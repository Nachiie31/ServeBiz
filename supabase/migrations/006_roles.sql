-- ServeBiz migration 006: staff roles (owner, manager, cashier).
-- Run in Supabase SQL Editor AFTER 005_reports_tax.sql. Safe to run more than once.
--
--   owner    everything: settings, tax, team, plus all manager abilities
--   manager  inventory, receiving, suppliers, products and prices, reports, voiding sales
--   cashier  point of sale and their OWN sales only. Never sees costs, profit, or reports.
--
-- These rules live in the database (Row Level Security + checked functions), so they hold even if
-- someone bypasses the app and talks to the API directly.

-- ───────── Team members carry an email so the Team page can show who is who ─────────
alter table public.business_members add column if not exists email text;

update public.business_members m
set email = lower(u.email)
from auth.users u
where u.id = m.user_id and m.email is null and u.email is not null;

-- ───────── Role helpers (security definer so policies can use them without recursion) ─────────
create or replace function public.member_role(b uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from public.business_members where business_id = b and user_id = auth.uid();
$$;

create or replace function public.has_role(b uuid, roles text[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(public.member_role(b) = any(roles), false);
$$;

-- A manager/owner sees every sale of the business; a cashier sees only the sales they rang up.
create or replace function public.can_view_sale(p_sale uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.sales s
    where s.id = p_sale
      and (
        public.has_role(s.business_id, array['owner', 'manager'])
        or (s.cashier_id = auth.uid() and public.is_member(s.business_id))
      )
  );
$$;

-- The first person to create a business is its owner (now also remembering their email).
create or replace function public.create_business(
  p_name text,
  p_type text,
  p_logo_url text default null,
  p_location text default null,
  p_phone text default null,
  p_email text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  insert into public.businesses (name, business_type, logo_url, location, contact_phone, contact_email, created_by)
  values (p_name, p_type, p_logo_url, p_location, p_phone, p_email, auth.uid())
  returning id into new_id;

  insert into public.business_members (business_id, user_id, role, email)
  values (new_id, auth.uid(), 'owner', (select lower(u.email) from auth.users u where u.id = auth.uid()));

  return new_id;
end;
$$;

-- ───────── Row Level Security by role ─────────
do $$
declare t text;
begin
  foreach t in array array[
    'suppliers','categories','products','stock_batches',
    'stock_movements','sales','sale_items','payments'
  ] loop
    execute format('drop policy if exists "members all %1$s" on public.%1$I', t);
  end loop;
end $$;

-- Business details and tax: everyone on the team can read (the POS needs the tax rate),
-- only the owner can change them.
drop policy if exists "members update business" on public.businesses;
drop policy if exists "owner update business" on public.businesses;
create policy "owner update business" on public.businesses
  for update using (public.has_role(id, array['owner']))
  with check (public.has_role(id, array['owner']));

-- Team list: owner sees everyone, everybody else sees only themselves.
drop policy if exists "read own memberships" on public.business_members;
drop policy if exists "read memberships" on public.business_members;
create policy "read memberships" on public.business_members
  for select using (user_id = auth.uid() or public.has_role(business_id, array['owner']));

-- Manager-only tables (these hold costs and supplier details).
drop policy if exists "managers all suppliers" on public.suppliers;
create policy "managers all suppliers" on public.suppliers
  for all using (public.has_role(business_id, array['owner', 'manager']))
  with check (public.has_role(business_id, array['owner', 'manager']));

drop policy if exists "managers all stock_batches" on public.stock_batches;
create policy "managers all stock_batches" on public.stock_batches
  for all using (public.has_role(business_id, array['owner', 'manager']))
  with check (public.has_role(business_id, array['owner', 'manager']));

drop policy if exists "managers all stock_movements" on public.stock_movements;
create policy "managers all stock_movements" on public.stock_movements
  for all using (public.has_role(business_id, array['owner', 'manager']))
  with check (public.has_role(business_id, array['owner', 'manager']));

-- Products and categories: the whole team reads (the POS needs them), managers write.
drop policy if exists "members read categories" on public.categories;
create policy "members read categories" on public.categories
  for select using (public.is_member(business_id));
drop policy if exists "managers all categories" on public.categories;
create policy "managers all categories" on public.categories
  for all using (public.has_role(business_id, array['owner', 'manager']))
  with check (public.has_role(business_id, array['owner', 'manager']));

drop policy if exists "members read products" on public.products;
create policy "members read products" on public.products
  for select using (public.is_member(business_id));
drop policy if exists "managers all products" on public.products;
create policy "managers all products" on public.products
  for all using (public.has_role(business_id, array['owner', 'manager']))
  with check (public.has_role(business_id, array['owner', 'manager']));

-- Sales: read-only for everyone through these policies. Sales are only ever written by the
-- checked functions below (complete_sale / void_sale), never directly.
drop policy if exists "view sales" on public.sales;
create policy "view sales" on public.sales
  for select using (
    public.has_role(business_id, array['owner', 'manager'])
    or (cashier_id = auth.uid() and public.is_member(business_id))
  );
drop policy if exists "view sale_items" on public.sale_items;
create policy "view sale_items" on public.sale_items
  for select using (public.can_view_sale(sale_id));
drop policy if exists "view payments" on public.payments;
create policy "view payments" on public.payments
  for select using (public.can_view_sale(sale_id));

revoke insert, update, delete on public.sales, public.sale_items, public.payments from anon, authenticated;

-- What the shop paid for an item is not for cashiers' eyes: hide the cost column from the API.
-- (Reports read it through the manager-only functions below.)
revoke select on public.sale_items from anon, authenticated;
grant select (id, sale_id, business_id, product_id, quantity, unit_price) on public.sale_items to authenticated;

-- Stock levels for the POS. This view runs with its owner's rights so cashiers can see how many
-- units are left WITHOUT being able to read batches (which carry costs). It only returns rows for
-- businesses the caller belongs to.
create or replace view public.product_stock
with (security_invoker = false) as
select
  p.id as product_id,
  p.business_id,
  coalesce(sum(b.quantity_remaining), 0)::integer as total_quantity,
  min(b.expiry_date) filter (where b.quantity_remaining > 0) as nearest_expiry,
  coalesce(sum(b.quantity_remaining) filter (where b.expiry_date is null or b.expiry_date >= current_date), 0)::integer as sellable_quantity
from public.products p
left join public.stock_batches b on b.product_id = p.id
where public.is_member(p.business_id)
group by p.id, p.business_id;

-- ───────── Selling: cashiers can sell, so these run with elevated rights but check membership ─────────
alter function public.quote_sale(uuid, jsonb, text, numeric) security definer;
alter function public.complete_sale(uuid, jsonb, text, numeric, text, numeric, text, text) security definer;

-- ───────── Inventory functions: managers and owners only ─────────
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
  if not public.has_role(p_business_id, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can receive stock';
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
  if not public.has_role(v_business, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can remove stock';
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

-- Voiding a sale: managers and owners only. Runs with elevated rights because nobody writes
-- sales directly any more.
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

  if v_business is null then
    raise exception 'Sale not found';
  end if;
  if not public.has_role(v_business, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can void a sale';
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

-- ───────── Reports: managers and owners only (they contain costs and profit) ─────────
create or replace function public.sales_totals(p_business_id uuid)
returns table (income numeric, sale_count bigint, cost numeric)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(s.total - s.tax), 0),
    count(*),
    coalesce(sum((select sum(i.quantity * i.unit_cost) from public.sale_items i where i.sale_id = s.id)), 0)
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
      and public.has_role(p_business_id, array['owner', 'manager'])
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
security definer
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
    and public.has_role(p_business_id, array['owner', 'manager'])
    and s.created_at >= (((now() at time zone p_tz)::date - (greatest(least(coalesce(p_days, 30), 365), 1) - 1))::timestamp at time zone p_tz)
  group by p.id, p.name
  order by sum(i.quantity * i.unit_price) desc
  limit 10;
$$;

-- ───────── Inviting staff ─────────
-- The owner invites by email and picks a role. When that person signs up or logs in with the same
-- (confirmed) email, they join the business automatically.
create table if not exists public.business_invites (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null check (role in ('manager', 'cashier')),
  invited_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id, email)
);

alter table public.business_invites enable row level security;
drop policy if exists "owner reads invites" on public.business_invites;
create policy "owner reads invites" on public.business_invites
  for select using (public.has_role(business_id, array['owner']));
drop policy if exists "owner deletes invites" on public.business_invites;
create policy "owner deletes invites" on public.business_invites
  for delete using (public.has_role(business_id, array['owner']));
revoke insert, update on public.business_invites from anon, authenticated;

create or replace function public.invite_member(p_business_id uuid, p_email text, p_role text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id uuid;
  v_count integer;
begin
  if not public.has_role(p_business_id, array['owner']) then
    raise exception 'Only the owner can invite staff';
  end if;
  if p_role not in ('manager', 'cashier') then
    raise exception 'Choose manager or cashier';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Enter a valid email address';
  end if;
  if exists (select 1 from public.business_members where business_id = p_business_id and email = v_email) then
    raise exception '% is already on your team', v_email;
  end if;

  select (select count(*) from public.business_members where business_id = p_business_id)
       + (select count(*) from public.business_invites where business_id = p_business_id)
  into v_count;
  if v_count >= 25 then
    raise exception 'Team limit reached (25 people including pending invites)';
  end if;

  insert into public.business_invites (business_id, email, role)
  values (p_business_id, v_email, p_role)
  on conflict (business_id, email) do update set role = excluded.role
  returning id into v_id;

  return v_id;
end;
$$;

-- Turns pending invites for the logged-in person into memberships. Returns how many were claimed.
-- Only confirmed email accounts qualify, so nobody can claim an invite by typing someone else's
-- address at sign-up (keep "Confirm email" ON in production), and guests never qualify.
create or replace function public.claim_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_confirmed timestamptz;
  v_anon boolean;
  r record;
  n integer := 0;
begin
  if auth.uid() is null then
    return 0;
  end if;
  select lower(u.email), u.email_confirmed_at, coalesce(u.is_anonymous, false)
  into v_email, v_confirmed, v_anon
  from auth.users u where u.id = auth.uid();

  if v_email is null or v_confirmed is null or v_anon then
    return 0;
  end if;

  for r in select * from public.business_invites where email = v_email loop
    insert into public.business_members (business_id, user_id, role, email)
    values (r.business_id, auth.uid(), r.role, v_email)
    on conflict (business_id, user_id) do nothing;
    delete from public.business_invites where id = r.id;
    n := n + 1;
  end loop;

  return n;
end;
$$;

-- ───────── Managing the team ─────────
create or replace function public.set_member_role(p_business_id uuid, p_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  if not public.has_role(p_business_id, array['owner']) then
    raise exception 'Only the owner can change roles';
  end if;
  if p_role not in ('manager', 'cashier') then
    raise exception 'Choose manager or cashier';
  end if;
  select role into v_current from public.business_members
  where business_id = p_business_id and user_id = p_user_id;
  if v_current is null then
    raise exception 'That person is not on this team';
  end if;
  if v_current = 'owner' then
    raise exception 'The owner role cannot be changed';
  end if;
  update public.business_members set role = p_role
  where business_id = p_business_id and user_id = p_user_id;
end;
$$;

create or replace function public.remove_member(p_business_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  if not public.has_role(p_business_id, array['owner']) then
    raise exception 'Only the owner can remove staff';
  end if;
  select role into v_current from public.business_members
  where business_id = p_business_id and user_id = p_user_id;
  if v_current is null then
    raise exception 'That person is not on this team';
  end if;
  if v_current = 'owner' then
    raise exception 'The owner cannot be removed';
  end if;
  delete from public.business_members
  where business_id = p_business_id and user_id = p_user_id;
end;
$$;
