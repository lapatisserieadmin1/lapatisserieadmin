-- Capacity windows, category caps, and overrides (Phase 4C). Runs in a transaction and rolls back.
-- order_number_seq is not transactional: each run consumes order numbers
-- (reset with `alter sequence public.order_number_seq restart with 1001` only while no real orders exist).
-- Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

-- Local timestamp p_days after today at p_time, in the business timezone.
create function pg_temp.ts(p_days integer, p_time time) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Kolkata')::date + p_days) + p_time) at time zone 'Asia/Kolkata'
$$;
create function pg_temp.items(p_key text, p_qty integer) returns jsonb language sql stable as $$
  select jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k = p_key), 'quantity', p_qty))
$$;

-- Clean, predictable configuration (all rolled back).
delete from public.capacity_overrides;
delete from public.category_daily_caps;
delete from public.pickup_windows;
delete from public.closures;
update public.business_hours set opens_at = '09:00', closes_at = '21:00', is_closed = false;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-0000000004a1','cap-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000004c1','cap-c@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-0000000004a1','Cap Admin','admin'),
 ('00000000-0000-0000-0000-0000000004c1','Cap Counter','counter');
insert into public.categories (name) values ('T Cap Cakes'), ('T Cap Puffs');
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Cap Cake', 'ready_stock', 500 from public.categories where name = 'T Cap Cakes';
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Cap Puff', 'ready_stock', 1800 from public.categories where name = 'T Cap Puffs';
insert into public.product_variants (product_id, name, price_paise)
  select id, 'Each', 50000 from public.products where name = 'T Cap Cake';
insert into public.product_variants (product_id, name, price_paise)
  select id, 'Each', 3000 from public.products where name = 'T Cap Puff';
insert into ctx select 'cake', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Cap Cake';
insert into ctx select 'puff', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Cap Puff';
insert into ctx select 'cakes_cat', id::text from public.categories where name = 'T Cap Cakes';
insert into ctx select 'puffs_cat', id::text from public.categories where name = 'T Cap Puffs';
-- Day 200 ahead has no real orders. Its weekday differs from today's (200 mod 7 = 4) and from day 201's.
insert into ctx values ('day', ((now() at time zone 'Asia/Kolkata')::date + 200)::text);
insert into ctx values ('dow', extract(dow from (now() at time zone 'Asia/Kolkata')::date + 200)::text);
insert into ctx values ('today_dow', extract(dow from (now() at time zone 'Asia/Kolkata')::date)::text);

set local role authenticated;

-- ===== Admin: settings =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000004a1","role":"authenticated"}', true);
do $$
declare dow smallint := (select v::smallint from ctx where k = 'dow');
begin
  perform public.set_pickup_windows(array[dow],
    '[{"starts_at":"09:00","ends_at":"11:00","max_orders":2},{"starts_at":"11:00","ends_at":"13:00","max_orders":null}]');
  -- expect: 2
  insert into r(check_name,outcome) values ('A1 admin sets weekday windows', (select count(*) from public.pickup_windows where weekday = dow)::text);

  begin perform public.set_pickup_windows(array[dow], '[{"starts_at":"09:00","ends_at":"11:00"},{"starts_at":"10:00","ends_at":"12:00"}]');
    insert into r(check_name,outcome) values ('A2 overlapping windows refused', 'ALLOWED');
  -- expect: Pickup windows on the same day cannot overlap (…)
  exception when others then insert into r(check_name,outcome) values ('A2 overlapping windows refused', sqlerrm); end;

  begin perform public.set_pickup_windows(array[dow], '[{"starts_at":"12:00","ends_at":"11:00"}]');
    insert into r(check_name,outcome) values ('A3 window ending before start refused', 'ALLOWED');
  -- expect: Each window must end after it starts.
  exception when others then insert into r(check_name,outcome) values ('A3 window ending before start refused', sqlerrm); end;

  -- expect: 2 (failed saves left the earlier list intact)
  insert into r(check_name,outcome) values ('A4 failed saves keep previous windows', (select count(*) from public.pickup_windows where weekday = dow)::text);

  -- Today's weekday: one all-day window with no places, to prove walk-ins skip capacity (C9).
  perform public.set_pickup_windows(array[(select v::smallint from ctx where k = 'today_dow')],
    '[{"starts_at":"00:00","ends_at":"23:59","max_orders":0}]');
  insert into public.category_daily_caps (category_id, max_orders) values ((select v::uuid from ctx where k = 'cakes_cat'), 1);

  begin perform public.set_date_windows((now() at time zone 'Asia/Kolkata')::date - 1, 'Past', '[{"starts_at":"09:00","ends_at":"10:00"}]');
    insert into r(check_name,outcome) values ('A5 date override in the past refused', 'ALLOWED');
  -- expect: Choose today or a later date.
  exception when others then insert into r(check_name,outcome) values ('A5 date override in the past refused', sqlerrm); end;
end $$;

-- ===== Counter: settings are admin-only =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000004c1","role":"authenticated"}', true);
do $$ begin
  begin perform public.set_pickup_windows(array[1::smallint], '[]');
    insert into r(check_name,outcome) values ('E1 counter cannot change windows', 'ALLOWED');
  -- expect: Only an admin can change pickup windows.
  exception when others then insert into r(check_name,outcome) values ('E1 counter cannot change windows', sqlerrm); end;

  begin insert into public.category_daily_caps (category_id, max_orders) values ((select v::uuid from ctx where k = 'puffs_cat'), 3);
    insert into r(check_name,outcome) values ('E2 counter cannot set caps', 'ALLOWED');
  -- expect: new row violates row-level security policy …
  exception when others then insert into r(check_name,outcome) values ('E2 counter cannot set caps', sqlerrm); end;
end $$;

-- ===== Counter: orders against windows and caps =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000004c1","role":"authenticated"}', true);
do $$
declare o public.orders; o2 public.orders; h text;
begin
  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '09:30'));
  o2 := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '10:00'));
  insert into ctx values ('o1', o.id::text), ('o2', o2.id::text);
  -- expect: pending_confirmation pending_confirmation
  insert into r(check_name,outcome) values ('C1 two orders fill window 9-11', o.status || ' ' || o2.status);

  begin perform public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '10:30'));
    insert into r(check_name,outcome) values ('C2 full window refused', 'ALLOWED');
  -- expect: capacity: Pickup window 9:00 AM–11:00 AM is full (2/2). An admin can override with a reason.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C2 full window refused', h || ': ' || sqlerrm); end;

  begin perform public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '10:30'),
        p_override_reason => 'Counter wants it');
    insert into r(check_name,outcome) values ('C3 counter cannot override', 'ALLOWED');
  -- expect: forbidden: Only an admin can override scheduling rules.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C3 counter cannot override', h || ': ' || sqlerrm); end;

  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '11:00'));
  -- expect: pending_confirmation (11:00 belongs to the unlimited 11-13 window)
  insert into r(check_name,outcome) values ('C4 boundary time goes to the later window', o.status::text);

  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '13:00'));
  -- expect: pending_confirmation
  insert into r(check_name,outcome) values ('C5 end of last window accepted', o.status::text);

  begin perform public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '14:00'));
    insert into r(check_name,outcome) values ('C6 time outside every window refused', 'ALLOWED');
  -- expect: slot: 2:00 PM is outside the pickup windows for <Weekday DD Mon>. An admin can override with a reason.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C6 time outside every window refused', h || ': ' || sqlerrm); end;

  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('cake', 3),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '11:30'));
  -- expect: pending_confirmation cat=true (3 cakes use one of one place; category snapshot stored)
  insert into r(check_name,outcome) values ('C7 cap counts orders, not units',
    o.status || ' cat=' || ((select category_id from public.order_items where order_id = o.id) = (select v::uuid from ctx where k = 'cakes_cat'))::text);

  begin perform public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('cake', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '12:00'));
    insert into r(check_name,outcome) values ('C8 capped category refused', 'ALLOWED');
  -- expect: capacity: T Cap Cakes: 1/1 orders on <DD Mon>. An admin can override with a reason.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C8 capped category refused', h || ': ' || sqlerrm); end;

  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 2), p_confirm => true);
  -- expect: confirmed (today's weekday has one window with 0 places)
  insert into r(check_name,outcome) values ('C9 walk-in immediate order skips capacity', o.status::text);

  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(201, '14:00'));
  -- expect: pending_confirmation
  insert into r(check_name,outcome) values ('C10 weekday without windows is unrestricted', o.status::text);
end $$;

-- ===== Admin: overrides, reschedule, confirm, festival days, availability =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000004a1","role":"authenticated"}', true);
do $$
declare o public.orders; h text; o1 uuid := (select v::uuid from ctx where k = 'o1'); day date := (select v::date from ctx where k = 'day');
begin
  o := public.reject_order((select v::uuid from ctx where k = 'o2'), 1, 'Test rejection');
  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '10:45'));
  insert into ctx values ('o3', o.id::text);
  -- expect: pending_confirmation (the rejected order no longer counts)
  insert into r(check_name,outcome) values ('D1 rejected orders free their place', o.status::text);

  o := public.reschedule_order(o1, (select version from public.orders where id = o1), pg_temp.ts(200, '10:30'), 'Customer asked');
  -- expect: true (window is 2/2 but the order itself is not counted)
  insert into r(check_name,outcome) values ('D4 reschedule within its own full window', (o.due_at = pg_temp.ts(200, '10:30'))::text);
  -- expect: 1 (window 9-11 holds o1 and o3; the order being rescheduled is left out)
  insert into r(check_name,outcome) values ('D4b availability can leave out the order being rescheduled',
    (select w ->> 'used' from jsonb_array_elements(public.pickup_availability(day, o1) -> 'windows') w where w ->> 'starts_at' = '09:00'));

  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '10:15'),
        p_override_reason => 'Owner approved extra festival order');
  -- expect: Pickup window 9:00 AM–11:00 AM is full (2/2).
  insert into ctx values ('o4', o.id::text);
  insert into r(check_name,outcome) values ('D2 admin override records capacity detail',
    (select data ->> 'capacity' from public.order_events where order_id = o.id and event_type = 'override'));

  begin perform public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '10:20'),
        p_override_reason => 'ok');
    insert into r(check_name,outcome) values ('D3 short override reason refused', 'ALLOWED');
  -- expect: validation: Give an override reason of at least 5 characters.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('D3 short override reason refused', h || ': ' || sqlerrm); end;

  -- Window 9-11 now holds o1, o3 (booked normally) and o4 (admin override): 3/2.
  -- expect: confirmed (only orders booked before o3 count, so a later override does not block it)
  begin o := public.confirm_order((select v::uuid from ctx where k = 'o3'), 1);
    insert into r(check_name,outcome) values ('D5a earlier booking confirms despite a later override', o.status::text);
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('D5a earlier booking confirms despite a later override', h || ': ' || sqlerrm); end;
  -- expect: capacity: Pickup window 9:00 AM–11:00 AM is full (2/2). An admin can override with a reason.
  begin perform public.confirm_order((select v::uuid from ctx where k = 'o4'), 1);
    insert into r(check_name,outcome) values ('D5b the over-limit booking needs an override to confirm', 'ALLOWED');
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('D5b the over-limit booking needs an override to confirm', h || ': ' || sqlerrm); end;

  perform public.set_date_windows(day, 'Diwali', '[{"starts_at":"15:00","ends_at":"17:00","max_orders":5}]');
  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '16:00'));
  -- expect: pending_confirmation
  insert into r(check_name,outcome) values ('D6a festival windows replace the weekday list', o.status::text);
  begin perform public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '10:05'));
    insert into r(check_name,outcome) values ('D6b weekday window unavailable on festival day', 'ALLOWED');
  -- expect: slot: 10:05 AM is outside the pickup windows for <Weekday DD Mon>. …
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('D6b weekday window unavailable on festival day', h || ': ' || sqlerrm); end;

  insert into public.capacity_overrides (on_date, kind, category_id, max_orders, note)
    values (day, 'category', (select v::uuid from ctx where k = 'puffs_cat'), 0, 'No puffs on Diwali');
  begin perform public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '16:30'));
    insert into r(check_name,outcome) values ('D7 category date override of 0 blocks the category', 'ALLOWED');
  -- expect: capacity: T Cap Puffs: <n>/0 orders on <DD Mon>. …
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('D7 category date override of 0 blocks the category', h || ': ' || sqlerrm); end;

  -- expect: {"windows": [{"max": 5, "used": 1, "ends_at": "17:00", "starts_at": "15:00"}], "categories": [cakes used 1 max 1, puffs max 0 …]}
  insert into r(check_name,outcome) values ('D8 availability for the festival day', public.pickup_availability(day)::text);

  -- expect: true
  insert into r(check_name,outcome) values ('D9 capacity check holds the per-day advisory lock',
    exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and objsubid = 2
            and objid = (day - date '2000-01-01')::oid)::text);
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
