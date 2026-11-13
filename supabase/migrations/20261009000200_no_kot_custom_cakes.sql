-- 2026-10-09 (owner): no more kitchen tickets (KOT), a Customer order source, collect from store or set up at
-- the customer's place, and custom cake orders with a staff price and an advance.
--
-- 1. Kitchen tickets are switched off: confirming makes no ticket, edits revise none, live tickets and open
--    issues are retired, chef PIN sign-in is closed. Ticket tables and their history stay, unused.
-- 2. Orders carry the fulfilment (collect | setup) with the set-up address and note.
-- 3. create_order takes the Customer source (call-order rules), the fulfilment and custom cake lines.
-- 4. custom_cakes holds a custom cake's details; create_custom_cake_order, update_custom_cake.
-- 5. set_fulfilment changes collect/set-up until the order is closed.
-- 6. order_summaries is recreated for the new columns; the unused fulfillment_type placeholder is dropped.

-- ---------------------------------------------------------------------------
-- 1. Kitchen tickets switched off
-- ---------------------------------------------------------------------------

create or replace function private.build_tickets(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return 0; -- 2026-10-09: no kitchen tickets
end;
$$;

create or replace function private.apply_ticket_changes(p_order_id uuid, p_cause text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  return; -- 2026-10-09: no kitchen tickets
end;
$$;

-- Live tickets are cancelled without a stop-work notice and open issues resolved, so orders confirmed
-- before the switch can be packed. Called once below; kept as a function for the checks.
create function private.retire_kitchen_tickets()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  retired integer;
  ord uuid;
begin
  update public.kitchen_issues
  set resolved_at = now(), resolution = 'KOT retired'
  where resolved_at is null;

  for ord in
    select distinct order_id from public.kitchen_tickets where status in ('new', 'acknowledged', 'preparing')
  loop
    perform private.log_order_event(ord, 'kitchen_tickets_retired', 'Kitchen tickets are no longer used.');
  end loop;

  update public.kitchen_tickets
  set status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, now()),
      cancel_reason = coalesce(cancel_reason, 'KOT retired'),
      stop_work_acknowledged_at = coalesce(stop_work_acknowledged_at, now())
  where status in ('new', 'acknowledged', 'preparing');
  get diagnostics retired = row_count;

  update public.kitchen_tickets set pending_changes = '[]' where has_pending_changes;
  update public.kitchen_tickets set stop_work_acknowledged_at = now()
  where status = 'cancelled' and stop_work_acknowledged_at is null;
  return retired;
end;
$$;
revoke execute on function private.retire_kitchen_tickets() from public, anon, authenticated;

select private.retire_kitchen_tickets();

-- Chef PIN sign-in and kitchen tablets are closed.
revoke execute on function
  public.set_staff_pin(uuid, text),
  public.register_kitchen_device(uuid, text, text),
  public.revoke_kitchen_device(uuid),
  public.verify_kitchen_pin(text, uuid, text),
  public.kitchen_device_chefs(text),
  public.record_kitchen_pin_session(uuid, uuid, uuid, timestamptz),
  public.kitchen_pin_session_status(uuid, text)
  from public, anon, authenticated, service_role;

-- Confirming no longer needs a kitchen for made-to-order items and makes no ticket (copied from
-- 20260930000300 with the kitchen mapping check and build_tickets removed).
create or replace function private.confirm_locked(o public.orders, p_override_reason text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  role public.staff_role := private.current_staff_role();
  problem text;
  cap_msg text; -- 4C
  cap_kind text; -- 4C
  result public.orders;
begin
  if role = 'counter' and o.source <> 'IN_STORE' then
    perform private.fail('Only an admin can confirm call, customer and online orders.', 'forbidden');
  end if;
  if role is null or role not in ('admin', 'counter') then
    perform private.fail('You do not have permission to confirm orders.', 'forbidden');
  end if;
  if o.status not in ('draft', 'pending_confirmation') then
    perform private.fail(format('Only draft or pending orders can be confirmed; this one is %s.', replace(o.status::text, '_', ' ')));
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

-- Changing items no longer needs a kitchen for added made-to-order items and revises no ticket (copied
-- from 20261003000400 with the kitchen check and apply_ticket_changes removed).
create or replace function public.update_order_items(
  p_order_id uuid,
  p_expected_version integer,
  p_lines jsonb,
  p_reason text default null,
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
  reason text := nullif(trim(coalesce(p_reason, '')), '');
  override text := nullif(trim(coalesce(p_override_reason, '')), '');
  item jsonb;
  pos integer := 0;
  qty integer;
  line_id uuid;
  variant uuid;
  v_notes text;
  last_existing integer;
  ln public.order_items;
  v record;
  next_line integer;
  kept uuid[] := '{}';
  changes jsonb := '[]';
  grown_lead integer := 0;
  old_categories uuid[];
  new_categories uuid[] := '{}';
  total_before bigint;
  problem text;
  cap_msg text;
  cat record;
  used integer;
  day date;
begin
  if role is null or role not in ('admin', 'counter') then
    perform private.fail('You do not have permission to change orders.', 'forbidden');
  end if;
  if override is not null and role <> 'admin' then
    perform private.fail('Only an admin can override scheduling rules.', 'forbidden');
  end if;
  if override is not null and length(override) < 5 then
    perform private.fail('Give an override reason of at least 5 characters.');
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    perform private.fail('An order needs at least one item. Cancel the order instead.');
  end if;
  if jsonb_array_length(p_lines) > 50 then
    perform private.fail('An order can have at most 50 lines.');
  end if;

  o := private.lock_order(p_order_id, p_expected_version);
  if o.status in ('confirmed', 'preparing') then -- 5C: preparing too
    if role <> 'admin' then
      perform private.fail('Only an admin can change the items on a confirmed order.', 'forbidden');
    end if;
    if reason is null then
      perform private.fail('Give a reason for changing a confirmed order.');
    end if;
  elsif o.status = 'ready' then
    perform private.fail('This order is packed. Reopen packing before changing its items.', 'kitchen');
  elsif o.status not in ('draft', 'pending_confirmation') then
    perform private.fail(format('Items cannot be changed on a %s order.', replace(o.status::text, '_', ' ')));
  end if;
  if exists (select 1 from public.bills where order_id = o.id) then
    perform private.fail('This order already has a bill. Issue a credit note instead.', 'billed');
  end if;

  total_before := o.total_paise;
  select coalesce(max(line_no), 0) into next_line from public.order_items where order_id = o.id;
  last_existing := next_line;
  -- Review fix: lines removed after the kitchen acknowledged stay (cancelled) but no longer hold a category.
  select coalesce(array_agg(distinct category_id) filter (where category_id is not null), '{}') into old_categories
  from public.order_items where order_id = o.id and quantity > cancelled_quantity;

  for item in select value from jsonb_array_elements(p_lines)
  loop
    pos := pos + 1;
    begin
      qty := (item ->> 'quantity')::integer;
      line_id := (item ->> 'line_id')::uuid;
      variant := (item ->> 'variant_id')::uuid;
    exception when others then
      perform private.fail(format('Line %s is not valid.', pos));
    end;
    v_notes := nullif(trim(coalesce(item ->> 'notes', '')), '');
    if qty is null or qty < 1 or qty > 999 then
      perform private.fail(format('Line %s: quantity must be between 1 and 999.', pos));
    end if;
    if length(coalesce(v_notes, '')) > 500 then
      perform private.fail(format('Line %s: notes are too long.', pos));
    end if;

    if line_id is not null then
      -- Existing line: keep its snapshot; only quantity and notes change.
      select * into ln from public.order_items where id = line_id and order_id = o.id;
      if not found then
        perform private.fail(format('Line %s is not on this order. Reload and try again.', pos), 'conflict');
      end if;
      if line_id = any (kept) then
        perform private.fail(format('Line %s appears twice.', pos));
      end if;
      kept := kept || line_id;
      if ln.cancelled_quantity >= ln.quantity then -- 5C
        perform private.fail(format('Line %s was removed from this order. Add the item again instead.', pos));
      end if;

      if qty > ln.quantity then
        -- More of an item: it must still be available and its preparation time must fit.
        select p.is_available and pv.is_available and p.archived_at is null and pv.archived_at is null as available
        into v
        from public.product_variants pv join public.products p on p.id = pv.product_id
        where pv.id = ln.variant_id;
        if not found or not v.available then
          perform private.fail(format('%s — %s is not available, so its quantity cannot be increased.', ln.product_name, ln.variant_name), 'unavailable');
        end if;
        if ln.prep_type = 'made_to_order' then
          grown_lead := greatest(grown_lead, ln.lead_time_minutes);
        end if;
      end if;

      if qty <> ln.quantity or v_notes is distinct from ln.notes then
        update public.order_items
        set quantity = qty, line_total_paise = unit_price_paise * qty, notes = v_notes
        where id = ln.id;
        changes := changes || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'item', ln.product_name || ' — ' || ln.variant_name,
          'from', ln.quantity, 'to', qty,
          'notes', case when v_notes is distinct from ln.notes then coalesce(v_notes, '') end)));
      end if;
    else
      -- New line: snapshot the current catalogue, as create_order does.
      select p.id as product_id, p.name as product_name, p.category_id, p.prep_type, p.is_veg, p.contains_egg, p.allergens,
             p.tax_rate_bps, p.hsn_code, p.is_available as product_available, p.archived_at as product_archived,
             pv.id as variant_id, pv.name as variant_name, pv.price_paise, pv.kitchen_id, pv.lead_time_minutes,
             pv.is_eggless, pv.is_available as variant_available, pv.archived_at as variant_archived
      into v
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
      where pv.id = variant;
      if not found then
        perform private.fail(format('Line %s: this item is no longer in the catalogue.', pos));
      end if;
      if v.product_archived is not null or v.variant_archived is not null
         or not v.product_available or not v.variant_available then
        perform private.fail(format('%s — %s is not available.', v.product_name, v.variant_name), 'unavailable');
      end if;

      next_line := next_line + 1;
      insert into public.order_items (
        order_id, line_no, product_id, variant_id, category_id, product_name, variant_name, prep_type, kitchen_id,
        is_veg, contains_egg, is_eggless, allergens, lead_time_minutes, unit_price_paise, tax_rate_bps,
        hsn_code, quantity, line_total_paise, tax_paise, notes
      ) values (
        o.id, next_line, v.product_id, v.variant_id, v.category_id, v.product_name, v.variant_name, v.prep_type,
        case when v.prep_type = 'made_to_order' then v.kitchen_id end,
        v.is_veg, v.contains_egg, v.is_eggless, v.allergens, v.lead_time_minutes, v.price_paise, v.tax_rate_bps,
        v.hsn_code, qty, v.price_paise * qty, 0, v_notes
      );
      if v.prep_type = 'made_to_order' then
        grown_lead := greatest(grown_lead, v.lead_time_minutes);
      end if;
      if v.category_id is not null and not v.category_id = any (old_categories) then
        new_categories := new_categories || v.category_id;
      end if;
      changes := changes || jsonb_build_array(jsonb_build_object(
        'item', v.product_name || ' — ' || v.variant_name, 'from', 0, 'to', qty));
    end if;
  end loop;

  -- Existing lines left out of the list are removed. 5C: a line the kitchen has acknowledged stays,
  -- fully cancelled and at zero value, so the ticket keeps its history; others are deleted (the
  -- audit log keeps the deleted rows).
  for ln in
    select * from public.order_items oi
    where oi.order_id = o.id and oi.line_no <= last_existing and not (oi.id = any (kept))
      and oi.quantity > oi.cancelled_quantity
    order by oi.line_no
  loop
    if exists (select 1 from public.kitchen_ticket_lines l join public.kitchen_tickets kt on kt.id = l.ticket_id
               where l.order_item_id = ln.id and kt.status in ('acknowledged', 'preparing', 'ready')) then
      update public.order_items set cancelled_quantity = quantity, line_total_paise = 0, tax_paise = 0 where id = ln.id;
    else
      delete from public.order_items where id = ln.id;
    end if;
    changes := changes || jsonb_build_array(jsonb_build_object(
      'item', ln.product_name || ' — ' || ln.variant_name, 'from', ln.quantity - ln.cancelled_quantity, 'to', 0));
  end loop;

  if jsonb_array_length(changes) = 0 then
    perform private.fail('Nothing was changed.');
  end if;

  -- Preparation time for what the edit adds.
  if grown_lead > 0 and o.due_at < now() + make_interval(mins => grown_lead) - interval '1 minute' then
    problem := format('The added items need %s of preparation; the earliest pickup is %s.',
      case when grown_lead >= 60 then (grown_lead / 60) || ' h ' || (grown_lead % 60) || ' min' else grown_lead || ' min' end,
      to_char((now() + make_interval(mins => grown_lead)) at time zone private.business_timezone(), 'FMDD Mon, FMHH12:MI AM'));
    if override is null then
      perform private.fail(problem || ' An admin can override with a reason.', 'lead_time');
    end if;
  end if;

  -- Daily caps for categories this edit adds, counted against every other order (as a new booking would be).
  if not o.is_immediate and cardinality(new_categories) > 0 then
    day := (o.due_at at time zone private.business_timezone())::date;
    perform pg_advisory_xact_lock(hashtext('capacity'), day - date '2000-01-01');
    for cat in
      select c.id, c.name, private.category_cap(day, c.id) as cap
      from public.categories c where c.id = any (new_categories) order by c.name
    loop
      continue when cat.cap is null;
      select count(*) into used
      from private.counted_orders(day, o.id) x
      where exists (select 1 from public.order_items oi
                    where oi.order_id = x.id and oi.category_id = cat.id and oi.quantity > oi.cancelled_quantity);
      if used >= cat.cap then
        cap_msg := format('%s: %s/%s orders on %s.', cat.name, used, cat.cap, to_char(day, 'FMDD Mon'));
        if override is null then
          perform private.fail(cap_msg || ' An admin can override with a reason.', 'capacity');
        end if;
        exit;
      end if;
    end loop;
  end if;

  perform private.recalc_order_totals(o.id);
  update public.orders set version = version + 1 where id = o.id returning * into o;

  perform private.log_order_event(o.id, 'items_changed', reason,
    jsonb_build_object('changes', changes, 'total_from', total_before, 'total_to', o.total_paise));
  if override is not null and (problem is not null or cap_msg is not null) then
    perform private.log_order_event(o.id, 'override', override,
      jsonb_strip_nulls(jsonb_build_object('lead_time', problem, 'capacity', cap_msg)));
  end if;
  return o;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Orders: fulfilment and the Customer source
-- ---------------------------------------------------------------------------

alter table public.orders
  add column fulfilment public.fulfilment_type not null default 'collect',
  add column setup_address text check (setup_address is null or length(setup_address) between 1 and 300),
  add column setup_note text check (setup_note is null or length(setup_note) between 1 and 300),
  add constraint orders_fulfilment_address_check check (
    (fulfilment = 'setup' and setup_address is not null)
    or (fulfilment = 'collect' and setup_address is null and setup_note is null));

do $$
declare c text;
begin
  select conname into c from pg_constraint
  where conrelid = 'public.orders'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%CALL%customer_phone%';
  execute format('alter table public.orders drop constraint %I', c);
end $$;
alter table public.orders add constraint orders_contact_check
  check (source not in ('CALL', 'CUSTOMER') or (customer_name is not null and customer_phone is not null));

alter table public.business_settings
  add column custom_cake_tax_rate_bps integer not null default 500 check (custom_cake_tax_rate_bps between 0 and 2800),
  add column custom_cake_hsn_code text check (custom_cake_hsn_code is null or custom_cake_hsn_code ~ '^[0-9]{4,8}$');

-- ---------------------------------------------------------------------------
-- 4a. Custom cakes
-- ---------------------------------------------------------------------------

create table public.custom_cakes (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null unique references public.order_items (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  flavour text not null check (length(flavour) between 1 and 80),
  weight_kg numeric(5,2) not null check (weight_kg between 0.25 and 50),
  tiers smallint not null default 1 check (tiers between 1 and 10),
  theme text check (theme is null or length(theme) <= 200),
  cream text check (cream is null or length(cream) <= 80),
  filling text check (filling is null or length(filling) <= 80),
  toppings text check (toppings is null or length(toppings) <= 200),
  message text check (message is null or length(message) <= 120),
  is_eggless boolean not null default false,
  instructions text check (instructions is null or length(instructions) <= 1000),
  photo_path text check (photo_path is null or length(photo_path) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index custom_cakes_order_id_idx on public.custom_cakes (order_id);
create trigger custom_cakes_updated_at before update on public.custom_cakes
  for each row execute function private.set_updated_at();
create trigger custom_cakes_audit after insert or update or delete on public.custom_cakes
  for each row execute function private.audit_row('id');
alter table public.custom_cakes enable row level security;
create policy "Admin and counter read custom cakes" on public.custom_cakes for select to authenticated
  using ((select private.has_role(array['admin', 'counter']::public.staff_role[])));
revoke all on public.custom_cakes from anon, authenticated;
grant select on public.custom_cakes to authenticated;

-- Checks and tidies a cake's details (jsonb keys as in custom_cakes); raises staff-facing messages.
create function private.clean_cake(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  f text := nullif(trim(coalesce(p ->> 'flavour', '')), '');
  w numeric;
  t integer;
  k text;
  limits jsonb := '{"theme": 200, "cream": 80, "filling": 80, "toppings": 200, "message": 120, "instructions": 1000}';
  label jsonb := '{"theme": "Theme", "cream": "Cream", "filling": "Filling", "toppings": "Toppings", "message": "Message", "instructions": "Instructions"}';
  result jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    perform private.fail('Enter the cake details.');
  end if;
  if f is null then
    perform private.fail('Enter the flavour.');
  end if;
  if length(f) > 80 then
    perform private.fail('Keep the flavour under 80 characters.');
  end if;
  begin
    w := (p ->> 'weight_kg')::numeric;
    t := coalesce((p ->> 'tiers')::integer, 1);
  exception when others then
    perform private.fail('Weight and tiers must be numbers.');
  end;
  if w is null or w < 0.25 or w > 50 then
    perform private.fail('Weight must be between 0.25 and 50 kg.');
  end if;
  if t < 1 or t > 10 then
    perform private.fail('Tiers must be between 1 and 10.');
  end if;
  result := jsonb_build_object('flavour', f, 'weight_kg', round(w, 2), 'tiers', t,
    'is_eggless', coalesce((p ->> 'is_eggless')::boolean, false));
  for k in select jsonb_object_keys(limits)
  loop
    if length(trim(coalesce(p ->> k, ''))) > (limits ->> k)::integer then
      perform private.fail(format('%s is too long (at most %s characters).', label ->> k, limits ->> k));
    end if;
    result := result || jsonb_build_object(k, nullif(trim(coalesce(p ->> k, '')), ''));
  end loop;
  return result;
end;
$$;

-- "1.5 kg", "2 kg · 3 tiers": the custom line's variant name.
create function private.cake_size_name(p_weight numeric, p_tiers integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim_scale(p_weight)::text || ' kg' || case when p_tiers > 1 then ' · ' || p_tiers || ' tiers' else '' end
$$;

-- Set-up address and note for a fulfilment; raises staff-facing messages.
create function private.clean_fulfilment(p_fulfilment public.fulfilment_type, p_address text, p_note text,
  out address text, out note text)
language plpgsql
immutable
set search_path = ''
as $$
begin
  if coalesce(p_fulfilment, 'collect') = 'collect' then
    return;
  end if;
  address := nullif(trim(coalesce(p_address, '')), '');
  note := nullif(trim(coalesce(p_note, '')), '');
  if address is null then
    perform private.fail('Set-up orders need the customer''s address.');
  end if;
  if length(address) > 300 then
    perform private.fail('Keep the address under 300 characters.');
  end if;
  if length(note) > 300 then
    perform private.fail('Keep the set-up note under 300 characters.');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. create_order: Customer source, fulfilment, custom cake lines
-- ---------------------------------------------------------------------------

drop function public.create_order(uuid, public.order_source, jsonb, text, text, timestamptz, text, text, boolean, text);

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
  p_override_reason text default null,
  p_fulfilment public.fulfilment_type default 'collect',
  p_setup_address text default null,
  p_setup_note text default null
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
  cap_msg text;
  cap_kind text;
  immediate boolean := p_due_at is null;
  due timestamptz := coalesce(p_due_at, now());
  v_name text := nullif(trim(coalesce(p_customer_name, '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_customer_phone, ''), '[\s()-]', '', 'g'), '');
  override text := nullif(trim(coalesce(p_override_reason, '')), '');
  fulfil public.fulfilment_type := coalesce(p_fulfilment, 'collect');
  setup record;
  cake jsonb;
  price bigint;
  cake_rate integer;
  cake_hsn text;
  item_id uuid;
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
  if override is not null and length(override) < 5 then
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
  if p_source in ('CALL', 'CUSTOMER') and (v_name is null or v_phone is null) then
    perform private.fail(format('%s orders need the customer''s name and phone number.',
      case p_source when 'CALL' then 'Call' else 'Customer' end));
  end if;
  select * into setup from private.clean_fulfilment(fulfil, p_setup_address, p_setup_note);
  if fulfil = 'setup' and immediate then
    perform private.fail('Set-up orders need a set-up date and time.');
  end if;
  if immediate and p_source <> 'IN_STORE' then
    perform private.fail(format('%s orders need a pickup date and time.',
      case p_source when 'CALL' then 'Call' else 'Customer' end));
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
    is_immediate, requested_due_at, customer_notes, internal_notes, created_by,
    fulfilment, setup_address, setup_note
  ) values (
    p_idempotency_key, p_source, 'pending_confirmation', customer, v_name, v_phone,
    immediate, due, nullif(trim(p_customer_notes), ''), nullif(trim(p_internal_notes), ''), auth.uid(),
    fulfil, setup.address, setup.note
  )
  returning * into o;

  for item in select value from jsonb_array_elements(p_items)
  loop
    line := line + 1;
    if length(coalesce(item ->> 'notes', '')) > 500 then
      perform private.fail(format('Line %s: notes are too long.', line));
    end if;

    if item ? 'custom_cake' then
      -- A custom cake: one piece at the price staff agreed, GST from Shop Settings.
      cake := private.clean_cake(item -> 'custom_cake');
      begin
        price := (item ->> 'price_paise')::bigint;
      exception when others then
        price := null;
      end;
      if price is null or price < 100 or price > 100000000 then
        perform private.fail('Enter a price between ₹1 and ₹10,00,000.');
      end if;
      select custom_cake_tax_rate_bps, custom_cake_hsn_code into cake_rate, cake_hsn from public.business_settings;
      cake_rate := coalesce(cake_rate, 500);
      line_total := price;
      line_tax := round(line_total * cake_rate::numeric / (10000 + cake_rate));
      insert into public.order_items (
        order_id, line_no, product_name, variant_name, prep_type,
        is_veg, contains_egg, is_eggless, lead_time_minutes, unit_price_paise, tax_rate_bps,
        hsn_code, quantity, line_total_paise, tax_paise, notes
      ) values (
        o.id, line, 'Custom cake', private.cake_size_name((cake ->> 'weight_kg')::numeric, (cake ->> 'tiers')::integer), 'made_to_order',
        true, not (cake ->> 'is_eggless')::boolean, (cake ->> 'is_eggless')::boolean, 0, price, cake_rate,
        cake_hsn, 1, line_total, line_tax, nullif(trim(item ->> 'notes'), '')
      )
      returning id into item_id;
      insert into public.custom_cakes (order_item_id, order_id, flavour, weight_kg, tiers, theme, cream, filling,
        toppings, message, is_eggless, instructions)
      values (item_id, o.id, cake ->> 'flavour', (cake ->> 'weight_kg')::numeric, (cake ->> 'tiers')::smallint,
        cake ->> 'theme', cake ->> 'cream', cake ->> 'filling', cake ->> 'toppings', cake ->> 'message',
        (cake ->> 'is_eggless')::boolean, cake ->> 'instructions');
      subtotal := subtotal + line_total;
      tax := tax + line_tax;
      continue;
    end if;

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

  perform private.log_order_event(o.id, 'created', null, jsonb_strip_nulls(jsonb_build_object('source', p_source,
    'immediate', immediate, 'fulfilment', fulfil, 'setup_address', setup.address)));
  if override is not null then
    perform private.log_order_event(o.id, 'override', override,
      jsonb_strip_nulls(jsonb_build_object('slot', private.pickup_slot_problem(due), 'lead_time', problem, 'capacity', cap_msg)));
  end if;

  if p_confirm then
    o := private.confirm_locked(o, override);
  end if;
  return o;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4b. Custom cake orders
-- ---------------------------------------------------------------------------

-- Admin and counter staff. One custom cake line at the staff price; name, phone and pickup time are
-- always needed. An advance is recorded as a payment in the same transaction. Retrying with the same
-- key returns the same order and records nothing more.
create function public.create_custom_cake_order(
  p_idempotency_key uuid,
  p_source public.order_source,
  p_customer_name text,
  p_customer_phone text,
  p_due_at timestamptz,
  p_price_paise bigint,
  p_cake jsonb,
  p_customer_notes text default null,
  p_internal_notes text default null,
  p_confirm boolean default false,
  p_override_reason text default null,
  p_fulfilment public.fulfilment_type default 'collect',
  p_setup_address text default null,
  p_setup_note text default null,
  p_advance_paise bigint default 0,
  p_advance_method public.payment_method default null,
  p_advance_reference text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  advance bigint := coalesce(p_advance_paise, 0);
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to create orders.', 'forbidden');
  end if;
  select * into o from public.orders where idempotency_key = p_idempotency_key;
  if found then
    return o;
  end if;

  if p_source not in ('IN_STORE', 'CALL', 'CUSTOMER') then
    perform private.fail('Custom cakes are taken in-store, by call or from the customer.');
  end if;
  if nullif(trim(coalesce(p_customer_name, '')), '') is null or nullif(trim(coalesce(p_customer_phone, '')), '') is null then
    perform private.fail('Custom cakes need the customer''s name and phone number.');
  end if;
  if p_due_at is null then
    perform private.fail('Custom cakes need a pickup date and time.');
  end if;
  if advance < 0 then
    perform private.fail('The advance cannot be negative.');
  end if;
  if advance > 0 and p_advance_method is null then
    perform private.fail('Choose how the advance was paid.');
  end if;
  if advance > 0 and p_price_paise is not null and advance > p_price_paise then
    perform private.fail('The advance is more than the price.');
  end if;

  o := public.create_order(p_idempotency_key, p_source,
    jsonb_build_array(jsonb_build_object('custom_cake', p_cake, 'price_paise', p_price_paise)),
    p_customer_name, p_customer_phone, p_due_at, p_customer_notes, p_internal_notes, p_confirm, p_override_reason,
    p_fulfilment, p_setup_address, p_setup_note);
  perform private.log_order_event(o.id, 'custom_cake_created', null, jsonb_build_object('price_paise', o.total_paise));

  if advance > 0 then
    perform public.record_payment(o.id, md5(p_idempotency_key::text || ':advance')::uuid, 'payment',
      p_advance_method, advance, p_advance_reference, 'Advance');
    select * into o from public.orders where id = o.id;
  end if;
  return o;
end;
$$;

-- Admin and counter staff, until the order is packed. A price change re-prices the order: not once a
-- bill exists, and only an admin on a confirmed order (as with changing items).
create function public.update_custom_cake(p_order_id uuid, p_expected_version integer, p_cake jsonb, p_price_paise bigint)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  role public.staff_role := private.current_staff_role();
  o public.orders;
  cc public.custom_cakes;
  ln public.order_items;
  cake jsonb := private.clean_cake(p_cake);
  total_before bigint;
begin
  if role is null or role not in ('admin', 'counter') then
    perform private.fail('You do not have permission to change orders.', 'forbidden');
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if o.status = 'ready' then
    perform private.fail('This order is packed. Reopen packing before changing the cake.');
  elsif o.status not in ('draft', 'pending_confirmation', 'confirmed', 'preparing') then
    perform private.fail(format('The cake cannot change on a %s order.', replace(o.status::text, '_', ' ')));
  end if;
  select * into cc from public.custom_cakes where order_id = o.id order by created_at limit 1;
  if not found then
    perform private.fail('This order has no custom cake.', 'not_found');
  end if;
  select * into ln from public.order_items where id = cc.order_item_id;
  if p_price_paise is null or p_price_paise < 100 or p_price_paise > 100000000 then
    perform private.fail('Enter a price between ₹1 and ₹10,00,000.');
  end if;
  if p_price_paise <> ln.unit_price_paise then
    if exists (select 1 from public.bills where order_id = o.id) then
      perform private.fail('This order already has a bill. Issue a credit note instead.', 'billed');
    end if;
    if o.status in ('confirmed', 'preparing') and role <> 'admin' then
      perform private.fail('Only an admin can change the price of a confirmed order.', 'forbidden');
    end if;
  end if;

  update public.custom_cakes
  set flavour = cake ->> 'flavour', weight_kg = (cake ->> 'weight_kg')::numeric, tiers = (cake ->> 'tiers')::smallint,
      theme = cake ->> 'theme', cream = cake ->> 'cream', filling = cake ->> 'filling', toppings = cake ->> 'toppings',
      message = cake ->> 'message', is_eggless = (cake ->> 'is_eggless')::boolean, instructions = cake ->> 'instructions'
  where id = cc.id;
  update public.order_items
  set variant_name = private.cake_size_name((cake ->> 'weight_kg')::numeric, (cake ->> 'tiers')::integer),
      is_eggless = (cake ->> 'is_eggless')::boolean, contains_egg = not (cake ->> 'is_eggless')::boolean,
      unit_price_paise = p_price_paise, line_total_paise = p_price_paise * (quantity - cancelled_quantity)
  where id = ln.id;

  total_before := o.total_paise;
  perform private.recalc_order_totals(o.id);
  update public.orders set version = version + 1 where id = o.id returning * into o;
  perform private.log_order_event(o.id, 'custom_cake_changed', null, jsonb_strip_nulls(jsonb_build_object(
    'total_from', case when o.total_paise <> total_before then total_before end,
    'total_to', case when o.total_paise <> total_before then o.total_paise end)));
  return o;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Collect or set up, after the order is taken
-- ---------------------------------------------------------------------------

create function public.set_fulfilment(p_order_id uuid, p_expected_version integer, p_fulfilment public.fulfilment_type,
  p_setup_address text default null, p_setup_note text default null)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  setup record;
  before public.fulfilment_type;
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to change orders.', 'forbidden');
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if o.status in ('completed', 'cancelled', 'rejected') then
    perform private.fail(format('Collect or set-up cannot change on a %s order.', o.status::text));
  end if;
  if p_fulfilment is null then
    perform private.fail('Choose collect or set up.');
  end if;
  select * into setup from private.clean_fulfilment(p_fulfilment, p_setup_address, p_setup_note);
  if p_fulfilment = 'setup' and o.is_immediate then
    perform private.fail('Set-up orders need a set-up date and time. Reschedule the order first.');
  end if;
  if p_fulfilment = o.fulfilment and setup.address is not distinct from o.setup_address
     and setup.note is not distinct from o.setup_note then
    perform private.fail('Nothing was changed.');
  end if;
  before := o.fulfilment;
  update public.orders
  set fulfilment = p_fulfilment, setup_address = setup.address, setup_note = setup.note, version = version + 1
  where id = o.id
  returning * into o;
  perform private.log_order_event(o.id, 'fulfilment_changed', null, jsonb_strip_nulls(jsonb_build_object(
    'from', before, 'to', p_fulfilment, 'setup_address', setup.address, 'setup_note', setup.note)));
  return o;
end;
$$;

revoke execute on function private.clean_cake(jsonb), private.cake_size_name(numeric, integer),
  private.clean_fulfilment(public.fulfilment_type, text, text) from public, anon, authenticated;
revoke execute on function
  public.create_order(uuid, public.order_source, jsonb, text, text, timestamptz, text, text, boolean, text, public.fulfilment_type, text, text),
  public.create_custom_cake_order(uuid, public.order_source, text, text, timestamptz, bigint, jsonb, text, text, boolean, text,
    public.fulfilment_type, text, text, bigint, public.payment_method, text),
  public.update_custom_cake(uuid, integer, jsonb, bigint),
  public.set_fulfilment(uuid, integer, public.fulfilment_type, text, text)
  from public, anon;
grant execute on function
  public.create_order(uuid, public.order_source, jsonb, text, text, timestamptz, text, text, boolean, text, public.fulfilment_type, text, text),
  public.create_custom_cake_order(uuid, public.order_source, text, text, timestamptz, bigint, jsonb, text, text, boolean, text,
    public.fulfilment_type, text, text, bigint, public.payment_method, text),
  public.update_custom_cake(uuid, integer, jsonb, bigint),
  public.set_fulfilment(uuid, integer, public.fulfilment_type, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Order summaries pick up the new order columns (o.* is expanded when the view is made)
-- ---------------------------------------------------------------------------

drop view public.order_summaries;
-- The original placeholder (always 'pickup', never read) is replaced by orders.fulfilment.
alter table public.orders drop column fulfillment_type;
create view public.order_summaries
with (security_invoker = true)
as
select
  o.*,
  coalesce(pay.paid_paise, 0) as paid_paise,
  coalesce(pay.refunded_paise, 0) as refunded_paise,
  coalesce(bill.credited_paise, 0) as credited_paise,
  bill.bill_id,
  bill.bill_number,
  (case when o.status in ('cancelled', 'rejected') then 0 else o.total_paise - coalesce(bill.credited_paise, 0) end)
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
  select b.id as bill_id, b.bill_number,
         (select sum(cn.total_paise) from public.credit_notes cn where cn.bill_id = b.id) as credited_paise
  from public.bills b where b.order_id = o.id
) bill on true
left join lateral (
  select sum(quantity - cancelled_quantity)::integer as item_count,
         array_agg(distinct kitchen_id) filter (where kitchen_id is not null and quantity > cancelled_quantity) as kitchen_ids
  from public.order_items where order_id = o.id
) items on true;

revoke all on public.order_summaries from anon, authenticated;
grant select on public.order_summaries to authenticated;
