-- ServeBiz migration 002: inventory functions.
-- Run in Supabase SQL Editor AFTER schema.sql. Safe to run more than once.

-- Receive a delivery: creates the product if the code is new (inactive until priced),
-- adds a stock batch, and logs a ledger entry, all in one transaction.
create or replace function public.receive_stock(
  p_business_id uuid,
  p_code text,
  p_name text,
  p_supplier_id uuid,
  p_date_received date,
  p_expiry_date date,
  p_quantity integer,
  p_base_price numeric,
  p_batch_no text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_product uuid;
  v_batch uuid;
  v_code text := trim(p_code);
begin
  if not public.is_member(p_business_id) then
    raise exception 'You are not a member of this business';
  end if;
  if v_code = '' then
    raise exception 'Product code is required';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than 0';
  end if;
  if p_base_price is null or p_base_price < 0 then
    raise exception 'Base price cannot be negative';
  end if;
  if p_expiry_date is not null and p_expiry_date < p_date_received then
    raise exception 'Expiry date is earlier than the date received';
  end if;

  select id into v_product from public.products
  where business_id = p_business_id and code = v_code;

  if v_product is null then
    if coalesce(trim(p_name), '') = '' then
      raise exception 'Product name is required for a new product';
    end if;
    insert into public.products (business_id, code, name, is_active)
    values (p_business_id, v_code, trim(p_name), false)
    returning id into v_product;
  end if;

  insert into public.stock_batches (
    business_id, product_id, supplier_id, batch_no, date_received,
    expiry_date, quantity_received, quantity_remaining, base_price, notes
  ) values (
    p_business_id, v_product, p_supplier_id, nullif(trim(p_batch_no), ''), p_date_received,
    p_expiry_date, p_quantity, p_quantity, p_base_price, nullif(trim(p_notes), '')
  ) returning id into v_batch;

  insert into public.stock_movements (business_id, product_id, batch_id, movement_type, quantity_change, reason)
  values (p_business_id, v_product, v_batch, 'receive', p_quantity, 'Delivery received');

  return v_batch;
end;
$$;

-- Remove stock (damaged / expired / other) from batches, earliest expiry first,
-- or from one chosen batch. Fails without changes if there is not enough stock.
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_type text,
  p_quantity integer,
  p_reason text default null,
  p_batch_id uuid default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_business uuid;
  v_left integer := p_quantity;
  v_take integer;
  b record;
begin
  if p_type not in ('damaged', 'expired', 'adjustment') then
    raise exception 'Invalid adjustment type';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Quantity must be greater than 0';
  end if;
  if p_type = 'adjustment' and coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required for this adjustment';
  end if;

  select business_id into v_business from public.products where id = p_product_id;
  if v_business is null then
    raise exception 'Product not found';
  end if;
  if not public.is_member(v_business) then
    raise exception 'You are not a member of this business';
  end if;

  for b in
    select id, quantity_remaining
    from public.stock_batches
    where product_id = p_product_id
      and quantity_remaining > 0
      and (p_batch_id is null or id = p_batch_id)
    order by expiry_date asc nulls last, date_received asc, created_at asc
    for update
  loop
    exit when v_left = 0;
    v_take := least(b.quantity_remaining, v_left);

    update public.stock_batches
    set quantity_remaining = quantity_remaining - v_take
    where id = b.id;

    insert into public.stock_movements (business_id, product_id, batch_id, movement_type, quantity_change, reason)
    values (v_business, p_product_id, b.id, p_type, -v_take, nullif(trim(p_reason), ''));

    v_left := v_left - v_take;
  end loop;

  if v_left > 0 then
    raise exception 'Not enough stock: % unit(s) short', v_left;
  end if;
end;
$$;
