-- WhatsApp Cloud API Terms sending, step 5 of the owner's plan (2026-11-07): keep WhatsApp's delivery
-- status (sent, delivered, read, failed) for each message, from Meta's webhook, and mark sends made in
-- local test mode so they never count as the customer having the Terms. Additive: the live app keeps working.

alter table public.terms_sends
  add column test_mode boolean not null default false,
  add column delivery_status text check (delivery_status is null or delivery_status in ('sent', 'delivered', 'read', 'failed')),
  add column delivery_updated_at timestamptz,
  add column delivery_problem text check (delivery_problem is null or length(delivery_problem) <= 500);

create index terms_sends_message_idx on public.terms_sends (message_id) where message_id is not null;

drop function public.record_terms_send(uuid, text, text, text, text);

create function public.record_terms_send(
  p_order_id uuid, p_format text, p_status text, p_message_id text default null, p_problem text default null,
  p_test boolean default false)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  send_id uuid;
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to send the terms.', 'forbidden');
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    perform private.fail('Order not found.', 'not_found');
  end if;
  if p_format is null or p_format not in ('pdf', 'png') then
    perform private.fail('Choose PDF or image.');
  end if;
  if p_status is null or p_status not in ('sent', 'failed') then
    perform private.fail('Unknown send status.');
  end if;
  if p_status = 'sent' and nullif(trim(coalesce(p_message_id, '')), '') is null then
    perform private.fail('WhatsApp did not return a message id.');
  end if;
  insert into public.terms_sends (order_id, format, status, message_id, problem, test_mode, delivery_status, delivery_updated_at)
  values (p_order_id, p_format, p_status, nullif(trim(coalesce(p_message_id, '')), ''),
          left(nullif(trim(coalesce(p_problem, '')), ''), 500), coalesce(p_test, false),
          case when p_status = 'sent' then 'sent' end, case when p_status = 'sent' then now() end)
  returning id into send_id;
  if p_status = 'sent' and not coalesce(p_test, false) then
    perform private.log_order_event(p_order_id, 'terms_sent', null, jsonb_build_object('format', p_format));
  end if;
  return send_id;
end;
$$;

revoke all on function public.record_terms_send(uuid, text, text, text, text, boolean) from public, anon;
grant execute on function public.record_terms_send(uuid, text, text, text, text, boolean) to authenticated, service_role;

-- Called by the webhook only, after it checked Meta's signature (run as anon since 20261107095146). Status only moves
-- forward (sent, delivered, read); failed can arrive at any time. Unknown message ids are ignored.
create function public.record_whatsapp_status(p_message_id text, p_status text, p_problem text default null)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  changed integer;
begin
  if p_status is null or p_status not in ('sent', 'delivered', 'read', 'failed') then
    return 0;
  end if;
  update public.terms_sends t
     set delivery_status = p_status,
         delivery_updated_at = now(),
         delivery_problem = case when p_status = 'failed' then left(nullif(trim(coalesce(p_problem, '')), ''), 500) else t.delivery_problem end
   where t.message_id = p_message_id
     and (p_status = 'failed'
          or array_position(array['sent', 'delivered', 'read'], p_status)
             > coalesce(array_position(array['sent', 'delivered', 'read'], t.delivery_status), 0));
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.record_whatsapp_status(text, text, text) from public, anon, authenticated;
grant execute on function public.record_whatsapp_status(text, text, text) to service_role;
