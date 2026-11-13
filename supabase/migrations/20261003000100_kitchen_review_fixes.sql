-- Phase 5A review fixes (HANDOVER section 7, "Minor items from the 5A review").
--
-- 1. One lock order everywhere: the order first, then its tickets. Admin edits already lock the order
--    (lock_order) and then touch tickets; chef actions locked the ticket first and then needed the
--    order (the timeline entry's foreign key, or the order status update), so the two could deadlock.
--    private.lock_ticket now locks the order before the ticket.
-- 2. private.kitchen_guard locks the order's tickets before it checks them, so a chef action in
--    flight finishes first and the check sees its result (it was a STABLE read without locks).
-- 3. resolve_issue goes through lock_ticket too.
-- 4. The "ticket ready" timeline entry carries the admin's reason when an admin acts as the kitchen.
-- 5. public.ticket_stamp(): the chef screen's change stamp, built from the tickets themselves instead
--    of "newest updated_at + count of all tickets" (a transaction that committed late could leave
--    the stamp unchanged, and the count grew with history).

-- ---------------------------------------------------------------------------
-- 1. Order, then ticket
-- ---------------------------------------------------------------------------

create or replace function private.lock_ticket(p_ticket_id uuid)
returns public.kitchen_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order uuid;
  t public.kitchen_tickets;
begin
  -- order_id never changes, so reading it unlocked is safe. NO KEY UPDATE conflicts with the admin
  -- path's FOR UPDATE and with other chef actions on the same order, but not with the key-share
  -- locks that payments and timeline entries take through their foreign keys.
  select order_id into v_order from public.kitchen_tickets where id = p_ticket_id;
  if v_order is null then
    perform private.fail('Ticket not found.', 'not_found');
  end if;
  perform 1 from public.orders where id = v_order for no key update;
  select * into t from public.kitchen_tickets where id = p_ticket_id for update;
  if not found then
    perform private.fail('Ticket not found.', 'not_found');
  end if;
  return t;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. kitchen_guard locks the tickets it checks
-- ---------------------------------------------------------------------------

-- Refuses item edits and reschedules once any live ticket is past New. Callers hold the order lock.
-- Locking the tickets (in id order) makes the check and the rebuild that follows one atomic step.
create or replace function private.kitchen_guard(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.kitchen_tickets where order_id = p_order_id order by id for update;
  if exists (select 1 from public.kitchen_tickets where order_id = p_order_id and status not in ('new', 'cancelled')) then
    perform private.fail('The kitchen has already acknowledged this order. Cancel it and create a new one, or wait for kitchen revisions.', 'kitchen');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. resolve_issue: order, then ticket, then the issue
-- ---------------------------------------------------------------------------

create or replace function public.resolve_issue(p_issue_id uuid, p_resolution text)
returns public.kitchen_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolution text := trim(coalesce(p_resolution, ''));
  v_ticket uuid;
  i public.kitchen_issues;
  t public.kitchen_tickets;
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can resolve kitchen issues.', 'forbidden');
  end if;
  if length(v_resolution) < 3 or length(v_resolution) > 500 then
    perform private.fail('Describe how the issue was resolved (3 to 500 characters).');
  end if;
  select ticket_id into v_ticket from public.kitchen_issues where id = p_issue_id;
  if v_ticket is null then
    perform private.fail('Issue not found.', 'not_found');
  end if;
  t := private.lock_ticket(v_ticket);
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

-- ---------------------------------------------------------------------------
-- 4. The ready entry carries the admin's reason
-- ---------------------------------------------------------------------------

-- Derives the ticket's ready state from its lines. Always touches updated_at so the chef screen's
-- change stamp moves. p_reason is the admin's reason when an admin acts as the kitchen.
create function private.sync_ticket(p_ticket_id uuid, p_reason text)
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

-- The one-argument form stays (no reason) so nothing has to be dropped.
create or replace function private.sync_ticket(p_ticket_id uuid)
returns public.kitchen_tickets
language sql
security definer
set search_path = ''
as $$
  select private.sync_ticket(p_ticket_id, null::text)
$$;

revoke execute on function private.sync_ticket(uuid, text) from public;

-- Sets how many of a line are ready (0..quantity). Starting is implied; lowering the count is a
-- recorded correction.
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
-- 5. Change stamp for the chef screen
-- ---------------------------------------------------------------------------

-- A value that changes whenever any visible ticket that could be on the screen changes: the tickets
-- still being worked on, plus anything touched in the last two days (finished work and stop-work
-- notices). It is a digest of the tickets' own updated_at values, so it moves no matter in which
-- order transactions commit, and it is bounded by the working set rather than by history. Runs as
-- the caller, so a chef's stamp covers only their kitchens (row-level security).
create function public.ticket_stamp()
returns text
language sql
stable
set search_path = ''
as $$
  select count(*)::text || ':' || coalesce(md5(string_agg(t.id::text || '@' || t.updated_at::text, ',' order by t.id)), '')
  from public.kitchen_tickets t
  where t.status in ('new', 'acknowledged', 'preparing') or t.updated_at >= now() - interval '2 days'
$$;

revoke execute on function public.ticket_stamp() from public, anon;
grant execute on function public.ticket_stamp() to authenticated;
