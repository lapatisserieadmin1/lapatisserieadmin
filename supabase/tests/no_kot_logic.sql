-- Kitchen tickets switched off (2026-10-09). Runs in a transaction and rolls back.
-- Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-0000000009a1','nk-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000009c1','nk-c@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-0000000009a1','Nk Admin','admin'),
 ('00000000-0000-0000-0000-0000000009c1','Nk Counter','counter');
insert into public.kitchens (code, name) values ('NK1', 'T Old Kitchen');

delete from public.capacity_overrides;
delete from public.category_daily_caps;
delete from public.pickup_windows;
delete from public.closures;
update public.business_hours set opens_at = '09:00', closes_at = '21:00', is_closed = false;

insert into public.categories (name) values ('T Nk Bakes');
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Nk Cake', 'made_to_order', 500 from public.categories where name = 'T Nk Bakes';
-- No kitchen on the variant: that used to block confirmation.
insert into public.product_variants (product_id, name, price_paise, lead_time_minutes)
  select id, '1 kg', 50000, 60 from public.products where name = 'T Nk Cake';
insert into ctx select 'cake', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Nk Cake';

create function pg_temp.day(p_days integer) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Kolkata')::date + p_days) + time '12:00') at time zone 'Asia/Kolkata'
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare o public.orders; h text;
begin
  o := public.create_order(gen_random_uuid(), 'CALL',
    jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k = 'cake'), 'quantity', 1)),
    'Nk Customer', '9000000901', pg_temp.day(3), p_confirm => true);
  insert into ctx values ('A', o.id::text);
  -- expect: confirmed / tickets 0
  insert into r(check_name,outcome) values ('N1 a made-to-order item with no kitchen confirms and makes no ticket',
    o.status || ' / tickets ' || (select count(*) from public.kitchen_tickets where order_id = o.id));

  o := public.mark_packed(o.id, o.version);
  -- expect: ready
  insert into r(check_name,outcome) values ('N2 a confirmed order packs with no kitchen step', o.status::text);

  begin perform public.set_staff_pin('00000000-0000-0000-0000-0000000009c1', '1234');
    insert into r(check_name,outcome) values ('N3 chef PINs can no longer be set', 'ALLOWED');
  -- expect: permission denied for function set_staff_pin
  exception when others then insert into r(check_name,outcome) values ('N3 chef PINs can no longer be set', sqlerrm); end;
end $$;

-- An order confirmed before the switch, with an open ticket and an open issue, is retired.
reset role;
do $$
declare o uuid; t uuid;
begin
  insert into public.orders (order_number, idempotency_key, source, status, customer_name, customer_phone, requested_due_at, confirmed_due_at)
  values (990901, gen_random_uuid(), 'CALL', 'preparing', 'Nk Old', '9000000902', pg_temp.day(2), pg_temp.day(2))
  returning id into o;
  insert into public.kitchen_tickets (order_id, kitchen_id, reference, source, status, due_at, start_by, pending_changes)
  values (o, (select id from public.kitchens where code = 'NK1'), 'NK-T-1', 'CALL', 'preparing', pg_temp.day(2), pg_temp.day(1), '[{"x":1}]')
  returning id into t;
  insert into public.kitchen_issues (ticket_id, kind, note) values (t, 'quality', 'Icing cracked');
  insert into ctx values ('B', o::text), ('BT', t::text);
  perform private.retire_kitchen_tickets();
end $$;
-- expect: cancelled / stop-work acknowledged true / changes false / issue resolved true / event 1
insert into r(check_name,outcome) values ('N4 live tickets and open issues are retired',
  (select t.status || ' / stop-work acknowledged ' || (t.stop_work_acknowledged_at is not null) || ' / changes ' || t.has_pending_changes
   from public.kitchen_tickets t where t.id = (select v::uuid from ctx where k = 'BT'))
  || ' / issue resolved ' || (select (resolved_at is not null)::text from public.kitchen_issues where ticket_id = (select v::uuid from ctx where k = 'BT'))
  || ' / event ' || (select count(*) from public.order_events where order_id = (select v::uuid from ctx where k = 'B') and event_type = 'kitchen_tickets_retired'));

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009c1","role":"authenticated"}', true);
do $$
declare o public.orders; b uuid := (select v::uuid from ctx where k = 'B');
begin
  o := public.mark_packed(b, (select version from public.orders where id = b));
  -- expect: ready
  insert into r(check_name,outcome) values ('N5 an order whose ticket was retired packs', o.status::text);
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
