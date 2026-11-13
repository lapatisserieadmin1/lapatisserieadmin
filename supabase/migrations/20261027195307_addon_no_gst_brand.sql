-- La Patisserie Madras changes (owner, 2026-10-28):
--   1. An optional add-on on a custom cake: details for the kitchen and an amount, billed as its own
--      "Add-on" line like the set-up and delivery charges, so it is in the total, advance and balance.
--   2. No GST: product and custom cake rates become 0 (prices were already GST-inclusive, so totals do
--      not change). The tax columns stay, at 0, so old bills and reports still read.
--   3. The shop's name and address.
-- Nothing is deleted.

-- ---------------------------------------------------------------------------
-- 1. Add-on
-- ---------------------------------------------------------------------------

alter table public.custom_cakes
  add column addon_details text check (char_length(addon_details) <= 500),
  add column addon_charge_paise bigint not null default 0 check (addon_charge_paise between 0 and 100000000),
  add column addon_charge_item_id uuid references public.order_items (id) on delete set null;
create index custom_cakes_addon_charge_item_id_idx on public.custom_cakes (addon_charge_item_id);

-- Copied from 20261024000100 with addon_details (text) and addon_charge_paise (charge) added.
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
  n integer;
  limits jsonb := '{"theme": 200, "design": 200, "model": 200, "fondant": 80, "cream": 80, "filling": 80, "toppings": 200, "message": 120, "instructions": 1000, "addon_details": 500}';
  label jsonb := '{"theme": "Theme", "design": "Colour", "model": "Model", "fondant": "Fondant", "cream": "Cream", "filling": "Filling", "toppings": "Toppings", "message": "Message", "instructions": "Instructions", "addon_details": "Add-on details"}';
  charge_label jsonb := '{"setup_charge_paise": "Set-up charges", "delivery_charge_paise": "Delivery charges", "addon_charge_paise": "Add-on amount"}';
  count_label jsonb := '{"cupcake_count": "Cupcakes", "popsicle_count": "Popsicles"}';
  count_tick jsonb := '{"cupcake_count": "has_cupcakes", "popsicle_count": "has_popsicles"}';
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
    'is_eggless', coalesce((p ->> 'is_eggless')::boolean, false));
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
  for k in select jsonb_object_keys(count_label)
  loop
    begin
      n := (p ->> k)::integer;
    exception when others then
      n := -1;
    end;
    if n is null then
      n := case when coalesce((p ->> (count_tick ->> k))::boolean, false) then 1 else 0 end;
    end if;
    if n < 0 or n > 999 then
      perform private.fail(format('%s must be a whole number from 0 to 999.', count_label ->> k));
    end if;
    result := result || jsonb_build_object(k, n, count_tick ->> k, n > 0);
  end loop;
  return result;
end;
$$;

-- Copied from 20261013000100 with the add-on line added.
create or replace function private.sync_cake_charges(p_cake_id uuid)
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
  select coalesce(custom_cake_tax_rate_bps, 0), custom_cake_hsn_code into rate, hsn from public.business_settings;
  rate := coalesce(rate, 0);
  foreach kind in array array['setup', 'delivery', 'addon']
  loop
    amount := case kind when 'setup' then cc.setup_charge_paise when 'delivery' then cc.delivery_charge_paise else cc.addon_charge_paise end;
    line_id := case kind when 'setup' then cc.setup_charge_item_id when 'delivery' then cc.delivery_charge_item_id else cc.addon_charge_item_id end;
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
        cc.order_id, next_line,
        case kind when 'setup' then 'Set-up charges' when 'delivery' then 'Delivery charges' else 'Add-on' end, 'Custom cake',
        'ready_stock', true, false, false, 0, amount, rate,
        hsn, 1, amount, round(amount * rate::numeric / (10000 + rate))
      )
      returning id into line_id;
    end if;
    if kind = 'setup' then
      update public.custom_cakes set setup_charge_item_id = line_id where id = cc.id and setup_charge_item_id is distinct from line_id;
    elsif kind = 'delivery' then
      update public.custom_cakes set delivery_charge_item_id = line_id where id = cc.id and delivery_charge_item_id is distinct from line_id;
    else
      update public.custom_cakes set addon_charge_item_id = line_id where id = cc.id and addon_charge_item_id is distinct from line_id;
    end if;
  end loop;
end;
$$;

-- Copied from 20261024000100; the add-on is saved with the other extras.
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
      cupcake_count = (cake ->> 'cupcake_count')::integer, popsicle_count = (cake ->> 'popsicle_count')::integer,
      setup_charge_paise = (cake ->> 'setup_charge_paise')::bigint,
      delivery_charge_paise = (cake ->> 'delivery_charge_paise')::bigint,
      addon_details = cake ->> 'addon_details',
      addon_charge_paise = (cake ->> 'addon_charge_paise')::bigint
  where order_id = o.id
  returning id into cake_id;
  perform private.sync_cake_charges(cake_id);
  perform private.recalc_order_totals(o.id);
  select * into o from public.orders where id = o.id;
  perform private.log_order_event(o.id, 'custom_cake_created', null, jsonb_strip_nulls(jsonb_build_object(
    'price_paise', o.total_paise,
    'setup_charge_paise', nullif((cake ->> 'setup_charge_paise')::bigint, 0),
    'delivery_charge_paise', nullif((cake ->> 'delivery_charge_paise')::bigint, 0),
    'addon_charge_paise', nullif((cake ->> 'addon_charge_paise')::bigint, 0))));

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

-- Copied from 20261024000100; the add-on is saved, and changing its amount follows the charge rules.
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
     or (cake ->> 'delivery_charge_paise')::bigint <> cc.delivery_charge_paise
     or (cake ->> 'addon_charge_paise')::bigint <> cc.addon_charge_paise then
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
      cream = cake ->> 'cream', message = cake ->> 'message', is_eggless = (cake ->> 'is_eggless')::boolean,
      instructions = cake ->> 'instructions',
      has_cupcakes = (cake ->> 'has_cupcakes')::boolean, has_popsicles = (cake ->> 'has_popsicles')::boolean,
      cupcake_count = (cake ->> 'cupcake_count')::integer, popsicle_count = (cake ->> 'popsicle_count')::integer,
      setup_charge_paise = (cake ->> 'setup_charge_paise')::bigint,
      delivery_charge_paise = (cake ->> 'delivery_charge_paise')::bigint,
      addon_details = cake ->> 'addon_details',
      addon_charge_paise = (cake ->> 'addon_charge_paise')::bigint
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

-- Copied from 20261024000200: the add-on line is kind 'addon', and the cake carries its details (never
-- its amount, which is a priced line and so absent from the kitchen version).
create or replace function public.order_quotation(p_order_id uuid)
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
                          when oi.id = cc.addon_charge_item_id then 'addon'
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
      'cupcake_count', cc.cupcake_count, 'popsicle_count', cc.popsicle_count, 'instructions', cc.instructions,
      'addon_details', cc.addon_details));
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

-- Copied from 20261024000100: the kitchen sees the add-on details (never an amount).
create or replace function public.chef_work(p_from date, p_to date)
returns table (
  order_id uuid,
  reference text,
  status public.order_status,
  due_at timestamptz,
  is_immediate boolean,
  fulfilment public.fulfilment_type,
  item_id uuid,
  line_no integer,
  product_name text,
  variant_name text,
  quantity integer,
  is_eggless boolean,
  notes text,
  kitchen_id uuid,
  kitchen_name text,
  image_url text,
  cake jsonb,
  customer_name text,
  customer_phone text,
  customer_notes text,
  setup_address text,
  setup_note text,
  source public.order_source
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.current_staff_role() is null then
    perform private.fail('You do not have access to the kitchen screen.', 'forbidden');
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    perform private.fail('Choose up to two months of dates.');
  end if;

  return query
  select o.id, o.reference, o.status, o.due_at, o.is_immediate, o.fulfilment,
         oi.id, oi.line_no, oi.product_name, oi.variant_name,
         -- A cancelled order keeps its quantities so the kitchen can see what to stop.
         case when o.status = 'cancelled' then oi.quantity else oi.quantity - oi.cancelled_quantity end,
         oi.is_eggless, oi.notes, o.kitchen_id, k.name, p.image_url,
         case when cc.id is null then null else jsonb_strip_nulls(jsonb_build_object(
           'flavour', cc.flavour, 'weight_kg', cc.weight_kg, 'tiers', cc.tiers, 'theme', cc.theme,
           'design', cc.design, 'model', cc.model, 'fondant', cc.fondant, 'cream', cc.cream,
           'filling', cc.filling, 'toppings', cc.toppings, 'message', cc.message, 'is_eggless', cc.is_eggless,
           'cupcake_count', cc.cupcake_count, 'popsicle_count', cc.popsicle_count, 'instructions', cc.instructions,
           'addon_details', cc.addon_details,
           'photo_paths', to_jsonb(cc.photo_paths))) end,
         coalesce(o.customer_name, c.full_name), coalesce(o.customer_phone, c.phone),
         o.customer_notes, o.setup_address, o.setup_note, o.source
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  left join public.customers c on c.id = o.customer_id
  left join public.kitchens k on k.id = o.kitchen_id
  left join public.products p on p.id = oi.product_id
  left join public.custom_cakes cc on cc.order_item_id = oi.id
  where (o.status in ('confirmed', 'preparing', 'ready')
         or (o.status = 'cancelled' and o.confirmed_at is not null))
    and (o.due_at at time zone private.business_timezone())::date between p_from and p_to
    and oi.prep_type = 'made_to_order'
    and (o.status = 'cancelled' or oi.quantity > oi.cancelled_quantity)
    and private.chef_sees_kitchen(o.kitchen_id)
  order by o.due_at, o.order_number, oi.line_no;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. No GST
-- ---------------------------------------------------------------------------

update public.products set tax_rate_bps = 0 where tax_rate_bps <> 0;
alter table public.business_settings alter column custom_cake_tax_rate_bps set default 0;
update public.business_settings set custom_cake_tax_rate_bps = 0 where custom_cake_tax_rate_bps <> 0;

-- ---------------------------------------------------------------------------
-- 3. Name and address
-- ---------------------------------------------------------------------------

alter table public.business_settings alter column business_name set default 'La Patisserie Madras';
update public.business_settings
set business_name = 'La Patisserie Madras',
    address = 'Bharath Nagar Extn, 7, Water Canal Rd, near Alliance Orchid Springs Apartment, Korattur, Chennai, Tamil Nadu 600099';
