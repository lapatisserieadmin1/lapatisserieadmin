-- Phase 5A: kitchen tickets (docs/superpowers/specs/2026-09-30-kitchen-tickets-design.md).
-- Confirmed orders get one ticket per kitchen. Chefs read only their kitchens' tickets and never
-- see prices, customers, or other order data. Tickets are written only through the functions below.

create type public.ticket_status as enum ('new', 'acknowledged', 'preparing', 'ready', 'cancelled');
create type public.ticket_line_status as enum ('pending', 'preparing', 'ready', 'cancelled');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.kitchen_tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  kitchen_id uuid not null references public.kitchens (id) on delete restrict,
  reference text not null unique,
  revision integer not null default 1 check (revision >= 1),
  source public.order_source not null,
  status public.ticket_status not null default 'new',
  due_at timestamptz not null,
  start_by timestamptz not null,
  revised_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users (id) on delete set null,
  started_at timestamptz,
  started_by uuid references auth.users (id) on delete set null,
  ready_at timestamptz,
  ready_by uuid references auth.users (id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text,
  stop_work_acknowledged_at timestamptz,
  stop_work_acknowledged_by uuid references auth.users (id) on delete set null,
  print_count integer not null default 0 check (print_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, kitchen_id)
);
create index kitchen_tickets_queue_idx on public.kitchen_tickets (kitchen_id, status, due_at);
create index kitchen_tickets_updated_at_idx on public.kitchen_tickets (updated_at desc);
create index kitchen_tickets_acknowledged_by_idx on public.kitchen_tickets (acknowledged_by);
create index kitchen_tickets_started_by_idx on public.kitchen_tickets (started_by);
create index kitchen_tickets_ready_by_idx on public.kitchen_tickets (ready_by);
create index kitchen_tickets_stop_work_by_idx on public.kitchen_tickets (stop_work_acknowledged_by);

-- Snapshot of the order's made-to-order lines for one kitchen. order_item_id becomes null when an
-- edit deletes the order line, so a stop-work ticket keeps showing what to stop.
create table public.kitchen_ticket_lines (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.kitchen_tickets (id) on delete cascade,
  order_item_id uuid unique references public.order_items (id) on delete set null,
  line_no integer not null,
  product_name text not null,
  variant_name text not null,
  quantity integer not null check (quantity >= 1),
  ready_quantity integer not null default 0,
  is_veg boolean not null,
  contains_egg boolean not null,
  is_eggless boolean not null,
  allergens text[] not null default '{}',
  notes text,
  lead_time_minutes integer not null,
  status public.ticket_line_status not null default 'pending',
  check (ready_quantity between 0 and quantity)
);
create index kitchen_ticket_lines_ticket_id_idx on public.kitchen_ticket_lines (ticket_id);

create table public.kitchen_issues (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.kitchen_tickets (id) on delete cascade,
  line_id uuid references public.kitchen_ticket_lines (id) on delete set null,
  kind text not null check (kind in ('ingredient', 'equipment', 'quality', 'other')),
  note text not null check (length(trim(note)) between 3 and 500),
  reported_by uuid references auth.users (id) on delete set null,
  reported_at timestamptz not null default now(),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  resolution text check (resolution is null or length(trim(resolution)) between 3 and 500),
  check ((resolved_at is null) = (resolution is null))
);
create index kitchen_issues_ticket_id_idx on public.kitchen_issues (ticket_id);
create index kitchen_issues_line_id_idx on public.kitchen_issues (line_id);
create index kitchen_issues_reported_by_idx on public.kitchen_issues (reported_by);
create index kitchen_issues_resolved_by_idx on public.kitchen_issues (resolved_by);

create trigger kitchen_tickets_updated_at before update on public.kitchen_tickets
  for each row execute function private.set_updated_at();
create trigger kitchen_tickets_audit after insert or update or delete on public.kitchen_tickets
  for each row execute function private.audit_row('id');
create trigger kitchen_ticket_lines_audit after insert or update or delete on public.kitchen_ticket_lines
  for each row execute function private.audit_row('id');
create trigger kitchen_issues_audit after insert or update or delete on public.kitchen_issues
  for each row execute function private.audit_row('id');

-- One row per order with tickets, for the order lists, calendar, and order page.
create view public.order_kitchen_progress
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
  count(*) filter (where t.status = 'cancelled' and t.stop_work_acknowledged_at is null) as stop_work_pending
from public.kitchen_tickets t
group by t.order_id;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

-- Admin and counter see every kitchen; a chef sees the kitchens assigned in staff_kitchens.
create function private.can_see_kitchen(p_kitchen_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_staff_role() in ('admin', 'counter'), false)
    or (private.current_staff_role() = 'chef'
        and exists (select 1 from public.staff_kitchens sk
                    where sk.user_id = (select auth.uid()) and sk.kitchen_id = p_kitchen_id))
$$;

alter table public.kitchen_tickets enable row level security;
alter table public.kitchen_ticket_lines enable row level security;
alter table public.kitchen_issues enable row level security;

create policy "Staff read tickets of their kitchens" on public.kitchen_tickets for select to authenticated
  using ((select private.can_see_kitchen(kitchen_id)));
create policy "Staff read ticket lines of their kitchens" on public.kitchen_ticket_lines for select to authenticated
  using (exists (select 1 from public.kitchen_tickets t where t.id = ticket_id));
create policy "Staff read issues of their kitchens" on public.kitchen_issues for select to authenticated
  using (exists (select 1 from public.kitchen_tickets t where t.id = ticket_id));

revoke all on public.kitchen_tickets, public.kitchen_ticket_lines, public.kitchen_issues, public.order_kitchen_progress
  from anon, authenticated;
grant select on public.kitchen_tickets, public.kitchen_ticket_lines, public.kitchen_issues, public.order_kitchen_progress
  to authenticated;

revoke execute on function private.can_see_kitchen(uuid) from public;
grant execute on function private.can_see_kitchen(uuid) to authenticated;
-- ---------------------------------------------------------------------------
-- Ticket building
-- ---------------------------------------------------------------------------

-- Replaces a ticket's lines with the order's current made-to-order lines for its kitchen.
create function private.fill_ticket_lines(p_ticket_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.kitchen_ticket_lines where ticket_id = p_ticket_id;
  insert into public.kitchen_ticket_lines (
    ticket_id, order_item_id, line_no, product_name, variant_name, quantity,
    is_veg, contains_egg, is_eggless, allergens, notes, lead_time_minutes)
  select t.id, oi.id, oi.line_no, oi.product_name, oi.variant_name, oi.quantity - oi.cancelled_quantity,
         oi.is_veg, oi.contains_egg, oi.is_eggless, oi.allergens, oi.notes, oi.lead_time_minutes
  from public.kitchen_tickets t
  join public.order_items oi on oi.order_id = t.order_id and oi.kitchen_id = t.kitchen_id
  where t.id = p_ticket_id and oi.prep_type = 'made_to_order' and oi.quantity > oi.cancelled_quantity;
$$;

-- What one kitchen should see of an order, in the same shape as its ticket lines, to detect changes.
create function private.ticket_signature(p_order_id uuid, p_kitchen_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_array(oi.id, oi.product_name, oi.variant_name,
                                              oi.quantity - oi.cancelled_quantity, oi.notes) order by oi.line_no), '[]')
  from public.order_items oi
  where oi.order_id = p_order_id and oi.kitchen_id = p_kitchen_id
    and oi.prep_type = 'made_to_order' and oi.quantity > oi.cancelled_quantity
$$;

-- Creates or refreshes the order's tickets: one per kitchen with active made-to-order lines.
-- Unchanged tickets are left alone; changed or reopened ones get revision + 1; kitchens that no
-- longer have lines are cancelled (a stop-work notice). Callers must have checked that no ticket is
-- past New (private.kitchen_guard) before an order edit. Returns the number of existing tickets
-- revised or cancelled (0 on a first build).
create function private.build_tickets(p_order_id uuid)
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
            stop_work_acknowledged_at = null, stop_work_acknowledged_by = null
        where id = t.id;
        changed := changed + 1;
      end if;
    end if;
  end loop;

  -- Kitchens with no active lines left: stop their work. Their lines stay as a record.
  -- (Alias kt, not t: t is a variable here.)
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

revoke execute on function
  private.fill_ticket_lines(uuid),
  private.ticket_signature(uuid, uuid),
  private.build_tickets(uuid)
  from public;

-- Confirming now creates the kitchen tickets (5A).
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

  perform private.build_tickets(result.id); -- 5A: tickets on confirmation

  perform private.log_order_event(o.id, 'confirmed', p_override_reason,
    jsonb_strip_nulls(jsonb_build_object('lead_time', problem, 'capacity', cap_msg))); -- 4C
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Chef actions
-- ---------------------------------------------------------------------------
-- Chef actions take no version number: each states an end result, so a repeat or a double tap
-- changes nothing. Any change to the order's status bumps the order version.

create function private.lock_ticket(p_ticket_id uuid)
returns public.kitchen_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.kitchen_tickets;
begin
  select * into t from public.kitchen_tickets where id = p_ticket_id for update;
  if not found then
    perform private.fail('Ticket not found.', 'not_found');
  end if;
  return t;
end;
$$;

-- 'chef' for a chef assigned to the kitchen; 'admin' for an admin acting as an exception with a
-- reason (at least 5 characters). Refuses everyone else, including counter staff.
create function private.ticket_actor(p_kitchen_id uuid, p_reason text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  role public.staff_role := private.current_staff_role();
  reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if role = 'chef' then
    if not exists (select 1 from public.staff_kitchens sk where sk.user_id = auth.uid() and sk.kitchen_id = p_kitchen_id) then
      perform private.fail('This ticket belongs to a kitchen you are not assigned to.', 'forbidden');
    end if;
    return 'chef';
  end if;
  if role = 'admin' then
    if reason is null or length(reason) < 5 then
      perform private.fail('Give a reason of at least 5 characters for acting on a kitchen ticket.', 'forbidden');
    end if;
    return 'admin';
  end if;
  perform private.fail('Only the kitchen can update tickets.', 'forbidden');
  return null;
end;
$$;

-- Writes an order timeline entry naming the ticket and kitchen.
create function private.log_ticket_event(t public.kitchen_tickets, p_type text, p_reason text default null, p_data jsonb default '{}')
returns void
language sql
security definer
set search_path = ''
as $$
  select private.log_order_event(t.order_id, p_type, nullif(trim(coalesce(p_reason, '')), ''),
    jsonb_build_object('ticket', t.reference, 'kitchen', (select k.name from public.kitchens k where k.id = t.kitchen_id))
    || coalesce(p_data, '{}'))
$$;

-- Starts a locked ticket: acknowledges it if needed, moves pending lines to preparing, and moves a
-- confirmed order to preparing.
create function private.start_ticket_locked(t public.kitchen_tickets, p_reason text)
returns public.kitchen_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.kitchen_tickets;
begin
  update public.kitchen_tickets
  set status = 'preparing',
      acknowledged_at = coalesce(acknowledged_at, now()),
      acknowledged_by = coalesce(acknowledged_by, auth.uid()),
      started_at = now(),
      started_by = auth.uid()
  where id = t.id
  returning * into result;
  update public.kitchen_ticket_lines set status = 'preparing' where ticket_id = t.id and status = 'pending';
  update public.orders set status = 'preparing', version = version + 1 where id = t.order_id and status = 'confirmed';
  perform private.log_ticket_event(result, 'ticket_started', p_reason);
  return result;
end;
$$;

-- Derives the ticket's ready state from its lines. Always touches updated_at so the chef screen's
-- change stamp moves.
create function private.sync_ticket(p_ticket_id uuid)
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
  select coalesce(bool_and(status = 'ready'), false) into all_ready from public.kitchen_ticket_lines where ticket_id = t.id;
  if all_ready and t.status <> 'ready' then
    update public.kitchen_tickets set status = 'ready', ready_at = now(), ready_by = auth.uid()
    where id = t.id returning * into t;
    perform private.log_ticket_event(t, 'ticket_ready');
  elsif not all_ready and t.status = 'ready' then
    update public.kitchen_tickets set status = 'preparing', ready_at = null, ready_by = null
    where id = t.id returning * into t;
  else
    update public.kitchen_tickets set updated_at = now() where id = t.id returning * into t;
  end if;
  return t;
end;
$$;

create function public.acknowledge_ticket(p_ticket_id uuid, p_reason text default null)
returns public.kitchen_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.kitchen_tickets := private.lock_ticket(p_ticket_id);
  actor text := private.ticket_actor(t.kitchen_id, p_reason);
begin
  if t.status = 'cancelled' then
    perform private.fail('This ticket was cancelled. Stop work on it.');
  end if;
  if t.status <> 'new' then
    return t;
  end if;
  update public.kitchen_tickets set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = auth.uid()
  where id = t.id returning * into t;
  perform private.log_ticket_event(t, 'ticket_acknowledged', case when actor = 'admin' then p_reason end);
  return t;
end;
$$;

create function public.start_ticket(p_ticket_id uuid, p_reason text default null)
returns public.kitchen_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.kitchen_tickets := private.lock_ticket(p_ticket_id);
  actor text := private.ticket_actor(t.kitchen_id, p_reason);
begin
  if t.status = 'cancelled' then
    perform private.fail('This ticket was cancelled. Stop work on it.');
  end if;
  if t.status in ('preparing', 'ready') then
    return t;
  end if;
  return private.start_ticket_locked(t, case when actor = 'admin' then p_reason end);
end;
$$;

-- Sets how many of a line are ready (0..quantity). Starting is implied; lowering the count is a
-- recorded correction.
create function public.set_line_ready(p_line_id uuid, p_ready_quantity integer, p_reason text default null)
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
  return private.sync_ticket(t.id);
end;
$$;

create function public.report_issue(p_ticket_id uuid, p_kind text, p_note text, p_line_id uuid default null)
returns public.kitchen_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.kitchen_tickets := private.lock_ticket(p_ticket_id);
  v_note text := trim(coalesce(p_note, ''));
  i public.kitchen_issues;
begin
  -- Reporting is not an exception, so an admin needs no reason; chefs must be assigned; others are refused.
  if private.current_staff_role() is distinct from 'admin' then
    perform private.ticket_actor(t.kitchen_id, null);
  end if;
  if t.status = 'cancelled' then
    perform private.fail('This ticket was cancelled. Stop work on it.');
  end if;
  if p_line_id is not null and not exists (select 1 from public.kitchen_ticket_lines where id = p_line_id and ticket_id = t.id) then
    perform private.fail('That item is not on this ticket.');
  end if;
  if p_kind is null or p_kind not in ('ingredient', 'equipment', 'quality', 'other') then
    perform private.fail('Choose what kind of issue this is.');
  end if;
  if length(v_note) < 3 then
    perform private.fail('Describe the issue in at least 3 characters.');
  end if;
  if length(v_note) > 500 then
    perform private.fail('Keep the note under 500 characters.');
  end if;

  insert into public.kitchen_issues (ticket_id, line_id, kind, note, reported_by)
  values (t.id, p_line_id, p_kind, v_note, auth.uid())
  returning * into i;
  update public.kitchen_tickets set updated_at = now() where id = t.id;
  perform private.log_ticket_event(t, 'kitchen_issue_reported', null, jsonb_build_object('kind', p_kind, 'note', v_note));
  return i;
end;
$$;

create function public.resolve_issue(p_issue_id uuid, p_resolution text)
returns public.kitchen_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolution text := trim(coalesce(p_resolution, ''));
  i public.kitchen_issues;
  t public.kitchen_tickets;
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can resolve kitchen issues.', 'forbidden');
  end if;
  if length(v_resolution) < 3 or length(v_resolution) > 500 then
    perform private.fail('Describe how the issue was resolved (3 to 500 characters).');
  end if;
  select * into i from public.kitchen_issues where id = p_issue_id for update;
  if not found then
    perform private.fail('Issue not found.', 'not_found');
  end if;
  if i.resolved_at is not null then
    perform private.fail('This issue is already resolved.');
  end if;

  update public.kitchen_issues
  set resolved_at = now(), resolved_by = auth.uid(), resolution = v_resolution
  where id = i.id
  returning * into i;
  update public.kitchen_tickets set updated_at = now() where id = i.ticket_id returning * into t;
  perform private.log_ticket_event(t, 'kitchen_issue_resolved', v_resolution, jsonb_build_object('kind', i.kind, 'note', i.note));
  return i;
end;
$$;

create function public.acknowledge_stop_work(p_ticket_id uuid, p_reason text default null)
returns public.kitchen_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.kitchen_tickets := private.lock_ticket(p_ticket_id);
  actor text := private.ticket_actor(t.kitchen_id, p_reason);
begin
  if t.status <> 'cancelled' then
    perform private.fail('This ticket is not cancelled.');
  end if;
  if t.stop_work_acknowledged_at is not null then
    return t;
  end if;
  update public.kitchen_tickets set stop_work_acknowledged_at = now(), stop_work_acknowledged_by = auth.uid()
  where id = t.id returning * into t;
  perform private.log_ticket_event(t, 'stop_work_acknowledged', case when actor = 'admin' then p_reason end);
  return t;
end;
$$;

-- Counts prints so reprints are labelled COPY. Chefs of the kitchen, admin, and counter may print.
create function public.record_ticket_print(p_ticket_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.kitchen_tickets := private.lock_ticket(p_ticket_id);
  n integer;
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.ticket_actor(t.kitchen_id, null);
  end if;
  update public.kitchen_tickets set print_count = print_count + 1 where id = t.id returning print_count into n;
  return n;
end;
$$;

revoke execute on function
  private.lock_ticket(uuid),
  private.ticket_actor(uuid, text),
  private.log_ticket_event(public.kitchen_tickets, text, text, jsonb),
  private.start_ticket_locked(public.kitchen_tickets, text),
  private.sync_ticket(uuid)
  from public;
revoke execute on function
  public.acknowledge_ticket(uuid, text),
  public.start_ticket(uuid, text),
  public.set_line_ready(uuid, integer, text),
  public.report_issue(uuid, text, text, uuid),
  public.resolve_issue(uuid, text),
  public.acknowledge_stop_work(uuid, text),
  public.record_ticket_print(uuid)
  from public, anon;
grant execute on function
  public.acknowledge_ticket(uuid, text),
  public.start_ticket(uuid, text),
  public.set_line_ready(uuid, integer, text),
  public.report_issue(uuid, text, text, uuid),
  public.resolve_issue(uuid, text),
  public.acknowledge_stop_work(uuid, text),
  public.record_ticket_print(uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Order changes (5A holding measure until kitchen revisions in 5C)
-- ---------------------------------------------------------------------------

-- Refuses item edits and reschedules once any live ticket is past New.
create function private.kitchen_guard(p_order_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.kitchen_tickets where order_id = p_order_id and status not in ('new', 'cancelled')) then
    perform private.fail('The kitchen has already acknowledged this order. Cancel it and create a new one, or wait for kitchen revisions.', 'kitchen');
  end if;
end;
$$;

revoke execute on function private.kitchen_guard(uuid) from public;

-- Item edits on confirmed orders: refused once the kitchen acknowledged; otherwise tickets are rebuilt.
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
  if o.status = 'confirmed' then
    if role <> 'admin' then
      perform private.fail('Only an admin can change the items on a confirmed order.', 'forbidden');
    end if;
    if reason is null then
      perform private.fail('Give a reason for changing a confirmed order.');
    end if;
  elsif o.status not in ('draft', 'pending_confirmation') then
    perform private.fail(format('Items cannot be changed on a %s order.', replace(o.status::text, '_', ' ')));
  end if;
  if o.status = 'confirmed' then -- 5A
    perform private.kitchen_guard(o.id);
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
      if o.status = 'confirmed' and v.prep_type = 'made_to_order' and v.kitchen_id is null then
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

  -- Existing lines left out of the list are removed (the audit log keeps the deleted rows).
  for ln in
    delete from public.order_items
    where order_id = o.id and line_no <= last_existing and not (id = any (kept))
    returning *
  loop
    changes := changes || jsonb_build_array(jsonb_build_object(
      'item', ln.product_name || ' — ' || ln.variant_name, 'from', ln.quantity, 'to', 0));
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
  if o.status = 'confirmed' and private.build_tickets(o.id) > 0 then -- 5A
    perform private.log_order_event(o.id, 'tickets_revised', null, jsonb_build_object('cause', 'items_changed'));
  end if;
  return o;
end;
$$;

-- Reschedules: same rule as item edits.
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
  if o.status = 'confirmed' then -- 5A
    perform private.kitchen_guard(o.id);
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
  if o.status = 'confirmed' and private.build_tickets(o.id) > 0 then -- 5A
    perform private.log_order_event(o.id, 'tickets_revised', null, jsonb_build_object('cause', 'rescheduled'));
  end if;
  return o;
end;
$$;

-- Cancelling stops kitchen work.
create or replace function public.cancel_order(p_order_id uuid, p_expected_version integer, p_reason text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  reason text := nullif(trim(coalesce(p_reason, '')), '');
  billed bigint;
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
  select total_paise into billed from public.bills where order_id = o.id;
  if billed is not null and private.order_credited(o.id) < billed then
    perform private.fail('This order has a bill. Issue a credit note for the full bill before cancelling.', 'billed');
  end if;

  update public.orders
  set status = 'cancelled', closed_reason = reason, closed_by = auth.uid(), closed_at = now(), version = version + 1
  where id = o.id
  returning * into o;
  perform private.log_order_event(o.id, 'cancelled', reason);
  -- 5A: stop kitchen work; ready counts stay on the lines as a record.
  update public.kitchen_ticket_lines l set status = 'cancelled'
  from public.kitchen_tickets t
  where l.ticket_id = t.id and t.order_id = o.id and t.status <> 'cancelled';
  update public.kitchen_tickets
  set status = 'cancelled', cancelled_at = now(), cancel_reason = reason
  where order_id = o.id and status <> 'cancelled';
  return o;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: tickets for confirmed or preparing orders that have none (the live database has no
-- orders today; this is a safety net).
-- ---------------------------------------------------------------------------
select private.build_tickets(o.id)
from public.orders o
where o.status in ('confirmed', 'preparing')
  and not exists (select 1 from public.kitchen_tickets t where t.order_id = o.id);
