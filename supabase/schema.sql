-- ServeBiz schema. Run in Supabase: SQL Editor -> New query -> paste -> Run.
-- Every business-owned row carries business_id; Row Level Security limits access to members.

create extension if not exists "pgcrypto";

-- ───────── Core: businesses and membership ─────────
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_type text not null,
  logo_url text,
  location text,
  contact_phone text,
  contact_email text,
  currency text not null default 'PHP',
  tax_rate numeric(5,2) not null default 0,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','manager','cashier')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);

-- Membership check used by every policy (security definer avoids policy recursion)
create or replace function public.is_member(b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.business_members
    where business_id = b and user_id = auth.uid()
  );
$$;

-- Create a business and its owner membership in one atomic call
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

  insert into public.business_members (business_id, user_id, role)
  values (new_id, auth.uid(), 'owner');

  return new_id;
end;
$$;

-- ───────── Inventory ─────────
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  contact text,
  created_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null,
  unique (business_id, name)
);

-- Product catalog: what the POS sells. Quantity is NOT stored here; it is the sum of batches.
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  code text not null,                       -- product code / SKU
  barcode text,
  name text not null,
  category_id uuid references public.categories(id) on delete set null,
  unit text not null default 'pc',
  selling_price numeric(12,2) not null default 0 check (selling_price >= 0),
  reorder_level integer not null default 0,
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, code)
);

-- Received products: one row per delivery line (a batch). Enables expiry tracking and FEFO.
create table if not exists public.stock_batches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  batch_no text,
  date_received date not null default current_date,
  expiry_date date,
  quantity_received integer not null check (quantity_received > 0),
  quantity_remaining integer not null check (quantity_remaining >= 0),
  base_price numeric(12,2) not null default 0 check (base_price >= 0),
  notes text,
  created_at timestamptz not null default now()
);

-- Ledger of every stock change (receive, sale, adjustment, return)
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  batch_id uuid references public.stock_batches(id) on delete set null,
  movement_type text not null check (movement_type in ('receive','sale','adjustment','return','expired','damaged')),
  quantity_change integer not null,
  reason text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

-- Total quantity per product, computed from batches (never typed by hand)
create or replace view public.product_stock
with (security_invoker = true) as
select
  p.id as product_id,
  p.business_id,
  coalesce(sum(b.quantity_remaining), 0)::integer as total_quantity,
  min(b.expiry_date) filter (where b.quantity_remaining > 0) as nearest_expiry
from public.products p
left join public.stock_batches b on b.product_id = p.id
group by p.id, p.business_id;

-- ───────── POS (tables ready for Phase 2) ─────────
create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  receipt_no text,
  subtotal numeric(12,2) not null default 0,
  discount numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  status text not null default 'completed' check (status in ('completed','voided','refunded')),
  cashier_id uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null references public.products(id),
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null,
  unit_cost numeric(12,2) not null default 0
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  method text not null check (method in ('cash','card','ewallet','stripe')),
  amount numeric(12,2) not null,
  stripe_payment_intent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_products_business on public.products(business_id);
create index if not exists idx_batches_product on public.stock_batches(product_id, expiry_date);
create index if not exists idx_movements_product on public.stock_movements(product_id, created_at desc);
create index if not exists idx_sales_business on public.sales(business_id, created_at desc);

-- ───────── Row Level Security ─────────
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.suppliers enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.stock_batches enable row level security;
alter table public.stock_movements enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;

create policy "members read business" on public.businesses
  for select using (public.is_member(id));
create policy "members update business" on public.businesses
  for update using (public.is_member(id));

create policy "read own memberships" on public.business_members
  for select using (user_id = auth.uid() or public.is_member(business_id));

-- Same member-only policy for every business-owned table
do $$
declare t text;
begin
  foreach t in array array[
    'suppliers','categories','products','stock_batches',
    'stock_movements','sales','sale_items','payments'
  ] loop
    execute format(
      'create policy "members all %1$s" on public.%1$I for all
         using (public.is_member(business_id))
         with check (public.is_member(business_id))', t);
  end loop;
end $$;

-- ───────── Storage: business logos ─────────
insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- Files live under "<user_id>/<filename>"; only that user can write there, anyone can read.
create policy "logos public read" on storage.objects
  for select using (bucket_id = 'logos');
create policy "logos owner upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "logos owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);
