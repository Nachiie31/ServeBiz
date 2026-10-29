-- ServeBiz migration 005: tax settings + sales reporting.
-- Run in Supabase SQL Editor AFTER 004_stripe.sql. Safe to run more than once.

-- ───────── Tax settings ─────────
alter table public.businesses add column if not exists tax_name text not null default 'Tax';
alter table public.businesses add column if not exists tax_inclusive boolean not null default false;

-- Same signature as before, now aware of "prices already include tax".
--   exclusive: tax is added on top      -> total = subtotal - discount + tax
--   inclusive: tax is inside the price  -> total = subtotal - discount
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
  v_inclusive boolean;
  v_sub numeric := 0;
  v_disc numeric := 0;
  v_base numeric;
  v_tax numeric := 0;
  v_total numeric;
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

  select b.tax_rate, b.tax_inclusive into v_tax_rate, v_inclusive
  from public.businesses b where b.id = p_business_id;

  for v_line in
    select (e->>'product_id')::uuid as product_id, sum((e->>'quantity')::integer) as qty
    from jsonb_array_elements(p_items) e
    group by 1
  loop
    if v_line.qty is null or v_line.qty <= 0 then
      raise exception 'Quantities must be greater than 0';
    end if;

    select p.name, p.selling_price, p.is_active into v_prod
    from public.products p
    where p.id = v_line.product_id and p.business_id = p_business_id;
    if not found then
      raise exception 'A product in the cart was not found';
    end if;
    if not v_prod.is_active or v_prod.selling_price <= 0 then
      raise exception '% is not available for sale', v_prod.name;
    end if;

    select coalesce(sum(sb.quantity_remaining), 0) into v_avail
    from public.stock_batches sb
    where sb.product_id = v_line.product_id
      and sb.quantity_remaining > 0
      and (sb.expiry_date is null or sb.expiry_date >= current_date);
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

  v_base := v_sub - v_disc;
  if coalesce(v_inclusive, false) then
    v_tax := round(v_base * coalesce(v_tax_rate, 0) / (100 + coalesce(v_tax_rate, 0)), 2);
    v_total := v_base;
  else
    v_tax := round(v_base * coalesce(v_tax_rate, 0) / 100, 2);
    v_total := v_base + v_tax;
  end if;

  return query select v_sub, v_disc, v_tax, v_total;
end;
$$;

-- ───────── Reporting ─────────
-- "Income" = net sales: what customers paid minus tax (tax is not your income).
-- "Cost" = what the sold items cost you (unit_cost is captured at the moment of sale).
-- Only completed sales count; voided sales are excluded everywhere.

create or replace function public.sales_totals(p_business_id uuid)
returns table (income numeric, sale_count bigint, cost numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(sum(s.total - s.tax), 0),
    count(*),
    coalesce(sum((select sum(i.quantity * i.unit_cost) from public.sale_items i where i.sale_id = s.id)), 0)
  from public.sales s
  where s.business_id = p_business_id
    and s.status = 'completed'
    and public.is_member(p_business_id);
$$;

-- One row per day for the last p_days days (empty days included), in the viewer's timezone.
create or replace function public.sales_by_day(p_business_id uuid, p_days integer default 30, p_tz text default 'UTC')
returns table (day date, income numeric, orders bigint, cost numeric)
language sql
stable
security invoker
set search_path = public
as $$
  with bounds as (
    select
      (now() at time zone p_tz)::date as today,
      greatest(least(coalesce(p_days, 30), 365), 1) as n
  ),
  days as (
    select (b.today - g)::date as d
    from bounds b, generate_series(0, (select n from bounds) - 1) g
  ),
  agg as (
    select
      (s.created_at at time zone p_tz)::date as d,
      sum(s.total - s.tax) as income,
      count(*) as orders,
      sum(coalesce((select sum(i.quantity * i.unit_cost) from public.sale_items i where i.sale_id = s.id), 0)) as cost
    from public.sales s, bounds b
    where s.business_id = p_business_id
      and s.status = 'completed'
      and public.is_member(p_business_id)
      and s.created_at >= ((b.today - (b.n - 1))::timestamp at time zone p_tz)
    group by 1
  )
  select days.d, coalesce(agg.income, 0), coalesce(agg.orders, 0), coalesce(agg.cost, 0)
  from days left join agg on agg.d = days.d
  order by days.d;
$$;

create or replace function public.top_products(p_business_id uuid, p_days integer default 30, p_tz text default 'UTC')
returns table (product_id uuid, name text, units bigint, sales numeric, profit numeric)
language sql
stable
security invoker
set search_path = public
as $$
  select
    p.id,
    p.name,
    sum(i.quantity)::bigint,
    sum(i.quantity * i.unit_price),
    sum(i.quantity * (i.unit_price - i.unit_cost))
  from public.sale_items i
  join public.sales s on s.id = i.sale_id
  join public.products p on p.id = i.product_id
  where s.business_id = p_business_id
    and s.status = 'completed'
    and public.is_member(p_business_id)
    and s.created_at >= (((now() at time zone p_tz)::date - (greatest(least(coalesce(p_days, 30), 365), 1) - 1))::timestamp at time zone p_tz)
  group by p.id, p.name
  order by sum(i.quantity * i.unit_price) desc
  limit 10;
$$;
