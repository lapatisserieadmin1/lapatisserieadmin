-- Admins delete any order from the calendar outright (owner, 2026-10-28): its payments, bill and credit
-- notes go with it, with no cancel or credit note first. Payments, bills and credit notes stay locked
-- everywhere else; only delete_order unlocks them, for this one transaction. The audit log keeps a copy
-- of every deleted row.

create or replace function private.block_payment_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('app.deleting_order', true) = 'on' then
    return old;
  end if;
  raise exception 'Payments cannot be edited or deleted; record a refund instead.';
end;
$$;

create or replace function private.block_document_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and current_setting('app.deleting_order', true) = 'on' then
    return old;
  end if;
  raise exception 'Bills and credit notes cannot be edited or deleted; issue a credit note instead.';
end;
$$;

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

  update public.orders set closed_reason = reason, closed_by = auth.uid(), closed_at = now() where id = o.id;
  perform set_config('app.deleting_order', 'on', true);
  delete from public.credit_notes where bill_id in (select id from public.bills where order_id = o.id);
  delete from public.payments where order_id = o.id;
  delete from public.bills where order_id = o.id;
  delete from public.orders where id = o.id;
  perform set_config('app.deleting_order', 'off', true);
end;
$$;

revoke execute on function public.delete_order(uuid, integer, text) from public, anon;
grant execute on function public.delete_order(uuid, integer, text) to authenticated;
