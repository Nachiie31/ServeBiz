-- ServeBiz migration 013: a Stripe account per branch (Stripe Connect), so online payments go to that business.
-- Safe to run more than once. Run after 012_offline_sales.sql (needs 008 for branches).

create table if not exists public.payment_accounts (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  stripe_account_id text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]{6,64}$'),
  charges_enabled boolean not null default false,
  details_submitted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_payment_accounts_acct on public.payment_accounts (stripe_account_id);

alter table public.payment_accounts enable row level security;
drop policy if exists "members read payment account" on public.payment_accounts;
create policy "members read payment account" on public.payment_accounts
  for select using (public.is_member(business_id));
revoke insert, update, delete on public.payment_accounts from anon, authenticated;

-- Connect (or refresh the status of) this branch's Stripe account. Owner only.
-- One Stripe account may serve several branches of the SAME business, never branches of different businesses.
create or replace function public.save_stripe_account(
  p_business_id uuid, p_account_id text, p_charges_enabled boolean default false, p_details_submitted boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anon boolean;
  v_org uuid;
begin
  if not public.has_role(p_business_id, array['owner']) then
    raise exception 'Only the owner can set up online payments';
  end if;
  select coalesce(u.is_anonymous, false) into v_anon from auth.users u where u.id = auth.uid();
  if v_anon then raise exception 'Guest demos use the shared test account. Sign up to connect your own.'; end if;
  if p_account_id is null or p_account_id !~ '^acct_[A-Za-z0-9]{6,64}$' then
    raise exception 'That is not a valid Stripe account id';
  end if;

  select organization_id into v_org from public.businesses where id = p_business_id;
  if exists (
    select 1 from public.payment_accounts pa
    join public.businesses b on b.id = pa.business_id
    where pa.stripe_account_id = p_account_id and b.organization_id is distinct from v_org
  ) then
    raise exception 'That Stripe account is already used by a different business';
  end if;

  insert into public.payment_accounts (business_id, stripe_account_id, charges_enabled, details_submitted)
  values (p_business_id, p_account_id, coalesce(p_charges_enabled, false), coalesce(p_details_submitted, false))
  on conflict (business_id) do update
    set stripe_account_id = excluded.stripe_account_id,
        charges_enabled = excluded.charges_enabled,
        details_submitted = excluded.details_submitted,
        updated_at = now();
end;
$$;
revoke all on function public.save_stripe_account(uuid, text, boolean, boolean) from public, anon;
grant execute on function public.save_stripe_account(uuid, text, boolean, boolean) to authenticated;

-- Stop using a connected account for this branch (the Stripe account itself is not touched).
create or replace function public.clear_stripe_account(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(p_business_id, array['owner']) then
    raise exception 'Only the owner can change online payments';
  end if;
  delete from public.payment_accounts where business_id = p_business_id;
end;
$$;
revoke all on function public.clear_stripe_account(uuid) from public, anon;
grant execute on function public.clear_stripe_account(uuid) to authenticated;

-- Use the same Stripe account as another branch of the same business (you must own both).
create or replace function public.copy_stripe_account(p_from uuid, p_to uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payment_accounts%rowtype;
begin
  if not (public.has_role(p_from, array['owner']) and public.has_role(p_to, array['owner'])) then
    raise exception 'You must own both branches';
  end if;
  if (select organization_id from public.businesses where id = p_from) is distinct from (select organization_id from public.businesses where id = p_to) then
    raise exception 'Branches must belong to the same business';
  end if;
  select * into v_row from public.payment_accounts where business_id = p_from;
  if v_row.business_id is null then raise exception 'The other branch has no connected Stripe account'; end if;
  perform public.save_stripe_account(p_to, v_row.stripe_account_id, v_row.charges_enabled, v_row.details_submitted);
end;
$$;
revoke all on function public.copy_stripe_account(uuid, uuid) from public, anon;
grant execute on function public.copy_stripe_account(uuid, uuid) to authenticated;

-- Audit trail (only when migration 009 is present)
do $$
begin
  if to_regprocedure('public.audit_write(uuid,text,text,text,jsonb)') is not null then
    execute $f$
      create or replace function public.trg_audit_payment_accounts() returns trigger
      language plpgsql security definer set search_path = public as $b$
      begin
        if tg_op = 'DELETE' then
          if exists (select 1 from public.businesses x where x.id = old.business_id) then
            perform public.audit_write(old.business_id, 'payments.disconnected', 'settings', 'Stripe account',
              jsonb_build_object('account', '...' || right(old.stripe_account_id, 4)));
          end if;
          return old;
        elsif tg_op = 'INSERT' then
          perform public.audit_write(new.business_id, 'payments.connected', 'settings', 'Stripe account',
            jsonb_build_object('account', '...' || right(new.stripe_account_id, 4)));
        elsif old.stripe_account_id is distinct from new.stripe_account_id then
          perform public.audit_write(new.business_id, 'payments.connected', 'settings', 'Stripe account',
            jsonb_build_object('account', '...' || right(new.stripe_account_id, 4)));
        end if;
        return new;
      end $b$;
    $f$;
    drop trigger if exists audit_payment_accounts on public.payment_accounts;
    create trigger audit_payment_accounts after insert or update or delete on public.payment_accounts
      for each row execute function public.trg_audit_payment_accounts();
  end if;
end $$;
