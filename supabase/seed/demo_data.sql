-- Demo data for trying the app (owner's request, 2026-10-03): a bakery catalogue, customers, and
-- orders in every state, created through the app's own functions so totals, kitchen tickets, bills
-- and timelines are consistent. Times are relative to when it runs (business time zone).
--
-- Marked for removal by supabase/seed/remove_demo_data.sql:
--   products: description starts with 'Demo product'; categories listed in that script;
--   orders: internal_notes = 'DEMO DATA', or counter sales named 'Demo walk-in';
-- Bills use real GST numbers (AB/2026-27/00001 …); the removal script deletes them and resets the
-- counters, so the first real bill is 00001 again.
--
-- Needs: the demo admin (demo@auri.test) and the demo chef (chef@auri.test, assigned to both
-- kitchens), and kitchens K1 and K2. Run as a superuser (Supabase SQL editor or MCP execute_sql).
-- Refuses to run twice (checks for existing demo products).
begin;

do $$ begin
  if exists (select 1 from public.products where description like 'Demo product%') then
    raise exception 'Demo data is already loaded. Run remove_demo_data.sql first.';
  end if;
  if not exists (select 1 from auth.users where email = 'demo@auri.test')
     or not exists (select 1 from auth.users where email = 'chef@auri.test') then
    raise exception 'The demo admin and demo chef logins must exist first.';
  end if;
end $$;

create temp table seed (k text primary key, v text) on commit drop;
grant all on seed to authenticated;
insert into seed select 'admin', id::text from auth.users where email = 'demo@auri.test';
insert into seed select 'chef', id::text from auth.users where email = 'chef@auri.test';
insert into seed select 'K1', id::text from public.kitchens where code = 'K1';
insert into seed select 'K2', id::text from public.kitchens where code = 'K2';
insert into seed values ('tz', private.business_timezone());

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
insert into public.categories (name, default_kitchen_id, sort_order) values
  ('Cakes', (select v::uuid from seed where k = 'K1'), 1),
  ('Pastries', null, 2),
  ('Breads', (select v::uuid from seed where k = 'K2'), 3),
  ('Cookies', (select v::uuid from seed where k = 'K2'), 4),
  ('Savouries', null, 5);

create function pg_temp.product(p_cat text, p_name text, p_prep text, p_veg boolean, p_egg boolean, p_allergens text[],
  p_hsn text, p_tax integer, p_desc text) returns uuid language sql as $$
  insert into public.products (category_id, name, description, prep_type, is_veg, contains_egg, allergens, hsn_code, tax_rate_bps)
  select id, p_name, 'Demo product. ' || p_desc, p_prep::public.prep_type, p_veg, p_egg, p_allergens, p_hsn, p_tax
  from public.categories where name = p_cat
  returning id
$$;
create function pg_temp.variant(p_product uuid, p_name text, p_price bigint, p_kitchen text, p_lead integer, p_eggless boolean, p_sort integer)
returns void language sql as $$
  insert into public.product_variants (product_id, name, price_paise, kitchen_id, lead_time_minutes, is_eggless, sort_order)
  values (p_product, p_name, p_price, (select v::uuid from seed where k = p_kitchen), p_lead, p_eggless, p_sort)
$$;

do $$
declare p uuid;
begin
  p := pg_temp.product('Cakes', 'Chocolate Truffle Cake', 'made_to_order', true, true, '{milk,gluten}', '19059090', 1800, 'Dark chocolate ganache layers.');
  perform pg_temp.variant(p, '500 g', 65000, 'K1', 240, false, 1);
  perform pg_temp.variant(p, '1 kg', 120000, 'K1', 240, false, 2);
  perform pg_temp.variant(p, '1 kg Eggless', 130000, 'K1', 240, true, 3);
  p := pg_temp.product('Cakes', 'Black Forest Cake', 'made_to_order', true, true, '{milk,gluten}', '19059090', 1800, 'Cherries and whipped cream.');
  perform pg_temp.variant(p, '500 g', 60000, 'K1', 240, false, 1);
  perform pg_temp.variant(p, '1 kg', 110000, 'K1', 240, false, 2);
  p := pg_temp.product('Cakes', 'Red Velvet Cake', 'made_to_order', true, true, '{milk,gluten}', '19059090', 1800, 'Cream cheese frosting.');
  perform pg_temp.variant(p, '1 kg', 140000, 'K1', 360, false, 1);
  p := pg_temp.product('Cakes', 'Fresh Fruit Gateau', 'made_to_order', true, false, '{milk,gluten}', '19059090', 1800, 'Seasonal fruit, eggless.');
  perform pg_temp.variant(p, '1 kg Eggless', 135000, 'K1', 240, true, 1);
  p := pg_temp.product('Cakes', 'Custom Photo Cake', 'made_to_order', true, true, '{milk,gluten}', '19059090', 1800, 'Edible photo print; message in the notes.');
  perform pg_temp.variant(p, '1.5 kg', 240000, 'K1', 1440, false, 1);
  perform pg_temp.variant(p, '2 kg', 300000, 'K1', 1440, false, 2);

  p := pg_temp.product('Pastries', 'Blueberry Cheesecake Slice', 'ready_stock', true, true, '{milk,gluten}', '19059090', 1800, 'Baked cheesecake.');
  perform pg_temp.variant(p, 'Slice', 22000, null, 0, false, 1);
  p := pg_temp.product('Pastries', 'Chocolate Éclair', 'ready_stock', true, true, '{milk,gluten}', '19059090', 1800, 'Choux with chocolate glaze.');
  perform pg_temp.variant(p, 'Each', 9000, null, 0, false, 1);
  p := pg_temp.product('Pastries', 'Butter Croissant', 'ready_stock', true, false, '{milk,gluten}', '19059090', 1800, 'Laminated butter dough.');
  perform pg_temp.variant(p, 'Each', 12000, null, 0, false, 1);

  p := pg_temp.product('Breads', 'Sourdough Loaf', 'made_to_order', true, false, '{gluten}', '19059010', 500, 'Slow-fermented, 18 hours.');
  perform pg_temp.variant(p, '400 g', 28000, 'K2', 720, false, 1);
  p := pg_temp.product('Breads', 'Multigrain Bread', 'made_to_order', true, false, '{gluten,sesame}', '19059010', 500, 'Seeds and whole wheat.');
  perform pg_temp.variant(p, '400 g', 12000, 'K2', 180, false, 1);
  p := pg_temp.product('Breads', 'Garlic Focaccia', 'made_to_order', true, false, '{gluten}', '19059010', 500, 'Olive oil and roasted garlic.');
  perform pg_temp.variant(p, 'Tray', 22000, 'K2', 180, false, 1);

  p := pg_temp.product('Cookies', 'Butter Cookies', 'made_to_order', true, false, '{milk,gluten}', '19053100', 1800, 'Classic Danish-style.');
  perform pg_temp.variant(p, '250 g box', 32000, 'K2', 120, false, 1);
  p := pg_temp.product('Cookies', 'Choco Chip Cookies', 'ready_stock', true, true, '{milk,gluten}', '19053100', 1800, 'Box of six.');
  perform pg_temp.variant(p, 'Box of 6', 24000, null, 0, false, 1);

  p := pg_temp.product('Savouries', 'Veg Puff', 'ready_stock', true, false, '{gluten}', '19059090', 500, 'Spiced vegetable filling.');
  perform pg_temp.variant(p, 'Each', 4000, null, 0, false, 1);
  p := pg_temp.product('Savouries', 'Chicken Puff', 'ready_stock', false, false, '{gluten}', '19059090', 500, 'Chicken masala filling.');
  perform pg_temp.variant(p, 'Each', 6000, null, 0, false, 1);
  p := pg_temp.product('Savouries', 'Paneer Sandwich', 'ready_stock', true, false, '{milk,gluten}', '19059090', 500, 'Grilled paneer tikka.');
  perform pg_temp.variant(p, 'Each', 14000, null, 0, false, 1);
end $$;

-- An order line by product and variant name.
create function pg_temp.item(p_product text, p_variant text, p_qty integer, p_notes text default null) returns jsonb language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object('variant_id', pv.id, 'quantity', p_qty, 'notes', p_notes))
  from public.product_variants pv join public.products p on p.id = pv.product_id
  where p.name = p_product and pv.name = p_variant and p.description like 'Demo product%'
$$;
-- p_days after today at p_time, business time zone; "today" times already past move to the next hour.
create function pg_temp.at(p_days integer, p_time text) returns timestamptz language sql stable as $$
  select greatest(
    (((now() at time zone tz)::date + p_days) + p_time::time) at time zone tz,
    date_trunc('hour', now()) + interval '2 hours')
  from (select v as tz from seed where k = 'tz') z
$$;
create function pg_temp.ver(p_order uuid) returns integer language sql stable as $$
  select version from public.orders where id = p_order
$$;
create function pg_temp.ticket(p_order uuid, p_kitchen text) returns uuid language sql stable as $$
  select t.id from public.kitchen_tickets t where t.order_id = p_order and t.kitchen_id = (select v::uuid from seed where k = p_kitchen)
$$;
create function pg_temp.lines(p_ticket uuid) returns setof public.kitchen_ticket_lines language sql stable as $$
  select * from public.kitchen_ticket_lines where ticket_id = p_ticket and status <> 'cancelled' order by line_no
$$;

set local role authenticated;

-- ---------------------------------------------------------------------------
-- Orders, as the demo admin
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', (select v from seed where k = 'admin'), 'role', 'authenticated')::text, true);
do $$
declare
  o public.orders;
  why constant text := 'Demo data';
begin
  -- 1–2. Counter sales (ready stock, paid at the counter, billed at once).
  perform public.counter_sale(gen_random_uuid(),
    jsonb_build_array(pg_temp.item('Veg Puff', 'Each', 2), pg_temp.item('Chocolate Éclair', 'Each', 1), pg_temp.item('Choco Chip Cookies', 'Box of 6', 1)),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amount_paise', 41000)), null, null, null, 'Demo walk-in');
  perform public.counter_sale(gen_random_uuid(),
    jsonb_build_array(pg_temp.item('Paneer Sandwich', 'Each', 2), pg_temp.item('Chicken Puff', 'Each', 2)),
    jsonb_build_array(jsonb_build_object('method', 'upi', 'amount_paise', 40000, 'reference', 'UPI-DEMO-001')), null, null, null, 'Demo walk-in');

  -- 3. Call order, cake today: made, packed, paid by UPI, handed over (bill).
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Black Forest Cake', '500 g', 1, 'Write "Happy Anniversary"')),
         'Priya Raman', '9000012301', pg_temp.at(0, '19:30'), 'Please box it with a candle', 'DEMO DATA', true, why);
  insert into seed values ('O3', o.id::text);
  -- 4. In-store order, ready stock: packed, paid by card, handed over; later a cheesecake is returned (credit note + refund).
  o := public.create_order(gen_random_uuid(), 'IN_STORE', jsonb_build_array(pg_temp.item('Blueberry Cheesecake Slice', 'Slice', 2), pg_temp.item('Butter Croissant', 'Each', 4)),
         'Arjun Mehta', '9000012302', pg_temp.at(0, '19:00'), null, 'DEMO DATA', true, why);
  insert into seed values ('O4', o.id::text);
  -- 5. Call order with a ₹100 discount, breads and cookies today: made, paid in cash, handed over.
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Sourdough Loaf', '400 g', 2), pg_temp.item('Butter Cookies', '250 g box', 1)),
         'Kavya Iyer', '9000012303', pg_temp.at(0, '20:00'), null, 'DEMO DATA', true, why);
  o := public.apply_discount(o.id, o.version, 'amount', 10000, 'Regular customer');
  insert into seed values ('O5', o.id::text);
  -- 6. Tomorrow's cake order with a deposit; the kitchen has started (Preparing).
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Chocolate Truffle Cake', '1 kg', 1, 'Write "Happy Birthday Rohan"'), pg_temp.item('Butter Cookies', '250 g box', 2)),
         'Meera Nair', '9000012304', pg_temp.at(1, '11:00'), null, 'DEMO DATA', true, why);
  perform public.record_payment(o.id, gen_random_uuid(), 'payment', 'upi', 50000, 'UPI-DEMO-002', 'Deposit');
  insert into seed values ('O6', o.id::text);
  -- 7. Photo cake on Monday, deposit paid; the kitchen has not seen it yet (New).
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Custom Photo Cake', '2 kg', 1, 'Photo by WhatsApp; "Happy 10th Birthday Ananya"')),
         'Sanjay Kumar', '9000012305', pg_temp.at(2, '16:00'), 'Photo will be sent on WhatsApp', 'DEMO DATA', true, why);
  perform public.record_payment(o.id, gen_random_uuid(), 'payment', 'cash', 100000, null, 'Deposit');
  -- 8. (An online order waiting for confirmation is added at the end, as the website would add it.)
  -- 9. Call order waiting for confirmation (tomorrow, eggless).
  perform public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Fresh Fruit Gateau', '1 kg Eggless', 1)),
         'Rahul Verma', '9000012307', pg_temp.at(1, '17:00'), null, 'DEMO DATA', false, why);
  -- 10. Breads made and packed, waiting for pickup today with the balance due.
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Multigrain Bread', '400 g', 2), pg_temp.item('Garlic Focaccia', 'Tray', 1)),
         'Deepa Krishnan', '9000012308', pg_temp.at(0, '20:30'), null, 'DEMO DATA', true, why);
  insert into seed values ('O10', o.id::text);
  -- 11. Cancelled after the kitchen started; deposit to refund; stop-work notice for the kitchen.
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Black Forest Cake', '1 kg', 1)),
         'Vikram Shah', '9000012309', pg_temp.at(1, '15:00'), null, 'DEMO DATA', true, why);
  perform public.record_payment(o.id, gen_random_uuid(), 'payment', 'upi', 30000, 'UPI-DEMO-003', 'Deposit');
  insert into seed values ('O11', o.id::text);
  -- 12. Rejected call order.
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Custom Photo Cake', '1.5 kg', 1)),
         'Neha Gupta', '9000012310', pg_temp.at(1, '10:00'), null, 'DEMO DATA', false, why);
  perform public.reject_order(o.id, o.version, 'Not enough time for a photo cake; offered Monday instead');
  -- 13. Changed after the kitchen started (5C): the kitchen still has to acknowledge the change.
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Chocolate Truffle Cake', '500 g', 1), pg_temp.item('Sourdough Loaf', '400 g', 1)),
         'Anita Desai', '9000012311', pg_temp.at(2, '11:00'), null, 'DEMO DATA', true, why);
  insert into seed values ('O13', o.id::text);
  -- 14. Rescheduled from Wednesday to Thursday.
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Black Forest Cake', '500 g', 2)),
         'Imran Khan', '9000012312', pg_temp.at(4, '12:00'), null, 'DEMO DATA', true, why);
  perform public.reschedule_order(o.id, o.version, pg_temp.at(5, '13:00'), 'Customer travelling on Wednesday', why);
  -- 15. Kitchen reports a problem (open issue on the KOT page).
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.item('Red Velvet Cake', '1 kg', 1)),
         'Lakshmi Pillai', '9000012313', pg_temp.at(1, '18:00'), null, 'DEMO DATA', true, why);
  insert into seed values ('O15', o.id::text);
end $$;

-- ---------------------------------------------------------------------------
-- Kitchen work, as the demo chef
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', (select v from seed where k = 'chef'), 'role', 'authenticated')::text, true);
do $$
declare l public.kitchen_ticket_lines; o uuid;
begin
  -- Finish everything for orders 3, 5 and 10.
  foreach o in array array[(select v::uuid from seed where k = 'O3'), (select v::uuid from seed where k = 'O5'), (select v::uuid from seed where k = 'O10')] loop
    for l in select kl.* from public.kitchen_ticket_lines kl join public.kitchen_tickets t on t.id = kl.ticket_id where t.order_id = o loop
      perform public.set_line_ready(l.id, l.quantity);
    end loop;
  end loop;
  -- Order 6: Kitchen 1 has made the cake; Kitchen 2 acknowledged the cookies.
  o := (select v::uuid from seed where k = 'O6');
  for l in select * from pg_temp.lines(pg_temp.ticket(o, 'K1')) loop
    perform public.set_line_ready(l.id, l.quantity);
  end loop;
  perform public.acknowledge_ticket(pg_temp.ticket(o, 'K2'));
  -- Order 11: Kitchen 1 started the cake (it will be cancelled).
  perform public.start_ticket(pg_temp.ticket((select v::uuid from seed where k = 'O11'), 'K1'));
  -- Order 13: both kitchens started.
  perform public.start_ticket(pg_temp.ticket((select v::uuid from seed where k = 'O13'), 'K1'));
  perform public.start_ticket(pg_temp.ticket((select v::uuid from seed where k = 'O13'), 'K2'));
  -- Order 15: a problem.
  perform public.start_ticket(pg_temp.ticket((select v::uuid from seed where k = 'O15'), 'K1'));
  perform public.report_issue(pg_temp.ticket((select v::uuid from seed where k = 'O15'), 'K1'), 'ingredient', 'Out of cream cheese; delivery expected tomorrow morning');
end $$;

-- ---------------------------------------------------------------------------
-- Packing, payments, handovers, changes, as the demo admin
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', (select v from seed where k = 'admin'), 'role', 'authenticated')::text, true);
do $$
declare
  o public.orders;
  b public.bills;
  v_id uuid;
begin
  -- 3: pack, pay the full amount by UPI, hand over (bill).
  v_id := (select v::uuid from seed where k = 'O3');
  o := public.mark_packed(v_id, pg_temp.ver(v_id), 'Candle added');
  perform public.record_payment(v_id, gen_random_uuid(), 'payment', 'upi', o.total_paise, 'UPI-DEMO-004', null);
  perform public.record_handover(v_id, pg_temp.ver(v_id), 'Priya (customer)');
  -- 4: pack, pay by card, hand over; then one cheesecake comes back: credit note and cash refund.
  v_id := (select v::uuid from seed where k = 'O4');
  o := public.mark_packed(v_id, pg_temp.ver(v_id));
  perform public.record_payment(v_id, gen_random_uuid(), 'payment', 'card', o.total_paise, 'CARD-DEMO-4421', null);
  perform public.record_handover(v_id, pg_temp.ver(v_id));
  select * into b from public.bills where order_id = v_id;
  perform public.issue_credit_note(b.id, gen_random_uuid(), 22000, 'One cheesecake slice returned (damaged box)');
  perform public.record_payment(v_id, gen_random_uuid(), 'refund', 'cash', 22000, null, 'Refund for the returned slice');
  -- 5: pack, pay in cash, hand over.
  v_id := (select v::uuid from seed where k = 'O5');
  o := public.mark_packed(v_id, pg_temp.ver(v_id));
  perform public.record_payment(v_id, gen_random_uuid(), 'payment', 'cash', o.total_paise, null, null);
  perform public.record_handover(v_id, pg_temp.ver(v_id), 'Driver from Kavya''s office');
  -- 10: packed, waiting for the customer (balance due).
  v_id := (select v::uuid from seed where k = 'O10');
  perform public.mark_packed(v_id, pg_temp.ver(v_id), 'On the pickup shelf');
  -- 11: cancelled after the kitchen started (stop-work; the ₹300 deposit is now due back).
  v_id := (select v::uuid from seed where k = 'O11');
  perform public.cancel_order(v_id, pg_temp.ver(v_id), 'Customer cancelled the party');
  -- 13: two truffle cakes instead of one: the kitchen gets a change to acknowledge.
  v_id := (select v::uuid from seed where k = 'O13');
  perform public.update_order_items(v_id, pg_temp.ver(v_id), (
    select jsonb_agg(jsonb_build_object('line_id', oi.id, 'quantity', case when oi.product_name = 'Chocolate Truffle Cake' then 2 else oi.quantity end) order by oi.line_no)
    from public.order_items oi where oi.order_id = v_id), 'Customer called: two cakes for the office party');
end $$;

reset role;

-- 8. Online order waiting for confirmation (Tuesday). Staff cannot create online orders (they come
-- from the public website, not built yet), so it is inserted the way the website would.
with o as (
  insert into public.orders (idempotency_key, source, status, customer_name, customer_phone, customer_notes, internal_notes, requested_due_at)
  values (gen_random_uuid(), 'ONLINE', 'pending_confirmation', 'Fatima Sheikh', '9000012306', 'Less sweet if possible', 'DEMO DATA', pg_temp.at(3, '12:00'))
  returning id
)
insert into public.order_items (
  order_id, line_no, product_id, variant_id, category_id, product_name, variant_name, prep_type, kitchen_id,
  is_veg, contains_egg, is_eggless, allergens, lead_time_minutes, unit_price_paise, tax_rate_bps, hsn_code,
  quantity, line_total_paise, tax_paise)
select o.id, 1, p.id, pv.id, p.category_id, p.name, pv.name, p.prep_type, pv.kitchen_id,
       p.is_veg, p.contains_egg, pv.is_eggless, p.allergens, pv.lead_time_minutes, pv.price_paise, p.tax_rate_bps, p.hsn_code,
       1, pv.price_paise, 0
from o, public.product_variants pv join public.products p on p.id = pv.product_id
where p.name = 'Red Velvet Cake' and pv.name = '1 kg' and p.description like 'Demo product%';
select private.recalc_order_totals(id) from public.orders where source = 'ONLINE' and internal_notes = 'DEMO DATA';

-- What was created.
select
  (select count(*) from public.products where description like 'Demo product%') as products,
  (select count(*) from public.orders where internal_notes = 'DEMO DATA' or customer_name = 'Demo walk-in') as orders,
  (select count(*) from public.bills) as bills,
  (select count(*) from public.credit_notes) as credit_notes,
  (select string_agg(status::text || ' ' || n, ', ' order by status) from (select status, count(*) n from public.orders group by status) s) as by_status;

commit;
