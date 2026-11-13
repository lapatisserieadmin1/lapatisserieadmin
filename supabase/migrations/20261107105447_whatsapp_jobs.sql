-- WhatsApp sending from the shop computer (owner, 2026-11-07): the admin taps "Send bill and Terms", the app
-- makes the files (private quotations bucket) and queues one job per file; the shop computer's sender, linked
-- to the bakery's WhatsApp, sends each file into the chat of the number the customer gave and reports back.
-- Additive only.

create table public.whatsapp_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  to_phone text not null check (to_phone ~ '^[0-9]{10,15}$'),
  document text not null check (document in ('bill', 'terms')),
  format text not null check (format in ('pdf', 'png')),
  file_path text not null check (length(file_path) between 1 and 300),
  file_name text not null check (length(file_name) between 1 and 200),
  caption text check (caption is null or length(caption) <= 500),
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  message_id text check (message_id is null or length(message_id) <= 200),
  problem text check (problem is null or length(problem) <= 500),
  attempts integer not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index whatsapp_jobs_pending_idx on public.whatsapp_jobs (created_at) where status in ('pending', 'sending');
create index whatsapp_jobs_order_idx on public.whatsapp_jobs (order_id, created_at desc);
alter table public.whatsapp_jobs enable row level security;
create policy "Admin and counter read whatsapp jobs" on public.whatsapp_jobs
  for select to authenticated
  using ((select private.has_role(array['admin', 'counter']::public.staff_role[])));
create policy "Admin and counter queue whatsapp jobs" on public.whatsapp_jobs
  for insert to authenticated
  with check ((select private.has_role(array['admin', 'counter']::public.staff_role[])) and status = 'pending');
revoke all on public.whatsapp_jobs from anon, authenticated;
grant select, insert on public.whatsapp_jobs to authenticated;

-- The shop computer's sender: when it was last running and which WhatsApp number it is linked to.
create table public.whatsapp_sender (
  id integer primary key default 1 check (id = 1),
  last_seen timestamptz,
  linked_phone text check (linked_phone is null or length(linked_phone) <= 20),
  state text check (state is null or state in ('waiting_for_qr', 'connected', 'disconnected'))
);
insert into public.whatsapp_sender (id) values (1);
alter table public.whatsapp_sender enable row level security;
create policy "Admin and counter read the sender" on public.whatsapp_sender
  for select to authenticated
  using ((select private.has_role(array['admin', 'counter']::public.staff_role[])));
revoke all on public.whatsapp_sender from anon, authenticated;
grant select on public.whatsapp_sender to authenticated;

create function public.whatsapp_sender_heartbeat(p_state text, p_linked_phone text default null)
returns void
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('Only admin or counter logins can run the WhatsApp sender.', 'forbidden');
  end if;
  if p_state is null or p_state not in ('waiting_for_qr', 'connected', 'disconnected') then
    perform private.fail('Unknown sender state.');
  end if;
  update public.whatsapp_sender
     set last_seen = now(), state = p_state, linked_phone = left(nullif(trim(coalesce(p_linked_phone, '')), ''), 20)
   where id = 1;
end;
$$;

-- Takes the oldest waiting job (jobs older than 2 hours are dropped as failed: a late bill confuses customers).
create function public.claim_whatsapp_job()
returns setof public.whatsapp_jobs
language plpgsql
security definer
set search_path to ''
as $$
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('Only admin or counter logins can run the WhatsApp sender.', 'forbidden');
  end if;
  update public.whatsapp_jobs
     set status = 'failed', problem = 'Not sent within 2 hours: the shop computer sender was not running.', updated_at = now()
   where status = 'pending' and created_at < now() - interval '2 hours';
  update public.whatsapp_jobs
     set status = 'pending', updated_at = now()
   where status = 'sending' and updated_at < now() - interval '2 minutes' and attempts < 3;
  return query
  update public.whatsapp_jobs j
     set status = 'sending', attempts = j.attempts + 1, updated_at = now()
   where j.id = (select id from public.whatsapp_jobs where status = 'pending' order by created_at limit 1 for update skip locked)
  returning j.*;
end;
$$;

create function public.finish_whatsapp_job(p_job_id uuid, p_status text, p_message_id text default null, p_problem text default null)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  job public.whatsapp_jobs;
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('Only admin or counter logins can run the WhatsApp sender.', 'forbidden');
  end if;
  if p_status is null or p_status not in ('sent', 'failed') then
    perform private.fail('Unknown job status.');
  end if;
  update public.whatsapp_jobs
     set status = p_status, message_id = left(nullif(trim(coalesce(p_message_id, '')), ''), 200),
         problem = left(nullif(trim(coalesce(p_problem, '')), ''), 500), updated_at = now()
   where id = p_job_id and status = 'sending'
  returning * into job;
  if job.id is not null and p_status = 'sent' then
    perform private.log_order_event(job.order_id, case when job.document = 'terms' then 'terms_sent' else 'bill_sent' end, null,
      jsonb_build_object('format', job.format, 'channel', 'shop_whatsapp'));
  end if;
end;
$$;

revoke all on function public.whatsapp_sender_heartbeat(text, text) from public, anon;
revoke all on function public.claim_whatsapp_job() from public, anon;
revoke all on function public.finish_whatsapp_job(uuid, text, text, text) from public, anon;
grant execute on function public.whatsapp_sender_heartbeat(text, text) to authenticated;
grant execute on function public.claim_whatsapp_job() to authenticated;
grant execute on function public.finish_whatsapp_job(uuid, text, text, text) to authenticated;
