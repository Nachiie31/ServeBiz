-- ServeBiz migration 011: purchase orders (order from a supplier, then receive against the order).
-- Safe to run more than once. Run after 010_refunds.sql (needs 006 for roles).

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  po_number text not null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  status text not null default 'ordered' check (status in ('ordered', 'partial', 'received', 'cancelled')),
  expected_date date,
  notes text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id, po_number)
);
create index if not exists idx_po_business_time on public.purchase_orders (business_id, created_at desc, id desc);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references public.purchase_orders(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_code text not null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  received_quantity integer not null default 0 check (received_quantity >= 0 and received_quantity <= quantity)
);
create index if not exists idx_po_items_po on public.purchase_order_items (po_id);

alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
drop policy if exists "managers read purchase orders" on public.purchase_orders;
create policy "managers read purchase orders" on public.purchase_orders
  for select using (public.has_role(business_id, array['owner', 'manager']));
drop policy if exists "managers read purchase order items" on public.purchase_order_items;
create policy "managers read purchase order items" on public.purchase_order_items
  for select using (public.has_role(business_id, array['owner', 'manager']));
revoke insert, update, delete on public.purchase_orders from anon, authenticated;
revoke insert, update, delete on public.purchase_order_items from anon, authenticated;

-- p_items: [{"code": "A1", "name": "Latte", "quantity": 10, "unit_cost": 42.5}, ...]
create or replace function public.create_purchase_order(
  p_business_id uuid,
  p_supplier_id uuid,
  p_expected_date date,
  p_notes text,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_n integer;
  e jsonb;
  v_code text;
  v_name text;
  v_qty integer;
  v_cost numeric;
begin
  if not public.has_role(p_business_id, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can create purchase orders';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item';
  end if;
  if jsonb_array_length(p_items) > 100 then raise exception 'A purchase order can have up to 100 items'; end if;
  if p_supplier_id is not null and not exists (select 1 from public.suppliers where id = p_supplier_id and business_id = p_business_id) then
    raise exception 'Supplier not found';
  end if;

  perform pg_advisory_xact_lock(hashtext('po:' || p_business_id::text));
  select coalesce(max(substring(po_number from 4)::integer), 0) + 1 into v_n
  from public.purchase_orders where business_id = p_business_id and po_number ~ '^PO-[0-9]+$';

  insert into public.purchase_orders (business_id, po_number, supplier_id, expected_date, notes)
  values (p_business_id, 'PO-' || lpad(v_n::text, 4, '0'), p_supplier_id, p_expected_date, nullif(left(trim(coalesce(p_notes, '')), 500), ''))
  returning id into v_id;

  for e in select * from jsonb_array_elements(p_items) loop
    v_code := trim(coalesce(e ->> 'code', ''));
    v_name := trim(coalesce(e ->> 'name', ''));
    begin
      v_qty := (e ->> 'quantity')::integer;
      v_cost := (e ->> 'unit_cost')::numeric;
    exception when others then
      raise exception 'Quantity and unit cost must be numbers';
    end;
    if v_code = '' or length(v_code) > 64 then raise exception 'Every item needs a product code (up to 64 characters)'; end if;
    if v_name = '' or length(v_name) > 200 then raise exception 'Every item needs a name (up to 200 characters)'; end if;
    if v_qty is null or v_qty <= 0 or v_qty > 1000000 then raise exception 'Quantity must be a whole number above 0'; end if;
    if v_cost is null or v_cost < 0 or v_cost >= 1e10 then raise exception 'Unit cost cannot be negative'; end if;
    insert into public.purchase_order_items (po_id, business_id, product_code, product_name, quantity, unit_cost)
    values (v_id, p_business_id, v_code, v_name, v_qty, round(v_cost, 2));
  end loop;
  return v_id;
end;
$$;
revoke all on function public.create_purchase_order(uuid, uuid, date, text, jsonb) from public, anon;
grant execute on function public.create_purchase_order(uuid, uuid, date, text, jsonb) to authenticated;

-- p_items: [{"item_id": "...", "quantity": 5, "expiry_date": "2027-01-31", "batch_no": "B1"}, ...]
create or replace function public.receive_purchase_order(p_po_id uuid, p_items jsonb, p_date_received date default current_date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders%rowtype;
  e jsonb;
  v_item public.purchase_order_items%rowtype;
  v_qty integer;
  v_expiry date;
  v_lines integer := 0;
  v_open integer;
  v_got integer;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if v_po.id is null then raise exception 'Purchase order not found'; end if;
  if not public.has_role(v_po.business_id, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can receive a purchase order';
  end if;
  if v_po.status not in ('ordered', 'partial') then raise exception 'This purchase order is already %', v_po.status; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Enter a quantity to receive';
  end if;
  if p_date_received is null or p_date_received > current_date + 1 then raise exception 'Check the received date'; end if;

  for e in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((e ->> 'quantity')::integer, 0);
    continue when v_qty = 0;
    if v_qty < 0 then raise exception 'Quantities cannot be negative'; end if;
    select * into v_item from public.purchase_order_items where id = (e ->> 'item_id')::uuid and po_id = p_po_id for update;
    if v_item.id is null then raise exception 'That item is not on this purchase order'; end if;
    if v_qty > v_item.quantity - v_item.received_quantity then
      raise exception '% : only % left to receive', v_item.product_name, v_item.quantity - v_item.received_quantity;
    end if;
    v_expiry := nullif(e ->> 'expiry_date', '')::date;

    perform public.receive_stock(v_po.business_id, v_item.product_code, v_item.product_name, v_po.supplier_id,
      p_date_received, v_expiry, v_qty, v_item.unit_cost, nullif(e ->> 'batch_no', ''), v_po.po_number);

    update public.purchase_order_items set received_quantity = received_quantity + v_qty where id = v_item.id;
    v_lines := v_lines + 1;
  end loop;

  if v_lines = 0 then raise exception 'Enter a quantity to receive'; end if;

  select count(*), coalesce(sum(received_quantity), 0) into v_open, v_got
  from public.purchase_order_items where po_id = p_po_id and received_quantity < quantity;
  update public.purchase_orders set status = case when v_open = 0 then 'received' else 'partial' end where id = p_po_id;
  return v_lines;
end;
$$;
revoke all on function public.receive_purchase_order(uuid, jsonb, date) from public, anon;
grant execute on function public.receive_purchase_order(uuid, jsonb, date) to authenticated;

-- Cancel an order nothing has arrived for, or close a partly received one (the rest is no longer expected).
create or replace function public.close_purchase_order(p_po_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_any integer;
  v_new text;
begin
  select * into v_po from public.purchase_orders where id = p_po_id for update;
  if v_po.id is null then raise exception 'Purchase order not found'; end if;
  if not public.has_role(v_po.business_id, array['owner', 'manager']) then
    raise exception 'Only an owner or manager can close a purchase order';
  end if;
  if v_po.status not in ('ordered', 'partial') then raise exception 'This purchase order is already %', v_po.status; end if;
  select coalesce(sum(received_quantity), 0) into v_any from public.purchase_order_items where po_id = p_po_id;
  v_new := case when v_any = 0 then 'cancelled' else 'received' end;
  update public.purchase_orders set status = v_new where id = p_po_id;
  return v_new;
end;
$$;
revoke all on function public.close_purchase_order(uuid) from public, anon;
grant execute on function public.close_purchase_order(uuid) to authenticated;

-- Audit trail (only when migration 009 is present)
do $$
begin
  if to_regprocedure('public.audit_write(uuid,text,text,text,jsonb)') is not null then
    execute $f$
      create or replace function public.trg_audit_po() returns trigger
      language plpgsql security definer set search_path = public as $b$
      begin
        if tg_op = 'INSERT' then
          perform public.audit_write(new.business_id, 'po.created', 'purchase', new.po_number, '{}'::jsonb);
        elsif old.status is distinct from new.status then
          perform public.audit_write(new.business_id, 'po.' || new.status, 'purchase', new.po_number, '{}'::jsonb);
        end if;
        return new;
      end $b$;
    $f$;
    drop trigger if exists audit_po on public.purchase_orders;
    create trigger audit_po after insert or update on public.purchase_orders
      for each row execute function public.trg_audit_po();
  end if;
end $$;
