-- Phase 4C: enforce pickup windows and category caps in create/confirm/reschedule (AC-32),
-- and require override reasons of at least 5 characters (AC-36).
-- create_order, confirm_locked, confirm_order and reschedule_order are copied from
-- 20260927000200_orders.sql with the capacity changes marked "4C".

-- Orders that use capacity on a business-local day (excluding one order, usually the one being checked).
create function private.counted_orders(p_day date, p_exclude uuid)
returns setof public.orders
language sql
stable
security definer
set search_path = ''
as $$
  select o.* from public.orders o
  where o.status not in ('draft', 'rejected', 'cancelled')
    and not o.is_immediate
    and o.id is distinct from p_exclude
    and o.due_at >= (p_day::timestamp at time zone private.business_timezone())
    and o.due_at < ((p_day + 1)::timestamp at time zone private.business_timezone())
$$;

-- The window list for a day: that date's festival override if any, otherwise the weekday list.
create function private.windows_for_date(p_day date)
returns table (starts_at time, ends_at time, max_orders integer)
language sql
stable
security definer
set search_path = ''
as $$
  select w.starts_at, w.ends_at, w.max_orders from public.capacity_overrides w
  where w.on_date = p_day and w.kind = 'window'
  union all
  select w.starts_at, w.ends_at, w.max_orders from public.pickup_windows w
  where w.weekday = extract(dow from p_day)
    and not exists (select 1 from public.capacity_overrides c where c.on_date = p_day and c.kind = 'window')
$$;

-- The window a local pickup time belongs to. A time on the boundary of two windows belongs to the later one;
-- the end time of a window with no window after it still belongs to that window.
create function private.window_for(p_local timestamp)
returns table (starts_at time, ends_at time, max_orders integer)
language sql
stable
security definer
set search_path = ''
as $$
  select w.starts_at, w.ends_at, w.max_orders
  from private.windows_for_date(p_local::date) w
  where w.starts_at <= p_local::time and p_local::time <= w.ends_at
  order by w.starts_at desc
  limit 1
$$;

create function private.category_cap(p_day date, p_category uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select max_orders from public.capacity_overrides where on_date = p_day and kind = 'category' and category_id = p_category),
    (select max_orders from public.category_daily_caps where category_id = p_category)
  )
$$;

-- Null message when the order fits; otherwise the first problem and its kind ('slot' or 'capacity').
-- Volatile on purpose: after taking the lock, each statement must see orders committed meanwhile.
create function private.capacity_problem(p_order_id uuid, p_due timestamptz, out message text, out kind text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  tz text := private.business_timezone();
  local_ts timestamp := p_due at time zone tz;
  day date := (p_due at time zone tz)::date;
  win record;
  cat record;
  used integer;
begin
  -- Serialise capacity checks per business day so two bookings cannot both take the last place.
  perform pg_advisory_xact_lock(hashtext('capacity'), day - date '2000-01-01');

  if exists (select 1 from private.windows_for_date(day)) then
    select * into win from private.window_for(local_ts);
    if not found then
      message := format('%s is outside the pickup windows for %s.', to_char(local_ts, 'FMHH12:MI AM'), to_char(local_ts, 'FMDay DD Mon'));
      kind := 'slot';
      return;
    end if;
    if win.max_orders is not null then
      select count(*) into used
      from private.counted_orders(day, p_order_id) o
      where (select x.starts_at from private.window_for(o.due_at at time zone tz) x) = win.starts_at;
      if used >= win.max_orders then
        message := format('Pickup window %s–%s is full (%s/%s).',
          to_char(win.starts_at, 'FMHH12:MI AM'), to_char(win.ends_at, 'FMHH12:MI AM'), used, win.max_orders);
        kind := 'capacity';
        return;
      end if;
    end if;
  end if;

  for cat in
    select c.id, c.name, private.category_cap(day, c.id) as cap
    from public.categories c
    where c.id in (select oi.category_id from public.order_items oi
                   where oi.order_id = p_order_id and oi.quantity > oi.cancelled_quantity)
    order by c.name
  loop
    continue when cat.cap is null;
    select count(*) into used
    from private.counted_orders(day, p_order_id) o
    where exists (select 1 from public.order_items oi
                  where oi.order_id = o.id and oi.category_id = cat.id and oi.quantity > oi.cancelled_quantity);
    if used >= cat.cap then
      message := format('%s: %s/%s orders on %s.', cat.name, used, cat.cap, to_char(day, 'FMDD Mon'));
      kind := 'capacity';
      return;
    end if;
  end loop;
end;
$$;

-- Window and category usage for one business-local day, for the staff order screens (and the website later).
create function public.pickup_availability(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tz text := private.business_timezone();
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to see pickup availability.', 'forbidden');
  end if;
  return jsonb_build_object(
    'windows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'starts_at', to_char(w.starts_at, 'HH24:MI'),
        'ends_at', to_char(w.ends_at, 'HH24:MI'),
        'max', w.max_orders,
        'used', (select count(*) from private.counted_orders(p_date, null) o
                 where (select x.starts_at from private.window_for(o.due_at at time zone tz) x) = w.starts_at)
      ) order by w.starts_at)
      from private.windows_for_date(p_date) w), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', c.id,
        'name', c.name,
        'max', c.cap,
        'used', (select count(*) from private.counted_orders(p_date, null) o
                 where exists (select 1 from public.order_items oi
                               where oi.order_id = o.id and oi.category_id = c.id and oi.quantity > oi.cancelled_quantity))
      ) order by c.name)
      from (select cc.id, cc.name, private.category_cap(p_date, cc.id) as cap from public.categories cc) c
      where c.cap is not null), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Replaced order functions
-- ---------------------------------------------------------------------------

create or replace function private.confirm_locked(o public.orders, p_override_reason text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  role public.staff_role := private.current_staff_role();
  unmapped text;
  problem text;
  cap_msg text; -- 4C
  cap_kind text; -- 4C
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

  -- 4C: windows and category caps (walk-in immediate orders do not reserve capacity).
  if not o.is_immediate then
    select c.message, c.kind into cap_msg, cap_kind from private.capacity_problem(o.id, o.requested_due_at) c;
    if cap_msg is not null and p_override_reason is null then
      perform private.fail(cap_msg || ' An admin can override with a reason.', cap_kind);
    end if;
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
    jsonb_strip_nulls(jsonb_build_object('lead_time', problem, 'capacity', cap_msg))); -- 4C
  return result;
end;
$$;

create or replace function public.create_order(
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
  cap_msg text; -- 4C
  cap_kind text; -- 4C
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
  if override is not null and length(override) < 5 then -- 4C
    perform private.fail('Give an override reason of at least 5 characters.');
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

    select p.id as product_id, p.name as product_name, p.category_id, p.prep_type, p.is_veg, p.contains_egg, p.allergens,
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
      order_id, line_no, product_id, variant_id, category_id, product_name, variant_name, prep_type, kitchen_id,
      is_veg, contains_egg, is_eggless, allergens, lead_time_minutes, unit_price_paise, tax_rate_bps,
      hsn_code, quantity, line_total_paise, tax_paise, notes
    ) values (
      o.id, line, v.product_id, v.variant_id, v.category_id, v.product_name, v.variant_name, v.prep_type,
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

  -- 4C: windows and category caps (walk-in immediate orders do not reserve capacity).
  if not immediate then
    select c.message, c.kind into cap_msg, cap_kind from private.capacity_problem(o.id, due) c;
    if cap_msg is not null and override is null then
      perform private.fail(cap_msg || ' An admin can override with a reason.', cap_kind);
    end if;
  end if;

  update public.orders
  set subtotal_paise = subtotal, total_paise = subtotal, tax_paise = tax
  where id = o.id
  returning * into o;

  perform private.log_order_event(o.id, 'created', null, jsonb_build_object('source', p_source, 'immediate', immediate));
  if override is not null then
    perform private.log_order_event(o.id, 'override', override,
      jsonb_strip_nulls(jsonb_build_object('slot', private.pickup_slot_problem(due), 'lead_time', problem, 'capacity', cap_msg))); -- 4C
  end if;

  if p_confirm then
    o := private.confirm_locked(o, override);
  end if;
  return o;
end;
$$;

create or replace function public.confirm_order(p_order_id uuid, p_expected_version integer, p_override_reason text default null)
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
  if override is not null and length(override) < 5 then -- 4C
    perform private.fail('Give an override reason of at least 5 characters.');
  end if;
  return private.confirm_locked(private.lock_order(p_order_id, p_expected_version), override);
end;
$$;

create or replace function public.reschedule_order(
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
  cap_msg text; -- 4C
  cap_kind text; -- 4C
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can reschedule orders.', 'forbidden');
  end if;
  if reason is null then
    perform private.fail('Give a reason for the new pickup time.');
  end if;
  if override is not null and length(override) < 5 then -- 4C
    perform private.fail('Give an override reason of at least 5 characters.');
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
  select c.message, c.kind into cap_msg, cap_kind from private.capacity_problem(o.id, p_due_at) c; -- 4C
  if (slot is not null or lead is not null or cap_msg is not null) and override is null then
    perform private.fail(coalesce(slot, lead, cap_msg) || ' An admin can override with a reason.',
      coalesce(case when slot is not null then 'slot' end, case when lead is not null then 'lead_time' end, cap_kind));
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
    case when override is not null
      then jsonb_strip_nulls(jsonb_build_object('override', override, 'slot', slot, 'lead_time', lead, 'capacity', cap_msg))
      else '{}' end);
  return o;
end;
$$;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------

revoke execute on function
  private.counted_orders(date, uuid),
  private.windows_for_date(date),
  private.window_for(timestamp),
  private.category_cap(date, uuid),
  private.capacity_problem(uuid, timestamptz)
  from public;

revoke execute on function public.pickup_availability(date) from public, anon;
grant execute on function public.pickup_availability(date) to authenticated;
