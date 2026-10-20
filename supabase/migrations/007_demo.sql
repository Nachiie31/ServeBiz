-- ServeBiz migration 007: demo store for guest logins.
-- Run in Supabase SQL Editor AFTER 006_roles.sql. Safe to run more than once.
--
-- When someone clicks "Continue as guest", they get their own private copy of a populated shop:
-- products, suppliers, stock batches (one near expiry, one expired), a month of sales, a couple of
-- voided sales, and a product that still needs pricing. Nobody else can see or change it.

create or replace function public.seed_demo_business(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b uuid;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_pids uuid[] := '{}';
  v_prices numeric[] := '{}';
  v_n integer;
  r record;
  b record;
  v_pid uuid;
  v_sid uuid;
  v_cid uuid;
  v_batch uuid;
  d integer;
  i integer;
  l integer;
  v_day date;
  v_start timestamptz;
  v_end timestamptz;
  v_ts timestamptz;
  v_orders integer;
  v_offs double precision[];
  v_sale uuid;
  v_no integer := 0;
  v_receipt text;
  v_lines integer;
  v_idx integer;
  v_qty integer;
  v_left integer;
  v_take integer;
  v_sold integer;
  v_cost numeric;
  v_sub numeric;
  v_disc numeric;
  v_base numeric;
  v_tax numeric;
  v_used uuid[];
  v_method text;
begin
  perform setseed(0.37);  -- same demo every time

  insert into public.businesses (
    name, business_type, location, contact_phone, contact_email, currency,
    tax_rate, tax_name, tax_inclusive, created_by
  ) values (
    'Sari-Sari Demo Mart', 'Grocery / Convenience', 'Quezon City, Metro Manila', '0917 000 0000',
    'demo@example.com', 'PHP', 12, 'VAT', true, p_user
  ) returning id into v_b;

  insert into public.business_members (business_id, user_id, role, email)
  values (v_b, p_user, 'owner', null);

  insert into public.suppliers (business_id, name, contact) values
    (v_b, 'Metro Beverage Trading', '0917 111 2233'),
    (v_b, 'Sunrise Foods Inc.', 'orders@sunrisefoods.example'),
    (v_b, 'Prime Grocers Wholesale', '0918 444 5566');

  insert into public.categories (business_id, name) values
    (v_b, 'Beverages'), (v_b, 'Snacks'), (v_b, 'Canned Goods'), (v_b, 'Household'), (v_b, 'Personal Care');

  -- code, barcode, name, category, unit, price, cost, reorder, opening qty, shelf life (days), supplier
  for r in
    select * from jsonb_to_recordset('[
      {"code":"BEV-001","bar":"4800016000011","name":"Mineral Water 500ml","cat":"Beverages","unit":"bottle","price":18,"cost":11,"re":30,"qty":360,"exp":240,"sup":"Metro Beverage Trading"},
      {"code":"BEV-002","bar":"4800016000028","name":"Cola 330ml Can","cat":"Beverages","unit":"can","price":35,"cost":24,"re":24,"qty":300,"exp":180,"sup":"Metro Beverage Trading"},
      {"code":"BEV-003","bar":"4800016000035","name":"3-in-1 Coffee Sachet","cat":"Beverages","unit":"pc","price":8,"cost":5.5,"re":40,"qty":500,"exp":300,"sup":"Sunrise Foods Inc."},
      {"code":"BEV-004","bar":"4800016000042","name":"Orange Juice 1L","cat":"Beverages","unit":"pack","price":95,"cost":68,"re":10,"qty":80,"exp":90,"sup":"Metro Beverage Trading"},
      {"code":"SNK-001","bar":"4800016000059","name":"Potato Chips 60g","cat":"Snacks","unit":"pack","price":28,"cost":19,"re":20,"qty":200,"exp":120,"sup":"Sunrise Foods Inc."},
      {"code":"SNK-002","bar":"4800016000066","name":"Choco Biscuit Pack","cat":"Snacks","unit":"pack","price":12,"cost":8,"re":25,"qty":300,"exp":150,"sup":"Sunrise Foods Inc."},
      {"code":"SNK-003","bar":"4800016000073","name":"Roasted Peanuts 100g","cat":"Snacks","unit":"pack","price":30,"cost":20,"re":15,"qty":120,"exp":200,"sup":"Sunrise Foods Inc."},
      {"code":"SNK-004","bar":"4800016000080","name":"Fruit Gummies 40g","cat":"Snacks","unit":"pack","price":15,"cost":9.5,"re":15,"qty":150,"exp":200,"sup":"Sunrise Foods Inc."},
      {"code":"CAN-001","bar":"4800016000097","name":"Sardines in Tomato 155g","cat":"Canned Goods","unit":"can","price":24,"cost":17,"re":25,"qty":240,"exp":540,"sup":"Prime Grocers Wholesale"},
      {"code":"CAN-002","bar":"4800016000103","name":"Corned Beef 150g","cat":"Canned Goods","unit":"can","price":58,"cost":42,"re":15,"qty":120,"exp":600,"sup":"Prime Grocers Wholesale"},
      {"code":"CAN-003","bar":"4800016000110","name":"Evaporated Milk 370ml","cat":"Canned Goods","unit":"can","price":46,"cost":34,"re":15,"qty":140,"exp":365,"sup":"Prime Grocers Wholesale"},
      {"code":"HSE-001","bar":"4800016000127","name":"Dishwashing Liquid 250ml","cat":"Household","unit":"bottle","price":45,"cost":30,"re":10,"qty":80,"exp":null,"sup":"Prime Grocers Wholesale"},
      {"code":"HSE-002","bar":"4800016000134","name":"Laundry Powder 500g","cat":"Household","unit":"pack","price":62,"cost":44,"re":10,"qty":80,"exp":null,"sup":"Prime Grocers Wholesale"},
      {"code":"HSE-003","bar":"4800016000141","name":"Tissue 3-ply Roll","cat":"Household","unit":"roll","price":22,"cost":14,"re":20,"qty":160,"exp":null,"sup":"Prime Grocers Wholesale"},
      {"code":"PCR-001","bar":"4800016000158","name":"Shampoo Sachet","cat":"Personal Care","unit":"pc","price":8,"cost":5,"re":40,"qty":400,"exp":700,"sup":"Sunrise Foods Inc."},
      {"code":"PCR-002","bar":"4800016000165","name":"Bath Soap 90g","cat":"Personal Care","unit":"pc","price":32,"cost":21,"re":20,"qty":160,"exp":800,"sup":"Sunrise Foods Inc."},
      {"code":"PCR-003","bar":"4800016000172","name":"Toothpaste 75ml","cat":"Personal Care","unit":"tube","price":68,"cost":47,"re":10,"qty":90,"exp":650,"sup":"Sunrise Foods Inc."}
    ]'::jsonb) as x(code text, bar text, name text, cat text, unit text, price numeric, cost numeric, re integer, qty integer, exp integer, sup text)
  loop
    select id into v_cid from public.categories where business_id = v_b and name = r.cat;
    select id into v_sid from public.suppliers where business_id = v_b and name = r.sup;

    insert into public.products (business_id, code, barcode, name, category_id, unit, selling_price, reorder_level, is_active)
    values (v_b, r.code, r.bar, r.name, v_cid, r.unit, r.price, r.re, true)
    returning id into v_pid;
    v_pids := v_pids || v_pid;
    v_prices := v_prices || r.price;

    -- opening stock, received 35 days ago
    insert into public.stock_batches (business_id, product_id, supplier_id, batch_no, date_received, expiry_date,
                                      quantity_received, quantity_remaining, base_price)
    values (v_b, v_pid, v_sid, 'LOT-' || r.code || '-A', v_today - 35,
            case when r.exp is null then null else v_today + r.exp end, r.qty, r.qty, r.cost)
    returning id into v_batch;
    insert into public.stock_movements (business_id, product_id, batch_id, movement_type, quantity_change, reason, created_at, created_by)
    values (v_b, v_pid, v_batch, 'receive', r.qty, 'Delivery received',
            ((v_today - 35)::timestamp + interval '9 hours') at time zone 'Asia/Manila', p_user);

    -- the fast-moving beverages got a second, later-expiring delivery 10 days ago (first in, first out)
    if r.code in ('BEV-001', 'BEV-002', 'BEV-003') then
      insert into public.stock_batches (business_id, product_id, supplier_id, batch_no, date_received, expiry_date,
                                        quantity_received, quantity_remaining, base_price)
      values (v_b, v_pid, v_sid, 'LOT-' || r.code || '-B', v_today - 10, v_today + r.exp + 90, 120, 120, r.cost)
      returning id into v_batch;
      insert into public.stock_movements (business_id, product_id, batch_id, movement_type, quantity_change, reason, created_at, created_by)
      values (v_b, v_pid, v_batch, 'receive', 120, 'Delivery received',
              ((v_today - 10)::timestamp + interval '9 hours') at time zone 'Asia/Manila', p_user);
    end if;
  end loop;

  v_n := array_length(v_pids, 1);

  -- ───────── A month of sales, oldest first so receipt numbers run in order ─────────
  for d in reverse 29..0 loop
    v_day := v_today - d;
    v_start := (v_day::timestamp + interval '8 hours') at time zone 'Asia/Manila';
    v_end := least((v_day::timestamp + interval '20 hours') at time zone 'Asia/Manila', now() - interval '3 minutes');
    continue when v_end <= v_start;

    v_orders := 4 + floor(random() * 6)::int
              + case when extract(dow from v_day) in (0, 6) then 3 else 0 end
              + case when d < 10 then 1 else 0 end;
    select array_agg(x order by x) into v_offs from (select random() as x from generate_series(1, v_orders)) s;

    for i in 1..v_orders loop
      v_ts := v_start + (v_end - v_start) * v_offs[i];
      v_receipt := 'R-' || lpad((v_no + 1)::text, 6, '0');

      insert into public.sales (business_id, receipt_no, status, cashier_id, created_at)
      values (v_b, v_receipt, 'completed', p_user, v_ts)
      returning id into v_sale;

      v_sub := 0;
      v_used := '{}';
      v_lines := 1 + floor(random() * 4)::int;

      for l in 1..v_lines loop
        v_idx := 1 + floor(power(random(), 1.6) * v_n)::int;
        v_pid := v_pids[v_idx];
        continue when v_pid = any(v_used);
        v_used := v_used || v_pid;

        v_qty := 1 + floor(random() * 3)::int;
        if v_prices[v_idx] < 20 then
          v_qty := v_qty + floor(random() * 3)::int;
        end if;

        v_left := v_qty;
        v_cost := 0;
        for b in
          select id, quantity_remaining, base_price
          from public.stock_batches
          where product_id = v_pid and quantity_remaining > 0
          order by expiry_date asc nulls last, date_received asc, created_at asc
          for update
        loop
          exit when v_left = 0;
          v_take := least(b.quantity_remaining, v_left);
          update public.stock_batches set quantity_remaining = quantity_remaining - v_take where id = b.id;
          insert into public.stock_movements (business_id, product_id, batch_id, movement_type, quantity_change, reason, sale_id, created_at, created_by)
          values (v_b, v_pid, b.id, 'sale', -v_take, 'Sale ' || v_receipt, v_sale, v_ts, p_user);
          v_cost := v_cost + v_take * b.base_price;
          v_left := v_left - v_take;
        end loop;

        v_sold := v_qty - v_left;
        continue when v_sold = 0;

        insert into public.sale_items (sale_id, business_id, product_id, quantity, unit_price, unit_cost)
        values (v_sale, v_b, v_pid, v_sold, v_prices[v_idx], round(v_cost / v_sold, 2));
        v_sub := v_sub + v_prices[v_idx] * v_sold;
      end loop;

      if v_sub = 0 then
        delete from public.sales where id = v_sale;
        continue;
      end if;

      v_disc := case when random() < 0.08 then round(v_sub * 0.05, 2) else 0 end;
      v_base := v_sub - v_disc;
      v_tax := round(v_base * 12 / 112, 2);   -- prices already include 12% VAT

      update public.sales
      set subtotal = v_sub, discount = v_disc, tax = v_tax, total = v_base
      where id = v_sale;

      v_no := v_no + 1;
      v_method := case when random() < 0.7 then 'cash' else 'stripe' end;
      if v_method = 'cash' then
        insert into public.payments (sale_id, business_id, method, amount, amount_tendered, created_at)
        values (v_sale, v_b, 'cash', v_base,
                case when random() < 0.4 then v_base else ceil(v_base / 50) * 50 end, v_ts);
      else
        insert into public.payments (sale_id, business_id, method, amount, amount_tendered, reference, stripe_payment_intent, created_at)
        values (v_sale, v_b, 'stripe', v_base, v_base,
                case when random() < 0.6 then 'GCash' else 'Card' end || ' · pi_demo_' || v_no,
                'pi_demo_' || replace(v_b::text, '-', '') || '_' || v_no, v_ts);
      end if;
    end loop;
  end loop;

  update public.businesses set next_receipt_no = v_no + 1 where id = v_b;

  -- two sales were voided (items returned to stock), so the voiding flow has something to show
  for r in
    select id from public.sales
    where business_id = v_b and created_at < now() - interval '2 days'
    order by random() limit 2
  loop
    perform public.void_sale(r.id, 'Customer returned items');
  end loop;

  -- ───────── Things that make the alerts interesting ─────────
  -- Potato chips: a batch expiring in 9 days
  select id into v_pid from public.products where business_id = v_b and code = 'SNK-001';
  select id into v_sid from public.suppliers where business_id = v_b and name = 'Sunrise Foods Inc.';
  insert into public.stock_batches (business_id, product_id, supplier_id, batch_no, date_received, expiry_date,
                                    quantity_received, quantity_remaining, base_price)
  values (v_b, v_pid, v_sid, 'LOT-SNK-001-N', v_today - 25, v_today + 9, 18, 18, 19)
  returning id into v_batch;
  insert into public.stock_movements (business_id, product_id, batch_id, movement_type, quantity_change, reason, created_at, created_by)
  values (v_b, v_pid, v_batch, 'receive', 18, 'Delivery received', ((v_today - 25)::timestamp + interval '9 hours') at time zone 'Asia/Manila', p_user);

  -- Fruit gummies: a batch that already expired (shows as Expired, never sold)
  select id into v_pid from public.products where business_id = v_b and code = 'SNK-004';
  insert into public.stock_batches (business_id, product_id, supplier_id, batch_no, date_received, expiry_date,
                                    quantity_received, quantity_remaining, base_price)
  values (v_b, v_pid, v_sid, 'LOT-SNK-004-X', v_today - 70, v_today - 6, 14, 14, 9.5)
  returning id into v_batch;
  insert into public.stock_movements (business_id, product_id, batch_id, movement_type, quantity_change, reason, created_at, created_by)
  values (v_b, v_pid, v_batch, 'receive', 14, 'Delivery received', ((v_today - 70)::timestamp + interval '9 hours') at time zone 'Asia/Manila', p_user);

  -- Orange juice: a batch expiring in 4 days
  select id into v_pid from public.products where business_id = v_b and code = 'BEV-004';
  select id into v_sid from public.suppliers where business_id = v_b and name = 'Metro Beverage Trading';
  insert into public.stock_batches (business_id, product_id, supplier_id, batch_no, date_received, expiry_date,
                                    quantity_received, quantity_remaining, base_price)
  values (v_b, v_pid, v_sid, 'LOT-BEV-004-N', v_today - 20, v_today + 4, 10, 10, 68)
  returning id into v_batch;
  insert into public.stock_movements (business_id, product_id, batch_id, movement_type, quantity_change, reason, created_at, created_by)
  values (v_b, v_pid, v_batch, 'receive', 10, 'Delivery received', ((v_today - 20)::timestamp + interval '9 hours') at time zone 'Asia/Manila', p_user);

  -- A product that was just delivered and still needs a selling price
  select id into v_sid from public.suppliers where business_id = v_b and name = 'Sunrise Foods Inc.';
  insert into public.products (business_id, code, name, unit, selling_price, is_active)
  values (v_b, 'NEW-001', 'Ice Candy (new)', 'pc', 0, false)
  returning id into v_pid;
  insert into public.stock_batches (business_id, product_id, supplier_id, batch_no, date_received, expiry_date,
                                    quantity_received, quantity_remaining, base_price)
  values (v_b, v_pid, v_sid, 'LOT-NEW-001-A', v_today - 2, v_today + 40, 30, 30, 4.5)
  returning id into v_batch;
  insert into public.stock_movements (business_id, product_id, batch_id, movement_type, quantity_change, reason, created_at, created_by)
  values (v_b, v_pid, v_batch, 'receive', 30, 'Delivery received', ((v_today - 2)::timestamp + interval '9 hours') at time zone 'Asia/Manila', p_user);

  -- The two products with the least stock left get a reorder level just above it: low-stock alerts
  update public.products p
  set reorder_level = s.q + 8
  from (
    select pr.id, coalesce(sum(sb.quantity_remaining), 0)::integer as q
    from public.products pr
    left join public.stock_batches sb on sb.product_id = pr.id
    where pr.business_id = v_b and pr.code <> 'NEW-001'
    group by pr.id
    order by 2 asc
    limit 2
  ) s
  where p.id = s.id;

  -- a pending staff invite, so the Team page is not empty (example.com can never be claimed)
  insert into public.business_invites (business_id, email, role, invited_by)
  values (v_b, 'cashier.demo@example.com', 'cashier', p_user);

  return v_b;
end;
$$;

-- Only the two wrappers below may call the seeder.
revoke all on function public.seed_demo_business(uuid) from public, anon, authenticated;

-- Called when a guest (anonymous) login has no business yet. Returns the guest's demo shop.
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
  select business_id into v_existing from public.business_members where user_id = auth.uid() limit 1;
  if v_existing is not null then
    return v_existing;
  end if;
  return public.seed_demo_business(auth.uid());
end;
$$;

-- "Reset demo": throw away this guest's shop and build a fresh one.
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
  delete from public.businesses where created_by = auth.uid();
  return public.seed_demo_business(auth.uid());
end;
$$;

-- Housekeeping: delete guest accounts (and their demo shops) older than p_hours.
-- Not callable from the app. Run it from the SQL Editor, or schedule it:
--   Supabase Dashboard -> Integrations -> Cron -> new job -> SQL snippet:
--     select public.purge_old_demos(24);
create or replace function public.purge_old_demos(p_hours integer default 24)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.businesses b
  using auth.users u
  where b.created_by = u.id
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
