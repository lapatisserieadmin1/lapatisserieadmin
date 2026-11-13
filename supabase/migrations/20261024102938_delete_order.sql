-- Admins delete an order from the calendar (owner, 2026-10-24). Only an order with no money recorded
-- (no payment, refund or bill) is deleted, with its items, events, kitchen tickets, cake and quotation
-- sends. An order with money keeps its records: the app cancels it instead. The audit log keeps the
-- deleted row, with the reason written onto it just before.
create or replace function public.delete_order(p_order_id uuid, p_expected_version integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can delete orders.', 'forbidden');
  end if;
  if reason is null then
    perform private.fail('Give a reason for deleting the order.');
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if exists (select 1 from public.payments where order_id = o.id) or exists (select 1 from public.bills where order_id = o.id) then
    perform private.fail('This order has payments or a bill, so it cannot be deleted.', 'has_money');
  end if;

  update public.orders set closed_reason = reason, closed_by = auth.uid(), closed_at = now() where id = o.id;
  delete from public.orders where id = o.id;
end;
$$;

revoke execute on function public.delete_order(uuid, integer, text) from public, anon;
grant execute on function public.delete_order(uuid, integer, text) to authenticated;
