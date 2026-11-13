-- Owner requests (2026-11-07):
-- 1. Pickup/Cab orders keep the customer's address and landmark too; only set-up orders require the address.
-- 2. The Terms and Conditions go to the customer's WhatsApp automatically; each attempt is logged per order.
-- 3. A private to-do list / diary for each staff member on the dashboard.
-- Additive and backward compatible: callers that send no address for pickup behave as before.

-- 1. Address and landmark for every order -----------------------------------------------------------------
create or replace function private.clean_fulfilment(
  p_fulfilment public.fulfilment_type, p_address text, p_note text, out address text, out note text)
returns record
language plpgsql
immutable
set search_path to ''
as $$
begin
  address := nullif(trim(coalesce(p_address, '')), '');
  note := nullif(trim(coalesce(p_note, '')), '');
  if coalesce(p_fulfilment, 'collect') = 'setup' and address is null then
    perform private.fail('Set-up orders need the customer''s address.');
  end if;
  if length(address) > 300 then
    perform private.fail('Keep the address under 300 characters.');
  end if;
  if length(note) > 300 then
    perform private.fail('Keep the landmark under 300 characters.');
  end if;
end;
$$;

alter table public.orders drop constraint orders_fulfilment_address_check;
alter table public.orders add constraint orders_fulfilment_address_check
  check (fulfilment <> 'setup' or setup_address is not null);

-- The website form sends a landmark as well.
drop function public.submit_website_order(uuid, text, text, timestamptz, text, text, text, jsonb, public.fulfilment_type, text);

create function public.submit_website_order(
  p_idempotency_key uuid, p_name text, p_phone text, p_due_at timestamptz, p_message text,
  p_order_type text default null, p_email text default null, p_items jsonb default '[]'::jsonb,
  p_fulfilment public.fulfilment_type default 'collect', p_setup_address text default null,
  p_setup_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  o public.orders;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[\s()-]', '', 'g'), '');
  v_email text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_message text := nullif(trim(coalesce(p_message, '')), '');
  v_type text;
  items jsonb := coalesce(p_items, '[]'::jsonb);
  fulfil public.fulfilment_type := coalesce(p_fulfilment, 'collect');
  setup record;
  customer uuid;
  blocked boolean;
  item jsonb;
  line integer := 0;
  v record;
  qty integer;
  variant uuid;
  subtotal bigint := 0;
  tax bigint := 0;
  line_total bigint;
  line_tax bigint;
  problem text;
  cap_msg text;
  notes text;
begin
  if p_idempotency_key is null then
    perform private.fail('Something went wrong. Please reload the page and try again.');
  end if;
  select * into o from public.orders where idempotency_key = p_idempotency_key;
  if found then
    if o.source <> 'ONLINE' then
      perform private.fail('Something went wrong. Please reload the page and try again.');
    end if;
    return jsonb_build_object('reference', o.reference, 'due_at', o.due_at);
  end if;

  if v_name is null or length(v_name) > 80 then
    perform private.fail('Please enter your name (up to 80 characters).');
  end if;
  if v_phone is null or v_phone !~ '^\+?[0-9]{10,15}$' then
    perform private.fail('Please enter a valid phone number (10 to 15 digits).');
  end if;
  if v_email is not null and (length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    perform private.fail('Please enter a valid email address, or leave it empty.');
  end if;
  if v_message is null and jsonb_typeof(items) = 'array' and jsonb_array_length(items) = 0 then
    perform private.fail('Please tell us what you would like to order.');
  end if;
  if length(coalesce(v_message, '')) > 800 then
    perform private.fail('Please keep your message under 800 characters.');
  end if;
  v_type := case p_order_type
    when 'birthday' then 'Birthday cake'
    when 'wedding' then 'Wedding cake'
    when 'custom' then 'Custom design'
    when 'macarons' then 'Macaron box'
    when 'pastries' then 'Pastry platter'
    when 'other' then 'Other'
  end;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 10 then
    perform private.fail('An online order can have at most 10 items. Please WhatsApp us for bigger orders.');
  end if;
  select * into setup from private.clean_fulfilment(fulfil, p_setup_address, p_setup_note);

  if p_due_at is null then
    perform private.fail('Please choose a pickup date and time.');
  end if;
  if p_due_at < now() then
    perform private.fail('Please choose a pickup time in the future.');
  end if;
  if p_due_at > now() + interval '180 days' then
    perform private.fail('We take online orders up to 6 months ahead. Please WhatsApp us for later dates.');
  end if;
  problem := private.pickup_slot_problem(p_due_at);
  if problem is not null then
    perform private.fail(problem, 'slot');
  end if;

  -- One website order at a time, so the spam counts below cannot be raced past.
  perform pg_advisory_xact_lock(hashtext('website_order'));
  if (select count(*) from public.orders
      where source = 'ONLINE' and created_at > now() - interval '1 hour') >= 30 then
    perform private.fail('We are receiving a lot of orders right now. Please WhatsApp or call us instead.', 'busy');
  end if;
  if (select count(*) from public.orders
      where source = 'ONLINE' and status = 'pending_confirmation' and customer_phone = v_phone) >= 3 then
    perform private.fail('You already have orders waiting for us to confirm. We will call you soon, or WhatsApp us.', 'busy');
  end if;

  -- A website visitor never renames an existing customer; a missing email is filled in.
  insert into public.customers (full_name, phone, email)
  values (v_name, v_phone, v_email)
  on conflict (phone) where phone is not null
    do update set email = coalesce(public.customers.email, excluded.email)
  returning id, is_blocked into customer, blocked;
  if blocked then
    perform private.fail('We could not take this order online. Please call us to order.', 'blocked');
  end if;

  notes := concat_ws(E'\n',
    'Website order' || coalesce(' — ' || v_type, ''),
    'Email: ' || v_email,
    case when v_message is not null then E'\n' || v_message end);

  insert into public.orders (
    idempotency_key, source, status, customer_id, customer_name, customer_phone,
    is_immediate, requested_due_at, customer_notes, fulfilment, setup_address, setup_note
  ) values (
    p_idempotency_key, 'ONLINE', 'pending_confirmation', customer, v_name, v_phone,
    false, p_due_at, left(notes, 1000), fulfil, setup.address, setup.note
  )
  returning * into o;

  for item in select value from jsonb_array_elements(items)
  loop
    line := line + 1;
    begin
      qty := (item ->> 'quantity')::integer;
      variant := (item ->> 'variant_id')::uuid;
    exception when others then
      perform private.fail('One of the items is not valid. Please reload the page and try again.');
    end;
    if qty is null or qty < 1 or qty > 50 then
      perform private.fail('Please order between 1 and 50 of each item.');
    end if;

    select p.id as product_id, p.name as product_name, p.category_id, p.prep_type, p.is_veg, p.contains_egg, p.allergens,
           p.tax_rate_bps, p.hsn_code, pv.id as variant_id, pv.name as variant_name, pv.price_paise, pv.kitchen_id,
           pv.lead_time_minutes, pv.is_eggless
    into v
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    join public.categories c on c.id = p.category_id
    where pv.id = variant
      and p.archived_at is null and p.is_available and c.is_active
      and pv.archived_at is null and pv.is_available;
    if not found then
      perform private.fail('One of the items is no longer available. Please reload the page and try again.', 'unavailable');
    end if;

    line_total := v.price_paise * qty;
    line_tax := round(line_total * v.tax_rate_bps::numeric / (10000 + v.tax_rate_bps));
    insert into public.order_items (
      order_id, line_no, product_id, variant_id, category_id, product_name, variant_name, prep_type, kitchen_id,
      is_veg, contains_egg, is_eggless, allergens, lead_time_minutes, unit_price_paise, tax_rate_bps,
      hsn_code, quantity, line_total_paise, tax_paise
    ) values (
      o.id, line, v.product_id, v.variant_id, v.category_id, v.product_name, v.variant_name, v.prep_type,
      case when v.prep_type = 'made_to_order' then v.kitchen_id end,
      v.is_veg, v.contains_egg, v.is_eggless, v.allergens, v.lead_time_minutes, v.price_paise, v.tax_rate_bps,
      v.hsn_code, qty, line_total, line_tax
    );
    subtotal := subtotal + line_total;
    tax := tax + line_tax;
  end loop;

  problem := private.lead_time_problem(o.id, p_due_at);
  if problem is not null then
    perform private.fail(problem, 'lead_time');
  end if;
  select c.message into cap_msg from private.capacity_problem(o.id, p_due_at) c;
  if cap_msg is not null then
    perform private.fail('That pickup time is fully booked. Please choose another time, or WhatsApp us.', 'capacity');
  end if;

  update public.orders
  set subtotal_paise = subtotal, total_paise = subtotal, tax_paise = tax
  where id = o.id
  returning * into o;

  perform private.log_order_event(o.id, 'created', null, jsonb_strip_nulls(jsonb_build_object(
    'source', 'ONLINE', 'website', true, 'immediate', false, 'fulfilment', fulfil,
    'setup_address', setup.address, 'setup_note', setup.note)));

  return jsonb_build_object('reference', o.reference, 'due_at', o.due_at);
end;
$$;

revoke all on function public.submit_website_order(uuid, text, text, timestamptz, text, text, text, jsonb, public.fulfilment_type, text, text) from public;
grant execute on function public.submit_website_order(uuid, text, text, timestamptz, text, text, text, jsonb, public.fulfilment_type, text, text)
  to anon, authenticated, service_role;

-- 2. Terms and Conditions sent automatically -----------------------------------------------------------------
create table public.terms_sends (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  sent_by uuid default auth.uid(),
  sent_at timestamptz not null default now(),
  format text not null check (format in ('pdf', 'png')),
  status text not null check (status in ('sent', 'failed')),
  message_id text check (message_id is null or length(message_id) <= 200),
  problem text check (problem is null or length(problem) <= 500),
  check (status <> 'sent' or message_id is not null)
);
create index terms_sends_order_idx on public.terms_sends (order_id, sent_at desc);
alter table public.terms_sends enable row level security;
create policy "Admin and counter read terms sends" on public.terms_sends
  for select to authenticated
  using ((select private.has_role(array['admin', 'counter']::public.staff_role[])));
revoke all on public.terms_sends from anon, authenticated;
grant select on public.terms_sends to authenticated;

create function public.record_terms_send(
  p_order_id uuid, p_format text, p_status text, p_message_id text default null, p_problem text default null)
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
  insert into public.terms_sends (order_id, format, status, message_id, problem)
  values (p_order_id, p_format, p_status, nullif(trim(coalesce(p_message_id, '')), ''),
          left(nullif(trim(coalesce(p_problem, '')), ''), 500))
  returning id into send_id;
  if p_status = 'sent' then
    perform private.log_order_event(p_order_id, 'terms_sent', null, jsonb_build_object('format', p_format));
  end if;
  return send_id;
end;
$$;

revoke all on function public.record_terms_send(uuid, text, text, text, text) from public, anon;
grant execute on function public.record_terms_send(uuid, text, text, text, text) to authenticated, service_role;

-- 3. Private to-do list / diary -------------------------------------------------------------------------------
create table public.diary_entries (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  entry_date date not null default (now() at time zone 'Asia/Kolkata')::date,
  title text not null check (length(trim(title)) between 1 and 200),
  quantity numeric(12, 2) check (quantity is null or (quantity >= 0 and quantity <= 9999999)),
  price_paise bigint check (price_paise is null or (price_paise >= 0 and price_paise <= 100000000000)),
  bill_note text check (bill_note is null or length(bill_note) <= 1000),
  is_done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index diary_entries_staff_date_idx on public.diary_entries (staff_id, entry_date desc, created_at desc);
create trigger diary_entries_set_updated_at before update on public.diary_entries
  for each row execute function private.set_updated_at();
alter table public.diary_entries enable row level security;
create policy "Staff manage their own diary" on public.diary_entries
  for all to authenticated
  using (staff_id = (select auth.uid()))
  with check (staff_id = (select auth.uid())
              and (select private.has_role(array['admin', 'counter']::public.staff_role[])));
revoke all on public.diary_entries from anon, authenticated;
grant select, insert, update, delete on public.diary_entries to authenticated;
