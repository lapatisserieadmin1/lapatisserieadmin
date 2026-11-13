-- Phase 4A: customers, orders, order items, payments, order timeline, business hours, closures.
-- Orders are written only through the functions below so totals, snapshots, transitions,
-- idempotency, and version checks are enforced in one place. Staff get read-only table access.
-- Prices are GST-inclusive (proposed default); tax is the included portion per line.

create type public.order_source as enum ('IN_STORE', 'ONLINE', 'CALL');
create type public.order_status as enum (
  'draft', 'pending_confirmation', 'confirmed', 'preparing', 'ready', 'completed', 'rejected', 'cancelled'
);
create type public.payment_method as enum ('cash', 'upi', 'card', 'bank_transfer', 'other');
create type public.payment_kind as enum ('payment', 'refund');

-- ---------------------------------------------------------------------------
-- Opening hours and closures
-- ---------------------------------------------------------------------------

create table public.business_hours (
  weekday smallint primary key check (weekday between 0 and 6), -- 0 = Sunday, as extract(dow)
  opens_at time not null,
  closes_at time not null,
  is_closed boolean not null default false,
  updated_at timestamptz not null default now(),
  check (closes_at > opens_at)
);

create table public.closures (
  closed_on date primary key,
  reason text not null check (length(trim(reason)) between 1 and 120),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Customers
-- ---------------------------------------------------------------------------

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 1 and 80),
  phone text check (phone is null or phone ~ '^\+?[0-9]{10,15}$'),
  email text,
  notes text,
  no_show_count integer not null default 0 check (no_show_count >= 0),
  is_blocked boolean not null default false,
  blocked_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index customers_phone_key on public.customers (phone) where phone is not null;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------

create sequence public.order_number_seq start 1001;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint not null unique default nextval('public.order_number_seq'),
  reference text generated always as ('B-' || order_number::text) stored,
  -- Unguessable token for the future public status page (AC-15).
  access_token uuid not null unique default gen_random_uuid(),
  idempotency_key uuid not null unique,
  source public.order_source not null,
  status public.order_status not null,
  customer_id uuid references public.customers (id) on delete restrict,
  customer_name text,
  customer_phone text,
  fulfillment_type text not null default 'pickup' check (fulfillment_type = 'pickup'),
  is_immediate boolean not null default false,
  requested_due_at timestamptz not null,
  confirmed_due_at timestamptz,
  due_at timestamptz generated always as (coalesce(confirmed_due_at, requested_due_at)) stored,
  customer_notes text check (customer_notes is null or length(customer_notes) <= 1000),
  internal_notes text check (internal_notes is null or length(internal_notes) <= 1000),
  subtotal_paise bigint not null default 0 check (subtotal_paise >= 0),
  discount_paise bigint not null default 0 check (discount_paise >= 0),
  total_paise bigint not null default 0 check (total_paise >= 0),
  tax_paise bigint not null default 0 check (tax_paise >= 0),
  version integer not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  closed_reason text,
  closed_by uuid references auth.users (id) on delete set null,
  closed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source <> 'CALL' or (customer_name is not null and customer_phone is not null))
);
create index orders_due_at_idx on public.orders (due_at);
create index orders_status_idx on public.orders (status);
create index orders_source_idx on public.orders (source);
create index orders_customer_id_idx on public.orders (customer_id);
create index orders_created_at_idx on public.orders (created_at desc);
create index orders_created_by_idx on public.orders (created_by);
create index orders_confirmed_by_idx on public.orders (confirmed_by);
create index orders_closed_by_idx on public.orders (closed_by);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  line_no integer not null,
  product_id uuid references public.products (id) on delete set null,
  variant_id uuid references public.product_variants (id) on delete set null,
  -- Snapshot at order time (PRD 5B). Catalogue edits never rewrite these.
  product_name text not null,
  variant_name text not null,
  prep_type public.prep_type not null,
  kitchen_id uuid references public.kitchens (id) on delete restrict,
  is_veg boolean not null,
  contains_egg boolean not null,
  is_eggless boolean not null,
  allergens text[] not null default '{}',
  lead_time_minutes integer not null,
  unit_price_paise bigint not null check (unit_price_paise >= 0),
  tax_rate_bps integer not null,
  hsn_code text,
  quantity integer not null check (quantity between 1 and 999),
  cancelled_quantity integer not null default 0 check (cancelled_quantity between 0 and quantity),
  line_total_paise bigint not null check (line_total_paise >= 0),
  tax_paise bigint not null check (tax_paise >= 0),
  notes text check (notes is null or length(notes) <= 500),
  created_at timestamptz not null default now(),
  unique (order_id, line_no)
);
create index order_items_order_id_idx on public.order_items (order_id);
create index order_items_kitchen_id_idx on public.order_items (kitchen_id);
create index order_items_variant_id_idx on public.order_items (variant_id);
create index order_items_product_id_idx on public.order_items (product_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete restrict,
  idempotency_key uuid not null unique,
  kind public.payment_kind not null,
  method public.payment_method not null,
  amount_paise bigint not null check (amount_paise > 0),
  reference text check (reference is null or length(reference) <= 100),
  note text check (note is null or length(note) <= 500),
  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now()
);
create index payments_order_id_idx on public.payments (order_id);
create index payments_recorded_at_idx on public.payments (recorded_at);
create index payments_recorded_by_idx on public.payments (recorded_by);

create table public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders (id) on delete cascade,
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  event_type text not null,
  reason text,
  data jsonb not null default '{}'
);
create index order_events_order_idx on public.order_events (order_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create trigger business_hours_updated_at before update on public.business_hours
  for each row execute function private.set_updated_at();
create trigger customers_updated_at before update on public.customers
  for each row execute function private.set_updated_at();
create trigger orders_updated_at before update on public.orders
  for each row execute function private.set_updated_at();

create trigger business_hours_audit after insert or update or delete on public.business_hours
  for each row execute function private.audit_row('weekday');
create trigger closures_audit after insert or update or delete on public.closures
  for each row execute function private.audit_row('closed_on');
create trigger customers_audit after insert or update or delete on public.customers
  for each row execute function private.audit_row('id');
create trigger orders_audit after insert or update or delete on public.orders
  for each row execute function private.audit_row('id');
create trigger order_items_audit after insert or update or delete on public.order_items
  for each row execute function private.audit_row('id');
create trigger payments_audit after insert or update or delete on public.payments
  for each row execute function private.audit_row('id');

-- Payments are a ledger: corrections are refunds, never edits.
create function private.block_payment_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Payments cannot be edited or deleted; record a refund instead.';
end;
$$;
create trigger payments_immutable before update or delete on public.payments
  for each row execute function private.block_payment_changes();

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------

create function private.has_role(roles public.staff_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_staff_role() = any (roles), false)
$$;

-- Raises a staff-facing error. hint carries the category the app maps to UI behaviour.
create function private.fail(p_message text, p_kind text default 'validation')
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using message = p_message, hint = p_kind, errcode = 'P0001';
end;
$$;

create function private.business_timezone()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select timezone from public.business_settings where id), 'Asia/Kolkata')
$$;

-- Null when the pickup time is inside opening hours on an open day; otherwise the reason.
create function private.pickup_slot_problem(due timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  local_ts timestamp := due at time zone private.business_timezone();
  closure record;
  hours record;
begin
  select * into closure from public.closures where closed_on = local_ts::date;
  if found then
    return format('The bakery is closed on %s (%s).', to_char(local_ts, 'FMDay DD Mon'), closure.reason);
  end if;

  select * into hours from public.business_hours where weekday = extract(dow from local_ts);
  if not found or hours.is_closed then
    return format('The bakery is closed on %ss.', to_char(local_ts, 'FMDay'));
  end if;

  if local_ts::time < hours.opens_at or local_ts::time > hours.closes_at then
    return format('Pickup on %s must be between %s and %s.',
      to_char(local_ts, 'FMDay'), to_char(hours.opens_at, 'FMHH12:MI AM'), to_char(hours.closes_at, 'FMHH12:MI AM'));
  end if;

  return null;
end;
$$;

create function private.log_order_event(p_order_id uuid, p_type text, p_reason text default null, p_data jsonb default '{}')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.order_events (order_id, actor_id, event_type, reason, data)
  values (p_order_id, auth.uid(), p_type, p_reason, coalesce(p_data, '{}'))
$$;

-- Locks the order row and enforces optimistic concurrency (AC-18).
create function private.lock_order(p_order_id uuid, p_expected_version integer)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id for update;
  if not found then
    perform private.fail('Order not found.', 'not_found');
  end if;
  if p_expected_version is distinct from o.version then
    perform private.fail('This order was changed by someone else. Reload to see the latest version.', 'conflict');
  end if;
  return o;
end;
$$;

create function private.max_lead_minutes(p_order_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(lead_time_minutes), 0)
  from public.order_items
  where order_id = p_order_id and prep_type = 'made_to_order' and quantity > cancelled_quantity
$$;

create function private.lead_time_problem(p_order_id uuid, p_due timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lead integer := private.max_lead_minutes(p_order_id);
  earliest timestamptz := now() + make_interval(mins => lead);
begin
  if lead > 0 and p_due < earliest - interval '1 minute' then
    return format('These items need %s of preparation; the earliest pickup is %s.',
      case when lead >= 60 then (lead / 60) || ' h ' || (lead % 60) || ' min' else lead || ' min' end,
      to_char(earliest at time zone private.business_timezone(), 'FMDD Mon, FMHH12:MI AM'));
  end if;
  return null;
end;
$$;

-- Shared by confirm_order and create_order(p_confirm => true).
create function private.confirm_locked(o public.orders, p_override_reason text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  role public.staff_role := private.current_staff_role();
  unmapped text;
  problem text;
  result public.orders;
begin
  if role = 'counter' and o.source <> 'IN_STORE' then
    perform private.fail('Only an admin can confirm call and online orders.', 'forbidden');
  end if;
  if role is null or role not in ('admin', 'counter') then
    perform private.fail('You do not have permission to confirm orders.', 'forbidden');
  end if;
  if o.status not in ('draft', 'pending_confirmation') then
    perform private.fail(format('Only draft or pending orders can be confirmed; this one is %s.', replace(o.status::text, '_', ' ')));
  end if;

  -- Pick up kitchen mappings fixed since the order was taken, then block if any are still missing (AC-06).
  update public.order_items oi
  set kitchen_id = v.kitchen_id
  from public.product_variants v
  where oi.order_id = o.id and oi.variant_id = v.id
    and oi.prep_type = 'made_to_order' and oi.kitchen_id is null and v.kitchen_id is not null;

  select string_agg(product_name || ' — ' || variant_name, ', ') into unmapped
  from public.order_items
  where order_id = o.id and prep_type = 'made_to_order' and kitchen_id is null and quantity > cancelled_quantity;
  if unmapped is not null then
    perform private.fail(format('Assign a preparing kitchen before confirming: %s.', unmapped), 'unmapped');
  end if;

  problem := private.lead_time_problem(o.id, o.requested_due_at);
  if problem is not null and p_override_reason is null then
    perform private.fail(problem || ' An admin can override with a reason.', 'lead_time');
  end if;

  update public.orders
  set status = 'confirmed',
      confirmed_due_at = requested_due_at,
      confirmed_by = auth.uid(),
      confirmed_at = now(),
      version = version + 1
  where id = o.id
  returning * into result;

  perform private.log_order_event(o.id, 'confirmed', p_override_reason,
    case when problem is not null then jsonb_build_object('override', problem) else '{}' end);
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public functions (called by the app via RPC). Each checks the caller's role itself.
-- ---------------------------------------------------------------------------

create function public.create_order(
  p_idempotency_key uuid,
  p_source public.order_source,
  p_items jsonb,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_due_at timestamptz default null,
  p_customer_notes text default null,
  p_internal_notes text default null,
  p_confirm boolean default false,
  p_override_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  role public.staff_role := private.current_staff_role();
  o public.orders;
  item jsonb;
  line integer := 0;
  v record;
  qty integer;
  variant uuid;
  customer uuid;
  blocked boolean;
  subtotal bigint := 0;
  tax bigint := 0;
  line_total bigint;
  line_tax bigint;
  problem text;
  immediate boolean := p_due_at is null;
  due timestamptz := coalesce(p_due_at, now());
  v_name text := nullif(trim(coalesce(p_customer_name, '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_customer_phone, ''), '[\s()-]', '', 'g'), '');
  override text := nullif(trim(coalesce(p_override_reason, '')), '');
begin
  if role is null or role not in ('admin', 'counter') then
    perform private.fail('You do not have permission to create orders.', 'forbidden');
  end if;

  -- Retried submissions return the original order (AC-07).
  select * into o from public.orders where idempotency_key = p_idempotency_key;
  if found then
    return o;
  end if;

  if p_source = 'ONLINE' then
    perform private.fail('Online orders are placed through the website.');
  end if;
  if override is not null and role <> 'admin' then
    perform private.fail('Only an admin can override scheduling rules.', 'forbidden');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform private.fail('Add at least one item.');
  end if;
  if jsonb_array_length(p_items) > 50 then
    perform private.fail('An order can have at most 50 lines.');
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{10,15}$' then
    perform private.fail('Enter a valid phone number (10 to 15 digits).');
  end if;
  if v_name is not null and length(v_name) > 80 then
    perform private.fail('Customer name is too long.');
  end if;
  if p_source = 'CALL' and (v_name is null or v_phone is null) then
    perform private.fail('Call orders need the customer''s name and phone number.');
  end if;
  if immediate and p_source <> 'IN_STORE' then
    perform private.fail('Call orders need a pickup date and time.');
  end if;
  if not immediate and (v_name is null or v_phone is null) then
    perform private.fail('Future pickups need the customer''s name and phone number.');
  end if;

  if not immediate then
    if due < now() - interval '5 minutes' then
      perform private.fail('The pickup time is in the past.');
    end if;
    problem := private.pickup_slot_problem(due);
    if problem is not null and override is null then
      perform private.fail(problem || ' An admin can override with a reason.', 'slot');
    end if;
  end if;

  if v_phone is not null then
    insert into public.customers (full_name, phone)
    values (coalesce(v_name, 'Customer'), v_phone)
    on conflict (phone) where phone is not null
      do update set full_name = coalesce(excluded.full_name, public.customers.full_name)
    returning id, is_blocked into customer, blocked;
    if blocked and override is null then
      perform private.fail('This phone number is blocked. An admin can override with a reason.', 'blocked');
    end if;
  end if;

  insert into public.orders (
    idempotency_key, source, status, customer_id, customer_name, customer_phone,
    is_immediate, requested_due_at, customer_notes, internal_notes, created_by
  ) values (
    p_idempotency_key, p_source, 'pending_confirmation', customer, v_name, v_phone,
    immediate, due, nullif(trim(p_customer_notes), ''), nullif(trim(p_internal_notes), ''), auth.uid()
  )
  returning * into o;

  for item in select value from jsonb_array_elements(p_items)
  loop
    line := line + 1;
    begin
      qty := (item ->> 'quantity')::integer;
      variant := (item ->> 'variant_id')::uuid;
    exception when others then
      perform private.fail(format('Line %s is not valid.', line));
    end;
    if qty is null or qty < 1 or qty > 999 then
      perform private.fail(format('Line %s: quantity must be between 1 and 999.', line));
    end if;

    select p.id as product_id, p.name as product_name, p.prep_type, p.is_veg, p.contains_egg, p.allergens,
           p.tax_rate_bps, p.hsn_code, p.is_available as product_available, p.archived_at as product_archived,
           pv.id as variant_id, pv.name as variant_name, pv.price_paise, pv.kitchen_id, pv.lead_time_minutes,
           pv.is_eggless, pv.is_available as variant_available, pv.archived_at as variant_archived
    into v
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    where pv.id = variant;

    if not found then
      perform private.fail(format('Line %s: this item is no longer in the catalogue.', line));
    end if;
    if v.product_archived is not null or v.variant_archived is not null
       or not v.product_available or not v.variant_available then
      perform private.fail(format('%s — %s is not available.', v.product_name, v.variant_name), 'unavailable');
    end if;
    if length(coalesce(item ->> 'notes', '')) > 500 then
      perform private.fail(format('Line %s: notes are too long.', line));
    end if;

    line_total := v.price_paise * qty;
    line_tax := round(line_total * v.tax_rate_bps::numeric / (10000 + v.tax_rate_bps));

    insert into public.order_items (
      order_id, line_no, product_id, variant_id, product_name, variant_name, prep_type, kitchen_id,
      is_veg, contains_egg, is_eggless, allergens, lead_time_minutes, unit_price_paise, tax_rate_bps,
      hsn_code, quantity, line_total_paise, tax_paise, notes
    ) values (
      o.id, line, v.product_id, v.variant_id, v.product_name, v.variant_name, v.prep_type,
      case when v.prep_type = 'made_to_order' then v.kitchen_id end,
      v.is_veg, v.contains_egg, v.is_eggless, v.allergens, v.lead_time_minutes, v.price_paise, v.tax_rate_bps,
      v.hsn_code, qty, line_total, line_tax, nullif(trim(item ->> 'notes'), '')
    );

    subtotal := subtotal + line_total;
    tax := tax + line_tax;
  end loop;

  problem := private.lead_time_problem(o.id, due);
  if problem is not null and override is null then
    perform private.fail(problem || ' An admin can override with a reason.', 'lead_time');
  end if;

  update public.orders
  set subtotal_paise = subtotal, total_paise = subtotal, tax_paise = tax
  where id = o.id
  returning * into o;

  perform private.log_order_event(o.id, 'created', null, jsonb_build_object('source', p_source, 'immediate', immediate));
  if override is not null then
    perform private.log_order_event(o.id, 'override', override,
      jsonb_build_object('slot', private.pickup_slot_problem(due), 'lead_time', problem));
  end if;

  if p_confirm then
    o := private.confirm_locked(o, override);
  end if;
  return o;
end;
$$;

create function public.confirm_order(p_order_id uuid, p_expected_version integer, p_override_reason text default null)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  override text := nullif(trim(coalesce(p_override_reason, '')), '');
begin
  if override is not null and not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can override scheduling rules.', 'forbidden');
  end if;
  return private.confirm_locked(private.lock_order(p_order_id, p_expected_version), override);
end;
$$;

create function public.reject_order(p_order_id uuid, p_expected_version integer, p_reason text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can reject orders.', 'forbidden');
  end if;
  if reason is null then
    perform private.fail('Give a reason for rejecting the order.');
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if o.status not in ('draft', 'pending_confirmation') then
    perform private.fail('Only orders awaiting confirmation can be rejected. Cancel confirmed orders instead.');
  end if;

  update public.orders
  set status = 'rejected', closed_reason = reason, closed_by = auth.uid(), closed_at = now(), version = version + 1
  where id = o.id
  returning * into o;
  perform private.log_order_event(o.id, 'rejected', reason);
  return o;
end;
$$;

create function public.cancel_order(p_order_id uuid, p_expected_version integer, p_reason text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can cancel orders.', 'forbidden');
  end if;
  if reason is null then
    perform private.fail('Give a reason for cancelling the order.');
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if o.status in ('completed', 'rejected', 'cancelled') then
    perform private.fail(format('This order is already %s.', o.status));
  end if;

  -- Stop-work notices for released kitchen tickets are added with KOT in Phase 5.
  update public.orders
  set status = 'cancelled', closed_reason = reason, closed_by = auth.uid(), closed_at = now(), version = version + 1
  where id = o.id
  returning * into o;
  perform private.log_order_event(o.id, 'cancelled', reason);
  return o;
end;
$$;

create function public.reschedule_order(
  p_order_id uuid,
  p_expected_version integer,
  p_due_at timestamptz,
  p_reason text,
  p_override_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  old_due timestamptz;
  reason text := nullif(trim(coalesce(p_reason, '')), '');
  override text := nullif(trim(coalesce(p_override_reason, '')), '');
  slot text;
  lead text;
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can reschedule orders.', 'forbidden');
  end if;
  if reason is null then
    perform private.fail('Give a reason for the new pickup time.');
  end if;
  if p_due_at is null or p_due_at < now() - interval '5 minutes' then
    perform private.fail('Choose a pickup time in the future.');
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if o.status not in ('draft', 'pending_confirmation', 'confirmed') then
    perform private.fail('Only orders that have not started preparation can be rescheduled here.');
  end if;

  slot := private.pickup_slot_problem(p_due_at);
  lead := private.lead_time_problem(o.id, p_due_at);
  if (slot is not null or lead is not null) and override is null then
    perform private.fail(coalesce(slot, lead) || ' An admin can override with a reason.', coalesce(case when slot is not null then 'slot' end, 'lead_time'));
  end if;

  old_due := o.due_at;
  update public.orders
  set requested_due_at = p_due_at,
      confirmed_due_at = case when status = 'confirmed' then p_due_at else confirmed_due_at end,
      is_immediate = false,
      version = version + 1
  where id = o.id
  returning * into o;

  perform private.log_order_event(o.id, 'rescheduled', reason,
    jsonb_build_object('from', old_due, 'to', p_due_at) ||
    case when override is not null then jsonb_build_object('override', override, 'slot', slot, 'lead_time', lead) else '{}' end);
  return o;
end;
$$;

create function public.record_payment(
  p_order_id uuid,
  p_idempotency_key uuid,
  p_kind public.payment_kind,
  p_method public.payment_method,
  p_amount_paise bigint,
  p_reference text default null,
  p_note text default null
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments;
  o public.orders;
  paid bigint;
  refunded bigint;
  charge bigint;
  note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to record payments.', 'forbidden');
  end if;

  select * into p from public.payments where idempotency_key = p_idempotency_key;
  if found then
    return p;
  end if;

  if p_amount_paise is null or p_amount_paise <= 0 then
    perform private.fail('Enter an amount greater than zero.');
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then
    perform private.fail('Order not found.', 'not_found');
  end if;

  select coalesce(sum(amount_paise) filter (where kind = 'payment'), 0),
         coalesce(sum(amount_paise) filter (where kind = 'refund'), 0)
  into paid, refunded
  from public.payments where order_id = o.id;
  charge := case when o.status in ('cancelled', 'rejected') then 0 else o.total_paise end;

  if p_kind = 'payment' then
    if o.status in ('cancelled', 'rejected') then
      perform private.fail('Payments cannot be taken on a cancelled or rejected order.');
    end if;
    if p_amount_paise > charge - paid + refunded then
      perform private.fail(format('This is more than the balance due (₹%s).', to_char((charge - paid + refunded) / 100.0, 'FM999999990.00')));
    end if;
  else
    if not private.has_role(array['admin']::public.staff_role[]) then
      perform private.fail('Only an admin can record refunds.', 'forbidden');
    end if;
    if note is null then
      perform private.fail('Give a reason for the refund.');
    end if;
    if p_amount_paise > paid - refunded then
      perform private.fail(format('Refund cannot exceed the amount paid (₹%s).', to_char((paid - refunded) / 100.0, 'FM999999990.00')));
    end if;
  end if;

  insert into public.payments (order_id, idempotency_key, kind, method, amount_paise, reference, note, recorded_by)
  values (o.id, p_idempotency_key, p_kind, p_method, p_amount_paise, nullif(trim(p_reference), ''), note, auth.uid())
  returning * into p;

  update public.orders set version = version + 1 where id = o.id;
  perform private.log_order_event(o.id, case when p_kind = 'payment' then 'payment_recorded' else 'refund_recorded' end, note,
    jsonb_build_object('amount_paise', p_amount_paise, 'method', p_method));
  return p;
end;
$$;

-- ---------------------------------------------------------------------------
-- Read model
-- ---------------------------------------------------------------------------

create view public.order_summaries
with (security_invoker = true)
as
select
  o.*,
  coalesce(pay.paid_paise, 0) as paid_paise,
  coalesce(pay.refunded_paise, 0) as refunded_paise,
  (case when o.status in ('cancelled', 'rejected') then 0 else o.total_paise end)
    - coalesce(pay.paid_paise, 0) + coalesce(pay.refunded_paise, 0) as balance_paise,
  coalesce(items.item_count, 0) as item_count,
  coalesce(items.kitchen_ids, '{}') as kitchen_ids
from public.orders o
left join lateral (
  select sum(amount_paise) filter (where kind = 'payment') as paid_paise,
         sum(amount_paise) filter (where kind = 'refund') as refunded_paise
  from public.payments where order_id = o.id
) pay on true
left join lateral (
  select sum(quantity - cancelled_quantity)::integer as item_count,
         array_agg(distinct kitchen_id) filter (where kitchen_id is not null) as kitchen_ids
  from public.order_items where order_id = o.id
) items on true;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------

alter table public.business_hours enable row level security;
alter table public.closures enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.order_events enable row level security;

create policy "Staff read hours" on public.business_hours for select to authenticated
  using ((select private.is_staff()));
create policy "Admins update hours" on public.business_hours for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create policy "Staff read closures" on public.closures for select to authenticated
  using ((select private.is_staff()));
create policy "Admins add closures" on public.closures for insert to authenticated
  with check ((select private.is_admin()));
create policy "Admins remove closures" on public.closures for delete to authenticated
  using ((select private.is_admin()));

-- Chefs get kitchen tickets in Phase 5, not customer orders or payments.
create policy "Admin and counter read customers" on public.customers for select to authenticated
  using ((select private.has_role(array['admin', 'counter']::public.staff_role[])));
create policy "Admin and counter read orders" on public.orders for select to authenticated
  using ((select private.has_role(array['admin', 'counter']::public.staff_role[])));
create policy "Admin and counter read order items" on public.order_items for select to authenticated
  using ((select private.has_role(array['admin', 'counter']::public.staff_role[])));
create policy "Admin and counter read payments" on public.payments for select to authenticated
  using ((select private.has_role(array['admin', 'counter']::public.staff_role[])));
create policy "Admin and counter read order events" on public.order_events for select to authenticated
  using ((select private.has_role(array['admin', 'counter']::public.staff_role[])));

-- New tables default to full access for API roles in Supabase; reset to explicit grants.
revoke all on public.business_hours, public.closures, public.customers, public.orders,
  public.order_items, public.payments, public.order_events, public.order_summaries
  from anon, authenticated;
revoke all on sequence public.order_number_seq from anon, authenticated;

grant select, update on public.business_hours to authenticated;
grant select, insert, delete on public.closures to authenticated;
grant select on public.customers, public.orders, public.order_items, public.payments,
  public.order_events, public.order_summaries to authenticated;

revoke execute on all functions in schema private from public;
grant execute on function private.current_staff_role(), private.is_staff(), private.is_admin(),
  private.has_role(public.staff_role[]) to authenticated;

revoke execute on function
  public.create_order(uuid, public.order_source, jsonb, text, text, timestamptz, text, text, boolean, text),
  public.confirm_order(uuid, integer, text),
  public.reject_order(uuid, integer, text),
  public.cancel_order(uuid, integer, text),
  public.reschedule_order(uuid, integer, timestamptz, text, text),
  public.record_payment(uuid, uuid, public.payment_kind, public.payment_method, bigint, text, text)
  from public, anon;
grant execute on function
  public.create_order(uuid, public.order_source, jsonb, text, text, timestamptz, text, text, boolean, text),
  public.confirm_order(uuid, integer, text),
  public.reject_order(uuid, integer, text),
  public.cancel_order(uuid, integer, text),
  public.reschedule_order(uuid, integer, timestamptz, text, text),
  public.record_payment(uuid, uuid, public.payment_kind, public.payment_method, bigint, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Seed placeholder hours: 9 AM to 9 PM every day (PRD decision 4 still open).
-- ---------------------------------------------------------------------------

insert into public.business_hours (weekday, opens_at, closes_at)
select d, '09:00', '21:00' from generate_series(0, 6) d;
