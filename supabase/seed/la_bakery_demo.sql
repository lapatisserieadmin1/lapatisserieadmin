-- Demo data for the la-bakery dev project (2026-10-24), made through the app's own functions so totals,
-- payments, bills and timelines are consistent. Replaces demo_data.sql there, which needs the retired
-- kitchen tickets and the old @auri.test logins. Times are relative to when it runs (business time zone).
--
-- Orders are marked like demo_data.sql (internal_notes = 'DEMO DATA', counter sales named 'Demo walk-in').
-- Products are the shop's starting catalogue, so their descriptions are what customers read on the website:
-- no marker. Their photos are in supabase/seed/product-photos (credits: web/public/site/photo-credits.html);
-- upload them to the product-photos bucket as an admin and set them with set_product_image.
--
-- Needs the staff logins demo-admin@lapatisserie.test and counter@auri.test, and kitchens
-- K1 and K2. Run as a superuser (Supabase SQL editor or MCP execute_sql). Refuses to run twice.
begin;

do $$ begin
  if exists (select 1 from public.orders where internal_notes = 'DEMO DATA') then
    raise exception 'Demo data is already loaded. Run remove_demo_data.sql first.';
  end if;
  if not exists (select 1 from auth.users where email = 'demo-admin@lapatisserie.test')
     or not exists (select 1 from auth.users where email = 'counter@auri.test') then
    raise exception 'The demo admin and demo counter logins must exist first.';
  end if;
end $$;

create temp table seed (k text primary key, v text) on commit drop;
grant all on seed to authenticated, anon;
insert into seed select 'admin', id::text from auth.users where email = 'demo-admin@lapatisserie.test';
insert into seed select 'counter', id::text from auth.users where email = 'counter@auri.test';
insert into seed select 'K1', id::text from public.kitchens where code = 'K1';
insert into seed select 'K2', id::text from public.kitchens where code = 'K2';
insert into seed values ('tz', private.business_timezone());

-- The shop as it appears on quotations and bills.
update public.business_settings
set business_name = 'La Patisserie', phone = '+91 98848 82516', email = 'lapatisseriemadras@gmail.com',
    address = '7, Water Canal Rd, Venkateswara Nagar, Korattur, Chennai, Tamil Nadu 600076';
-- The hours printed on the website.
update public.business_hours set opens_at = '10:00', closes_at = '20:00', is_closed = false;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
insert into public.categories (name, default_kitchen_id, sort_order) values
  ('Cakes', (select v::uuid from seed where k = 'K2'), 1),
  ('Pastries', null, 2),
  ('Breads', (select v::uuid from seed where k = 'K2'), 3),
  ('Cookies', (select v::uuid from seed where k = 'K2'), 4),
  ('Savouries', null, 5)
on conflict (name) do nothing;

create function pg_temp.product(p_cat text, p_name text, p_prep text, p_egg boolean, p_allergens text[],
  p_hsn text, p_tax integer, p_desc text) returns uuid language sql as $$
  insert into public.products (category_id, name, description, prep_type, is_veg, contains_egg, allergens, hsn_code, tax_rate_bps)
  select id, p_name, p_desc, p_prep::public.prep_type, null, p_egg, p_allergens, p_hsn, p_tax
  from public.categories where name = p_cat
  returning id
$$;
create function pg_temp.variant(p_product uuid, p_name text, p_price bigint, p_lead integer, p_eggless boolean, p_sort integer)
returns void language sql as $$
  insert into public.product_variants (product_id, name, price_paise, kitchen_id, lead_time_minutes, is_eggless, sort_order)
  select p_product, p_name, p_price, case when p.prep_type = 'made_to_order' then (select v::uuid from seed where k = 'K2') end,
         p_lead, p_eggless, p_sort
  from public.products p where p.id = p_product
$$;

do $$
declare p uuid;
begin
  p := pg_temp.product('Cakes', 'Chocolate Truffle Cake', 'made_to_order', true, '{milk,gluten}', '19059090', 1800, 'Dark chocolate ganache layers.');
  perform pg_temp.variant(p, '500 g', 65000, 240, false, 1);
  perform pg_temp.variant(p, '1 kg', 120000, 240, false, 2);
  perform pg_temp.variant(p, '1 kg Eggless', 130000, 240, true, 3);
  p := pg_temp.product('Cakes', 'Black Forest Cake', 'made_to_order', true, '{milk,gluten}', '19059090', 1800, 'Cherries and whipped cream.');
  perform pg_temp.variant(p, '500 g', 60000, 240, false, 1);
  perform pg_temp.variant(p, '1 kg', 110000, 240, false, 2);
  p := pg_temp.product('Cakes', 'Red Velvet Cake', 'made_to_order', true, '{milk,gluten}', '19059090', 1800, 'Cream cheese frosting.');
  perform pg_temp.variant(p, '1 kg', 140000, 360, false, 1);
  p := pg_temp.product('Cakes', 'Fresh Fruit Gateau', 'made_to_order', false, '{milk,gluten}', '19059090', 1800, 'Seasonal fruit, eggless.');
  perform pg_temp.variant(p, '1 kg Eggless', 135000, 240, true, 1);
  p := pg_temp.product('Cakes', 'Rasmalai Cake', 'made_to_order', false, '{milk,gluten,nuts}', '19059090', 1800, 'Saffron milk sponge, pistachio.');
  perform pg_temp.variant(p, '1 kg Eggless', 150000, 360, true, 1);

  p := pg_temp.product('Pastries', 'Blueberry Cheesecake Slice', 'ready_stock', true, '{milk,gluten}', '19059090', 1800, 'Baked cheesecake.');
  perform pg_temp.variant(p, 'Slice', 22000, 0, false, 1);
  p := pg_temp.product('Pastries', 'Chocolate Éclair', 'ready_stock', true, '{milk,gluten}', '19059090', 1800, 'Choux with chocolate glaze.');
  perform pg_temp.variant(p, 'Each', 9000, 0, false, 1);
  p := pg_temp.product('Pastries', 'Butter Croissant', 'ready_stock', false, '{milk,gluten}', '19059090', 1800, 'Laminated butter dough.');
  perform pg_temp.variant(p, 'Each', 12000, 0, false, 1);
  p := pg_temp.product('Pastries', 'French Macarons', 'ready_stock', true, '{milk,nuts}', '19059090', 1800, 'Rose, pistachio, salted caramel.');
  perform pg_temp.variant(p, 'Box of 6', 48000, 0, false, 1);

  p := pg_temp.product('Breads', 'Sourdough Loaf', 'made_to_order', false, '{gluten}', '19059010', 500, 'Slow-fermented, 18 hours.');
  perform pg_temp.variant(p, '400 g', 28000, 720, false, 1);
  p := pg_temp.product('Breads', 'Multigrain Bread', 'made_to_order', false, '{gluten,sesame}', '19059010', 500, 'Seeds and whole wheat.');
  perform pg_temp.variant(p, '400 g', 12000, 180, false, 1);
  p := pg_temp.product('Breads', 'Garlic Focaccia', 'made_to_order', false, '{gluten}', '19059010', 500, 'Olive oil and roasted garlic.');
  perform pg_temp.variant(p, 'Tray', 22000, 180, false, 1);

  p := pg_temp.product('Cookies', 'Butter Cookies', 'made_to_order', false, '{milk,gluten}', '19053100', 1800, 'Classic Danish-style.');
  perform pg_temp.variant(p, '250 g box', 32000, 120, false, 1);
  p := pg_temp.product('Cookies', 'Choco Chip Cookies', 'ready_stock', true, '{milk,gluten}', '19053100', 1800, 'Box of six.');
  perform pg_temp.variant(p, 'Box of 6', 24000, 0, false, 1);

  p := pg_temp.product('Savouries', 'Veg Puff', 'ready_stock', false, '{gluten}', '19059090', 500, 'Spiced vegetable filling.');
  perform pg_temp.variant(p, 'Each', 4000, 0, false, 1);
  p := pg_temp.product('Savouries', 'Chicken Puff', 'ready_stock', false, '{gluten}', '19059090', 500, 'Chicken masala filling.');
  perform pg_temp.variant(p, 'Each', 6000, 0, false, 1);
  p := pg_temp.product('Savouries', 'Paneer Sandwich', 'ready_stock', false, '{milk,gluten}', '19059090', 500, 'Grilled paneer tikka.');
  perform pg_temp.variant(p, 'Each', 14000, 0, false, 1);
end $$;

-- An order line by product and variant name.
create function pg_temp.item(p_product text, p_variant text, p_qty integer, p_notes text default null) returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('variant_id', pv.id, 'quantity', p_qty, 'notes', p_notes))
  from public.product_variants pv join public.products p on p.id = pv.product_id
  where p.name = p_product and pv.name = p_variant and p.archived_at is null and pv.archived_at is null
$$;
-- p_days after today at p_time, business time zone; "today" times already past move to two hours from now.
create function pg_temp.at(p_days integer, p_time text) returns timestamptz language sql stable as $$
  select greatest(
    (((now() at time zone tz)::date + p_days) + p_time::time) at time zone tz,
    date_trunc('hour', now()) + interval '2 hours')
  from (select v as tz from seed where k = 'tz') z
$$;
create function pg_temp.ver(p_order uuid) returns integer language sql stable as $$
  select version from public.orders where id = p_order
$$;
create function pg_temp.cake(p jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('tiers', 1, 'is_eggless', false, 'cupcake_count', 0, 'popsicle_count', 0,
                            'setup_charge_paise', 0, 'delivery_charge_paise', 0) || p
$$;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Orders, as the demo admin (Web orders → Kitchen 2, custom cakes → Kitchen 1)
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', (select v from seed where k = 'admin'), 'role', 'authenticated')::text, true);
do $$
declare
  o public.orders;
  why constant text := 'Demo data';
begin
  -- Counter sales: ready stock, paid at the counter, billed at once.
  perform public.counter_sale(gen_random_uuid(),
    jsonb_build_array(pg_temp.item('Veg Puff', 'Each', 2), pg_temp.item('Chocolate Éclair', 'Each', 1), pg_temp.item('Choco Chip Cookies', 'Box of 6', 1)),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amount_paise', 41000)), null, null, null, 'Demo walk-in', null);
  perform public.counter_sale(gen_random_uuid(),
    jsonb_build_array(pg_temp.item('Paneer Sandwich', 'Each', 2), pg_temp.item('French Macarons', 'Box of 6', 1)),
    jsonb_build_array(jsonb_build_object('method', 'upi', 'amount_paise', 76000, 'reference', 'UPI-DEMO-001')), null, null, null, 'Demo walk-in', null);

  -- Call order today: packed, paid by UPI, handed over (bill).
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Black Forest Cake', '500 g', 1, 'Write "Happy Anniversary"')),
         'Priya Raman', '9000012301', pg_temp.at(0, '19:30'), 'Please box it with a candle', 'DEMO DATA', true, why, 'collect', null, null);
  insert into seed values ('O1', o.id::text);
  -- In-store order today: packed, waiting for pickup with the balance due.
  o := public.create_order(gen_random_uuid(), 'IN_STORE', jsonb_build_array(pg_temp.item('Blueberry Cheesecake Slice', 'Slice', 2), pg_temp.item('Butter Croissant', 'Each', 4)),
         'Arjun Mehta', '9000012302', pg_temp.at(0, '20:00'), null, 'DEMO DATA', true, why, 'collect', null, null);
  insert into seed values ('O2', o.id::text);
  -- Call order with a ₹100 discount, tomorrow.
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Sourdough Loaf', '400 g', 2), pg_temp.item('Butter Cookies', '250 g box', 1)),
         'Kavya Iyer', '9000012303', pg_temp.at(1, '10:30'), null, 'DEMO DATA', true, why, 'collect', null, null);
  perform public.apply_discount(o.id, o.version, 'amount', 10000, 'Regular customer');
  -- Tomorrow's cake with a deposit, delivered and set up at a party.
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Chocolate Truffle Cake', '1 kg', 1, 'Write "Happy Birthday Rohan"'), pg_temp.item('Butter Cookies', '250 g box', 2)),
         'Meera Nair', '9000012304', pg_temp.at(1, '17:00'), null, 'DEMO DATA', true, why, 'setup', '22 Besant Avenue, Adyar', 'Second floor, lift available');
  perform public.record_payment(o.id, gen_random_uuid(), 'payment', 'upi', 50000, 'UPI-DEMO-002', 'Deposit');
  -- Call order waiting for confirmation (in two days, eggless).
  perform public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Fresh Fruit Gateau', '1 kg Eggless', 1)),
         'Rahul Verma', '9000012307', pg_temp.at(2, '17:00'), null, 'DEMO DATA', false, why, 'collect', null, null);
  -- Cancelled with a deposit to refund.
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Black Forest Cake', '1 kg', 1)),
         'Vikram Shah', '9000012309', pg_temp.at(2, '15:00'), null, 'DEMO DATA', true, why, 'collect', null, null);
  perform public.record_payment(o.id, gen_random_uuid(), 'payment', 'upi', 30000, 'UPI-DEMO-003', 'Deposit');
  perform public.cancel_order(o.id, pg_temp.ver(o.id), 'Customer cancelled the party');
  -- Rejected.
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Red Velvet Cake', '1 kg', 1)),
         'Neha Gupta', '9000012310', pg_temp.at(1, '10:00'), null, 'DEMO DATA', false, why, 'collect', null, null);
  perform public.reject_order(o.id, o.version, 'Fully booked for red velvet tomorrow; offered Friday instead');
  -- Rescheduled.
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Black Forest Cake', '500 g', 2)),
         'Imran Khan', '9000012312', pg_temp.at(4, '12:00'), null, 'DEMO DATA', true, why, 'collect', null, null);
  perform public.reschedule_order(o.id, o.version, pg_temp.at(5, '13:00'), 'Customer travelling that day', why);
  -- Next week: bread order.
  perform public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Multigrain Bread', '400 g', 3), pg_temp.item('Garlic Focaccia', 'Tray', 2)),
         'Deepa Krishnan', '9000012308', pg_temp.at(7, '09:30'), null, 'DEMO DATA', true, why, 'collect', null, null);

  -- Custom cakes (Kitchen 1). A birthday set-up with set-up and delivery charges, advance and a sticky note.
  o := public.create_custom_cake_order(gen_random_uuid(), 'CALL', 'Ananya Sridhar', '9000012320', pg_temp.at(3, '18:00'), 450000,
         pg_temp.cake('{"flavour": "Belgian chocolate truffle", "weight_kg": 2, "tiers": 2, "theme": "Unicorn", "design": "Pastel rainbow mane, gold horn",
                       "fondant": "Full", "cream": "Whipped", "message": "Happy 5th Birthday, Aarav", "is_eggless": true,
                       "cupcake_count": 12, "popsicle_count": 6, "instructions": "Gold leaf on the top tier",
                       "setup_charge_paise": 150000, "delivery_charge_paise": 30000}'),
         'Pastel pink and gold, please', 'DEMO DATA', true, why, 'setup', '5 Lake View Road, Adyar', 'Call at the gate',
         200000, 'upi', 'UPI-DEMO-010');
  perform public.set_sticky_note(o.id, 'Customer will send the balloon colours on WhatsApp by Thursday.', true);
  -- A wedding cake next week, collected.
  perform public.create_custom_cake_order(gen_random_uuid(), 'CALL', 'Karthik & Divya', '9000012321', pg_temp.at(6, '11:00'), 900000,
         pg_temp.cake('{"flavour": "Vanilla bean with raspberry", "weight_kg": 5, "tiers": 3, "theme": "Classic white wedding",
                       "design": "Sugar roses cascading down one side", "fondant": "Full", "cream": "Swiss meringue buttercream",
                       "message": "Karthik & Divya", "instructions": "Keep refrigerated; collect with the van"}'),
         null, 'DEMO DATA', true, why, 'collect', null, null, 300000, 'bank_transfer', 'NEFT-DEMO-77');
  -- A photo cake tomorrow with delivery only.
  perform public.create_custom_cake_order(gen_random_uuid(), 'IN_STORE', 'Sanjay Kumar', '9000012305', pg_temp.at(1, '16:00'), 240000,
         pg_temp.cake('{"flavour": "Black forest", "weight_kg": 1.5, "theme": "Cricket", "design": "Edible photo print",
                       "fondant": "Semi", "cream": "Fresh cream", "message": "Happy 10th Birthday, Ananya", "cupcake_count": 6,
                       "delivery_charge_paise": 25000}'),
         'Photo will be sent on WhatsApp', 'DEMO DATA', true, why, 'setup', '14 TTK Road, Alwarpet', null, 100000, 'cash', null);
  -- A custom cake enquiry waiting for confirmation.
  perform public.create_custom_cake_order(gen_random_uuid(), 'CALL', 'Lakshmi Pillai', '9000012313', pg_temp.at(4, '17:30'), 180000,
         pg_temp.cake('{"flavour": "Rasmalai", "weight_kg": 1.5, "theme": "Floral", "cream": "Whipped", "message": "Congratulations Amma", "is_eggless": true}'),
         null, 'DEMO DATA', false, why, 'collect', null, null, 0, null, null);
end $$;

-- Packing and handover for today's orders.
do $$
declare
  o public.orders;
  v_id uuid;
begin
  v_id := (select v::uuid from seed where k = 'O1');
  o := public.mark_packed(v_id, pg_temp.ver(v_id), 'Candle added');
  perform public.record_payment(v_id, gen_random_uuid(), 'payment', 'upi', o.total_paise, 'UPI-DEMO-004', null);
  perform public.record_handover(v_id, pg_temp.ver(v_id), 'Priya (customer)', null);
  v_id := (select v::uuid from seed where k = 'O2');
  perform public.mark_packed(v_id, pg_temp.ver(v_id), 'On the pickup shelf');
end $$;

-- An order taken by the counter staff member.
select set_config('request.jwt.claims', json_build_object('sub', (select v from seed where k = 'counter'), 'role', 'authenticated')::text, true);
do $$ begin
  perform public.create_order(gen_random_uuid(), 'IN_STORE', jsonb_build_array(pg_temp.item('Chocolate Truffle Cake', '500 g', 1), pg_temp.item('French Macarons', 'Box of 6', 2)),
         'Fatima Sheikh', '9000012306', pg_temp.at(2, '12:00'), 'Less sweet if possible', 'DEMO DATA', true, null, 'collect', null, null);
end $$;

-- Website orders waiting for confirmation, sent the way the public site sends them.
reset role;
insert into seed values
  ('W1', jsonb_build_array(pg_temp.item('Red Velvet Cake', '1 kg', 1))::text),
  ('W2', jsonb_build_array(pg_temp.item('Chocolate Éclair', 'Each', 6), pg_temp.item('Butter Croissant', 'Each', 6))::text);
set local role anon;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
select public.submit_website_order(gen_random_uuid(), 'Rohit Menon', '9000012330', pg_temp.at(3, '12:00'), 'Less sugar please',
  'birthday', 'rohit@example.com', (select v::jsonb from seed where k = 'W1'), 'collect', null);
select public.submit_website_order(gen_random_uuid(), 'Sneha Rao', '9000012331', pg_temp.at(2, '17:00'), null,
  'pastries', null, (select v::jsonb from seed where k = 'W2'), 'collect', null);
reset role;
update public.orders set internal_notes = 'DEMO DATA' where source = 'ONLINE' and internal_notes is null;

-- Reviews on the website and one offer.
insert into public.reviews (customer_name, rating, comment, status, decided_at) values
  ('Priya R.', 5, 'The anniversary cake was gorgeous and tasted even better. Thank you!', 'approved', now()),
  ('Arjun M.', 5, 'Best croissants in Chennai. Flaky and buttery every time.', 'approved', now()),
  ('Kavya I.', 4, 'Lovely sourdough. Would love a smaller loaf option.', 'approved', now()),
  ('Imran K.', 5, 'They moved my order at short notice without any fuss.', 'pending', null);
insert into public.offers (title, body, button_label, button_link, starts_on, ends_on, sort_order) values
  ('Diwali gift boxes', 'Assorted macarons and cookies, gift-wrapped. Order two days ahead.', 'See products', '#products',
   current_date, current_date + 21, 1);

-- What was created.
select
  (select count(*) from public.products where archived_at is null) as products,
  (select count(*) from public.orders) as orders,
  (select count(*) from public.custom_cakes) as custom_cakes,
  (select string_agg(k.name || ' ' || n, ', ') from (select kitchen_id, count(*) n from public.orders group by kitchen_id) s join public.kitchens k on k.id = s.kitchen_id) as by_kitchen,
  (select string_agg(status::text || ' ' || n, ', ' order by status) from (select status, count(*) n from public.orders group by status) s) as by_status;

commit;
