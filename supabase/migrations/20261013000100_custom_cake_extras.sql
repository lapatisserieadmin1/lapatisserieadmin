-- 2026-10-13 (owner): more custom cake details, and set-up and delivery charges.
--
-- 1. custom_cakes gains design, model, fondant (theme stays), cupcakes and popsicles ticks, and the
--    set-up and delivery charges.
-- 2. A charge above zero is its own order line ("Set-up charges", "Delivery charges") at the custom cake
--    GST rate, so totals, bills and balances include it; custom_cakes keeps which line is which.
-- 3. create_custom_cake_order saves the new details and charge lines before confirming; the advance is
--    checked against the whole total. update_custom_cake changes them under the same rules as the price.

-- ---------------------------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------------------------

alter table public.custom_cakes
  add column design text check (design is null or length(design) <= 200),
  add column model text check (model is null or length(model) <= 200),
  add column fondant text check (fondant is null or length(fondant) <= 80),
  add column has_cupcakes boolean not null default false,
  add column has_popsicles boolean not null default false,
  add column setup_charge_paise bigint not null default 0 check (setup_charge_paise between 0 and 100000000),
  add column delivery_charge_paise bigint not null default 0 check (delivery_charge_paise between 0 and 100000000),
  add column setup_charge_item_id uuid references public.order_items (id) on delete set null,
  add column delivery_charge_item_id uuid references public.order_items (id) on delete set null;
create index custom_cakes_setup_charge_item_id_idx on public.custom_cakes (setup_charge_item_id);
create index custom_cakes_delivery_charge_item_id_idx on public.custom_cakes (delivery_charge_item_id);

-- Checks and tidies a cake's details (jsonb keys as in custom_cakes); raises staff-facing messages.
-- Copied from 20261009000200 with design, model, fondant, the ticks and the charges added.
create or replace function private.clean_cake(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  f text := nullif(trim(coalesce(p ->> 'flavour', '')), '');
  w numeric;
  t integer;
  k text;
  charge bigint;
  limits jsonb := '{"theme": 200, "design": 200, "model": 200, "fondant": 80, "cream": 80, "filling": 80, "toppings": 200, "message": 120, "instructions": 1000}';
  label jsonb := '{"theme": "Theme", "design": "Design", "model": "Model", "fondant": "Fondant", "cream": "Cream", "filling": "Filling", "toppings": "Toppings", "message": "Message", "instructions": "Instructions"}';
  charge_label jsonb := '{"setup_charge_paise": "Set-up charges", "delivery_charge_paise": "Delivery charges"}';
  result jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    perform private.fail('Enter the cake details.');
  end if;
  if f is null then
    perform private.fail('Enter the flavour.');
  end if;
  if length(f) > 80 then
    perform private.fail('Keep the flavour under 80 characters.');
  end if;
  begin
    w := (p ->> 'weight_kg')::numeric;
    t := coalesce((p ->> 'tiers')::integer, 1);
  exception when others then
    perform private.fail('Weight and tiers must be numbers.');
  end;
  if w is null or w < 0.25 or w > 50 then
    perform private.fail('Weight must be between 0.25 and 50 kg.');
  end if;
  if t < 1 or t > 10 then
    perform private.fail('Tiers must be between 1 and 10.');
  end if;
  result := jsonb_build_object('flavour', f, 'weight_kg', round(w, 2), 'tiers', t,
    'is_eggless', coalesce((p ->> 'is_eggless')::boolean, false),
    'has_cupcakes', coalesce((p ->> 'has_cupcakes')::boolean, false),
    'has_popsicles', coalesce((p ->> 'has_popsicles')::boolean, false));
  for k in select jsonb_object_keys(limits)
  loop
    if length(trim(coalesce(p ->> k, ''))) > (limits ->> k)::integer then
      perform private.fail(format('%s is too long (at most %s characters).', label ->> k, limits ->> k));
    end if;
    result := result || jsonb_build_object(k, nullif(trim(coalesce(p ->> k, '')), ''));
  end loop;
  for k in select jsonb_object_keys(charge_label)
  loop
    begin
      charge := coalesce((p ->> k)::bigint, 0);
    exception when others then
      charge := -1;
    end;
    if charge < 0 or charge > 100000000 then
      perform private.fail(format('%s must be between ₹0 and ₹10,00,000.', charge_label ->> k));
    end if;
    result := result || jsonb_build_object(k, charge);
  end loop;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Charge lines
-- ---------------------------------------------------------------------------

-- Makes the order's "Set-up charges" and "Delivery charges" lines match the cake's charges: a line is
-- added, re-priced or deleted (no bill exists when this runs). Totals are left to recalc_order_totals.
create function private.sync_cake_charges(p_cake_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  cc public.custom_cakes;
  kind text;
  amount bigint;
  line_id uuid;
  rate integer;
  hsn text;
  next_line integer;
begin
  select * into cc from public.custom_cakes where id = p_cake_id;
  select coalesce(custom_cake_tax_rate_bps, 500), custom_cake_hsn_code into rate, hsn from public.business_settings;
  rate := coalesce(rate, 500);
  foreach kind in array array['setup', 'delivery']
  loop
    amount := case kind when 'setup' then cc.setup_charge_paise else cc.delivery_charge_paise end;
    line_id := case kind when 'setup' then cc.setup_charge_item_id else cc.delivery_charge_item_id end;
    -- A line removed from the order with Edit items (fully cancelled) no longer counts.
    if line_id is not null and not exists (select 1 from public.order_items where id = line_id and quantity > cancelled_quantity) then
      line_id := null;
    end if;
    if amount = 0 then
      if line_id is not null then
        delete from public.order_items where id = line_id;
      end if;
      line_id := null;
    elsif line_id is not null then
      update public.order_items
      set unit_price_paise = amount, line_total_paise = amount * (quantity - cancelled_quantity)
      where id = line_id and unit_price_paise <> amount;
    else
      select coalesce(max(line_no), 0) + 1 into next_line from public.order_items where order_id = cc.order_id;
      insert into public.order_items (
        order_id, line_no, product_name, variant_name, prep_type,
        is_veg, contains_egg, is_eggless, lead_time_minutes, unit_price_paise, tax_rate_bps,
        hsn_code, quantity, line_total_paise, tax_paise
      ) values (
        cc.order_id, next_line, case kind when 'setup' then 'Set-up charges' else 'Delivery charges' end, 'Custom cake',
        'ready_stock', true, false, false, 0, amount, rate,
        hsn, 1, amount, round(amount * rate::numeric / (10000 + rate))
      )
      returning id into line_id;
    end if;
    if kind = 'setup' then
      update public.custom_cakes set setup_charge_item_id = line_id where id = cc.id and setup_charge_item_id is distinct from line_id;
    else
      update public.custom_cakes set delivery_charge_item_id = line_id where id = cc.id and delivery_charge_item_id is distinct from line_id;
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Custom cake orders
-- ---------------------------------------------------------------------------

-- Copied from 20261009000200: the order is created unconfirmed, the new details and charge lines are
-- added, then it is confirmed if asked; the advance is checked against the whole total.
create or replace function public.create_custom_cake_order(
  p_idempotency_key uuid,
  p_source public.order_source,
  p_customer_name text,
  p_customer_phone text,
  p_due_at timestamptz,
  p_price_paise bigint,
  p_cake jsonb,
  p_customer_notes text default null,
  p_internal_notes text default null,
  p_confirm boolean default false,
  p_override_reason text default null,
  p_fulfilment public.fulfilment_type default 'collect',
  p_setup_address text default null,
  p_setup_note text default null,
  p_advance_paise bigint default 0,
  p_advance_method public.payment_method default null,
  p_advance_reference text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  advance bigint := coalesce(p_advance_paise, 0);
  cake jsonb;
  cake_id uuid;
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to create orders.', 'forbidden');
  end if;
  select * into o from public.orders where idempotency_key = p_idempotency_key;
  if found then
    return o;
  end if;

  if p_source not in ('IN_STORE', 'CALL', 'CUSTOMER') then
    perform private.fail('Custom cakes are taken in-store, by call or from the customer.');
  end if;
  if nullif(trim(coalesce(p_customer_name, '')), '') is null or nullif(trim(coalesce(p_customer_phone, '')), '') is null then
    perform private.fail('Custom cakes need the customer''s name and phone number.');
  end if;
  if p_due_at is null then
    perform private.fail('Custom cakes need a pickup date and time.');
  end if;
  if advance < 0 then
    perform private.fail('The advance cannot be negative.');
  end if;
  if advance > 0 and p_advance_method is null then
    perform private.fail('Choose how the advance was paid.');
  end if;
  cake := private.clean_cake(p_cake);

  o := public.create_order(p_idempotency_key, p_source,
    jsonb_build_array(jsonb_build_object('custom_cake', p_cake, 'price_paise', p_price_paise)),
    p_customer_name, p_customer_phone, p_due_at, p_customer_notes, p_internal_notes, false, p_override_reason,
    p_fulfilment, p_setup_address, p_setup_note);

  update public.custom_cakes
  set design = cake ->> 'design', model = cake ->> 'model', fondant = cake ->> 'fondant',
      has_cupcakes = (cake ->> 'has_cupcakes')::boolean, has_popsicles = (cake ->> 'has_popsicles')::boolean,
      setup_charge_paise = (cake ->> 'setup_charge_paise')::bigint,
      delivery_charge_paise = (cake ->> 'delivery_charge_paise')::bigint
  where order_id = o.id
  returning id into cake_id;
  perform private.sync_cake_charges(cake_id);
  perform private.recalc_order_totals(o.id);
  select * into o from public.orders where id = o.id;
  perform private.log_order_event(o.id, 'custom_cake_created', null, jsonb_strip_nulls(jsonb_build_object(
    'price_paise', o.total_paise,
    'setup_charge_paise', nullif((cake ->> 'setup_charge_paise')::bigint, 0),
    'delivery_charge_paise', nullif((cake ->> 'delivery_charge_paise')::bigint, 0))));

  if advance > o.total_paise then
    perform private.fail('The advance is more than the price.');
  end if;
  if p_confirm then
    o := private.confirm_locked(o, nullif(trim(coalesce(p_override_reason, '')), ''));
  end if;

  if advance > 0 then
    perform public.record_payment(o.id, md5(p_idempotency_key::text || ':advance')::uuid, 'payment',
      p_advance_method, advance, p_advance_reference, 'Advance');
    select * into o from public.orders where id = o.id;
  end if;
  return o;
end;
$$;

-- Admin and counter staff, until the order is packed. A price or charge change re-prices the order: not
-- once a bill exists, and only an admin on a confirmed order (as with changing items). Copied from
-- 20261009000200 with the new details and the charges added.
create or replace function public.update_custom_cake(p_order_id uuid, p_expected_version integer, p_cake jsonb, p_price_paise bigint)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  role public.staff_role := private.current_staff_role();
  o public.orders;
  cc public.custom_cakes;
  ln public.order_items;
  cake jsonb := private.clean_cake(p_cake);
  total_before bigint;
begin
  if role is null or role not in ('admin', 'counter') then
    perform private.fail('You do not have permission to change orders.', 'forbidden');
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if o.status = 'ready' then
    perform private.fail('This order is packed. Reopen packing before changing the cake.');
  elsif o.status not in ('draft', 'pending_confirmation', 'confirmed', 'preparing') then
    perform private.fail(format('The cake cannot change on a %s order.', replace(o.status::text, '_', ' ')));
  end if;
  select * into cc from public.custom_cakes where order_id = o.id order by created_at limit 1;
  if not found then
    perform private.fail('This order has no custom cake.', 'not_found');
  end if;
  select * into ln from public.order_items where id = cc.order_item_id;
  if p_price_paise is null or p_price_paise < 100 or p_price_paise > 100000000 then
    perform private.fail('Enter a price between ₹1 and ₹10,00,000.');
  end if;
  if p_price_paise <> ln.unit_price_paise
     or (cake ->> 'setup_charge_paise')::bigint <> cc.setup_charge_paise
     or (cake ->> 'delivery_charge_paise')::bigint <> cc.delivery_charge_paise then
    if exists (select 1 from public.bills where order_id = o.id) then
      perform private.fail('This order already has a bill. Issue a credit note instead.', 'billed');
    end if;
    if o.status in ('confirmed', 'preparing') and role <> 'admin' then
      perform private.fail('Only an admin can change the price or charges of a confirmed order.', 'forbidden');
    end if;
  end if;

  update public.custom_cakes
  set flavour = cake ->> 'flavour', weight_kg = (cake ->> 'weight_kg')::numeric, tiers = (cake ->> 'tiers')::smallint,
      theme = cake ->> 'theme', design = cake ->> 'design', model = cake ->> 'model', fondant = cake ->> 'fondant',
      cream = cake ->> 'cream', filling = cake ->> 'filling', toppings = cake ->> 'toppings',
      message = cake ->> 'message', is_eggless = (cake ->> 'is_eggless')::boolean, instructions = cake ->> 'instructions',
      has_cupcakes = (cake ->> 'has_cupcakes')::boolean, has_popsicles = (cake ->> 'has_popsicles')::boolean,
      setup_charge_paise = (cake ->> 'setup_charge_paise')::bigint,
      delivery_charge_paise = (cake ->> 'delivery_charge_paise')::bigint
  where id = cc.id;
  update public.order_items
  set variant_name = private.cake_size_name((cake ->> 'weight_kg')::numeric, (cake ->> 'tiers')::integer),
      is_eggless = (cake ->> 'is_eggless')::boolean, contains_egg = not (cake ->> 'is_eggless')::boolean,
      unit_price_paise = p_price_paise, line_total_paise = p_price_paise * (quantity - cancelled_quantity)
  where id = ln.id;
  if not exists (select 1 from public.bills where order_id = o.id) then
    perform private.sync_cake_charges(cc.id);
  end if;

  total_before := o.total_paise;
  perform private.recalc_order_totals(o.id);
  update public.orders set version = version + 1 where id = o.id returning * into o;
  perform private.log_order_event(o.id, 'custom_cake_changed', null, jsonb_strip_nulls(jsonb_build_object(
    'total_from', case when o.total_paise <> total_before then total_before end,
    'total_to', case when o.total_paise <> total_before then o.total_paise end)));
  return o;
end;
$$;

revoke execute on function private.sync_cake_charges(uuid) from public, anon, authenticated;
