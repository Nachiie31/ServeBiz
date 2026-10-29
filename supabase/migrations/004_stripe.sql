-- ServeBiz migration 004: Stripe test payments.
-- Run in Supabase SQL Editor AFTER 003_pos.sql. Safe to run more than once.

-- A Stripe payment can only ever create one sale (protects against double-recording).
create unique index if not exists idx_payments_stripe_pi
  on public.payments(stripe_payment_intent) where stripe_payment_intent is not null;

-- The old signature is replaced (keeping both would make calls ambiguous).
drop function if exists public.complete_sale(uuid, jsonb, text, numeric, text, numeric, text);

-- ───────── Quote: validate a cart and compute totals, changing nothing ─────────
-- Single source of truth for pricing. Used before sending the customer to Stripe
-- and again when the sale is recorded.
create or replace function public.quote_sale(
  p_business_id uuid,
  p_items jsonb,
  p_discount_type text default 'amount',
  p_discount_value numeric default 0
)
returns table (subtotal numeric, discount numeric, tax numeric, total numeric)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_line record;
  v_prod record;
  v_avail integer;
  v_tax_rate numeric;
  v_sub numeric := 0;
  v_disc numeric := 0;
  v_tax numeric := 0;
begin
  if not public.is_member(p_business_id) then
    raise exception 'You are not a member of this business';
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

  for v_line in
    select (e->>'product_id')::uuid as product_id, sum((e->>'quantity')::integer) as qty
    from jsonb_array_elements(p_items) e
    group by 1
  loop
    if v_line.qty is null or v_line.qty <= 0 then
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

    select coalesce(sum(quantity_remaining), 0) into v_avail
    from public.stock_batches
    where product_id = v_line.product_id
      and quantity_remaining > 0
      and (expiry_date is null or expiry_date >= current_date);
    if v_avail < v_line.qty then
      raise exception 'Not enough stock for % (% available)', v_prod.name, v_avail;
    end if;

    v_sub := v_sub + v_prod.selling_price * v_line.qty;
  end loop;

  if p_discount_type = 'percent' then
    if p_discount_value > 100 then
      raise exception 'Discount cannot exceed 100 percent';
    end if;
    v_disc := round(v_sub * coalesce(p_discount_value, 0) / 100, 2);
  else
    if coalesce(p_discount_value, 0) > v_sub then
      raise exception 'Discount cannot be more than the subtotal';
    end if;
    v_disc := round(coalesce(p_discount_value, 0), 2);
  end if;

  v_tax := round((v_sub - v_disc) * coalesce(v_tax_rate, 0) / 100, 2);

  return query select v_sub, v_disc, v_tax, v_sub - v_disc + v_tax;
end;
$$;

-- ───────── Complete a sale (now also accepts Stripe payments) ─────────
create or replace function public.complete_sale(
  p_business_id uuid,
  p_items jsonb,
  p_discount_type text default 'amount',
  p_discount_value numeric default 0,
  p_method text default 'cash',          -- 'cash' | 'card' | 'ewallet' | 'stripe'
  p_tendered numeric default null,
  p_reference text default null,
  p_stripe_pi text default null
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
  v_q record;
  v_line record;
  v_prod record;
  b record;
  v_left integer;
  v_take integer;
  v_cost numeric;
begin
  if p_method not in ('cash', 'card', 'ewallet', 'stripe') then
    raise exception 'Invalid payment method';
  end if;
  if p_method = 'stripe' and coalesce(trim(p_stripe_pi), '') = '' then
    raise exception 'A Stripe payment reference is required';
  end if;

  -- Validates membership, cart, prices and stock, and returns the totals
  select * into v_q from public.quote_sale(p_business_id, p_items, p_discount_type, p_discount_value);

  if p_method = 'cash' and coalesce(p_tendered, v_q.total) < v_q.total then
    raise exception 'Cash received is less than the total';
  end if;

  update public.businesses
  set next_receipt_no = next_receipt_no + 1
  where id = p_business_id
  returning next_receipt_no - 1 into v_no;
  v_receipt := 'R-' || lpad(v_no::text, 6, '0');

  insert into public.sales (business_id, receipt_no, subtotal, discount, tax, total, status)
  values (p_business_id, v_receipt, v_q.subtotal, v_q.discount, v_q.tax, v_q.total, 'completed')
  returning id into v_sale;

  for v_line in
    select (e->>'product_id')::uuid as product_id, sum((e->>'quantity')::integer) as qty
    from jsonb_array_elements(p_items) e
    group by 1
  loop
    select name, selling_price into v_prod from public.products where id = v_line.product_id;
    v_left := v_line.qty;
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
    values (v_sale, p_business_id, v_line.product_id, v_line.qty, v_prod.selling_price, round(v_cost / v_line.qty, 2));
  end loop;

  insert into public.payments (sale_id, business_id, method, amount, amount_tendered, reference, stripe_payment_intent)
  values (
    v_sale, p_business_id, p_method, v_q.total,
    case when p_method = 'cash' then coalesce(p_tendered, v_q.total) else v_q.total end,
    coalesce(nullif(trim(p_reference), ''), nullif(trim(p_stripe_pi), '')),
    case when p_method = 'stripe' then trim(p_stripe_pi) else null end
  );

  return v_sale;
end;
$$;
