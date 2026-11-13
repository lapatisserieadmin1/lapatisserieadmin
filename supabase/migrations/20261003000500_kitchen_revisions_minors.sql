-- Phase 5C: the minor items deferred from its final review.
--
-- 1. order_summaries.kitchen_ids leaves out items removed after the kitchen acknowledged (kept as
--    fully cancelled lines), so order lists and the calendar's kitchen filter no longer show a
--    kitchen that has nothing left on the order. The view is recreated from its billing definition
--    with only that filter changed (o.* is expanded again, so it now also carries the columns added
--    to orders since: no_show_at, packed_at and the other 5B columns).
-- 2. private.revise_tickets:
--    - an item added since the kitchen last acknowledged and removed again is deleted from the
--      ticket instead of staying as a "Removed" line the kitchen never saw;
--    - pickup change entries are UTC text, so a move and a move back net out in any session time zone;
--    - a ticket made Ready by an edit records why in the timeline.
-- 3. report_issue refuses a removed (cancelled) item.

-- ---------------------------------------------------------------------------
-- 1. Order summaries: kitchens of active items only
-- ---------------------------------------------------------------------------

drop view public.order_summaries;
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

-- ---------------------------------------------------------------------------
-- 2. Revisions
-- ---------------------------------------------------------------------------

create or replace function private.revise_tickets(p_order_id uuid)
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
        if ln.want = 0 and exists (select 1 from jsonb_array_elements(t.pending_changes) e
                                   where e ->> 'key' = 'qty:' || ln.item_id and (e -> 'from') = '0'::jsonb) then
          -- Added since the kitchen last acknowledged and removed again: the kitchen never saw it.
          delete from public.kitchen_ticket_lines where id = ln.line_id;
          entries := entries || jsonb_build_array(jsonb_build_object(
            'key', 'qty:' || ln.item_id, 'kind', 'quantity', 'item', ln.item, 'from', ln.have, 'to', 0));
          continue;
        end if;
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
        'key', 'pickup', 'kind', 'pickup', 'item', 'Pickup',
        'from', to_char(t.due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'to', to_char(o.due_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));
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
    perform private.sync_ticket(t.id, 'Order changed: everything left was already made.');
    summary := summary || jsonb_build_array(jsonb_build_object(
      'ticket', t.reference,
      'kitchen', (select k.name from public.kitchens k where k.id = t.kitchen_id),
      'changes', entries));
  end loop;
  return summary;
end;
$$;

revoke execute on function private.revise_tickets(uuid) from public;

-- ---------------------------------------------------------------------------
-- 3. No issues on removed items
-- ---------------------------------------------------------------------------

create or replace function public.report_issue(p_ticket_id uuid, p_kind text, p_note text, p_line_id uuid default null)
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
  if exists (select 1 from public.kitchen_ticket_lines where id = p_line_id and status = 'cancelled') then -- 5C
    perform private.fail('This item was removed from the order.');
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
