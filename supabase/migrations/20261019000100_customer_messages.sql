-- WhatsApp messages to customers (owner, 2026-10-19). Staff open a ready-made message in WhatsApp from the
-- order page and send it themselves (click-to-chat, no paid service). Opening one is recorded on the order's
-- timeline; whether it was actually sent is up to the staff member (PROJECT_RULES 2.20).

create function public.record_customer_message(p_order_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to message customers.', 'forbidden');
  end if;
  if p_kind is null or p_kind not in ('received', 'confirmed', 'ready', 'balance', 'thanks') then
    perform private.fail('Unknown message.');
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    perform private.fail('Order not found.', 'not_found');
  end if;
  perform private.log_order_event(p_order_id, 'customer_message', null,
    jsonb_build_object('channel', 'whatsapp', 'kind', p_kind));
end;
$$;

revoke execute on function public.record_customer_message(uuid, text) from public, anon;
grant execute on function public.record_customer_message(uuid, text) to authenticated;
