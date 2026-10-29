-- ServeBiz migration 012: safe re-sending of cash sales (offline mode and flaky connections).
-- Safe to run more than once. Run after 011_purchase_orders.sql.

alter table public.sales add column if not exists client_ref uuid;
create unique index if not exists uq_sales_client_ref on public.sales (business_id, client_ref) where client_ref is not null;

-- Records a cash sale exactly once. The till makes up p_client_ref when the cashier checks out; if the
-- request is repeated (a lost response, or an offline sale sent later) the original sale is returned instead
-- of selling twice. p_sold_at is when the sale really happened (the sale and its stock/payment rows are dated then).
create or replace function public.sync_offline_sale(
  p_business_id uuid,
  p_client_ref uuid,
  p_items jsonb,
  p_discount_type text default 'amount',
  p_discount_value numeric default 0,
  p_tendered numeric default null,
  p_sold_at timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_when timestamptz;
begin
  if p_client_ref is null then raise exception 'Missing sale reference'; end if;
  if not public.is_member(p_business_id) then raise exception 'You are not a member of this business'; end if;

  perform pg_advisory_xact_lock(hashtext('sale:' || p_business_id::text || p_client_ref::text));

  select id into v_id from public.sales where business_id = p_business_id and client_ref = p_client_ref;
  if v_id is not null then return v_id; end if;

  v_id := public.complete_sale(p_business_id, p_items, p_discount_type, p_discount_value, 'cash', p_tendered, null, null);

  -- Never in the future, and not older than 30 days (a device that was offline longer gets today's date).
  v_when := case
    when p_sold_at is null then now()
    when p_sold_at > now() then now()
    when p_sold_at < now() - interval '30 days' then now()
    else p_sold_at end;

  update public.sales set client_ref = p_client_ref, created_at = v_when where id = v_id;
  update public.stock_movements set created_at = v_when where sale_id = v_id;
  update public.payments set created_at = v_when where sale_id = v_id;
  return v_id;
end;
$$;
revoke all on function public.sync_offline_sale(uuid, uuid, jsonb, text, numeric, numeric, timestamptz) from public, anon;
grant execute on function public.sync_offline_sale(uuid, uuid, jsonb, text, numeric, numeric, timestamptz) to authenticated;
