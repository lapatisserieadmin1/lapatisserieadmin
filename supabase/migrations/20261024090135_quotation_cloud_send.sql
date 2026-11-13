-- Quotations sent by the server through the WhatsApp Business (Cloud) API (owner, 2026-10-24).
-- record_quotation_send also takes channel 'cloud_api': status 'sent' with WhatsApp's message id, or
-- 'failed' (no file needed, so a failed attempt still shows in the order's send log, though not in its
-- history of events). Same permission and file checks.
-- Safe: replaces one function; no table or data changes.

drop function public.record_quotation_send(uuid, text, text, text, text, text);

create function public.record_quotation_send(p_order_id uuid, p_format text, p_channel text, p_status text,
  p_file_path text, p_caption text default null, p_message_id text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  send_id uuid;
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to send quotations.', 'forbidden');
  end if;
  if not exists (select 1 from public.orders where id = p_order_id) then
    perform private.fail('Order not found.', 'not_found');
  end if;
  if p_format is null or p_format not in ('pdf', 'png') then
    perform private.fail('Choose PDF or image.');
  end if;
  if p_channel is null or p_status is null
     or not (p_channel in ('share_sheet', 'download_and_chat') and p_status in ('shared', 'downloaded')
             or p_channel = 'cloud_api' and p_status in ('sent', 'failed')) then
    perform private.fail('Unknown way of sending.');
  end if;
  if (p_status <> 'failed' or p_file_path is not null)
     and (p_file_path is null or p_file_path not like p_order_id::text || '/%.' || p_format or p_file_path like '%..%'
          or not exists (select 1 from storage.objects where bucket_id = 'quotations' and name = p_file_path)) then
    perform private.fail('The quotation file was not found. Prepare it again.');
  end if;
  if p_status = 'sent' and p_channel = 'cloud_api' and nullif(trim(coalesce(p_message_id, '')), '') is null then
    perform private.fail('WhatsApp did not return a message id.');
  end if;
  if length(p_caption) > 2000 or length(p_message_id) > 200 then
    perform private.fail('Keep the message under 2000 characters.');
  end if;
  insert into public.quotation_sends (order_id, sent_by, format, channel, status, file_path, caption, message_id)
  values (p_order_id, auth.uid(), p_format, p_channel, p_status, p_file_path, nullif(trim(coalesce(p_caption, '')), ''),
          nullif(trim(coalesce(p_message_id, '')), ''))
  returning id into send_id;
  if p_status <> 'failed' then
    perform private.log_order_event(p_order_id, 'quotation_sent', null,
      jsonb_build_object('format', p_format, 'channel', p_channel, 'status', p_status));
  end if;
  return send_id;
end;
$$;

revoke execute on function public.record_quotation_send(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.record_quotation_send(uuid, text, text, text, text, text, text) to authenticated;
