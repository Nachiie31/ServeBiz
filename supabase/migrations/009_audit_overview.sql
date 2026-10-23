-- ServeBiz migration 009: audit log + all-branches overview.
-- Safe to run more than once. Run after 008_branches.sql.

-- ───────── Audit log ─────────
-- Written only by triggers (clients cannot insert, edit or delete rows). Owners of a branch read its log.
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,                 -- no foreign key on purpose: deletes of a whole business must never fail on the log
  actor_id uuid,
  actor_email text,
  action text not null,                      -- e.g. product.price_changed
  entity text not null,                      -- product | sale | stock | member | invite | settings
  entity_label text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_business_time on public.audit_log (business_id, created_at desc, id desc);
create index if not exists idx_audit_business_action on public.audit_log (business_id, action);

alter table public.audit_log enable row level security;
drop policy if exists "owner reads audit log" on public.audit_log;
create policy "owner reads audit log" on public.audit_log
  for select using (public.has_role(business_id, array['owner']));
revoke insert, update, delete on public.audit_log from anon, authenticated;

create or replace function public.audit_write(
  p_business uuid, p_action text, p_entity text, p_label text, p_details jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
begin
  if current_setting('servebiz.no_audit', true) = '1' then return; end if;   -- demo seeding is not "activity"
  if v_actor is not null then
    select coalesce(
      (select m.email from public.business_members m where m.business_id = p_business and m.user_id = v_actor),
      (select u.email from auth.users u where u.id = v_actor)
    ) into v_email;
  end if;
  insert into public.audit_log (business_id, actor_id, actor_email, action, entity, entity_label, details)
  values (p_business, v_actor, v_email, p_action, p_entity, left(p_label, 200), coalesce(p_details, '{}'::jsonb));
end;
$$;
revoke all on function public.audit_write(uuid, text, text, text, jsonb) from public, anon, authenticated;

alter function public.seed_demo_business(uuid) set servebiz.no_audit = '1';

-- Small helper: {"field": [old, new]} for the fields that changed.
create or replace function public.audit_diff(p_old jsonb, p_new jsonb, p_fields text[])
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(f, jsonb_build_array(p_old -> f, p_new -> f)), '{}'::jsonb)
  from unnest(p_fields) f
  where (p_old -> f) is distinct from (p_new -> f);
$$;
revoke all on function public.audit_diff(jsonb, jsonb, text[]) from public, anon, authenticated;

-- products
create or replace function public.trg_audit_products() returns trigger
language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.audit_write(new.business_id, 'product.created', 'product', new.name || ' (' || new.code || ')',
      jsonb_build_object('selling_price', new.selling_price));
    return new;
  elsif tg_op = 'UPDATE' then
    d := public.audit_diff(to_jsonb(old), to_jsonb(new), array['name','code','barcode','selling_price','reorder_level','is_active','unit','category_id']);
    if d <> '{}'::jsonb then
      perform public.audit_write(new.business_id,
        case when d ? 'selling_price' then 'product.price_changed' else 'product.edited' end,
        'product', new.name || ' (' || new.code || ')', d);
    end if;
    return new;
  else
    if exists (select 1 from public.businesses b where b.id = old.business_id) then
      perform public.audit_write(old.business_id, 'product.deleted', 'product', old.name || ' (' || old.code || ')');
    end if;
    return old;
  end if;
end $$;
drop trigger if exists audit_products on public.products;
create trigger audit_products after insert or update or delete on public.products
  for each row execute function public.trg_audit_products();

-- sales: voids only (every sale already lives in sales history)
create or replace function public.trg_audit_sales() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status is distinct from new.status and new.status = 'voided' then
    perform public.audit_write(new.business_id, 'sale.voided', 'sale', coalesce(new.receipt_no, new.id::text),
      jsonb_build_object('total', new.total));
  end if;
  return new;
end $$;
drop trigger if exists audit_sales on public.sales;
create trigger audit_sales after update on public.sales
  for each row execute function public.trg_audit_sales();

-- stock: deliveries and manual corrections (not sales or sale returns)
create or replace function public.trg_audit_stock() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_label text;
begin
  if new.movement_type in ('receive', 'adjustment', 'expired', 'damaged') then
    select p.name || ' (' || p.code || ')' into v_label from public.products p where p.id = new.product_id;
    perform public.audit_write(new.business_id,
      case new.movement_type when 'receive' then 'stock.received' else 'stock.adjusted' end,
      'stock', v_label,
      jsonb_build_object('type', new.movement_type, 'change', new.quantity_change, 'reason', new.reason));
  end if;
  return new;
end $$;
drop trigger if exists audit_stock on public.stock_movements;
create trigger audit_stock after insert on public.stock_movements
  for each row execute function public.trg_audit_stock();

-- team
create or replace function public.trg_audit_members() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if tg_op = 'INSERT' then
    select coalesce(new.email, (select u.email from auth.users u where u.id = new.user_id)) into v_email;
    if new.role <> 'owner' then
      perform public.audit_write(new.business_id, 'member.joined', 'member', v_email, jsonb_build_object('role', new.role));
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    if old.role is distinct from new.role then
      select coalesce(new.email, (select u.email from auth.users u where u.id = new.user_id)) into v_email;
      perform public.audit_write(new.business_id, 'member.role_changed', 'member', v_email, jsonb_build_object('role', jsonb_build_array(old.role, new.role)));
    end if;
    return new;
  else
    if exists (select 1 from public.businesses b where b.id = old.business_id) then
      select coalesce(old.email, (select u.email from auth.users u where u.id = old.user_id)) into v_email;
      perform public.audit_write(old.business_id, 'member.removed', 'member', v_email, jsonb_build_object('role', old.role));
    end if;
    return old;
  end if;
end $$;
drop trigger if exists audit_members on public.business_members;
create trigger audit_members after insert or update or delete on public.business_members
  for each row execute function public.trg_audit_members();

create or replace function public.trg_audit_invites() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_write(new.business_id, 'invite.sent', 'invite', new.email, jsonb_build_object('role', new.role));
    return new;
  else
    -- deleted because it was accepted (member.joined covers that) or cancelled by the owner
    if exists (select 1 from public.businesses b where b.id = old.business_id)
       and not exists (select 1 from public.business_members m where m.business_id = old.business_id and (m.email = old.email)) then
      perform public.audit_write(old.business_id, 'invite.cancelled', 'invite', old.email, jsonb_build_object('role', old.role));
    end if;
    return old;
  end if;
end $$;
drop trigger if exists audit_invites on public.business_invites;
create trigger audit_invites after insert or delete on public.business_invites
  for each row execute function public.trg_audit_invites();

-- business settings (tax, currency, names)
create or replace function public.trg_audit_businesses() returns trigger
language plpgsql security definer set search_path = public as $$
declare d jsonb;
begin
  d := public.audit_diff(to_jsonb(old), to_jsonb(new),
    array['name','branch_name','business_type','location','contact_phone','contact_email','currency','tax_rate','tax_name','tax_inclusive']);
  if d <> '{}'::jsonb then
    perform public.audit_write(new.id,
      case when d ?| array['tax_rate','tax_name','tax_inclusive'] then 'settings.tax_changed' else 'settings.changed' end,
      'settings', new.name, d);
  end if;
  return new;
end $$;
drop trigger if exists audit_businesses on public.businesses;
create trigger audit_businesses after update on public.businesses
  for each row execute function public.trg_audit_businesses();

-- When a business is removed (demo reset/purge), its log goes with it.
create or replace function public.trg_audit_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.audit_log where business_id = old.id;
  return old;
end $$;
drop trigger if exists zz_audit_cleanup on public.businesses;
create trigger zz_audit_cleanup after delete on public.businesses
  for each row execute function public.trg_audit_cleanup();

-- Paged read with filters. Owners only.
create or replace function public.list_audit(
  p_business_id uuid,
  p_entity text default 'all',
  p_limit integer default 25,
  p_offset integer default 0
) returns table (
  id uuid, created_at timestamptz, actor_email text, action text, entity text,
  entity_label text, details jsonb, total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.created_at, a.actor_email, a.action, a.entity, a.entity_label, a.details,
         count(*) over () as total_count
  from public.audit_log a
  where a.business_id = p_business_id
    and public.has_role(p_business_id, array['owner'])
    and (p_entity is null or p_entity = 'all' or a.entity = p_entity)
  order by a.created_at desc, a.id desc
  limit greatest(least(coalesce(p_limit, 25), 200), 1)
  offset greatest(coalesce(p_offset, 0), 0);
$$;
grant execute on function public.list_audit(uuid, text, integer, integer) to authenticated;

-- ───────── All-branches overview ─────────
-- For an owner of the business (organization). Branches the caller does not own are not included,
-- so a manager of one branch never sees figures for the others.
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
  stock as (
    select b.business_id,
           sum(b.quantity_remaining) as units,
           sum(b.quantity_remaining * b.base_price) as value
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
         coalesce(s.income, 0), coalesce(s.orders, 0), coalesce(s.cost, 0),
         coalesce(stock.units, 0)::bigint, coalesce(stock.value, 0),
         coalesce(alerts.low, 0), coalesce(alerts.out, 0)
  from mine
  left join s on s.business_id = mine.id
  left join stock on stock.business_id = mine.id
  left join alerts on alerts.business_id = mine.id
  order by lower(mine.branch_name);
$$;
grant execute on function public.org_overview(uuid, integer) to authenticated;
