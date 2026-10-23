-- ServeBiz migration 010: partial refunds (return some items of a sale).
-- Safe to run more than once. Run after 009_audit_overview.sql.

create table if not exists public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  reason text,
  refund_total numeric(12,2) not null check (refund_total >= 0),   -- what the customer gets back (incl. tax)
  refund_tax numeric(12,2) not null default 0 check (refund_tax >= 0),
  refund_cost numeric(12,2) not null default 0,                    -- cost of the goods taken back (for profit)
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_returns_sale on public.sale_returns (sale_id);
create index if not exists idx_returns_business_time on public.sale_returns (business_id, created_at desc);

create table if not exists public.sale_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.sale_returns(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  sale_item_id uuid not null references public.sale_items(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  amount numeric(12,2) not null default 0
);
create index if not exists idx_return_items_item on public.sale_return_items (sale_item_id);
create index if not exists idx_return_items_return on public.sale_return_items (return_id);

alter table public.sale_returns enable row level security;
alter table public.sale_return_items enable row level security;
drop policy if exists "see returns of visible sales" on public.sale_returns;
create policy "see returns of visible sales" on public.sale_returns for select using (public.can_view_sale(sale_id));
drop policy if exists "see return items of visible sales" on public.sale_return_items;
create policy "see return items of visible sales" on public.sale_return_items for select using (public.can_view_sale(sale_id));
revoke insert, update, delete on public.sale_returns from anon, authenticated;
revoke insert, update, delete on public.sale_return_items from anon, authenticated;

-- ───────── Refund some items ─────────
-- p_items: [{"sale_item_id": "...", "quantity": 2}, ...]. Stock goes back to the batches it came from.
-- Discount and tax are shared out in proportion to the items returned; returning everything refunds the exact remainder.
create or replace function public.refund_sale(p_sale_id uuid, p_items jsonb, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.sales%rowtype;
  v_return uuid;
  v_item record;
  v_req record;
  v_left integer;
  v_take integer;
  m record;
  v_ratio numeric;
  v_tax_ratio numeric;
  v_amount numeric;
  v_total numeric := 0;
  v_tax numeric := 0;
  v_cost numeric := 0;
  v_prior_total numeric;
  v_prior_tax numeric;
  v_remaining_after integer;
begin
  select * into v_sale from public.sales where id = p_sale_id for update;
  if v_sale.id is null then raise exception 'Sale not found'; end if;
  if not public.has_role(v_sale.business_id, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can refund a sale';
  end if;
  if v_sale.status <> 'completed' then raise exception 'Only completed sales can be refunded'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Choose at least one item to refund';
  end if;
  if jsonb_array_length(p_items) > 200 then raise exception 'Too many items'; end if;

  v_ratio := case when v_sale.subtotal > 0 then v_sale.total / v_sale.subtotal else 0 end;
  v_tax_ratio := case when v_sale.subtotal > 0 then v_sale.tax / v_sale.subtotal else 0 end;

  insert into public.sale_returns (business_id, sale_id, reason, refund_total)
  values (v_sale.business_id, p_sale_id, nullif(left(trim(coalesce(p_reason, '')), 300), ''), 0)
  returning id into v_return;

  -- merge duplicate lines, then process each
  for v_req in
    select (e ->> 'sale_item_id')::uuid as sale_item_id, sum((e ->> 'quantity')::integer) as qty
    from jsonb_array_elements(p_items) e
    group by 1
  loop
    if v_req.qty is null or v_req.qty <= 0 then raise exception 'Quantities must be above 0'; end if;

    select i.* into v_item from public.sale_items i where i.id = v_req.sale_item_id and i.sale_id = p_sale_id;
    if v_item.id is null then raise exception 'That item is not part of this sale'; end if;

    if v_req.qty > v_item.quantity - coalesce((select sum(r.quantity) from public.sale_return_items r where r.sale_item_id = v_item.id), 0) then
      raise exception 'You can refund at most % more of that item', v_item.quantity - coalesce((select sum(r.quantity) from public.sale_return_items r where r.sale_item_id = v_item.id), 0);
    end if;

    v_amount := round(v_item.unit_price * v_req.qty * v_ratio, 2);
    v_total := v_total + v_amount;
    v_tax := v_tax + round(v_item.unit_price * v_req.qty * v_tax_ratio, 2);
    v_cost := v_cost + v_item.unit_cost * v_req.qty;

    insert into public.sale_return_items (return_id, sale_id, sale_item_id, quantity, amount)
    values (v_return, p_sale_id, v_item.id, v_req.qty, v_amount);

    -- Put the stock back, most recently taken batch first, never more than was taken from each batch.
    v_left := v_req.qty;
    for m in
      select s.batch_id, (-s.quantity_change) - coalesce((
               select sum(r.quantity_change) from public.stock_movements r
               where r.sale_id = p_sale_id and r.movement_type = 'return' and r.batch_id = s.batch_id and r.product_id = s.product_id), 0) as available
      from public.stock_movements s
      where s.sale_id = p_sale_id and s.movement_type = 'sale' and s.product_id = v_item.product_id and s.batch_id is not null
      order by s.created_at desc, s.id desc
    loop
      exit when v_left <= 0;
      continue when m.available <= 0;
      v_take := least(v_left, m.available);
      update public.stock_batches set quantity_remaining = quantity_remaining + v_take where id = m.batch_id;
      insert into public.stock_movements (business_id, product_id, batch_id, movement_type, quantity_change, reason, sale_id)
      values (v_sale.business_id, v_item.product_id, m.batch_id, 'return', v_take,
              coalesce(nullif(left(trim(coalesce(p_reason, '')), 200), ''), 'Item returned') || ' (' || v_sale.receipt_no || ')', p_sale_id);
      v_left := v_left - v_take;
    end loop;
  end loop;

  -- is everything now returned?
  select coalesce(sum(i.quantity - coalesce((select sum(r.quantity) from public.sale_return_items r where r.sale_item_id = i.id), 0)), 0)
  into v_remaining_after
  from public.sale_items i where i.sale_id = p_sale_id;

  if v_remaining_after = 0 then
    select coalesce(sum(refund_total), 0), coalesce(sum(refund_tax), 0) into v_prior_total, v_prior_tax
    from public.sale_returns where sale_id = p_sale_id and id <> v_return;
    v_total := v_sale.total - v_prior_total;      -- exact remainder, so rounding never leaves cents behind
    v_tax := v_sale.tax - v_prior_tax;
    update public.sales set status = 'refunded' where id = p_sale_id;
  end if;

  update public.sale_returns
  set refund_total = greatest(v_total, 0), refund_tax = greatest(least(v_tax, v_total), 0), refund_cost = v_cost
  where id = v_return;

  return v_return;
end;
$$;
revoke all on function public.refund_sale(uuid, jsonb, text) from public, anon;
grant execute on function public.refund_sale(uuid, jsonb, text) to authenticated;

-- A sale with partial refunds is refunded, not voided (voiding would put the same stock back twice).
create or replace function public.void_sale(p_sale_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
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

  if v_business is null then raise exception 'Sale not found'; end if;
  if not public.has_role(v_business, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can void a sale';
  end if;
  if v_status <> 'completed' then raise exception 'Only completed sales can be voided'; end if;
  if exists (select 1 from public.sale_returns where sale_id = p_sale_id) then
    raise exception 'This sale already has refunds. Refund the remaining items instead of voiding it.';
  end if;

  for m in
    select product_id, batch_id, quantity_change
    from public.stock_movements
    where sale_id = p_sale_id and movement_type = 'sale' and batch_id is not null
  loop
    update public.stock_batches set quantity_remaining = quantity_remaining + (-m.quantity_change) where id = m.batch_id;
    insert into public.stock_movements (business_id, product_id, batch_id, movement_type, quantity_change, reason, sale_id)
    values (v_business, m.product_id, m.batch_id, 'return', -m.quantity_change,
            coalesce(nullif(trim(p_reason), ''), 'Sale voided') || ' (' || v_receipt || ')', p_sale_id);
  end loop;

  update public.sales set status = 'voided' where id = p_sale_id;
end;
$$;

-- ───────── Reports subtract refunds ─────────
-- Income is net of tax. Refunds are taken off on the day they happen. A sale refunded in full drops out entirely
-- (like a void), so only refunds on still-"completed" sales are subtracted.
create or replace function public.sales_totals(p_business_id uuid)
returns table (income numeric, sale_count bigint, cost numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(s.total - s.tax), 0)
      - coalesce((select sum(r.refund_total - r.refund_tax) from public.sale_returns r join public.sales x on x.id = r.sale_id
                  where r.business_id = p_business_id and x.status = 'completed'), 0),
    count(*),
    coalesce(sum((select sum(i.quantity * i.unit_cost) from public.sale_items i where i.sale_id = s.id)), 0)
      - coalesce((select sum(r.refund_cost) from public.sale_returns r join public.sales x on x.id = r.sale_id
                  where r.business_id = p_business_id and x.status = 'completed'), 0)
  from public.sales s
  where s.business_id = p_business_id
    and s.status = 'completed'
    and public.has_role(p_business_id, array['owner', 'manager']);
$$;

create or replace function public.sales_by_day(p_business_id uuid, p_days integer default 30, p_tz text default 'UTC')
returns table (day date, income numeric, orders bigint, cost numeric)
language sql
stable
security definer
set search_path = public
as $$
  with bounds as (
    select (now() at time zone p_tz)::date as today, greatest(least(coalesce(p_days, 30), 365), 1) as n
  ),
  days as (
    select (b.today - g)::date as d from bounds b, generate_series(0, (select n from bounds) - 1) g
  ),
  agg as (
    select (s.created_at at time zone p_tz)::date as d,
           sum(s.total - s.tax) as income,
           count(*) as orders,
           sum(coalesce((select sum(i.quantity * i.unit_cost) from public.sale_items i where i.sale_id = s.id), 0)) as cost
    from public.sales s, bounds b
    where s.business_id = p_business_id
      and s.status = 'completed'
      and public.has_role(p_business_id, array['owner', 'manager'])
      and s.created_at >= ((b.today - (b.n - 1))::timestamp at time zone p_tz)
    group by 1
  ),
  refunds as (
    select (r.created_at at time zone p_tz)::date as d,
           sum(r.refund_total - r.refund_tax) as income,
           sum(r.refund_cost) as cost
    from public.sale_returns r
    join public.sales x on x.id = r.sale_id and x.status = 'completed', bounds b
    where r.business_id = p_business_id
      and public.has_role(p_business_id, array['owner', 'manager'])
      and r.created_at >= ((b.today - (b.n - 1))::timestamp at time zone p_tz)
    group by 1
  )
  select days.d,
         coalesce(agg.income, 0) - coalesce(refunds.income, 0),
         coalesce(agg.orders, 0),
         coalesce(agg.cost, 0) - coalesce(refunds.cost, 0)
  from days
  left join agg on agg.d = days.d
  left join refunds on refunds.d = days.d
  order by days.d;
$$;

create or replace function public.top_products(p_business_id uuid, p_days integer default 30, p_tz text default 'UTC')
returns table (product_id uuid, name text, units bigint, sales numeric, profit numeric)
language sql
stable
security definer
set search_path = public
as $$
  with lines as (
    select i.product_id, i.unit_price, i.unit_cost,
           i.quantity - coalesce((select sum(r.quantity) from public.sale_return_items r where r.sale_item_id = i.id), 0) as qty
    from public.sale_items i
    join public.sales s on s.id = i.sale_id
    where s.business_id = p_business_id
      and s.status = 'completed'
      and public.has_role(p_business_id, array['owner', 'manager'])
      and s.created_at >= (((now() at time zone p_tz)::date - (greatest(least(coalesce(p_days, 30), 365), 1) - 1))::timestamp at time zone p_tz)
  )
  select p.id, p.name, sum(l.qty)::bigint, sum(l.qty * l.unit_price), sum(l.qty * (l.unit_price - l.unit_cost))
  from lines l
  join public.products p on p.id = l.product_id
  where l.qty > 0
  group by p.id, p.name
  order by sum(l.qty * l.unit_price) desc
  limit 10;
$$;

-- All-branches overview: same refund rule.
create or replace function public.org_overview(p_org uuid, p_days integer default 30)
returns table (
  business_id uuid, branch_name text, role text,
  income numeric, orders bigint, cost numeric,
  units_in_stock bigint, inventory_value numeric, low_stock integer, out_of_stock integer
)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select b.id, b.branch_name
    from public.businesses b
    join public.business_members m on m.business_id = b.id and m.user_id = auth.uid() and m.role = 'owner'
    where b.organization_id = p_org
  ),
  s as (
    select s.business_id,
           sum(s.total - s.tax) as income,
           count(*) as orders,
           sum((select sum(i.quantity * i.unit_cost) from public.sale_items i where i.sale_id = s.id)) as cost
    from public.sales s
    where s.business_id in (select id from mine)
      and s.status = 'completed'
      and (p_days is null or s.created_at >= now() - make_interval(days => greatest(least(p_days, 3650), 1)))
    group by s.business_id
  ),
  ref as (
    select r.business_id, sum(r.refund_total - r.refund_tax) as income, sum(r.refund_cost) as cost
    from public.sale_returns r
    join public.sales x on x.id = r.sale_id and x.status = 'completed'
    where r.business_id in (select id from mine)
      and (p_days is null or r.created_at >= now() - make_interval(days => greatest(least(p_days, 3650), 1)))
    group by r.business_id
  ),
  stock as (
    select b.business_id, sum(b.quantity_remaining) as units, sum(b.quantity_remaining * b.base_price) as value
    from public.stock_batches b
    where b.business_id in (select id from mine) and b.quantity_remaining > 0
    group by b.business_id
  ),
  per_product as (
    select p.business_id, p.reorder_level, p.is_active,
           coalesce((select sum(b.quantity_remaining) from public.stock_batches b where b.product_id = p.id), 0) as qty
    from public.products p
    where p.business_id in (select id from mine)
  ),
  alerts as (
    select business_id,
           count(*) filter (where is_active and reorder_level > 0 and qty <= reorder_level and qty > 0)::integer as low,
           count(*) filter (where is_active and qty = 0)::integer as out
    from per_product group by business_id
  )
  select mine.id, mine.branch_name, 'owner'::text,
         coalesce(s.income, 0) - coalesce(ref.income, 0), coalesce(s.orders, 0), coalesce(s.cost, 0) - coalesce(ref.cost, 0),
         coalesce(stock.units, 0)::bigint, coalesce(stock.value, 0),
         coalesce(alerts.low, 0), coalesce(alerts.out, 0)
  from mine
  left join s on s.business_id = mine.id
  left join ref on ref.business_id = mine.id
  left join stock on stock.business_id = mine.id
  left join alerts on alerts.business_id = mine.id
  order by lower(mine.branch_name);
$$;
grant execute on function public.org_overview(uuid, integer) to authenticated;

-- Audit log entry for refunds (needs migration 009; skipped quietly if the audit tables are not there)
do $$
begin
  if to_regprocedure('public.audit_write(uuid,text,text,text,jsonb)') is not null then
    execute $f$
      create or replace function public.trg_audit_returns() returns trigger
      language plpgsql security definer set search_path = public as $b$
      begin
        -- amounts are final only after refund_sale updates the row, so log on that update
        if tg_op = 'UPDATE' and old.refund_total = 0 and new.refund_total >= 0 and not exists (
             select 1 from public.audit_log a where a.business_id = new.business_id and a.action = 'sale.refunded' and a.details ->> 'return_id' = new.id::text) then
          perform public.audit_write(new.business_id, 'sale.refunded', 'sale',
            (select coalesce(s.receipt_no, s.id::text) from public.sales s where s.id = new.sale_id),
            jsonb_build_object('total', new.refund_total, 'reason', new.reason, 'return_id', new.id));
        end if;
        return new;
      end $b$;
    $f$;
    drop trigger if exists audit_returns on public.sale_returns;
    create trigger audit_returns after update on public.sale_returns
      for each row execute function public.trg_audit_returns();
  end if;
end $$;
