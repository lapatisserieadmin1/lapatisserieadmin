-- Deferred minor from the final review (2026-10-03): an item added since the kitchen last
-- acknowledged and then removed was deleted from the ticket even when the kitchen had already made
-- some of it. It now stays on the ticket as a Removed line in that case; it is still deleted when
-- none was made. Only this condition changes in private.revise_tickets.

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
        if ln.want = 0 and ln.ready_quantity = 0 and exists (select 1 from jsonb_array_elements(t.pending_changes) e
                                   where e ->> 'key' = 'qty:' || ln.item_id and (e -> 'from') = '0'::jsonb) then
          -- Added since the kitchen last acknowledged and removed again before any was made: the
          -- kitchen never saw it. (If some were made, it stays as a Removed line below.)
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
