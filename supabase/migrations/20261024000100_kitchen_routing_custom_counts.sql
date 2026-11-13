-- Owner, 2026-10-24.
--
-- 1. Products no longer have a food type (veg / non-veg). products.is_veg and the order_items snapshot
--    become nullable with no default, so existing rows keep their value and new rows carry none; the
--    website catalogue stops sending it.
-- 2. Custom cakes: cupcakes and popsicles are counts (0 = none) instead of ticks. has_cupcakes and
--    has_popsicles stay, kept equal to count > 0. Toppings and filling leave the form; values already
--    saved are kept and still shown, and changing a cake no longer clears them.
-- 3. Every order belongs to one kitchen (orders.kitchen_id): custom cake orders to Kitchen 1 (code K1),
--    all other orders (website and catalogue orders) to Kitchen 2 (code K2). Set by triggers, so every
--    way an order is created is covered; existing orders are filled in.
-- 4. Chefs see only orders of their own kitchen: chef_work, cake photos and (next migration) the
--    price-free quotation filter on orders.kitchen_id. Lines with no kitchen are no longer shown to every
--    chef. A chef login belongs to exactly one kitchen.
-- order_summaries is recreated for the new orders columns in 20261024000200.

-- ---------------------------------------------------------------------------
-- 1. No food type
-- ---------------------------------------------------------------------------

alter table public.products alter column is_veg drop not null, alter column is_veg drop default;
alter table public.order_items alter column is_veg drop not null;

-- Copied from 20261016000100 without is_veg.
create or replace function public.website_catalogue()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(p.item order by p.cat_sort, p.cat_name, p.name), '[]'::jsonb)
  from (
    select c.sort_order as cat_sort, c.name as cat_name, pr.name,
      jsonb_build_object(
        'id', pr.id,
        'name', pr.name,
        'description', pr.description,
        'image_url', pr.image_url,
        'category', c.name,
        'contains_egg', pr.contains_egg,
        'from_paise', min(v.price_paise),
        'variants', jsonb_agg(jsonb_build_object(
          'id', v.id, 'name', v.name, 'price_paise', v.price_paise, 'is_eggless', v.is_eggless
        ) order by v.sort_order, v.price_paise, v.name)
      ) as item
    from public.products pr
    join public.categories c on c.id = pr.category_id
    join public.product_variants v on v.product_id = pr.id
    where pr.archived_at is null and pr.is_available
      and c.is_active
      and v.archived_at is null and v.is_available
    group by pr.id, c.id
  ) p
$$;

-- ---------------------------------------------------------------------------
-- 2. Cupcake and popsicle counts
-- ---------------------------------------------------------------------------

alter table public.custom_cakes
  add column cupcake_count integer not null default 0 check (cupcake_count between 0 and 999),
  add column popsicle_count integer not null default 0 check (popsicle_count between 0 and 999);
-- A tick had no count; 1 keeps "included" true until staff enter the real number.
update public.custom_cakes set cupcake_count = 1 where has_cupcakes;
update public.custom_cakes set popsicle_count = 1 where has_popsicles;

-- Copied from 20261013000100 with the counts added. A caller that still sends only a tick
-- (has_cupcakes: true) gets a count of 1.
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
  limits jsonb := '{"theme": 200, "design": 200, "model": 200, "fondant": 80, "cream": 80, "filling": 80, "toppings": 200, "message": 120, "instructions": 1000}';
  label jsonb := '{"theme": "Theme", "design": "Design", "model": "Model", "fondant": "Fondant", "cream": "Cream", "filling": "Filling", "toppings": "Toppings", "message": "Message", "instructions": "Instructions"}';
  charge_label jsonb := '{"setup_charge_paise": "Set-up charges", "delivery_charge_paise": "Delivery charges"}';
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

-- Copied from 20261013000100; the counts are saved with the other extras.
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

-- Copied from 20261013000100: the counts are saved; filling and toppings are no longer on the form, so
-- the values already saved are kept rather than cleared.
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
      cream = cake ->> 'cream', message = cake ->> 'message', is_eggless = (cake ->> 'is_eggless')::boolean,
      instructions = cake ->> 'instructions',
      has_cupcakes = (cake ->> 'has_cupcakes')::boolean, has_popsicles = (cake ->> 'has_popsicles')::boolean,
      cupcake_count = (cake ->> 'cupcake_count')::integer, popsicle_count = (cake ->> 'popsicle_count')::integer,
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

-- ---------------------------------------------------------------------------
-- 3. One kitchen per order
-- ---------------------------------------------------------------------------

alter table public.orders add column kitchen_id uuid references public.kitchens (id) on delete restrict;
create index orders_kitchen_id_idx on public.orders (kitchen_id);

create function private.kitchen_by_code(p_code text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.kitchens where code = p_code
$$;

-- New orders start in Kitchen 2 (web and catalogue orders).
create function private.route_new_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kitchen_id is null then
    new.kitchen_id := private.kitchen_by_code('K2');
  end if;
  return new;
end;
$$;
create trigger orders_route_kitchen before insert on public.orders
  for each row execute function private.route_new_order();

-- An order with a custom cake is a custom order: Kitchen 1.
create function private.route_custom_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k1 uuid := private.kitchen_by_code('K1');
begin
  update public.orders set kitchen_id = k1 where id = new.order_id and kitchen_id is distinct from k1;
  return null;
end;
$$;
create trigger custom_cakes_route_kitchen after insert on public.custom_cakes
  for each row execute function private.route_custom_order();

-- Existing orders, without touching their updated_at.
alter table public.orders disable trigger orders_updated_at;
update public.orders o set kitchen_id = private.kitchen_by_code('K1')
where exists (select 1 from public.custom_cakes cc where cc.order_id = o.id);
update public.orders set kitchen_id = private.kitchen_by_code('K2') where kitchen_id is null;
alter table public.orders enable trigger orders_updated_at;

-- ---------------------------------------------------------------------------
-- 4. Chefs see only their own kitchen's orders
-- ---------------------------------------------------------------------------

-- Admin and counter staff see every kitchen; a chef only the kitchen assigned to them. No kitchen: nobody
-- but admin and counter staff.
create or replace function private.chef_sees_kitchen(p_kitchen_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_staff_role() in ('admin', 'counter'), false)
    or (private.current_staff_role() = 'chef'
        and p_kitchen_id is not null
        and exists (select 1 from public.staff_kitchens sk
                    where sk.user_id = (select auth.uid()) and sk.kitchen_id = p_kitchen_id))
$$;

-- Copied from 20261021000100; the order's kitchen decides.
create or replace function private.chef_sees_cake_photo(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.current_staff_role() = 'chef' and exists (
    select 1
    from public.custom_cakes cc
    join public.orders o on o.id = cc.order_id
    where p_path = any (cc.photo_paths)
      and (o.status in ('confirmed', 'preparing', 'ready') or (o.status = 'cancelled' and o.confirmed_at is not null))
      and private.chef_sees_kitchen(o.kitchen_id))
$$;

-- Copied from 20261021000100: rows of the chef's own kitchen only (the order's kitchen), no food type, and
-- the cupcake and popsicle counts in place of the ticks.
drop function public.chef_work(date, date);
create function public.chef_work(p_from date, p_to date)
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
revoke execute on function public.chef_work(date, date) from public, anon;
grant execute on function public.chef_work(date, date) to authenticated;

-- A chef login belongs to one kitchen, so the two kitchens stay apart.
create function private.guard_chef_one_kitchen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select role from public.staff_profiles where user_id = new.user_id) = 'chef'
     and exists (select 1 from public.staff_kitchens where user_id = new.user_id and kitchen_id <> new.kitchen_id) then
    raise exception 'A kitchen login belongs to one kitchen only.';
  end if;
  return new;
end;
$$;
create trigger staff_kitchens_one_kitchen_per_chef before insert on public.staff_kitchens
  for each row execute function private.guard_chef_one_kitchen();

revoke execute on function private.kitchen_by_code(text), private.route_new_order(), private.route_custom_order(),
  private.guard_chef_one_kitchen() from public, anon, authenticated;
