-- ServeBiz migration 014: accept/decline invitations, and removing branches or businesses.
-- Run in Supabase SQL Editor AFTER 013_payment_accounts.sql. Safe to run more than once.
--
--   * Invitations are no longer joined automatically. The invited person sees them (on the
--     Invitations page, or on the first screen if they have no business yet) and chooses
--     Accept or Decline. A declined invite stays visible to the owner as "Declined".
--   * An owner can remove a branch, or a whole business. Someone must always keep at least one
--     business, so the last remaining business can never be removed.

-- ───────── Invitation status ─────────
alter table public.business_invites add column if not exists status text not null default 'pending';
alter table public.business_invites add column if not exists responded_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_invites_status_check') then
    alter table public.business_invites add constraint business_invites_status_check check (status in ('pending', 'declined'));
  end if;
end $$;

-- Re-inviting someone who declined puts the invite back to pending.
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

  if exists (
    select 1 from public.business_members m
    join public.businesses b on b.id = m.business_id
    left join auth.users u on u.id = m.user_id
    where b.organization_id <> v_org and (m.email = v_email or lower(u.email) = v_email)
  ) or exists (
    select 1 from public.business_invites i
    join public.businesses b on b.id = i.business_id
    where b.organization_id <> v_org and i.email = v_email and i.status = 'pending'
  ) then
    raise exception '% already belongs to a different business, so they cannot be invited here. One email can work in several branches of the same business, but not in two businesses.', v_email;
  end if;

  select (select count(*) from public.business_members where business_id = p_business_id)
       + (select count(*) from public.business_invites where business_id = p_business_id and email <> v_email)
  into v_count;
  if v_count >= 25 then
    raise exception 'Team limit reached (25 people including pending invites)';
  end if;

  insert into public.business_invites (business_id, email, role)
  values (p_business_id, v_email, p_role)
  on conflict (business_id, email) do update
    set role = excluded.role, status = 'pending', responded_at = null
  returning id into v_id;

  return v_id;
end;
$$;

-- Joining no longer happens by itself. Kept (returning 0) so older screens do not break.
create or replace function public.claim_invites()
returns integer
language sql
security definer
set search_path = public
as $$ select 0 $$;

-- ───────── What the invited person sees ─────────
-- Only a confirmed email account sees invitations, so nobody can read or answer an invite
-- by typing someone else's address at sign-up. Guests never have any.
create or replace function public.my_invites()
returns table (
  id uuid, business_id uuid, org_name text, branch_name text, location text,
  role text, invited_by_email text, created_at timestamptz, blocked boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text;
  v_confirmed timestamptz;
  v_anon boolean;
begin
  if auth.uid() is null then return; end if;
  select lower(u.email), u.email_confirmed_at, coalesce(u.is_anonymous, false)
  into v_email, v_confirmed, v_anon
  from auth.users u where u.id = auth.uid();
  if v_email is null or v_confirmed is null or v_anon then return; end if;

  return query
  select i.id, i.business_id, o.name, b.branch_name, b.location, i.role,
         (select lower(x.email)::text from auth.users x where x.id = i.invited_by),
         i.created_at,
         -- already working for a different business: they can decline, but not accept
         exists (
           select 1 from public.business_members m
           join public.businesses mb on mb.id = m.business_id
           where m.user_id = auth.uid() and mb.organization_id <> b.organization_id
         )
  from public.business_invites i
  join public.businesses b on b.id = i.business_id
  join public.organizations o on o.id = b.organization_id
  where i.email = v_email and i.status = 'pending'
  order by i.created_at desc, i.id;
end;
$$;

create or replace function public.accept_invite(p_invite_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_confirmed timestamptz;
  v_anon boolean;
  r record;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select lower(u.email), u.email_confirmed_at, coalesce(u.is_anonymous, false)
  into v_email, v_confirmed, v_anon
  from auth.users u where u.id = auth.uid();
  if v_email is null or v_confirmed is null or v_anon then
    raise exception 'Confirm your email address to accept invitations';
  end if;

  select i.id, i.business_id, i.role, b.organization_id as org into r
  from public.business_invites i
  join public.businesses b on b.id = i.business_id
  where i.id = p_invite_id and i.email = v_email and i.status = 'pending'
  for update of i;
  if r.id is null then raise exception 'That invitation is no longer available'; end if;

  if exists (
    select 1 from public.business_members m
    join public.businesses mb on mb.id = m.business_id
    where m.user_id = auth.uid() and mb.organization_id <> r.org
  ) then
    raise exception 'You already work for a different business, so you cannot join this one';
  end if;

  insert into public.business_members (business_id, user_id, role, email)
  values (r.business_id, auth.uid(), r.role, v_email)
  on conflict (business_id, user_id) do nothing;
  delete from public.business_invites where id = r.id;
  return r.business_id;
end;
$$;

create or replace function public.decline_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_anon boolean;
  v_n integer;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select lower(u.email), coalesce(u.is_anonymous, false) into v_email, v_anon from auth.users u where u.id = auth.uid();
  if v_email is null or v_anon then raise exception 'Not allowed'; end if;
  update public.business_invites set status = 'declined', responded_at = now()
  where id = p_invite_id and email = v_email and status = 'pending';
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'That invitation is no longer available'; end if;
end;
$$;

revoke all on function public.my_invites() from public, anon;
revoke all on function public.accept_invite(uuid) from public, anon;
revoke all on function public.decline_invite(uuid) from public, anon;
grant execute on function public.my_invites() to authenticated;
grant execute on function public.accept_invite(uuid) to authenticated;
grant execute on function public.decline_invite(uuid) to authenticated;

-- Audit: sent / declined / cancelled (accepting shows up as "member joined")
create or replace function public.trg_audit_invites() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_write(new.business_id, 'invite.sent', 'invite', new.email, jsonb_build_object('role', new.role));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.status = 'declined' and old.status <> 'declined' then
      perform public.audit_write(new.business_id, 'invite.declined', 'invite', new.email, jsonb_build_object('role', new.role));
    end if;
    return new;
  else
    if exists (select 1 from public.businesses b where b.id = old.business_id)
       and not exists (select 1 from public.business_members m where m.business_id = old.business_id and (m.email = old.email)) then
      perform public.audit_write(old.business_id, 'invite.cancelled', 'invite', old.email, jsonb_build_object('role', old.role));
    end if;
    return old;
  end if;
end $$;
drop trigger if exists audit_invites on public.business_invites;
create trigger audit_invites after insert or update or delete on public.business_invites
  for each row execute function public.trg_audit_invites();

-- ───────── Removing a branch or a whole business ─────────
-- Every person keeps at least one business: removing the last one is refused.
create or replace function public.my_business_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct b.organization_id)::integer
  from public.business_members m
  join public.businesses b on b.id = m.business_id
  where m.user_id = auth.uid();
$$;
revoke all on function public.my_business_count() from public, anon;
grant execute on function public.my_business_count() to authenticated;

-- Removes one branch and everything in it (products, stock, sales, team, settings).
-- If it is the business's only branch, that removes the business, so the "keep one" rule applies.
create or replace function public.delete_branch(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_branches integer;
  v_anon boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select coalesce(u.is_anonymous, false) into v_anon from auth.users u where u.id = auth.uid();
  if coalesce(v_anon, false) then raise exception 'Guest demos cannot remove businesses'; end if;
  if not public.has_role(p_business_id, array['owner']) then
    raise exception 'Only the owner can remove a branch';
  end if;

  v_org := public.org_of(p_business_id);
  select count(*) into v_branches from public.businesses where organization_id = v_org;

  if v_branches <= 1 then
    if public.my_business_count() <= 1 then
      raise exception 'This is your only business, so it cannot be removed. Create another business first.';
    end if;
    delete from public.organizations where id = v_org;     -- cascades to the branch and its data
  else
    delete from public.businesses where id = p_business_id;
  end if;
end;
$$;

-- Removes a whole business with all of its branches.
create or replace function public.delete_business(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anon boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select coalesce(u.is_anonymous, false) into v_anon from auth.users u where u.id = auth.uid();
  if coalesce(v_anon, false) then raise exception 'Guest demos cannot remove businesses'; end if;
  if not exists (select 1 from public.businesses where organization_id = p_org_id) then
    raise exception 'Business not found';
  end if;
  -- you must own every branch of it
  if exists (
    select 1 from public.businesses b
    where b.organization_id = p_org_id and not public.has_role(b.id, array['owner'])
  ) then
    raise exception 'Only the owner can remove a business';
  end if;
  if public.my_business_count() <= 1 then
    raise exception 'This is your only business, so it cannot be removed. Create another business first.';
  end if;
  delete from public.organizations where id = p_org_id;
end;
$$;

revoke all on function public.delete_branch(uuid) from public, anon;
revoke all on function public.delete_business(uuid) from public, anon;
grant execute on function public.delete_branch(uuid) to authenticated;
grant execute on function public.delete_business(uuid) to authenticated;
