-- Custom cake orders (2026-10-09). Runs in a transaction and rolls back.
-- Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-000000000ea1','cc-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000ec1','cc-c@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-000000000ea1','Cc Admin','admin'),
 ('00000000-0000-0000-0000-000000000ec1','Cc Counter','counter');

delete from public.capacity_overrides;
delete from public.category_daily_caps;
delete from public.pickup_windows;
delete from public.closures;
update public.business_hours set opens_at = '09:00', closes_at = '21:00', is_closed = false;
update public.business_settings set custom_cake_tax_rate_bps = 500, custom_cake_hsn_code = '1905';

create function pg_temp.day(p_days integer) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Kolkata')::date + p_days) + time '12:00') at time zone 'Asia/Kolkata'
$$;
create function pg_temp.cake() returns jsonb language sql immutable as $$
  select jsonb_build_object('flavour', ' Chocolate truffle ', 'weight_kg', 1.5, 'tiers', 2, 'theme', 'Unicorn',
    'cream', 'Whipped', 'filling', 'Ganache', 'toppings', 'Sprinkles', 'message', 'Happy 5th Birthday Anu',
    'is_eggless', true, 'instructions', 'Less sweet')
$$;
create function pg_temp.order_with(p_key uuid, p_cake jsonb, p_price bigint, p_advance bigint default 0) returns public.orders language sql as $$
  select public.create_custom_cake_order(p_key, 'CUSTOMER', 'Cc Anu', '9000000921', pg_temp.day(3), p_price, p_cake,
    p_advance_paise => p_advance, p_advance_method => case when p_advance > 0 then 'cash'::public.payment_method end)
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000ec1","role":"authenticated"}', true);
do $$
declare o public.orders; o2 public.orders; k uuid := gen_random_uuid(); c public.custom_cakes; i public.order_items;
begin
  o := pg_temp.order_with(k, pg_temp.cake(), 150000, 50000);
  insert into ctx values ('A', o.id::text);
  select * into i from public.order_items where order_id = o.id;
  select * into c from public.custom_cakes where order_id = o.id;
  -- expect: CUSTOMER / pending_confirmation / total 150000 / tax 7143 / Custom cake — 1.5 kg · 2 tiers / 500 / 1905 / eggless true
  insert into r(check_name,outcome) values ('C1 a custom cake order is one line at the staff price',
    o.source || ' / ' || o.status || ' / total ' || o.total_paise || ' / tax ' || o.tax_paise || ' / '
    || i.product_name || ' — ' || i.variant_name || ' / ' || i.tax_rate_bps || ' / ' || i.hsn_code || ' / eggless ' || i.is_eggless);
  -- expect: Chocolate truffle / 1.50 / 2 / Unicorn / Happy 5th Birthday Anu / true
  insert into r(check_name,outcome) values ('C2 the cake details are kept',
    c.flavour || ' / ' || c.weight_kg || ' / ' || c.tiers || ' / ' || c.theme || ' / ' || c.message || ' / ' || c.is_eggless);
  -- expect: 100000 / custom_cake_created
  insert into r(check_name,outcome) values ('C3 the advance is recorded as a payment',
    (select balance_paise from public.order_summaries where id = o.id) || ' / '
    || (select string_agg(event_type, ',') from public.order_events where order_id = o.id and event_type = 'custom_cake_created'));

  o2 := pg_temp.order_with(k, pg_temp.cake(), 150000, 50000);
  -- expect: true / 1
  insert into r(check_name,outcome) values ('C4 the same key returns the same order and records the advance once',
    (o2.id = o.id)::text || ' / ' || (select count(*) from public.payments where order_id = o.id));

  begin perform pg_temp.order_with(gen_random_uuid(), pg_temp.cake(), 150000, 150100);
    insert into r(check_name,outcome) values ('C5 an advance above the price is refused', 'ALLOWED');
  -- expect: The advance is more than the price.
  exception when others then insert into r(check_name,outcome) values ('C5 an advance above the price is refused', sqlerrm); end;

  begin perform pg_temp.order_with(gen_random_uuid(), pg_temp.cake() - 'flavour', 150000);
    insert into r(check_name,outcome) values ('C6 flavour is required', 'ALLOWED');
  -- expect: Enter the flavour.
  exception when others then insert into r(check_name,outcome) values ('C6 flavour is required', sqlerrm); end;

  begin perform pg_temp.order_with(gen_random_uuid(), pg_temp.cake() || '{"weight_kg": 0}', 150000);
    insert into r(check_name,outcome) values ('C7 weight must be sensible', 'ALLOWED');
  -- expect: Weight must be between 0.25 and 50 kg.
  exception when others then insert into r(check_name,outcome) values ('C7 weight must be sensible', sqlerrm); end;

  begin perform pg_temp.order_with(gen_random_uuid(), pg_temp.cake(), 0);
    insert into r(check_name,outcome) values ('C8 the price is required', 'ALLOWED');
  -- expect: Enter a price between ₹1 and ₹10,00,000.
  exception when others then insert into r(check_name,outcome) values ('C8 the price is required', sqlerrm); end;

  begin perform public.create_custom_cake_order(gen_random_uuid(), 'IN_STORE', 'Cc Walk', '9000000922', null, 100000, pg_temp.cake());
    insert into r(check_name,outcome) values ('C9 a custom cake needs a pickup time', 'ALLOWED');
  -- expect: Custom cakes need a pickup date and time.
  exception when others then insert into r(check_name,outcome) values ('C9 a custom cake needs a pickup time', sqlerrm); end;

  o := public.update_custom_cake(o.id, o.version, pg_temp.cake() || '{"flavour": "Black forest"}', 180000);
  -- expect: 180000 / 8571 / Black forest / custom_cake_changed
  insert into r(check_name,outcome) values ('C10 changing the price re-prices the order',
    o.total_paise || ' / ' || o.tax_paise || ' / ' || (select flavour from public.custom_cakes where order_id = o.id) || ' / '
    || (select string_agg(event_type, ',') from public.order_events where order_id = o.id and event_type = 'custom_cake_changed'));

  begin perform public.update_order_items(o.id, o.version,
      jsonb_build_array(jsonb_build_object('line_id', (select id from public.order_items where order_id = o.id), 'quantity', 2)));
    insert into r(check_name,outcome) values ('C11 a custom cake line cannot be multiplied', 'ALLOWED');
  -- expect: Custom cake — 1.5 kg · 2 tiers is not available, so its quantity cannot be increased.
  exception when others then insert into r(check_name,outcome) values ('C11 a custom cake line cannot be multiplied', sqlerrm); end;

  -- expect: 1
  insert into r(check_name,outcome) values ('C12 counter staff can read custom cakes', (select count(*) from public.custom_cakes)::text);

  o := public.create_custom_cake_order_with_advance_date(
    gen_random_uuid(), 'CUSTOMER', 'Cc Dated', '9000000929', pg_temp.day(3), 100000, pg_temp.cake(),
    p_advance_paise => 25000, p_advance_method => 'upi', p_advance_reference => 'UTR-DATED',
    p_advance_paid_at => pg_temp.day(-2));
  -- expect: true / UTR-DATED / 25000
  insert into r(check_name,outcome) values ('C23 initial advance keeps its payment date and reference',
    (select (paid_at = pg_temp.day(-2))::text || ' / ' || reference || ' / ' || amount_paise
     from public.payments where order_id = o.id));
end $$;

-- Admin confirms and packs; then the cake cannot change.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000ea1","role":"authenticated"}', true);
do $$
declare o public.orders; a uuid := (select v::uuid from ctx where k = 'A');
begin
  o := public.confirm_order(a, (select version from public.orders where id = a));
  o := public.mark_packed(a, o.version);
  begin perform public.update_custom_cake(a, o.version, pg_temp.cake(), 150000);
    insert into r(check_name,outcome) values ('C13 a packed cake cannot change', 'ALLOWED');
  -- expect: This order is packed. Reopen packing before changing the cake.
  exception when others then insert into r(check_name,outcome) values ('C13 a packed cake cannot change', sqlerrm); end;
end $$;

-- The GST rate comes from Shop Settings.
reset role;
update public.business_settings set custom_cake_tax_rate_bps = 1800;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000ea1","role":"authenticated"}', true);
do $$
declare o public.orders;
begin
  o := pg_temp.order_with(gen_random_uuid(), pg_temp.cake(), 118000);
  -- expect: 1800 / 18000
  insert into r(check_name,outcome) values ('C14 a new custom cake uses the settings rate',
    (select tax_rate_bps from public.order_items where order_id = o.id) || ' / ' || o.tax_paise);
end $$;

-- 2026-10-13: design, model, fondant, cupcakes and popsicles, set-up and delivery charges.
reset role;
update public.business_settings set custom_cake_tax_rate_bps = 500;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000ea1","role":"authenticated"}', true);
do $$
declare o public.orders; c public.custom_cakes;
  extras jsonb := '{"design": "Gold drip", "model": "Doll cake", "fondant": " Full fondant ", "has_cupcakes": true,
    "has_popsicles": false, "setup_charge_paise": 50000, "delivery_charge_paise": 20000}';
begin
  o := pg_temp.order_with(gen_random_uuid(), pg_temp.cake() || extras, 150000, 210000);
  select * into c from public.custom_cakes where order_id = o.id;
  -- expect: Gold drip / Doll cake / Full fondant / true / false / 50000 / 20000
  insert into r(check_name,outcome) values ('C15 the new cake details are kept',
    c.design || ' / ' || c.model || ' / ' || c.fondant || ' / ' || c.has_cupcakes || ' / ' || c.has_popsicles
    || ' / ' || c.setup_charge_paise || ' / ' || c.delivery_charge_paise);
  -- expect: 220000 / 10476 / 10000 / Custom cake=150000,Set-up charges=50000,Delivery charges=20000 / true
  insert into r(check_name,outcome) values ('C16 charges are their own lines in the total, and the advance can cover them',
    o.total_paise || ' / ' || o.tax_paise || ' / ' || (select balance_paise from public.order_summaries where id = o.id) || ' / '
    || (select string_agg(product_name || '=' || line_total_paise, ',' order by line_no) from public.order_items where order_id = o.id)
    || ' / ' || (c.setup_charge_item_id is not null and c.delivery_charge_item_id is not null));

  o := public.update_custom_cake(o.id, o.version, pg_temp.cake() || extras || '{"setup_charge_paise": 0, "delivery_charge_paise": 30000}', 150000);
  select * into c from public.custom_cakes where order_id = o.id;
  -- expect: 180000 / Custom cake=150000,Delivery charges=30000 / true
  insert into r(check_name,outcome) values ('C17 changing the charges removes or re-prices their lines',
    o.total_paise || ' / '
    || (select string_agg(product_name || '=' || line_total_paise, ',' order by line_no) from public.order_items where order_id = o.id)
    || ' / ' || (c.setup_charge_item_id is null));

  o := public.update_custom_cake(o.id, o.version, pg_temp.cake() || extras, 150000);
  -- expect: 220000 / 3
  insert into r(check_name,outcome) values ('C18 a charge put back adds its line again',
    o.total_paise || ' / ' || (select count(*) from public.order_items where order_id = o.id));

  begin perform pg_temp.order_with(gen_random_uuid(), pg_temp.cake() || extras, 150000, 220100);
    insert into r(check_name,outcome) values ('C19 an advance above the whole total is refused', 'ALLOWED');
  -- expect: The advance is more than the price.
  exception when others then insert into r(check_name,outcome) values ('C19 an advance above the whole total is refused', sqlerrm); end;

  begin perform pg_temp.order_with(gen_random_uuid(), pg_temp.cake() || '{"delivery_charge_paise": -5}', 150000);
    insert into r(check_name,outcome) values ('C20 charges cannot be negative', 'ALLOWED');
  -- expect: Delivery charges must be between ₹0 and ₹10,00,000.
  exception when others then insert into r(check_name,outcome) values ('C20 charges cannot be negative', sqlerrm); end;

  o := public.confirm_order(o.id, o.version);
  insert into ctx values ('X', o.id::text);
end $$;

-- Counter staff can change a confirmed cake's details but not its charges.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000ec1","role":"authenticated"}', true);
do $$
declare o public.orders; x uuid := (select v::uuid from ctx where k = 'X');
  extras jsonb := '{"design": "Gold drip", "model": "Doll cake", "fondant": "Full fondant", "has_cupcakes": true,
    "setup_charge_paise": 50000, "delivery_charge_paise": 20000}';
begin
  o := public.update_custom_cake(x, (select version from public.orders where id = x), pg_temp.cake() || extras || '{"fondant": "Semi fondant"}', 150000);
  -- expect: Semi fondant / 220000
  insert into r(check_name,outcome) values ('C21 counter staff change the details of a confirmed cake',
    (select fondant from public.custom_cakes where order_id = x) || ' / ' || o.total_paise);
  begin perform public.update_custom_cake(x, o.version, pg_temp.cake() || extras || '{"delivery_charge_paise": 0}', 150000);
    insert into r(check_name,outcome) values ('C22 only an admin changes a confirmed cake''s charges', 'ALLOWED');
  -- expect: Only an admin can change the price or charges of a confirmed order.
  exception when others then insert into r(check_name,outcome) values ('C22 only an admin changes a confirmed cake''s charges', sqlerrm); end;
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
