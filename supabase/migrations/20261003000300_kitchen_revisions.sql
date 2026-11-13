-- Phase 5C: kitchen revisions after acknowledgement (docs/superpowers/specs/2026-10-03-kitchen-revisions-design.md).
-- Admins may change items and the pickup time after the kitchen has acknowledged or started an order.
-- Acknowledged and started tickets are revised in place: lines are matched by order line, ready counts
-- are kept (capped at a lowered quantity; owner 2026-10-03), removed items stay as cancelled lines,
-- and the exact changes wait on the ticket until the kitchen acknowledges them. Packing waits for that.
-- Replaces the 5A holding measure (private.kitchen_guard).

-- ---------------------------------------------------------------------------
-- 1. Ticket columns
-- ---------------------------------------------------------------------------

alter table public.kitchen_tickets
  add column pending_changes jsonb not null default '[]' check (jsonb_typeof(pending_changes) = 'array'),
  add column has_pending_changes boolean generated always as (jsonb_array_length(pending_changes) > 0) stored,
  add column changes_acknowledged_at timestamptz,
  add column changes_acknowledged_by uuid references auth.users (id) on delete set null;
create index kitchen_tickets_changes_acknowledged_by_idx on public.kitchen_tickets (changes_acknowledged_by);
create index kitchen_tickets_pending_idx on public.kitchen_tickets (has_pending_changes) where has_pending_changes;

-- A line removed by a revision stays on the ticket at quantity 0 (cancelled), so the chef sees it.
alter table public.kitchen_ticket_lines
  drop constraint kitchen_ticket_lines_quantity_check,
  add constraint kitchen_ticket_lines_quantity_check check (quantity >= 1 or (quantity = 0 and status = 'cancelled'));

-- ---------------------------------------------------------------------------
-- 2. Change lists
-- ---------------------------------------------------------------------------

-- Adds new change entries to a ticket's unacknowledged list. An entry for the same key (one order
-- line's quantity, its notes, or the pickup time) keeps the first "from" and takes the new "to", so
-- the list always shows the net change since the kitchen last acknowledged; a net change of nothing
-- leaves the list.
create function private.merge_ticket_changes(p_pending jsonb, p_new jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  result jsonb := coalesce(p_pending, '[]'::jsonb);
  e jsonb;
  idx integer;
  merged jsonb;
begin
  for e in select value from jsonb_array_elements(coalesce(p_new, '[]'::jsonb))
  loop
    idx := null;
    select (x.ord - 1)::integer into idx
    from jsonb_array_elements(result) with ordinality as x(value, ord)
    where x.value ->> 'key' = e ->> 'key';
    if idx is null then
      if (e -> 'from') is distinct from (e -> 'to') then
        result := result || jsonb_build_array(e);
      end if;
    else
      merged := e || jsonb_build_object('from', result -> idx -> 'from');
      if (merged -> 'from') is not distinct from (merged -> 'to') then
        result := result - idx;
      else
        result := jsonb_set(result, array[idx::text], merged);
      end if;
    end if;
  end loop;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Ready state ignores removed lines; removed lines take no ready count
-- ---------------------------------------------------------------------------

create or replace function private.sync_ticket(p_ticket_id uuid, p_reason text)
returns public.kitchen_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.kitchen_tickets;
  all_ready boolean;
begin
  select * into t from public.kitchen_tickets where id = p_ticket_id;
  -- 5C: lines removed by a revision (status cancelled) do not count.
  select coalesce(bool_and(status = 'ready') filter (where status <> 'cancelled'), false) into all_ready
  from public.kitchen_ticket_lines where ticket_id = t.id;
  if all_ready and t.status <> 'ready' then
    update public.kitchen_tickets set status = 'ready', ready_at = now(), ready_by = auth.uid()
    where id = t.id returning * into t;
    perform private.log_ticket_event(t, 'ticket_ready', p_reason);
  elsif not all_ready and t.status = 'ready' then
    update public.kitchen_tickets set status = 'preparing', ready_at = null, ready_by = null
    where id = t.id returning * into t;
  else
    update public.kitchen_tickets set updated_at = now() where id = t.id returning * into t;
  end if;
  return t;
end;
$$;

create or replace function public.set_line_ready(p_line_id uuid, p_ready_quantity integer, p_reason text default null)
returns public.kitchen_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  ln public.kitchen_ticket_lines;
  t public.kitchen_tickets;
  actor text;
  admin_reason text;
begin
  select * into ln from public.kitchen_ticket_lines where id = p_line_id;
  if not found then
    perform private.fail('Ticket line not found.', 'not_found');
  end if;
  t := private.lock_ticket(ln.ticket_id);
  actor := private.ticket_actor(t.kitchen_id, p_reason);
  admin_reason := case when actor = 'admin' then p_reason end;
  if t.status = 'cancelled' then
    perform private.fail('This ticket was cancelled. Stop work on it.');
  end if;
  select * into ln from public.kitchen_ticket_lines where id = p_line_id for update;
  if ln.status = 'cancelled' then -- 5C
    perform private.fail('This item was removed from the order.');
  end if;
  if p_ready_quantity is null or p_ready_quantity < 0 or p_ready_quantity > ln.quantity then
    perform private.fail(format('Enter a ready count from 0 to %s.', ln.quantity));
  end if;
  if p_ready_quantity = ln.ready_quantity then
    return t;
  end if;

  if p_ready_quantity > 0 and t.status in ('new', 'acknowledged') then
    t := private.start_ticket_locked(t, admin_reason);
  end if;
  update public.kitchen_ticket_lines
  set ready_quantity = p_ready_quantity,
      status = (case
        when p_ready_quantity = quantity then 'ready'
        when p_ready_quantity > 0 or t.status in ('preparing', 'ready') then 'preparing'
        else 'pending' end)::public.ticket_line_status
  where id = ln.id;
  if p_ready_quantity < ln.ready_quantity then
    perform private.log_ticket_event(t, 'ready_count_corrected', admin_reason,
      jsonb_build_object('line', ln.product_name || ' — ' || ln.variant_name, 'from', ln.ready_quantity, 'to', p_ready_quantity));
  end if;
  return private.sync_ticket(t.id, admin_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Revising tickets
-- ---------------------------------------------------------------------------

-- 5A rebuild, now only for tickets the kitchen has not acknowledged (New, cancelled, or none yet).
-- Acknowledged and started tickets are left to private.revise_tickets. Kitchens with no active lines
-- are still cancelled here (stop-work), whatever their state.
create or replace function private.build_tickets(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  k record;
  t public.kitchen_tickets;
  current_lines jsonb;
  changed integer := 0;
  dropped integer;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then
    perform private.fail('Order not found.', 'not_found');
  end if;

  for k in
    select oi.kitchen_id, kc.code, max(oi.lead_time_minutes) as lead
    from public.order_items oi
    join public.kitchens kc on kc.id = oi.kitchen_id
    where oi.order_id = o.id and oi.prep_type = 'made_to_order' and oi.quantity > oi.cancelled_quantity
    group by oi.kitchen_id, kc.code
  loop
    select * into t from public.kitchen_tickets where order_id = o.id and kitchen_id = k.kitchen_id for update;
    if not found then
      insert into public.kitchen_tickets (order_id, kitchen_id, reference, source, due_at, start_by)
      values (o.id, k.kitchen_id, o.reference || '-' || k.code, o.source, o.due_at,
              o.due_at - make_interval(mins => k.lead))
      returning * into t;
      perform private.fill_ticket_lines(t.id);
    elsif t.status in ('acknowledged', 'preparing', 'ready') then
      continue; -- 5C: revised in place by private.revise_tickets
    else
      select coalesce(jsonb_agg(jsonb_build_array(l.order_item_id, l.product_name, l.variant_name, l.quantity, l.notes)
                                order by l.line_no), '[]')
      into current_lines
      from public.kitchen_ticket_lines l where l.ticket_id = t.id;
      if t.status = 'cancelled' or t.due_at is distinct from o.due_at
         or current_lines is distinct from private.ticket_signature(o.id, k.kitchen_id) then
        perform private.fill_ticket_lines(t.id);
        update public.kitchen_tickets
        set status = 'new', revision = revision + 1, revised_at = now(),
            due_at = o.due_at, start_by = o.due_at - make_interval(mins => k.lead),
            acknowledged_at = null, acknowledged_by = null, started_at = null, started_by = null,
            ready_at = null, ready_by = null, cancelled_at = null, cancel_reason = null,
            stop_work_acknowledged_at = null, stop_work_acknowledged_by = null,
            pending_changes = '[]' -- 5C
        where id = t.id;
        changed := changed + 1;
      end if;
    end if;
  end loop;

  -- Kitchens with no active lines left: stop their work. Their lines stay as a record.
  update public.kitchen_ticket_lines l
  set status = 'cancelled'
  from public.kitchen_tickets kt
  where l.ticket_id = kt.id and kt.order_id = o.id and kt.status <> 'cancelled'
    and not exists (select 1 from public.order_items oi
                    where oi.order_id = o.id and oi.kitchen_id = kt.kitchen_id
                      and oi.prep_type = 'made_to_order' and oi.quantity > oi.cancelled_quantity);
  update public.kitchen_tickets kt
  set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Removed from the order'
  where kt.order_id = o.id and kt.status <> 'cancelled'
    and not exists (select 1 from public.order_items oi
                    where oi.order_id = o.id and oi.kitchen_id = kt.kitchen_id
                      and oi.prep_type = 'made_to_order' and oi.quantity > oi.cancelled_quantity);
  get diagnostics dropped = row_count;
  return changed + dropped;
end;
$$;

-- Revises the order's acknowledged, preparing and ready tickets in place after an item edit or a
-- reschedule. Callers hold the order lock. Returns [{ticket, kitchen, changes}] for each ticket
-- that changed.
create function private.revise_tickets(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  t public.kitchen_tickets;
  ln record;
  entries jsonb;
  summary jsonb := '[]';
  started boolean;
  new_ready integer;
begin
  select * into o from public.orders where id = p_order_id;
  -- Order, then tickets (in id order), as everywhere else.
  perform 1 from public.kitchen_tickets where order_id = o.id order by id for update;

  for t in
    select kt.* from public.kitchen_tickets kt
    where kt.order_id = o.id and kt.status in ('acknowledged', 'preparing', 'ready')
      -- A kitchen with nothing left is cancelled by build_tickets (stop-work) instead.
      and exists (select 1 from public.order_items oi
                  where oi.order_id = o.id and oi.kitchen_id = kt.kitchen_id
                    and oi.prep_type = 'made_to_order' and oi.quantity > oi.cancelled_quantity)
    order by kt.reference
  loop
    entries := '[]';
    started := t.status in ('preparing', 'ready');

    -- This kitchen's order lines, and order lines already on the ticket.
    for ln in
      select oi.id as item_id, oi.line_no, oi.product_name, oi.variant_name,
             oi.product_name || ' — ' || oi.variant_name as item,
             oi.is_veg, oi.contains_egg, oi.is_eggless, oi.allergens, oi.lead_time_minutes, oi.notes as want_notes,
             case when oi.prep_type = 'made_to_order' and oi.kitchen_id = t.kitchen_id
                  then oi.quantity - oi.cancelled_quantity else 0 end as want,
             l.id as line_id, l.quantity as have, l.ready_quantity, l.notes as have_notes
      from public.order_items oi
      left join public.kitchen_ticket_lines l on l.order_item_id = oi.id and l.ticket_id = t.id
      where oi.order_id = o.id
        and ((oi.prep_type = 'made_to_order' and oi.kitchen_id = t.kitchen_id) or l.id is not null)
      order by oi.line_no
    loop
      if ln.line_id is null then
        continue when ln.want = 0;
        insert into public.kitchen_ticket_lines (
          ticket_id, order_item_id, line_no, product_name, variant_name, quantity,
          is_veg, contains_egg, is_eggless, allergens, notes, lead_time_minutes, status)
        values (t.id, ln.item_id, ln.line_no, ln.product_name, ln.variant_name, ln.want,
          ln.is_veg, ln.contains_egg, ln.is_eggless, ln.allergens, ln.want_notes, ln.lead_time_minutes,
          (case when started then 'preparing' else 'pending' end)::public.ticket_line_status);
        entries := entries || jsonb_build_array(jsonb_build_object(
          'key', 'qty:' || ln.item_id, 'kind', 'quantity', 'item', ln.item, 'from', 0, 'to', ln.want));
      else
        if ln.want <> ln.have then
          new_ready := least(ln.ready_quantity, ln.want);
          update public.kitchen_ticket_lines
          set quantity = ln.want,
              ready_quantity = new_ready,
              status = (case
                when ln.want = 0 then 'cancelled'
                when new_ready = ln.want then 'ready'
                when new_ready > 0 or started then 'preparing'
                else 'pending' end)::public.ticket_line_status
          where id = ln.line_id;
          entries := entries || jsonb_build_array(jsonb_build_object(
            'key', 'qty:' || ln.item_id, 'kind', 'quantity', 'item', ln.item, 'from', ln.have, 'to', ln.want));
        end if;
        if ln.want > 0 and ln.want_notes is distinct from ln.have_notes then
          update public.kitchen_ticket_lines set notes = ln.want_notes where id = ln.line_id;
          entries := entries || jsonb_build_array(jsonb_build_object(
            'key', 'notes:' || ln.item_id, 'kind', 'notes', 'item', ln.item, 'from', ln.have_notes, 'to', ln.want_notes));
        end if;
      end if;
    end loop;

    if t.due_at is distinct from o.due_at then
      entries := entries || jsonb_build_array(jsonb_build_object(
        'key', 'pickup', 'kind', 'pickup', 'item', 'Pickup', 'from', t.due_at, 'to', o.due_at));
    end if;

    continue when jsonb_array_length(entries) = 0;

    update public.kitchen_tickets
    set revision = revision + 1,
        revised_at = now(),
        due_at = o.due_at,
        start_by = o.due_at - make_interval(mins => (
          select coalesce(max(l.lead_time_minutes), 0) from public.kitchen_ticket_lines l
          where l.ticket_id = t.id and l.status <> 'cancelled')),
        pending_changes = private.merge_ticket_changes(pending_changes, entries)
    where id = t.id;
    perform private.sync_ticket(t.id);
    summary := summary || jsonb_build_array(jsonb_build_object(
      'ticket', t.reference,
      'kitchen', (select k.name from public.kitchens k where k.id = t.kitchen_id),
      'changes', entries));
  end loop;
  return summary;
end;
$$;

-- After an item edit or reschedule of a confirmed or preparing order: revise acknowledged work,
-- rebuild work the kitchen has not seen, stop work for kitchens with nothing left, and log it.
create function private.apply_ticket_changes(p_order_id uuid, p_cause text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  revised jsonb := private.revise_tickets(p_order_id);
  rebuilt integer := private.build_tickets(p_order_id);
begin
  if jsonb_array_length(revised) > 0 or rebuilt > 0 then
    perform private.log_order_event(p_order_id, 'tickets_revised', null,
      jsonb_build_object('cause', p_cause, 'tickets', revised));
  end if;
end;
$$;

revoke execute on function
  private.merge_ticket_changes(jsonb, jsonb),
  private.revise_tickets(uuid),
  private.apply_ticket_changes(uuid, text)
  from public;

-- Item edits: preparing orders too; acknowledged lines are cancelled, not deleted; tickets revised (5C).
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
  select coalesce(array_agg(distinct category_id) filter (where category_id is not null), '{}') into old_categories
  from public.order_items where order_id = o.id;

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
      if o.status in ('confirmed', 'preparing') and v.prep_type = 'made_to_order' and v.kitchen_id is null then
        perform private.fail(format('Assign a preparing kitchen before adding %s — %s to a confirmed order.', v.product_name, v.variant_name), 'unmapped');
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
  if o.status in ('confirmed', 'preparing') then -- 5C
    perform private.apply_ticket_changes(o.id, 'items_changed');
  end if;
  return o;
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
  cap_msg text;
  cap_kind text;
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can reschedule orders.', 'forbidden');
  end if;
  if reason is null then
    perform private.fail('Give a reason for the new pickup time.');
  end if;
  if override is not null and length(override) < 5 then
    perform private.fail('Give an override reason of at least 5 characters.');
  end if;
  if p_due_at is null or p_due_at < now() - interval '5 minutes' then
    perform private.fail('Choose a pickup time in the future.');
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if o.status = 'ready' then -- 5C
    perform private.fail('This order is packed. Reopen packing before changing its pickup time.', 'kitchen');
  end if;
  if o.status not in ('draft', 'pending_confirmation', 'confirmed', 'preparing') then
    perform private.fail('Only orders that are not yet packed can be rescheduled.');
  end if;

  slot := private.pickup_slot_problem(p_due_at);
  lead := private.lead_time_problem(o.id, p_due_at);
  select c.message, c.kind into cap_msg, cap_kind from private.capacity_problem(o.id, p_due_at) c;
  if (slot is not null or lead is not null or cap_msg is not null) and override is null then
    perform private.fail(coalesce(slot, lead, cap_msg) || ' An admin can override with a reason.',
      coalesce(case when slot is not null then 'slot' end, case when lead is not null then 'lead_time' end, cap_kind));
  end if;

  old_due := o.due_at;
  update public.orders
  set requested_due_at = p_due_at,
      confirmed_due_at = case when status in ('confirmed', 'preparing') then p_due_at else confirmed_due_at end,
      is_immediate = false,
      version = version + 1
  where id = o.id
  returning * into o;

  perform private.log_order_event(o.id, 'rescheduled', reason,
    jsonb_build_object('from', old_due, 'to', p_due_at) ||
    case when override is not null
      then jsonb_strip_nulls(jsonb_build_object('override', override, 'slot', slot, 'lead_time', lead, 'capacity', cap_msg))
      else '{}' end);
  if o.status in ('confirmed', 'preparing') then -- 5C
    perform private.apply_ticket_changes(o.id, 'rescheduled');
  end if;
  return o;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The kitchen acknowledges changes
-- ---------------------------------------------------------------------------

-- The assigned chef, or an admin with a reason. Nothing to acknowledge: a no-op (double taps).
create function public.acknowledge_ticket_changes(p_ticket_id uuid, p_reason text default null)
returns public.kitchen_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.kitchen_tickets := private.lock_ticket(p_ticket_id);
  actor text := private.ticket_actor(t.kitchen_id, p_reason);
  acknowledged jsonb;
begin
  if t.status = 'cancelled' then
    perform private.fail('This ticket was cancelled. Stop work on it.');
  end if;
  if not t.has_pending_changes then
    return t;
  end if;
  acknowledged := t.pending_changes;
  update public.kitchen_tickets
  set pending_changes = '[]', changes_acknowledged_at = now(), changes_acknowledged_by = auth.uid()
  where id = t.id
  returning * into t;
  perform private.log_ticket_event(t, 'ticket_changes_acknowledged', case when actor = 'admin' then p_reason end,
    jsonb_build_object('changes', acknowledged));
  return t;
end;
$$;

revoke execute on function public.acknowledge_ticket_changes(uuid, text) from public, anon;
grant execute on function public.acknowledge_ticket_changes(uuid, text) to authenticated;

-- 5A holding measure: no longer called.
drop function private.kitchen_guard(uuid);

-- ---------------------------------------------------------------------------
-- 6. Packing waits for acknowledged changes
-- ---------------------------------------------------------------------------

create or replace function public.mark_packed(p_order_id uuid, p_expected_version integer, p_note text default null)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  waiting text;
  unacknowledged text;
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('Only admin and counter staff can pack orders.', 'forbidden');
  end if;
  select * into o from public.orders where id = p_order_id;
  if not found then
    perform private.fail('Order not found.', 'not_found');
  end if;
  -- Packing again changes nothing (a double tap or a retry after a lost answer).
  if o.status = 'ready' and o.packed_at is not null then
    return o;
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if o.status not in ('confirmed', 'preparing') then
    perform private.fail(format('Only confirmed or preparing orders can be packed; this one is %s.', replace(o.status::text, '_', ' ')));
  end if;
  if length(v_note) > 300 then
    perform private.fail('Keep the packing note under 300 characters.');
  end if;

  -- 5C: the kitchen must have seen every change.
  select string_agg(k.name, ', ' order by k.name) into unacknowledged
  from public.kitchen_tickets t join public.kitchens k on k.id = t.kitchen_id
  where t.order_id = o.id and t.status <> 'cancelled' and t.has_pending_changes;
  if unacknowledged is not null then
    perform private.fail(format('Not every kitchen has acknowledged the latest change: %s.', unacknowledged), 'kitchen');
  end if;
  select string_agg(k.name || ' (' || t.status::text || ')', ', ' order by k.name) into waiting
  from public.kitchen_tickets t join public.kitchens k on k.id = t.kitchen_id
  where t.order_id = o.id and t.status not in ('ready', 'cancelled');
  if waiting is not null then
    perform private.fail(format('Not every kitchen has finished: %s.', waiting), 'kitchen');
  end if;
  if exists (select 1 from public.kitchen_issues i join public.kitchen_tickets t on t.id = i.ticket_id
             where t.order_id = o.id and i.resolved_at is null) then
    perform private.fail('Resolve the open kitchen issue before packing.', 'kitchen');
  end if;

  update public.orders
  set status = 'ready', packed_at = now(), packed_by = auth.uid(), packing_note = v_note, version = version + 1
  where id = o.id
  returning * into o;
  perform private.log_order_event(o.id, 'packed', null, jsonb_strip_nulls(jsonb_build_object('note', v_note)));
  return o;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Bills leave out removed lines
-- ---------------------------------------------------------------------------

create or replace function private.issue_bill_locked(o public.orders)
returns public.bills
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bills;
  v_fy text := private.financial_year(now());
  v_seq integer;
  v_prefix text;
  v_tax bigint;
  v_cgst bigint;
  v_business jsonb;
begin
  select * into b from public.bills where order_id = o.id;
  if found then
    return b;
  end if;
  if o.status not in ('confirmed', 'preparing', 'ready', 'completed') then
    perform private.fail('Only confirmed orders can be billed.');
  end if;

  select bill_prefix, jsonb_build_object('name', business_name, 'address', address, 'phone', phone,
           'email', email, 'gstin', gstin, 'fssai_licence', fssai_licence)
  into v_prefix, v_business
  from public.business_settings where id;

  v_seq := private.next_document_number('bill', v_fy);
  v_tax := o.tax_paise;
  -- CGST/SGST split per GST rate so the bill total matches the printed rate summary exactly.
  select coalesce(sum(div(rate_tax, 2)), 0)::bigint into v_cgst
  from (select sum(tax_paise) as rate_tax from public.order_items where order_id = o.id group by tax_rate_bps) t;

  insert into public.bills (
    order_id, bill_number, financial_year, sequence_number, issued_by, business, customer_name, customer_phone,
    lines, subtotal_paise, discount_paise, total_paise, taxable_paise, cgst_paise, sgst_paise
  )
  select o.id, v_prefix || '/' || v_fy || '/' || lpad(v_seq::text, 5, '0'), v_fy, v_seq, auth.uid(), v_business,
    o.customer_name, o.customer_phone,
    coalesce(jsonb_agg(jsonb_build_object(
      'line_no', line_no, 'name', product_name, 'variant', variant_name, 'hsn', hsn_code,
      'is_veg', is_veg, 'is_eggless', is_eggless,
      'quantity', quantity - cancelled_quantity, 'unit_price_paise', unit_price_paise,
      'gross_paise', line_total_paise, 'discount_paise', discount_paise,
      'net_paise', line_total_paise - discount_paise, 'tax_rate_bps', tax_rate_bps,
      'tax_paise', tax_paise, 'taxable_paise', line_total_paise - discount_paise - tax_paise
    ) order by line_no), '[]'),
    o.subtotal_paise, o.discount_paise, o.total_paise, o.total_paise - v_tax, v_cgst, v_tax - v_cgst
  from public.order_items where order_id = o.id and quantity > cancelled_quantity -- 5C
  returning * into b;

  perform private.log_order_event(o.id, 'bill_issued', null, jsonb_build_object('bill_number', b.bill_number, 'total_paise', b.total_paise));
  return b;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Progress view: tickets with unacknowledged changes
-- ---------------------------------------------------------------------------

create or replace view public.order_kitchen_progress
with (security_invoker = true)
as
select
  t.order_id,
  count(*) filter (where t.status <> 'cancelled') as ticket_count,
  count(*) filter (where t.status = 'ready') as ready_count,
  (count(*) filter (where t.status <> 'cancelled') > 0
   and count(*) filter (where t.status not in ('ready', 'cancelled')) = 0) as all_ready,
  (select count(*) from public.kitchen_issues i join public.kitchen_tickets t2 on t2.id = i.ticket_id
   where t2.order_id = t.order_id and i.resolved_at is null) as open_issues,
  count(*) filter (where t.status = 'cancelled' and t.stop_work_acknowledged_at is null) as stop_work_pending,
  count(*) filter (where t.status <> 'cancelled' and t.has_pending_changes) as changes_pending -- 5C
from public.kitchen_tickets t
group by t.order_id;
