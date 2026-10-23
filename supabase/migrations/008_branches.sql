-- ServeBiz migration 008: multiple businesses, each with branches.
-- Run in Supabase SQL Editor AFTER 007_demo.sql. Safe to run more than once.
--
-- Model
--   organization  = a business (for example "Brew Cafe"). One person can run several.
--   branch        = a row in `businesses` that belongs to an organization ("Makati", "Cubao").
--                   Each branch has its OWN products, stock, sales, staff and settings.
--
-- Rules enforced here, in the database:
--   * Only the owner of a business can add branches to it.
--   * Staff invites: an email that already belongs to (or is invited to) a DIFFERENT business is
--     refused. The same email may work in several branches of the SAME business.
--   * Guest (demo) accounts keep a single demo business.

-- ───────── Organizations ─────────
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.businesses add column if not exists organization_id uuid references public.organizations(id) on delete cascade;
alter table public.businesses add column if not exists branch_name text;

-- Existing businesses each become their own organization with a "Main branch".
do $$
declare r record; o uuid;
begin
  for r in select id, name, created_by from public.businesses where organization_id is null loop
    insert into public.organizations (name, created_by) values (left(btrim(r.name), 100), r.created_by) returning id into o;
    update public.businesses set organization_id = o where id = r.id;
  end loop;
end $$;

update public.businesses set branch_name = 'Main branch' where branch_name is null or btrim(branch_name) = '';

-- Anything inserted from now on (including the demo seeder) gets an organization automatically.
create or replace function public.businesses_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id is null then
    insert into public.organizations (name, created_by)
    values (left(btrim(new.name), 100), new.created_by)
    returning id into new.organization_id;
  end if;
  if new.branch_name is null or btrim(new.branch_name) = '' then
    new.branch_name := 'Main branch';
  end if;
  return new;
end;
$$;
drop trigger if exists businesses_before_insert on public.businesses;
create trigger businesses_before_insert before insert on public.businesses
  for each row execute function public.businesses_before_insert();

alter table public.businesses alter column organization_id set not null;
alter table public.businesses alter column branch_name set not null;
alter table public.businesses alter column branch_name set default 'Main branch';

-- A branch can never be moved to another business.
create or replace function public.businesses_lock_org()
returns trigger
language plpgsql
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'A branch cannot be moved to another business';
  end if;
  return new;
end;
$$;
drop trigger if exists businesses_lock_org on public.businesses;
create trigger businesses_lock_org before update on public.businesses
  for each row execute function public.businesses_lock_org();

create index if not exists idx_businesses_org on public.businesses(organization_id);
create unique index if not exists idx_businesses_branch_name on public.businesses(organization_id, lower(branch_name));

-- ───────── Helpers (security definer so policies can use them without recursion) ─────────
create or replace function public.org_of(b uuid)
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select organization_id from public.businesses where id = b;
$$;

create or replace function public.is_org_member(o uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.business_members m
    join public.businesses b on b.id = m.business_id
    where b.organization_id = o and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_org_owner(o uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.business_members m
    join public.businesses b on b.id = m.business_id
    where b.organization_id = o and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- ───────── Row Level Security for organizations ─────────
alter table public.organizations enable row level security;

drop policy if exists "members read organization" on public.organizations;
create policy "members read organization" on public.organizations
  for select using (public.is_org_member(id));

drop policy if exists "owner rename organization" on public.organizations;
create policy "owner rename organization" on public.organizations
  for update using (public.is_org_owner(id)) with check (public.is_org_owner(id));

revoke insert, delete on public.organizations from anon, authenticated;

-- ───────── Creating businesses and branches ─────────
-- New signature (adds the first branch's name). The old one is dropped so calls are not ambiguous.
drop function if exists public.create_business(text, text, text, text, text, text);

create or replace function public.create_business(
  p_name text,
  p_type text,
  p_logo_url text default null,
  p_location text default null,
  p_phone text default null,
  p_email text default null,
  p_branch_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  v_anon boolean;
  v_name text := btrim(coalesce(p_name, ''));
  v_branch text := nullif(btrim(coalesce(p_branch_name, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if v_name = '' then
    raise exception 'Business name is required';
  end if;
  if length(v_name) > 100 then
    raise exception 'Business name is too long (100 characters at most)';
  end if;
  if v_branch is not null and length(v_branch) > 60 then
    raise exception 'Branch name is too long (60 characters at most)';
  end if;

  select coalesce(u.is_anonymous, false) into v_anon from auth.users u where u.id = auth.uid();
  if v_anon and exists (select 1 from public.business_members where user_id = auth.uid()) then
    raise exception 'Guest accounts get one demo business. Sign up to create your own.';
  end if;
  if (select count(*) from public.organizations where created_by = auth.uid()) >= 10 then
    raise exception 'You can run up to 10 businesses';
  end if;

  insert into public.businesses (name, business_type, logo_url, location, contact_phone, contact_email, created_by, branch_name)
  values (v_name, p_type, p_logo_url, p_location, p_phone, p_email, auth.uid(), v_branch)
  returning id into new_id;

  insert into public.business_members (business_id, user_id, role, email)
  values (new_id, auth.uid(), 'owner', (select lower(u.email) from auth.users u where u.id = auth.uid()));

  return new_id;
end;
$$;

-- Adds a branch to the same business as p_source_business. Currency, tax and type are copied from
-- the source branch; products, stock, sales and staff start empty.
create or replace function public.create_branch(
  p_source_business uuid,
  p_branch_name text,
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
  v_org uuid;
  v_org_name text;
  v_branch text := btrim(coalesce(p_branch_name, ''));
  v_anon boolean;
  s record;
  new_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select coalesce(u.is_anonymous, false) into v_anon from auth.users u where u.id = auth.uid();
  if v_anon then
    raise exception 'Guest accounts cannot add branches. Sign up to create your own business.';
  end if;
  if not public.has_role(p_source_business, array['owner']) then
    raise exception 'Only the owner can add a branch';
  end if;
  if v_branch = '' then
    raise exception 'Branch name is required';
  end if;
  if length(v_branch) > 60 then
    raise exception 'Branch name is too long (60 characters at most)';
  end if;

  select * into s from public.businesses where id = p_source_business;
  v_org := s.organization_id;
  select name into v_org_name from public.organizations where id = v_org;

  if (select count(*) from public.businesses where organization_id = v_org) >= 20 then
    raise exception 'A business can have up to 20 branches';
  end if;
  if exists (select 1 from public.businesses where organization_id = v_org and lower(branch_name) = lower(v_branch)) then
    raise exception 'This business already has a branch called %', v_branch;
  end if;

  insert into public.businesses (
    name, business_type, logo_url, location, contact_phone, contact_email,
    currency, tax_rate, tax_name, tax_inclusive, created_by, organization_id, branch_name
  ) values (
    left(v_org_name || ' - ' || v_branch, 100), s.business_type, s.logo_url,
    nullif(btrim(coalesce(p_location, '')), ''), nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_email, '')), ''),
    s.currency, s.tax_rate, s.tax_name, s.tax_inclusive, auth.uid(), v_org, v_branch
  ) returning id into new_id;

  insert into public.business_members (business_id, user_id, role, email)
  values (new_id, auth.uid(), 'owner', (select lower(u.email) from auth.users u where u.id = auth.uid()));

  return new_id;
end;
$$;

-- ───────── Staff invites: one business per person (branches of it are fine) ─────────
create or replace function public.invite_member(p_business_id uuid, p_email text, p_role text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
  v_count integer;
  v_org uuid;
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

  v_org := public.org_of(p_business_id);

  if exists (
    select 1 from public.business_members m
    left join auth.users u on u.id = m.user_id
    where m.business_id = p_business_id and (m.email = v_email or lower(u.email) = v_email)
  ) then
    raise exception '% is already on this branch''s team', v_email;
  end if;

  -- Already working for, or invited to, a DIFFERENT business?
  if exists (
    select 1 from public.business_members m
    join public.businesses b on b.id = m.business_id
    left join auth.users u on u.id = m.user_id
    where b.organization_id <> v_org and (m.email = v_email or lower(u.email) = v_email)
  ) or exists (
    select 1 from public.business_invites i
    join public.businesses b on b.id = i.business_id
    where b.organization_id <> v_org and i.email = v_email
  ) then
    raise exception '% already belongs to a different business, so they cannot be invited here. One email can work in several branches of the same business, but not in two businesses.', v_email;
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

-- Joining via invite. Invites from a business other than the one the person already belongs to are
-- skipped (they stay pending), so nobody ends up in two businesses through old invites.
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

  for r in
    select i.id, i.business_id, i.role, b.organization_id as org
    from public.business_invites i
    join public.businesses b on b.id = i.business_id
    where i.email = v_email
    order by i.created_at, i.id
  loop
    if exists (
      select 1 from public.business_members m
      join public.businesses mb on mb.id = m.business_id
      where m.user_id = auth.uid() and mb.organization_id <> r.org
    ) then
      continue;
    end if;
    insert into public.business_members (business_id, user_id, role, email)
    values (r.business_id, auth.uid(), r.role, v_email)
    on conflict (business_id, user_id) do nothing;
    delete from public.business_invites where id = r.id;
    n := n + 1;
  end loop;

  return n;
end;
$$;

-- ───────── Demo accounts also remove their organization ─────────
create or replace function public.reset_demo()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anon boolean;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select coalesce(u.is_anonymous, false) into v_anon from auth.users u where u.id = auth.uid();
  if not coalesce(v_anon, false) then
    raise exception 'Only guest logins can reset the demo';
  end if;
  delete from public.organizations where created_by = auth.uid();   -- cascades to its branches and data
  return public.seed_demo_business(auth.uid());
end;
$$;

create or replace function public.purge_old_demos(p_hours integer default 24)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.organizations o
  using auth.users u
  where o.created_by = u.id
    and u.is_anonymous
    and u.created_at < now() - make_interval(hours => p_hours);

  with gone as (
    delete from auth.users
    where is_anonymous and created_at < now() - make_interval(hours => p_hours)
    returning 1
  )
  select count(*) into n from gone;

  return n;
end;
$$;
revoke all on function public.purge_old_demos(integer) from public, anon, authenticated;

-- ───────── Paged product list (so large catalogs are never loaded all at once) ─────────
-- Runs with the caller's rights: cashiers get no cost column, other businesses' rows never appear.
create or replace function public.list_products(
  p_business_id uuid,
  p_q text default '',
  p_filter text default 'all',
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid, code text, barcode text, name text, category_name text, unit text,
  selling_price numeric, reorder_level integer, is_active boolean,
  total_quantity integer, nearest_expiry date, latest_cost numeric, total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select
      trim(coalesce(p_q, '')) = '' as no_query,
      '%' || replace(replace(replace(trim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pattern
  ),
  base as (
    select
      p.id, p.code, p.barcode, p.name, c.name as category_name, p.unit, p.selling_price, p.reorder_level, p.is_active,
      coalesce(s.total_quantity, 0)::integer as total_quantity,
      s.nearest_expiry,
      (select sb.base_price from public.stock_batches sb where sb.product_id = p.id order by sb.created_at desc limit 1) as latest_cost
    from public.products p
    cross join params
    left join public.categories c on c.id = p.category_id
    left join public.product_stock s on s.product_id = p.id
    where p.business_id = p_business_id
      and public.is_member(p_business_id)
      and (
        params.no_query
        or p.name ilike params.pattern
        or p.code ilike params.pattern
        or coalesce(p.barcode, '') ilike params.pattern
      )
  )
  select
    b.id, b.code, b.barcode, b.name, b.category_name, b.unit, b.selling_price, b.reorder_level, b.is_active,
    b.total_quantity, b.nearest_expiry, b.latest_cost,
    count(*) over () as total_count
  from base b
  where case coalesce(p_filter, 'all')
    when 'pricing' then (not b.is_active or b.selling_price <= 0)
    when 'low' then (b.reorder_level > 0 and b.total_quantity <= b.reorder_level)
    when 'out' then b.total_quantity = 0
    else true
  end
  order by lower(b.name), b.id
  limit greatest(least(coalesce(p_limit, 25), 200), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
