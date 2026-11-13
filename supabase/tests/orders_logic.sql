-- Business-rule checks for Phase 4A order functions. Runs in a transaction and rolls back.
-- order_number_seq is not transactional: each run consumes order numbers
-- (reset with `alter sequence public.order_number_seq restart with 1001` only while no real orders exist).
-- Expected (2026-09-27): all outcomes read as the check name describes; see comments per check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-0000000000a1','a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000c1','c@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000f1','f@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-0000000000a1','T Admin','admin'),
 ('00000000-0000-0000-0000-0000000000c1','T Counter','counter'),
 ('00000000-0000-0000-0000-0000000000f1','T Chef','chef');
insert into public.categories (name) values ('T Cat');
insert into public.products (category_id, name, prep_type, tax_rate_bps) select id, 'T Cake', 'made_to_order', 500 from public.categories where name='T Cat';
insert into public.products (category_id, name, prep_type, tax_rate_bps) select id, 'T Puff', 'ready_stock', 1800 from public.categories where name='T Cat';
insert into public.product_variants (product_id, name, price_paise, kitchen_id, lead_time_minutes)
  select p.id, '1 kg', 105000, k.id, 240 from public.products p, public.kitchens k where p.name='T Cake' and k.code='K1';
insert into public.product_variants (product_id, name, price_paise, is_eggless, lead_time_minutes)
  select id, '1 kg Eggless', 115000, true, 240 from public.products where name='T Cake';
insert into public.product_variants (product_id, name, price_paise)
  select id, 'Each', 3000 from public.products where name='T Puff';
insert into ctx select 'cake', v.id::text from public.product_variants v where v.name='1 kg';
insert into ctx select 'eggless', v.id::text from public.product_variants v where v.name='1 kg Eggless';
insert into ctx select 'puff', v.id::text from public.product_variants v where v.name='Each';
insert into ctx values ('tomorrow11', (((now() at time zone 'Asia/Kolkata')::date + 1 + time '11:00') at time zone 'Asia/Kolkata')::text);
insert into ctx values ('tomorrow23', (((now() at time zone 'Asia/Kolkata')::date + 1 + time '23:00') at time zone 'Asia/Kolkata')::text);

set local role authenticated;

-- Counter staff
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
do $$
declare o public.orders; o2 public.orders;
begin
  o := public.create_order('10000000-0000-0000-0000-000000000001', 'IN_STORE',
        jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k='puff'), 'quantity', 4)), p_confirm => true);
  -- expect: confirmed total=12000 tax=1831
  insert into r(check_name,outcome) values ('counter walk-in ready-stock confirmed', o.status || ' total=' || o.total_paise || ' tax=' || o.tax_paise);
  o2 := public.create_order('10000000-0000-0000-0000-000000000001', 'IN_STORE',
        jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k='puff'), 'quantity', 9)));
  insert into r(check_name,outcome) values ('retry with same key returns same order (AC-07)', (o.id = o2.id)::text);

  o2 := public.create_order('10000000-0000-0000-0000-000000000003', 'IN_STORE',
        jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k='puff'), 'quantity', 1)),
        p_customer_name => 'Past pickup', p_customer_phone => '9000000001',
        p_due_at => now() - interval '1 day', p_confirm => true);
  -- expect: confirmed / true
  insert into r(check_name,outcome) values ('staff can confirm an order with a past pickup date',
    o2.status || ' / ' || (o2.confirmed_due_at < now())::text);

  begin perform public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k='cake'), 'quantity', 1)), p_due_at => (select v::timestamptz from ctx where k='tomorrow11'));
    insert into r(check_name,outcome) values ('call order without phone rejected', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('call order without phone rejected', sqlerrm); end;

  o := public.create_order('10000000-0000-0000-0000-000000000002', 'CALL',
        jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k='cake'), 'quantity', 2, 'notes', 'Happy Birthday Asha')),
        p_customer_name => 'Asha R', p_customer_phone => '98400 12345', p_due_at => (select v::timestamptz from ctx where k='tomorrow11'));
  -- expect: pending_confirmation total=210000 tax=10000 phone=9840012345
  insert into r(check_name,outcome) values ('call order created pending', o.status || ' total=' || o.total_paise || ' tax=' || o.tax_paise || ' phone=' || o.customer_phone);
  insert into ctx values ('call', o.id::text);

  begin perform public.confirm_order(o.id, o.version);
    insert into r(check_name,outcome) values ('counter cannot confirm call order', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('counter cannot confirm call order', sqlerrm); end;

  begin perform public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k='cake'), 'quantity', 1)),
        p_customer_name => 'X', p_customer_phone => '9840012345', p_due_at => (select v::timestamptz from ctx where k='tomorrow23'));
    insert into r(check_name,outcome) values ('pickup outside hours rejected (AC-17)', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('pickup outside hours rejected (AC-17)', sqlerrm); end;

  begin perform public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k='cake'), 'quantity', 1)),
        p_customer_name => 'X', p_customer_phone => '9840012345', p_due_at => now() + interval '1 hour');
    insert into r(check_name,outcome) values ('lead time violation rejected', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('lead time violation rejected', sqlerrm); end;

  begin perform public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k='cake'), 'quantity', 1)),
        p_customer_name => 'X', p_customer_phone => '9840012345', p_due_at => now() + interval '1 hour', p_override_reason => 'owner said ok');
    insert into r(check_name,outcome) values ('counter cannot override', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('counter cannot override', sqlerrm); end;

  perform public.record_payment(o.id, '20000000-0000-0000-0000-000000000001', 'payment', 'upi', 50000, 'UPI123', null, now() - interval '2 days');
  -- expect: true
  insert into r(check_name,outcome) values ('payment date is separate from the entry timestamp',
    (select paid_at < recorded_at from public.payments where idempotency_key = '20000000-0000-0000-0000-000000000001')::text);
  begin perform public.record_payment(o.id, gen_random_uuid(), 'payment', 'cash', 1, null, null, now() + interval '1 day');
    insert into r(check_name,outcome) values ('future payment dates are refused', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('future payment dates are refused', sqlerrm); end;
  begin perform public.record_payment(o.id, gen_random_uuid(), 'payment', 'cash', 999999);
    insert into r(check_name,outcome) values ('overpayment rejected', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('overpayment rejected', sqlerrm); end;
  begin perform public.record_payment(o.id, gen_random_uuid(), 'refund', 'cash', 100, null, 'x');
    insert into r(check_name,outcome) values ('counter cannot refund', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('counter cannot refund', sqlerrm); end;
  perform public.record_payment(o.id, '20000000-0000-0000-0000-000000000001', 'payment', 'upi', 50000);
  -- expect: 1 balance=160000
  insert into r(check_name,outcome) values ('deposit recorded once despite retry', (select count(*)::text from public.payments where order_id = o.id) || ' balance=' || (select balance_paise from public.order_summaries where id = o.id));
end $$;

-- Admin
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$
declare o public.orders; e text;
begin
  begin perform public.confirm_order((select v::uuid from ctx where k='call'), 99);
    insert into r(check_name,outcome) values ('stale version rejected (AC-18)', 'ALLOWED');
  exception when others then get stacked diagnostics e = pg_exception_hint; insert into r(check_name,outcome) values ('stale version rejected (AC-18)', e || ': ' || sqlerrm); end;

  o := public.confirm_order((select v::uuid from ctx where k='call'), (select version from public.orders where id = (select v::uuid from ctx where k='call')));
  insert into r(check_name,outcome) values ('admin confirms call order', o.status::text);

  update public.product_variants set price_paise = 1, kitchen_id = null where id = (select v::uuid from ctx where k='cake');
  -- expect: 105000 kitchen_set=true
  insert into r(check_name,outcome) values ('catalogue edit leaves snapshot unchanged (AC-11)',
    (select unit_price_paise || ' kitchen_set=' || (kitchen_id is not null) from public.order_items where order_id = o.id));

  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k='eggless'), 'quantity', 1)),
        p_customer_name => 'Ben', p_customer_phone => '+919840099999', p_due_at => (select v::timestamptz from ctx where k='tomorrow11'));
  begin perform public.confirm_order(o.id, o.version);
    -- expect: ALLOWED
    insert into r(check_name,outcome) values ('an item with no kitchen confirms (KOT retired 2026-10-09)', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('an item with no kitchen confirms (KOT retired 2026-10-09)', sqlerrm); end;

  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k='puff'), 'quantity', 1)),
        p_customer_name => 'Cy', p_customer_phone => '9840011111', p_due_at => (select v::timestamptz from ctx where k='tomorrow23'), p_override_reason => 'Staying late for this customer', p_confirm => true);
  insert into r(check_name,outcome) values ('admin override with reason is logged', o.status || ' events=' || (select string_agg(event_type || coalesce(':' || reason, ''), ', ' order by id) from public.order_events where order_id = o.id));

  o := public.reschedule_order((select v::uuid from ctx where k='call'), (select version from public.orders where id = (select v::uuid from ctx where k='call')),
        (select v::timestamptz from ctx where k='tomorrow11') + interval '3 hours', 'Customer asked for later');
  insert into r(check_name,outcome) values ('reschedule updates due and confirmed due', (o.due_at = (select v::timestamptz from ctx where k='tomorrow11') + interval '3 hours')::text || ' ' || (o.confirmed_due_at = o.due_at)::text);

  begin perform public.record_payment(o.id, gen_random_uuid(), 'refund', 'upi', 20000);
    insert into r(check_name,outcome) values ('refund needs reason', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('refund needs reason', sqlerrm); end;

  o := public.cancel_order(o.id, o.version, 'Customer cancelled');
  -- expect: cancelled balance=-50000
  insert into r(check_name,outcome) values ('cancelled order shows refund due, not auto-refunded (AC-08)', o.status || ' balance=' || (select balance_paise from public.order_summaries where id = o.id));

  begin insert into public.orders (idempotency_key, source, status, requested_due_at) values (gen_random_uuid(), 'IN_STORE', 'completed', now());
    insert into r(check_name,outcome) values ('direct table insert blocked', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('direct table insert blocked', sqlerrm); end;
end $$;

-- Chef
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000f1","role":"authenticated"}', true);
do $$ begin
  insert into r(check_name,outcome) values ('chef sees no orders or payments (expect 0/0)', (select count(*) from public.orders) || '/' || (select count(*) from public.payments));
  begin perform public.create_order(gen_random_uuid(), 'IN_STORE', jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k='puff'), 'quantity', 1)));
    insert into r(check_name,outcome) values ('chef cannot create orders', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('chef cannot create orders', sqlerrm); end;
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
