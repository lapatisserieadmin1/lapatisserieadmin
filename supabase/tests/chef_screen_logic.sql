-- Chef screen (2026-10-20): what chefs can and cannot read, chef_work, set_item_kitchen, cake photos.
-- Runs in a transaction and rolls back. Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-000000000ca1','ch-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000cc1','ch-c@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000cf1','ch-f1@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000cf2','ch-f2@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-000000000ca1','Ch Admin','admin'),
 ('00000000-0000-0000-0000-000000000cc1','Ch Counter','counter'),
 ('00000000-0000-0000-0000-000000000cf1','Ch Chef One','chef'),
 ('00000000-0000-0000-0000-000000000cf2','Ch Chef Two','chef');
insert into public.staff_kitchens (user_id, kitchen_id)
  select '00000000-0000-0000-0000-000000000cf1', id from public.kitchens where code = 'K1';
insert into public.staff_kitchens (user_id, kitchen_id)
  select '00000000-0000-0000-0000-000000000cf2', id from public.kitchens where code = 'K2';

delete from public.capacity_overrides;
delete from public.category_daily_caps;
delete from public.pickup_windows;
delete from public.closures;
update public.business_hours set opens_at = '09:00', closes_at = '21:00', is_closed = false;

insert into public.categories (name) values ('T Ch Bakes');
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Ch Cake', 'made_to_order', 500 from public.categories where name = 'T Ch Bakes';
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Ch Bread', 'made_to_order', 500 from public.categories where name = 'T Ch Bakes';
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Ch Puff', 'ready_stock', 500 from public.categories where name = 'T Ch Bakes';
insert into public.product_variants (product_id, name, price_paise, kitchen_id)
  select p.id, '1 kg', 90000, (select id from public.kitchens where code = 'K1') from public.products p where p.name = 'T Ch Cake';
insert into public.product_variants (product_id, name, price_paise, kitchen_id)
  select p.id, 'Loaf', 6000, (select id from public.kitchens where code = 'K2') from public.products p where p.name = 'T Ch Bread';
insert into public.product_variants (product_id, name, price_paise)
  select p.id, 'Each', 3000 from public.products p where p.name = 'T Ch Puff';
insert into ctx select 'cake', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Ch Cake';
insert into ctx select 'bread', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Ch Bread';
insert into ctx select 'puff', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Ch Puff';
insert into ctx select 'K1', id::text from public.kitchens where code = 'K1';
insert into ctx select 'K2', id::text from public.kitchens where code = 'K2';

create function pg_temp.day(p_days integer) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Kolkata')::date + p_days) + time '12:00') at time zone 'Asia/Kolkata'
$$;
create function pg_temp.d(p_days integer) returns date language sql stable as $$
  select (now() at time zone 'Asia/Kolkata')::date + p_days
$$;
create function pg_temp.line(p_key text, p_qty integer) returns jsonb language sql stable as $$
  select jsonb_build_object('variant_id', (select v from ctx where k = p_key), 'quantity', p_qty)
$$;
create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true)
$$;

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000ca1');
do $$
declare o public.orders;
begin
  -- A: confirmed, cake (K1) + bread (K2) + puff (ready stock), due in 2 days.
  o := public.create_order(gen_random_uuid(), 'CALL',
    jsonb_build_array(pg_temp.line('cake', 1), pg_temp.line('bread', 3), pg_temp.line('puff', 4)),
    'Ch Secret Name', '9000000981', pg_temp.day(2), 'Customer note with email x@y.z', 'Paid 500 advance', true);
  insert into ctx values ('A', o.id::text);
  -- B: pending (not confirmed), cake.
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.line('cake', 2)),
    'Ch Two', '9000000982', pg_temp.day(2));
  insert into ctx values ('B', o.id::text);
  -- C: custom cake, confirmed, no kitchen yet, with a photo.
  o := public.create_custom_cake_order(gen_random_uuid(), 'CALL', 'Ch Three', '9000000983', pg_temp.day(3), 150000,
    '{"flavour": "Red velvet", "weight_kg": 1.5, "tiers": 2, "message": "Happy birthday", "setup_charge_paise": 50000}',
    p_confirm => true);
  insert into ctx values ('C', o.id::text);
  perform public.set_custom_cake_photos(o.id, array[o.id || '/ref.jpg']);
  -- D: confirmed cake then cancelled.
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.line('cake', 1)),
    'Ch Four', '9000000984', pg_temp.day(2), p_confirm => true);
  o := public.cancel_order(o.id, o.version, 'Customer called to cancel');
  insert into ctx values ('D', o.id::text);
  -- E: confirmed cake due in 20 days.
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(pg_temp.line('cake', 1)),
    'Ch Five', '9000000985', pg_temp.day(20), p_confirm => true);
  insert into ctx values ('E', o.id::text);
end $$;
insert into storage.objects (bucket_id, name) select 'custom-cake-photos', v || '/ref.jpg' from ctx where k = 'C';
insert into storage.objects (bucket_id, name) values ('custom-cake-photos', 'other-order/ref.jpg');

-- Chef One (Kitchen 1).
select pg_temp.as_user('00000000-0000-0000-0000-000000000cf1');
-- expect: 0/0/0/0/0/0/0
insert into r(check_name,outcome) values ('H1 chef reads no prices, products, settings, orders, items, offers or reviews',
  (select count(*) from public.product_variants) || '/' || (select count(*) from public.products) || '/' ||
  (select count(*) from public.business_settings) || '/' || (select count(*) from public.orders) || '/' ||
  (select count(*) from public.order_items) || '/' || (select count(*) from public.offers) || '/' ||
  (select count(*) from public.reviews));
-- expect: 2
insert into r(check_name,outcome) values ('H2 chef reads kitchen names', (select count(*) from public.kitchens)::text);
-- Since 2026-10-24 the order's kitchen decides: custom cake orders are Kitchen 1, every other order Kitchen 2.
-- expect: Custom cake x1 (Kitchen 1) confirmed
insert into r(check_name,outcome) values ('H3 chef one (Kitchen 1) sees only custom cake orders',
  (select string_agg(w.product_name || ' x' || w.quantity || ' (' || coalesce(w.kitchen_name, 'no kitchen') || ') ' || w.status, ' | '
     order by w.product_name, w.status::text)
   from public.chef_work(pg_temp.d(0), pg_temp.d(7)) w));
-- expect: false
insert into r(check_name,outcome) values ('H4 chef_work carries no amounts or staff notes',
  (select bool_or(to_jsonb(w)::text ~ '(paise|1500|Paid 500|price|amount|total|discount|charge)')
   from public.chef_work(pg_temp.d(0), pg_temp.d(30)) w)::text);
-- expect: 0
insert into r(check_name,outcome) values ('H4b chef one sees nothing of the web orders',
  (select count(*) from public.chef_work(pg_temp.d(0), pg_temp.d(30)) w where w.cake is null)::text);
-- expect: Red velvet / 1.50 / Happy birthday / true
insert into r(check_name,outcome) values ('H5 custom cake details and photo path come through',
  (select (w.cake ->> 'flavour') || ' / ' || (w.cake ->> 'weight_kg') || ' / ' || (w.cake ->> 'message') || ' / ' ||
          ((w.cake -> 'photo_paths' ->> 0) like '%/ref.jpg')::text
   from public.chef_work(pg_temp.d(0), pg_temp.d(7)) w where w.cake is not null));
-- expect: 1
insert into r(check_name,outcome) values ('H6 chef reads the photo of a cake on their screen, not others',
  (select count(*) from storage.objects where bucket_id = 'custom-cake-photos')::text);
-- expect: 0
insert into r(check_name,outcome) values ('H7 later web orders stay out of Kitchen 1 too',
  (select count(*) from public.chef_work(pg_temp.d(8), pg_temp.d(30)))::text);
do $$ begin
  begin perform public.chef_work(pg_temp.d(0), pg_temp.d(100));
    insert into r(check_name,outcome) values ('H8 at most two months at a time', 'ALLOWED');
  -- expect: Choose up to two months of dates.
  exception when others then insert into r(check_name,outcome) values ('H8 at most two months at a time', sqlerrm); end;
  begin perform public.set_item_kitchen((select id from public.order_items limit 1), null);
    insert into r(check_name,outcome) values ('H9 chefs cannot route items', 'ALLOWED');
  -- expect: You do not have permission to change orders.
  exception when others then insert into r(check_name,outcome) values ('H9 chefs cannot route items', sqlerrm); end;
end $$;

-- Chef Two (Kitchen 2).
select pg_temp.as_user('00000000-0000-0000-0000-000000000cf2');
-- expect: T Ch Bread x3 (Kitchen 2) | T Ch Cake x1 (Kitchen 2) | T Ch Cake x1 (Kitchen 2)
insert into r(check_name,outcome) values ('H10 chef two (Kitchen 2) sees every web order line, no custom cake',
  (select string_agg(w.product_name || ' x' || w.quantity || ' (' || coalesce(w.kitchen_name, 'no kitchen') || ')', ' | '
     order by w.product_name, w.status::text)
   from public.chef_work(pg_temp.d(0), pg_temp.d(7)) w));
-- expect: Ch Secret Name / 9000000981 / Customer note with email x@y.z
insert into r(check_name,outcome) values ('H10b chef sees the customer name, phone and notes',
  (select distinct w.customer_name || ' / ' || w.customer_phone || ' / ' || w.customer_notes
   from public.chef_work(pg_temp.d(0), pg_temp.d(30)) w where w.customer_name = 'Ch Secret Name'));
-- expect: 1
insert into r(check_name,outcome) values ('H10c later dates are in a wider range',
  (select count(*) from public.chef_work(pg_temp.d(8), pg_temp.d(30)))::text);

-- Counter staff route the custom cake to Kitchen 2.
select pg_temp.as_user('00000000-0000-0000-0000-000000000cc1');
do $$
declare cake_item uuid := (select order_item_id from public.custom_cakes where order_id = (select v::uuid from ctx where k = 'C'));
  charge_item uuid := (select setup_charge_item_id from public.custom_cakes where order_id = (select v::uuid from ctx where k = 'C'));
begin
  perform public.set_item_kitchen(cake_item, (select v::uuid from ctx where k = 'K2'));
  -- expect: Kitchen 2 / 1
  insert into r(check_name,outcome) values ('H11 counter staff route a custom cake to a kitchen, logged',
    (select k.name from public.order_items oi join public.kitchens k on k.id = oi.kitchen_id where oi.id = cake_item) || ' / ' ||
    (select count(*) from public.order_events where order_id = (select v::uuid from ctx where k = 'C') and event_type = 'item_kitchen_changed'));
  begin perform public.set_item_kitchen(charge_item, (select v::uuid from ctx where k = 'K2'));
    insert into r(check_name,outcome) values ('H12 charge lines do not go to a kitchen', 'ALLOWED');
  -- expect: Only made-to-order items go to a kitchen.
  exception when others then insert into r(check_name,outcome) values ('H12 charge lines do not go to a kitchen', sqlerrm); end;
  begin perform public.set_item_kitchen((select id from public.order_items where order_id = (select v::uuid from ctx where k = 'D')),
      (select v::uuid from ctx where k = 'K2'));
    insert into r(check_name,outcome) values ('H13 closed orders keep their kitchen', 'ALLOWED');
  -- expect: The kitchen cannot change on a cancelled order.
  exception when others then insert into r(check_name,outcome) values ('H13 closed orders keep their kitchen', sqlerrm); end;
  -- expect: 4
  insert into r(check_name,outcome) values ('H14 counter staff see every kitchen on the chef screen',
    (select count(*) from public.chef_work(pg_temp.d(0), pg_temp.d(7)))::text);
end $$;

-- A line's kitchen no longer moves an order: the custom cake order stays with Kitchen 1, photo too.
select pg_temp.as_user('00000000-0000-0000-0000-000000000cf1');
-- expect: 1 / 1
insert into r(check_name,outcome) values ('H15 a custom cake order stays in Kitchen 1 whatever its line says, photo too',
  (select count(*) from public.chef_work(pg_temp.d(0), pg_temp.d(7)) w where w.cake is not null) || ' / ' ||
  (select count(*) from storage.objects where bucket_id = 'custom-cake-photos'));
select pg_temp.as_user('00000000-0000-0000-0000-000000000cf2');
-- expect: 0
insert into r(check_name,outcome) values ('H16 Kitchen 2 never sees it',
  (select count(*) from public.chef_work(pg_temp.d(0), pg_temp.d(7)) w where w.cake is not null)::text);

-- An inactive chef sees nothing.
reset role;
update public.staff_profiles set is_active = false where user_id = '00000000-0000-0000-0000-000000000cf2';
set local role authenticated;
do $$ begin
  begin perform public.chef_work(pg_temp.d(0), pg_temp.d(7));
    insert into r(check_name,outcome) values ('H17 an inactive chef is refused', 'ALLOWED');
  -- expect: You do not have access to the kitchen screen.
  exception when others then insert into r(check_name,outcome) values ('H17 an inactive chef is refused', sqlerrm); end;
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
