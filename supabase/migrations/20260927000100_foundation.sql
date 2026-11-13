-- Phase 3 foundation: settings, kitchens, staff roles, catalogue, audit.
-- Money is stored as integer paise. Times are timestamptz; business timezone lives in business_settings.

create schema if not exists private;

create type public.staff_role as enum ('admin', 'counter', 'chef');
create type public.prep_type as enum ('made_to_order', 'ready_stock');

-- ---------------------------------------------------------------------------
-- Shared trigger helpers
-- ---------------------------------------------------------------------------

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.business_settings (
  id boolean primary key default true check (id),
  business_name text not null default 'Auri Bakery' check (length(trim(business_name)) between 1 and 80),
  timezone text not null default 'Asia/Kolkata',
  currency text not null default 'INR' check (currency = 'INR'),
  phone text,
  email text,
  address text,
  gstin text check (gstin is null or gstin ~ '^[0-9]{2}[A-Z0-9]{13}$'),
  fssai_licence text check (fssai_licence is null or fssai_licence ~ '^[0-9]{14}$'),
  updated_at timestamptz not null default now()
);

create table public.kitchens (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_]{1,16}$'),
  name text not null check (length(trim(name)) between 1 and 60),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 1 and 80),
  role public.staff_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_kitchens (
  user_id uuid not null references public.staff_profiles (user_id) on delete cascade,
  kitchen_id uuid not null references public.kitchens (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (user_id, kitchen_id)
);
create index staff_kitchens_kitchen_id_idx on public.staff_kitchens (kitchen_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 60),
  default_kitchen_id uuid references public.kitchens (id) on delete set null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index categories_default_kitchen_id_idx on public.categories (default_kitchen_id);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories (id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 100),
  description text,
  image_url text,
  prep_type public.prep_type not null default 'made_to_order',
  is_veg boolean not null default true,
  contains_egg boolean not null default false,
  allergens text[] not null default '{}',
  hsn_code text check (hsn_code is null or hsn_code ~ '^[0-9]{4,8}$'),
  -- GST rate in basis points (500 = 5%). Supplied by the owner/accountant.
  tax_rate_bps integer not null default 0 check (tax_rate_bps between 0 and 2800),
  is_available boolean not null default true,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_category_id_idx on public.products (category_id);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  price_paise bigint not null check (price_paise >= 0),
  -- Required for made-to-order variants before an order containing them can be confirmed (PRD 5B, AC-06).
  kitchen_id uuid references public.kitchens (id) on delete restrict,
  lead_time_minutes integer not null default 0 check (lead_time_minutes between 0 and 43200),
  is_eggless boolean not null default false,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index product_variants_product_id_idx on public.product_variants (product_id);
create index product_variants_kitchen_id_idx on public.product_variants (kitchen_id);
create unique index product_variants_active_name_key
  on public.product_variants (product_id, lower(name))
  where archived_at is null;

create table public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  table_name text not null,
  record_id text not null,
  old_data jsonb,
  new_data jsonb
);
create index audit_events_record_idx on public.audit_events (table_name, record_id, occurred_at desc);
create index audit_events_occurred_at_idx on public.audit_events (occurred_at desc);

-- ---------------------------------------------------------------------------
-- Authorization helpers (private schema is not exposed through the Data API)
-- ---------------------------------------------------------------------------

create function private.current_staff_role()
returns public.staff_role
language sql
stable
security definer
set search_path = ''
as $$
  select sp.role
  from public.staff_profiles sp
  where sp.user_id = (select auth.uid()) and sp.is_active
$$;

create function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_staff_role() is not null
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_staff_role() = 'admin', false)
$$;

revoke all on schema private from public;
revoke execute on all functions in schema private from public;
grant usage on schema private to authenticated;
grant execute on function private.current_staff_role(), private.is_staff(), private.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Audit and integrity triggers
-- ---------------------------------------------------------------------------

-- TG_ARGV[0] names the primary-key column used as record_id.
create function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pk text := tg_argv[0];
  rec jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_events (actor_id, action, table_name, record_id, old_data, new_data)
  values (
    auth.uid(),
    tg_op,
    tg_table_name,
    rec ->> pk,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end;
$$;

-- Never leave the bakery without an active admin.
create function private.guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and old.is_active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.is_active)
     and not exists (
       select 1 from public.staff_profiles
       where role = 'admin' and is_active and user_id <> old.user_id
     ) then
    raise exception 'At least one active admin is required';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger staff_profiles_guard_last_admin
  before update or delete on public.staff_profiles
  for each row execute function private.guard_last_admin();

create trigger business_settings_updated_at before update on public.business_settings
  for each row execute function private.set_updated_at();
create trigger kitchens_updated_at before update on public.kitchens
  for each row execute function private.set_updated_at();
create trigger staff_profiles_updated_at before update on public.staff_profiles
  for each row execute function private.set_updated_at();
create trigger categories_updated_at before update on public.categories
  for each row execute function private.set_updated_at();
create trigger products_updated_at before update on public.products
  for each row execute function private.set_updated_at();
create trigger product_variants_updated_at before update on public.product_variants
  for each row execute function private.set_updated_at();

create trigger business_settings_audit after insert or update or delete on public.business_settings
  for each row execute function private.audit_row('id');
create trigger kitchens_audit after insert or update or delete on public.kitchens
  for each row execute function private.audit_row('id');
create trigger staff_profiles_audit after insert or update or delete on public.staff_profiles
  for each row execute function private.audit_row('user_id');
create trigger staff_kitchens_audit after insert or update or delete on public.staff_kitchens
  for each row execute function private.audit_row('user_id');
create trigger categories_audit after insert or update or delete on public.categories
  for each row execute function private.audit_row('id');
create trigger products_audit after insert or update or delete on public.products
  for each row execute function private.audit_row('id');
create trigger product_variants_audit after insert or update or delete on public.product_variants
  for each row execute function private.audit_row('id');

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.business_settings enable row level security;
alter table public.kitchens enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.staff_kitchens enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.audit_events enable row level security;

-- Staff read shared reference data; only admins change it.
create policy "Staff read settings" on public.business_settings for select to authenticated
  using ((select private.is_staff()));
create policy "Admins update settings" on public.business_settings for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Staff read kitchens" on public.kitchens for select to authenticated
  using ((select private.is_staff()));
create policy "Admins insert kitchens" on public.kitchens for insert to authenticated
  with check ((select private.is_admin()));
create policy "Admins update kitchens" on public.kitchens for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Staff read own profile, admins read all" on public.staff_profiles for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy "Admins insert staff" on public.staff_profiles for insert to authenticated
  with check ((select private.is_admin()));
create policy "Admins update staff" on public.staff_profiles for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Staff read own kitchens, admins read all" on public.staff_kitchens for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy "Admins assign kitchens" on public.staff_kitchens for insert to authenticated
  with check ((select private.is_admin()));
create policy "Admins unassign kitchens" on public.staff_kitchens for delete to authenticated
  using ((select private.is_admin()));

create policy "Staff read categories" on public.categories for select to authenticated
  using ((select private.is_staff()));
create policy "Admins insert categories" on public.categories for insert to authenticated
  with check ((select private.is_admin()));
create policy "Admins update categories" on public.categories for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Staff read products" on public.products for select to authenticated
  using ((select private.is_staff()));
create policy "Admins insert products" on public.products for insert to authenticated
  with check ((select private.is_admin()));
create policy "Admins update products" on public.products for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Staff read variants" on public.product_variants for select to authenticated
  using ((select private.is_staff()));
create policy "Admins insert variants" on public.product_variants for insert to authenticated
  with check ((select private.is_admin()));
create policy "Admins update variants" on public.product_variants for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Admins read audit" on public.audit_events for select to authenticated
  using ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Data API grants: nothing for anon yet (public site not started); explicit grants for staff.
-- Products and variants are archived, never deleted.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
grant select, update on public.business_settings to authenticated;
grant select, insert, update on public.kitchens to authenticated;
grant select, insert, update on public.staff_profiles to authenticated;
grant select, insert, delete on public.staff_kitchens to authenticated;
grant select, insert, update on public.categories to authenticated;
grant select, insert, update on public.products to authenticated;
grant select, insert, update on public.product_variants to authenticated;
grant select on public.audit_events to authenticated;

-- Made-to-order variants that still need a kitchen (AC-06).
create view public.unmapped_variants
with (security_invoker = true)
as
select v.id as variant_id, v.name as variant_name, p.id as product_id, p.name as product_name
from public.product_variants v
join public.products p on p.id = v.product_id
where p.prep_type = 'made_to_order'
  and v.kitchen_id is null
  and v.archived_at is null
  and p.archived_at is null;

grant select on public.unmapped_variants to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: settings row and placeholder kitchens (PRD section 2)
-- ---------------------------------------------------------------------------

insert into public.business_settings (id) values (true);
insert into public.kitchens (code, name, sort_order) values
  ('K1', 'Kitchen 1', 1),
  ('K2', 'Kitchen 2', 2);
