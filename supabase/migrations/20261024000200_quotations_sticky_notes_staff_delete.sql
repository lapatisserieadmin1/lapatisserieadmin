-- Owner, 2026-10-24.
--
-- 1. public.order_quotation(order): everything a quotation shows, in one place. Admin and counter staff
--    get the full version with every amount; a chef gets the price-free version, and only for a confirmed
--    order of their own kitchen. Amount keys are left out of the chef's version entirely.
-- 2. Sticky note on each order (orders.sticky_note), with "include in WhatsApp message".
-- 3. Quotation files: private Storage bucket "quotations" (admin and counter staff only; read through
--    short-lived signed URLs) and public.quotation_sends, the log of every quotation sent to a customer.
-- 4. Staff are deleted softly (staff_profiles.deleted_at): the profile stays so "taken by" on old orders
--    keeps its name, the login is disabled and its sessions end. Not yourself, never the last admin.
-- 5. order_summaries is recreated for the orders columns added on 2026-10-24.

-- ---------------------------------------------------------------------------
-- 1. Quotation data
-- ---------------------------------------------------------------------------

create function public.order_quotation(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  role public.staff_role := private.current_staff_role();
  with_amounts boolean;
  o public.orders;
  cc public.custom_cakes;
  s public.business_settings;
  paid bigint;
  refunded bigint;
  credited bigint;
  items jsonb;
  cake jsonb;
begin
  if role is null then
    perform private.fail('You do not have access to quotations.', 'forbidden');
  end if;
  with_amounts := role in ('admin', 'counter');
  select * into o from public.orders where id = p_order_id;
  -- A chef asking for another kitchen's order, or an order not yet confirmed, is told it does not exist.
  if not found or (not with_amounts and (not private.chef_sees_kitchen(o.kitchen_id)
                                         or o.status not in ('confirmed', 'preparing', 'ready', 'completed'))) then
    perform private.fail('Quotation not found.', 'not_found');
  end if;
  select * into cc from public.custom_cakes where order_id = o.id order by created_at limit 1;
  select * into s from public.business_settings;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'line_no', oi.line_no,
             'name', oi.product_name,
             'variant', oi.variant_name,
             'quantity', oi.quantity - oi.cancelled_quantity,
             'kind', case when oi.id = cc.setup_charge_item_id then 'setup'
                          when oi.id = cc.delivery_charge_item_id then 'delivery'
                          when oi.id = cc.order_item_id then 'cake'
                          else 'item' end,
             'is_eggless', oi.is_eggless,
             'notes', oi.notes)
           || case when with_amounts
                   then jsonb_build_object('unit_price_paise', oi.unit_price_paise, 'line_total_paise', oi.line_total_paise)
                   else '{}'::jsonb end
           order by oi.line_no), '[]'::jsonb)
  into items
  from public.order_items oi
  where oi.order_id = o.id and oi.quantity > oi.cancelled_quantity;

  if cc.id is not null then
    cake := jsonb_strip_nulls(jsonb_build_object(
      'flavour', cc.flavour, 'weight_kg', cc.weight_kg, 'tiers', cc.tiers, 'theme', cc.theme,
      'design', cc.design, 'model', cc.model, 'fondant', cc.fondant, 'cream', cc.cream,
      'filling', cc.filling, 'toppings', cc.toppings, 'message', cc.message, 'is_eggless', cc.is_eggless,
      'cupcake_count', cc.cupcake_count, 'popsicle_count', cc.popsicle_count, 'instructions', cc.instructions));
  end if;

  if with_amounts then
    select coalesce(sum(amount_paise) filter (where kind = 'payment'), 0),
           coalesce(sum(amount_paise) filter (where kind = 'refund'), 0)
    into paid, refunded
    from public.payments where order_id = o.id;
    select coalesce(sum(cn.total_paise), 0) into credited
    from public.bills b join public.credit_notes cn on cn.bill_id = b.id
    where b.order_id = o.id;
  end if;

  return jsonb_build_object(
    'mode', case when with_amounts then 'full' else 'kitchen' end,
    'timezone', private.business_timezone(),
    'shop', jsonb_strip_nulls(jsonb_build_object('name', s.business_name, 'phone', s.phone, 'email', s.email, 'address', s.address)),
    'order', jsonb_strip_nulls(jsonb_build_object(
      'id', o.id, 'reference', o.reference, 'status', o.status, 'source', o.source,
      'created_at', o.created_at, 'confirmed_at', o.confirmed_at, 'due_at', o.due_at, 'is_immediate', o.is_immediate,
      'fulfilment', o.fulfilment, 'setup_address', o.setup_address, 'setup_note', o.setup_note,
      'customer_notes', o.customer_notes,
      'kitchen', (select k.name from public.kitchens k where k.id = o.kitchen_id))),
    'cake', cake,
    'items', items)
  || case when with_amounts then jsonb_build_object('amounts', jsonb_build_object(
       'subtotal_paise', o.subtotal_paise,
       'discount_paise', o.discount_paise,
       'tax_paise', o.tax_paise,
       'total_paise', o.total_paise,
       'credited_paise', credited,
       'advance_paise', paid - refunded,
       'balance_paise', (case when o.status in ('cancelled', 'rejected') then 0 else o.total_paise - credited end) - paid + refunded))
     else '{}'::jsonb end;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Sticky notes
-- ---------------------------------------------------------------------------

alter table public.orders
  add column sticky_note text check (sticky_note is null or length(sticky_note) between 1 and 500),
  add column sticky_note_in_whatsapp boolean not null default false;

-- Admin and counter staff, at any stage. An empty note clears it (and the WhatsApp choice).
create function public.set_sticky_note(p_order_id uuid, p_note text, p_in_whatsapp boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to change orders.', 'forbidden');
  end if;
  if length(note) > 500 then
    perform private.fail('Keep the sticky note under 500 characters.');
  end if;
  update public.orders
  set sticky_note = note, sticky_note_in_whatsapp = coalesce(p_in_whatsapp, false) and note is not null
  where id = p_order_id;
  if not found then
    perform private.fail('Order not found.', 'not_found');
  end if;
  perform private.log_order_event(p_order_id, 'sticky_note_changed', null, jsonb_build_object(
    'cleared', note is null, 'in_whatsapp', coalesce(p_in_whatsapp, false) and note is not null));
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Quotation files and the send log
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('quotations', 'quotations', false, 10485760, array['application/pdf', 'image/png'])
on conflict (id) do nothing;

-- Chefs have no policy here: they can neither upload nor open quotation files.
create policy "Admin and counter add quotations" on storage.objects for insert to authenticated
  with check (bucket_id = 'quotations' and (select private.has_role(array['admin', 'counter']::public.staff_role[])));
create policy "Admin and counter read quotations" on storage.objects for select to authenticated
  using (bucket_id = 'quotations' and (select private.has_role(array['admin', 'counter']::public.staff_role[])));

create table public.quotation_sends (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  sent_by uuid references auth.users (id) on delete set null,
  sent_at timestamptz not null default now(),
  format text not null check (format in ('pdf', 'png')),
  -- share_sheet: the phone's share sheet with the file attached; download_and_chat: file downloaded and the
  -- customer's WhatsApp chat opened; cloud_api: sent by the server (not set up yet).
  channel text not null check (channel in ('share_sheet', 'download_and_chat', 'cloud_api')),
  status text not null check (status in ('shared', 'downloaded', 'sent', 'delivered', 'read', 'failed')),
  file_path text check (file_path is null or length(file_path) <= 300),
  message_id text check (message_id is null or length(message_id) <= 200),
  caption text check (caption is null or length(caption) <= 2000)
);
create index quotation_sends_order_id_idx on public.quotation_sends (order_id, sent_at);
create index quotation_sends_sent_by_idx on public.quotation_sends (sent_by);
create trigger quotation_sends_audit after insert or update or delete on public.quotation_sends
  for each row execute function private.audit_row('id');
alter table public.quotation_sends enable row level security;
create policy "Admin and counter read quotation sends" on public.quotation_sends for select to authenticated
  using ((select private.has_role(array['admin', 'counter']::public.staff_role[])));
revoke all on public.quotation_sends from anon, authenticated;
grant select on public.quotation_sends to authenticated;

-- Admin and counter staff record a quotation they sent from their device. The file must be one generated
-- for this order and stored in the quotations bucket.
create function public.record_quotation_send(p_order_id uuid, p_format text, p_channel text, p_status text,
  p_file_path text, p_caption text default null)
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
  if p_channel is null or p_channel not in ('share_sheet', 'download_and_chat')
     or p_status is null or p_status not in ('shared', 'downloaded') then
    perform private.fail('Unknown way of sending.');
  end if;
  if p_file_path is null or p_file_path not like p_order_id::text || '/%.' || p_format or p_file_path like '%..%'
     or not exists (select 1 from storage.objects where bucket_id = 'quotations' and name = p_file_path) then
    perform private.fail('The quotation file was not found. Prepare it again.');
  end if;
  if length(p_caption) > 2000 then
    perform private.fail('Keep the message under 2000 characters.');
  end if;
  insert into public.quotation_sends (order_id, sent_by, format, channel, status, file_path, caption)
  values (p_order_id, auth.uid(), p_format, p_channel, p_status, p_file_path, nullif(trim(coalesce(p_caption, '')), ''))
  returning id into send_id;
  perform private.log_order_event(p_order_id, 'quotation_sent', null,
    jsonb_build_object('format', p_format, 'channel', p_channel, 'status', p_status));
  return send_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Deleting staff
-- ---------------------------------------------------------------------------

alter table public.staff_profiles
  add column deleted_at timestamptz,
  add column deleted_by uuid references auth.users (id) on delete set null,
  add constraint staff_profiles_deleted_inactive check (deleted_at is null or not is_active);

-- Admins only. The profile stays (old orders keep the name), access ends at once: inactive, no kitchen,
-- every login session deleted (refresh tokens go with them). The app also bans the login in Supabase Auth.
create function public.delete_staff(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target public.staff_profiles;
begin
  if not private.is_admin() then
    perform private.fail('Only an admin can delete staff.', 'forbidden');
  end if;
  if p_user_id = (select auth.uid()) then
    perform private.fail('You cannot delete your own login. Ask another admin.');
  end if;
  select * into target from public.staff_profiles where user_id = p_user_id for update;
  if not found or target.deleted_at is not null then
    perform private.fail('Staff member not found.', 'not_found');
  end if;
  if target.role = 'admin' and target.is_active and not exists (
       select 1 from public.staff_profiles
       where role = 'admin' and is_active and deleted_at is null and user_id <> p_user_id) then
    perform private.fail('At least one active admin is required.');
  end if;
  update public.staff_profiles
  set is_active = false, deleted_at = now(), deleted_by = (select auth.uid())
  where user_id = p_user_id;
  delete from public.staff_kitchens where user_id = p_user_id;
  delete from auth.sessions where user_id = p_user_id;
end;
$$;

revoke execute on function public.order_quotation(uuid), public.set_sticky_note(uuid, text, boolean),
  public.record_quotation_send(uuid, text, text, text, text, text), public.delete_staff(uuid) from public, anon;
grant execute on function public.order_quotation(uuid), public.set_sticky_note(uuid, text, boolean),
  public.record_quotation_send(uuid, text, text, text, text, text), public.delete_staff(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. order_summaries with the new orders columns (copied from 20261009000200)
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
