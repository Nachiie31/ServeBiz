-- ServeBiz migration 016: fixes found during QA. Safe to run more than once. Run after 015.

-- Supplier names are unique per branch (ignoring case and spaces). Existing duplicates keep working:
-- the later ones get " (2)", " (3)" ... added so nothing is lost.
do $$
declare r record;
begin
  for r in
    select id, name, row_number() over (partition by business_id, lower(btrim(name)) order by created_at, id) as n
    from public.suppliers
  loop
    if r.n > 1 then
      update public.suppliers set name = left(btrim(r.name), 90) || ' (' || r.n || ')' where id = r.id;
    end if;
  end loop;
end $$;

create unique index if not exists suppliers_unique_name on public.suppliers (business_id, lower(btrim(name)));

-- Invitations: changing a pending invite's role, or re-inviting someone who declined, is logged as a new "invite sent".
create or replace function public.trg_audit_invites() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_write(new.business_id, 'invite.sent', 'invite', new.email, jsonb_build_object('role', new.role));
    return new;
  elsif tg_op = 'UPDATE' then
    if new.status = 'declined' and old.status <> 'declined' then
      perform public.audit_write(new.business_id, 'invite.declined', 'invite', new.email, jsonb_build_object('role', new.role));
    elsif new.status = 'pending' and (old.status = 'declined' or old.role <> new.role) then
      perform public.audit_write(new.business_id, 'invite.sent', 'invite', new.email, jsonb_build_object('role', new.role));
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

-- A guest's first page load can ask for the demo store from two requests at once (the app shell and the
-- setup page). Serialize per guest so they never end up with two copies.
create or replace function public.create_demo_business()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anon boolean;
  v_existing uuid;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  select coalesce(u.is_anonymous, false) into v_anon from auth.users u where u.id = auth.uid();
  if not coalesce(v_anon, false) then
    raise exception 'Demo data is only available to guest logins';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('demo:' || auth.uid()::text, 0));
  select business_id into v_existing from public.business_members where user_id = auth.uid() limit 1;
  if v_existing is not null then
    return v_existing;
  end if;
  return public.seed_demo_business(auth.uid());
end;
$$;
