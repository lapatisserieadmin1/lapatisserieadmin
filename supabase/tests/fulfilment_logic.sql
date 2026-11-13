-- Collect from store or set up at the customer's place, and the Customer source (2026-10-09).
-- Runs in a transaction and rolls back. Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-000000000da1','fu-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000dc1','fu-c@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-000000000da1','Fu Admin','admin'),
 ('00000000-0000-0000-0000-000000000dc1','Fu Counter','counter');

delete from public.capacity_overrides;
delete from public.category_daily_caps;
delete from public.pickup_windows;
delete from public.closures;
update public.business_settings set gstin = '33ABCDE1234F1Z5';
update public.business_hours set opens_at = '09:00', closes_at = '21:00', is_closed = false;

insert into public.categories (name) values ('T Fu Bakes');
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Fu Puff', 'ready_stock', 1800 from public.categories where name = 'T Fu Bakes';
insert into public.product_variants (product_id, name, price_paise)
  select id, 'Each', 3000 from public.products where name = 'T Fu Puff';
insert into ctx select 'puff', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Fu Puff';

create function pg_temp.day(p_days integer) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Kolkata')::date + p_days) + time '12:00') at time zone 'Asia/Kolkata'
$$;
create function pg_temp.items() returns jsonb language sql stable as $$
  select jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k = 'puff'), 'quantity', 2))
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000da1","role":"authenticated"}', true);
do $$
declare o public.orders; h text;
begin
  begin perform public.create_order(gen_random_uuid(), 'CALL', pg_temp.items(), 'Fu One', '9000000911', pg_temp.day(2),
      p_fulfilment => 'setup', p_setup_address => '   ');
    insert into r(check_name,outcome) values ('F1 set-up needs an address', 'ALLOWED');
  -- expect: Set-up orders need the customer's address.
  exception when others then insert into r(check_name,outcome) values ('F1 set-up needs an address', sqlerrm); end;

  o := public.create_order(gen_random_uuid(), 'CALL', pg_temp.items(), 'Fu One', '9000000911', pg_temp.day(2),
      p_fulfilment => 'setup', p_setup_address => ' 12 Rose Street, Anna Nagar ', p_setup_note => 'Hall on 2nd floor');
  insert into ctx values ('S', o.id::text);
  -- expect: setup / 12 Rose Street, Anna Nagar / Hall on 2nd floor
  insert into r(check_name,outcome) values ('F2 a set-up order keeps the address and note', o.fulfilment || ' / ' || o.setup_address || ' / ' || o.setup_note);

  o := public.create_order(gen_random_uuid(), 'CALL', pg_temp.items(), 'Fu One', '9000000911', pg_temp.day(2),
      p_setup_address => 'Ignored street');
  -- expect: collect / NULL
  insert into r(check_name,outcome) values ('F3 a collect order stores no address', o.fulfilment || ' / ' || coalesce(o.setup_address, 'NULL'));

  begin perform public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items(), null, null, null,
      p_fulfilment => 'setup', p_setup_address => '12 Rose Street');
    insert into r(check_name,outcome) values ('F4 set-up cannot be immediate', 'ALLOWED');
  -- expect: Set-up orders need a set-up date and time.
  exception when others then insert into r(check_name,outcome) values ('F4 set-up cannot be immediate', sqlerrm); end;

  begin perform public.create_order(gen_random_uuid(), 'CUSTOMER', pg_temp.items(), 'Fu Two', null, pg_temp.day(2));
    insert into r(check_name,outcome) values ('F5 customer orders need name and phone', 'ALLOWED');
  -- expect: Customer orders need the customer's name and phone number.
  exception when others then insert into r(check_name,outcome) values ('F5 customer orders need name and phone', sqlerrm); end;

  o := public.create_order(gen_random_uuid(), 'CUSTOMER', pg_temp.items(), 'Fu Two', '9000000912', pg_temp.day(2), p_confirm => true);
  -- expect: CUSTOMER / confirmed
  insert into r(check_name,outcome) values ('F6 an admin takes and confirms a customer order', o.source || ' / ' || o.status);
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000dc1","role":"authenticated"}', true);
do $$
declare o public.orders; s uuid := (select v::uuid from ctx where k = 'S');
begin
  begin perform public.create_order(gen_random_uuid(), 'CUSTOMER', pg_temp.items(), 'Fu Three', '9000000913', pg_temp.day(2), p_confirm => true);
    insert into r(check_name,outcome) values ('F7 counter cannot confirm a customer order', 'ALLOWED');
  -- expect: Only an admin can confirm call, customer and online orders.
  exception when others then insert into r(check_name,outcome) values ('F7 counter cannot confirm a customer order', sqlerrm); end;

  begin perform public.set_fulfilment(s, (select version from public.orders where id = s), 'setup', '');
    insert into r(check_name,outcome) values ('F8 changing to set-up needs an address', 'ALLOWED');
  -- expect: Set-up orders need the customer's address.
  exception when others then insert into r(check_name,outcome) values ('F8 changing to set-up needs an address', sqlerrm); end;

  o := public.set_fulfilment(s, (select version from public.orders where id = s), 'collect', 'kept?', 'kept?');
  -- expect: collect / NULL / NULL / setup -> collect
  insert into r(check_name,outcome) values ('F9 switching to collect clears the address and logs the change',
    o.fulfilment || ' / ' || coalesce(o.setup_address, 'NULL') || ' / ' || coalesce(o.setup_note, 'NULL') || ' / '
    || (select (data ->> 'from') || ' -> ' || (data ->> 'to') from public.order_events where order_id = s and event_type = 'fulfilment_changed'));

  insert into ctx values ('CS', (public.counter_sale(gen_random_uuid(), pg_temp.items(),
    jsonb_build_array(jsonb_build_object('method', 'cash', 'amount_paise', 6000))) ->> 'order_id'));
  -- expect: collect
  insert into r(check_name,outcome) values ('F10 a counter sale is always collect',
    (select fulfilment::text from public.orders where id = (select v::uuid from ctx where k = 'CS')));
end $$;

-- A completed order (the counter sale) cannot change.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000da1","role":"authenticated"}', true);
do $$
declare s uuid := (select v::uuid from ctx where k = 'CS');
begin
  begin perform public.set_fulfilment(s, (select version from public.orders where id = s), 'setup', '12 Rose Street');
    insert into r(check_name,outcome) values ('F11 a completed order cannot change', 'ALLOWED');
  -- expect: Collect or set-up cannot change on a completed order.
  exception when others then insert into r(check_name,outcome) values ('F11 a completed order cannot change', sqlerrm); end;
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
