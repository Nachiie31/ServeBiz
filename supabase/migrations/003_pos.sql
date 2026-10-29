-- ServeBiz migration 003: point of sale.
-- Run in Supabase SQL Editor AFTER schema.sql and 002_inventory.sql. Safe to run more than once.

-- ───────── Extra columns ─────────
alter table public.stock_movements add column if not exists sale_id uuid references public.sales(id) on delete set null;
alter table public.payments add column if not exists amount_tendered numeric(12,2);
alter table public.payments add column if not exists reference text;
alter table public.businesses add column if not exists next_receipt_no integer not null default 1;

create unique index if not exists idx_sales_receipt on public.sales(business_id, receipt_no);
create index if not exists idx_movements_sale on public.stock_movements(sale_id);

-- Stock view: adds sellable_quantity (expired batches are never sold)
create or replace view public.product_stock
with (security_invoker = true) as
select
  p.id as product_id,
  p.business_id,
  coalesce(sum(b.quantity_remaining), 0)::integer as total_quantity,
  min(b.expiry_date) filter (where b.quantity_remaining > 0) as nearest_expiry,
  coalesce(sum(b.quantity_remaining) filter (where b.expiry_date is null or b.expiry_date >= current_date), 0)::integer as sellable_quantity
from public.products p
left join public.stock_batches b on b.product_id = p.id
group by p.id, p.business_id;

-- ───────── Complete a sale ─────────
-- Prices come from the products table (never from the browser). Stock is taken from the
-- earliest-expiring, non-expired batches. Everything happens in one transaction: if any
-- line lacks stock, nothing is saved.
create or replace function public.complete_sale(
  p_business_id uuid,
  p_items jsonb,                       -- [{"product_id": "...", "quantity": 2}, ...]
  p_discount_type text default 'amount', -- 'amount' or 'percent'
  p_discount_value numeric default 0,
  p_method text default 'cash',          -- 'cash' | 'card' | 'ewallet'
  p_tendered numeric default null,
  p_reference text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale uuid;
  v_no integer;
  v_receipt text;
  v_tax_rate numeric;
  v_line record;
  v_prod record;
  b record;
  v_qty integer;
  v_left integer;
  v_take integer;
  v_cost numeric;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_tax numeric := 0;
  v_total numeric := 0;
begin
  if not public.is_member(p_business_id) then
    raise exception 'You are not a member of this business';
  end if;
  if p_method not in ('cash', 'card', 'ewallet') then
    raise exception 'Invalid payment method';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'The cart is empty';
  end if;
  if p_discount_type not in ('amount', 'percent') then
    raise exception 'Invalid discount type';
  end if;
  if coalesce(p_discount_value, 0) < 0 then
    raise exception 'Discount cannot be negative';
  end if;

  select tax_rate into v_tax_rate from public.businesses where id = p_business_id;

  -- Pass 1: validate lines and compute the subtotal
  for v_line in
    select (e->>'product_id')::uuid as product_id, sum((e->>'quantity')::integer) as qty
    from jsonb_array_elements(p_items) e
    group by 1
  loop
    v_qty := v_line.qty;
    if v_qty is null or v_qty <= 0 then
      raise exception 'Quantities must be greater than 0';
    end if;
    select name, selling_price, is_active into v_prod
    from public.products
    where id = v_line.product_id and business_id = p_business_id;
    if not found then
      raise exception 'A product in the cart was not found';
    end if;
    if not v_prod.is_active or v_prod.selling_price <= 0 then
      raise exception '% is not available for sale', v_prod.name;
    end if;
    v_subtotal := v_subtotal + v_prod.selling_price * v_qty;
  end loop;

  if p_discount_type = 'percent' then
    if p_discount_value > 100 then
      raise exception 'Discount cannot exceed 100 percent';
    end if;
    v_discount := round(v_subtotal * coalesce(p_discount_value, 0) / 100, 2);
  else
    if coalesce(p_discount_value, 0) > v_subtotal then
      raise exception 'Discount cannot be more than the subtotal';
    end if;
    v_discount := round(coalesce(p_discount_value, 0), 2);
  end if;

  v_tax := round((v_subtotal - v_discount) * coalesce(v_tax_rate, 0) / 100, 2);
  v_total := v_subtotal - v_discount + v_tax;

  if p_method = 'cash' and coalesce(p_tendered, v_total) < v_total then
    raise exception 'Cash received is less than the total';
  end if;

  -- Receipt number (per business)
  update public.businesses
  set next_receipt_no = next_receipt_no + 1
  where id = p_business_id
  returning next_receipt_no - 1 into v_no;
  v_receipt := 'R-' || lpad(v_no::text, 6, '0');

  insert into public.sales (business_id, receipt_no, subtotal, discount, tax, total, status)
  values (p_business_id, v_receipt, v_subtotal, v_discount, v_tax, v_total, 'completed')
  returning id into v_sale;

  -- Pass 2: deduct stock (earliest expiry first, skipping expired batches) and record lines
  for v_line in
    select (e->>'product_id')::uuid as product_id, sum((e->>'quantity')::integer) as qty
    from jsonb_array_elements(p_items) e
    group by 1
  loop
    v_qty := v_line.qty;
    select name, selling_price into v_prod from public.products where id = v_line.product_id;
    v_left := v_qty;
    v_cost := 0;

    for b in
      select id, quantity_remaining, base_price
      from public.stock_batches
      where product_id = v_line.product_id
        and quantity_remaining > 0
        and (expiry_date is null or expiry_date >= current_date)
      order by expiry_date asc nulls last, date_received asc, created_at asc
      for update
    loop
      exit when v_left = 0;
      v_take := least(b.quantity_remaining, v_left);

      update public.stock_batches
      set quantity_remaining = quantity_remaining - v_take
      where id = b.id;

      insert into public.stock_movements (business_id, product_id, batch_id, movement_type, quantity_change, reason, sale_id)
      values (p_business_id, v_line.product_id, b.id, 'sale', -v_take, 'Sale ' || v_receipt, v_sale);

      v_cost := v_cost + v_take * b.base_price;
      v_left := v_left - v_take;
    end loop;

    if v_left > 0 then
      raise exception 'Not enough stock for % (% short)', v_prod.name, v_left;
    end if;

    insert into public.sale_items (sale_id, business_id, product_id, quantity, unit_price, unit_cost)
    values (v_sale, p_business_id, v_line.product_id, v_qty, v_prod.selling_price, round(v_cost / v_qty, 2));
  end loop;

  insert into public.payments (sale_id, business_id, method, amount, amount_tendered, reference)
  values (
    v_sale, p_business_id, p_method, v_total,
    case when p_method = 'cash' then coalesce(p_tendered, v_total) else v_total end,
    nullif(trim(p_reference), '')
  );

  return v_sale;
end;
$$;

-- ───────── Void a sale: put the stock back into the same batches ─────────
create or replace function public.void_sale(p_sale_id uuid, p_reason text default null)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_business uuid;
  v_status text;
  v_receipt text;
  m record;
begin
  select business_id, status, receipt_no into v_business, v_status, v_receipt
  from public.sales where id = p_sale_id for update;

  if v_business is null then
    raise exception 'Sale not found';
  end if;
  if not public.is_member(v_business) then
    raise exception 'You are not a member of this business';
  end if;
  if v_status <> 'completed' then
    raise exception 'Only completed sales can be voided';
  end if;

  for m in
    select product_id, batch_id, quantity_change
    from public.stock_movements
    where sale_id = p_sale_id and movement_type = 'sale' and batch_id is not null
  loop
    update public.stock_batches
    set quantity_remaining = quantity_remaining + (-m.quantity_change)
    where id = m.batch_id;

    insert into public.stock_movements (business_id, product_id, batch_id, movement_type, quantity_change, reason, sale_id)
    values (v_business, m.product_id, m.batch_id, 'return', -m.quantity_change,
            coalesce(nullif(trim(p_reason), ''), 'Sale voided') || ' (' || v_receipt || ')', p_sale_id);
  end loop;

  update public.sales set status = 'voided' where id = p_sale_id;
end;
$$;
