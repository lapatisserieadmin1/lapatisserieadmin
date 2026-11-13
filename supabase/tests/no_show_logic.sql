-- No-show recording and customer blocking (Phase 4C). Runs in a transaction and rolls back.
-- Test orders are inserted directly with order numbers from 990001, so order_number_seq is not consumed.
-- Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
grant all on r to authenticated;
grant usage on sequence r_n_seq to authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-0000000005a1','ns-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000005c1','ns-c@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000005f1','ns-f@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-0000000005a1','NS Admin','admin'),
 ('00000000-0000-0000-0000-0000000005c1','NS Counter','counter'),
 ('00000000-0000-0000-0000-0000000005f1','NS Chef','chef');

-- Predictable opening hours for the blocked-phone check (all rolled back).
delete from public.closures;
update public.business_hours set opens_at = '09:00', closes_at = '21:00', is_closed = false;

insert into public.customers (id, full_name, phone) values
 ('00000000-0000-0000-0000-00000000c001','NS Customer','9000000501');

-- o1 confirmed, past pickup · o2 confirmed, future pickup · o3 completed, past · o4 cancelled, past
-- o5 walk-in without a customer, past · o6 pending confirmation, past
insert into public.orders (id, order_number, idempotency_key, source, status, customer_id, customer_name, customer_phone, requested_due_at, confirmed_due_at)
values
 ('00000000-0000-0000-0000-0000000e0001', 990001, gen_random_uuid(), 'CALL', 'confirmed', '00000000-0000-0000-0000-00000000c001', 'NS Customer', '9000000501', now() - interval '2 hours', now() - interval '2 hours'),
 ('00000000-0000-0000-0000-0000000e0002', 990002, gen_random_uuid(), 'CALL', 'confirmed', '00000000-0000-0000-0000-00000000c001', 'NS Customer', '9000000501', now() + interval '2 hours', now() + interval '2 hours'),
 ('00000000-0000-0000-0000-0000000e0003', 990003, gen_random_uuid(), 'CALL', 'completed', '00000000-0000-0000-0000-00000000c001', 'NS Customer', '9000000501', now() - interval '2 hours', now() - interval '2 hours'),
 ('00000000-0000-0000-0000-0000000e0004', 990004, gen_random_uuid(), 'CALL', 'cancelled', '00000000-0000-0000-0000-00000000c001', 'NS Customer', '9000000501', now() - interval '3 hours', now() - interval '3 hours'),
 ('00000000-0000-0000-0000-0000000e0005', 990005, gen_random_uuid(), 'IN_STORE', 'confirmed', null, null, null, now() - interval '2 hours', now() - interval '2 hours'),
 ('00000000-0000-0000-0000-0000000e0006', 990006, gen_random_uuid(), 'CALL', 'pending_confirmation', '00000000-0000-0000-0000-00000000c001', 'NS Customer', '9000000501', now() - interval '2 hours', null);

set local role authenticated;

-- ===== Chef =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005f1","role":"authenticated"}', true);
do $$
declare h text;
begin
  begin perform public.record_no_show('00000000-0000-0000-0000-0000000e0001', 1);
    insert into r(check_name,outcome) values ('N1 chef cannot record a no-show', 'ALLOWED');
  -- expect: forbidden: You do not have permission to record no-shows.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('N1 chef cannot record a no-show', h || ': ' || sqlerrm); end;
end $$;

-- ===== Counter =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005c1","role":"authenticated"}', true);
do $$
declare o public.orders; h text;
begin
  o := public.record_no_show('00000000-0000-0000-0000-0000000e0001', 1);
  -- expect: confirmed / 2 / true (status unchanged, version bumped, stamped)
  insert into r(check_name,outcome) values ('N2 counter records a no-show; status unchanged',
    o.status::text || ' / ' || o.version || ' / ' || (o.no_show_at is not null and o.no_show_by = auth.uid())::text);
  -- expect: 1
  insert into r(check_name,outcome) values ('N3 customer count goes up',
    (select no_show_count from public.customers where id = '00000000-0000-0000-0000-00000000c001')::text);
  -- expect: {"no_show_count": 1}
  insert into r(check_name,outcome) values ('N4 timeline entry',
    (select data::text from public.order_events where order_id = o.id and event_type = 'no_show_recorded'));

  begin perform public.record_no_show('00000000-0000-0000-0000-0000000e0001', 2);
    insert into r(check_name,outcome) values ('N5 same order counts once', 'ALLOWED');
  -- expect: validation: A no-show is already recorded for this order.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('N5 same order counts once', h || ': ' || sqlerrm); end;

  begin perform public.record_no_show('00000000-0000-0000-0000-0000000e0001', 1);
    insert into r(check_name,outcome) values ('N6 stale version refused', 'ALLOWED');
  -- expect: conflict: This order was changed by someone else. …
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('N6 stale version refused', h || ': ' || sqlerrm); end;

  begin perform public.record_no_show('00000000-0000-0000-0000-0000000e0002', 1);
    insert into r(check_name,outcome) values ('N7 future pickup refused', 'ALLOWED');
  -- expect: validation: The pickup time has not passed yet.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('N7 future pickup refused', h || ': ' || sqlerrm); end;

  begin perform public.record_no_show('00000000-0000-0000-0000-0000000e0003', 1);
    insert into r(check_name,outcome) values ('N8 completed order refused', 'ALLOWED');
  -- expect: validation: A no-show cannot be recorded on a completed order.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('N8 completed order refused', h || ': ' || sqlerrm); end;

  begin perform public.record_no_show('00000000-0000-0000-0000-0000000e0005', 1);
    insert into r(check_name,outcome) values ('N9 order without a customer refused', 'ALLOWED');
  -- expect: validation: This order has no customer phone number to record a no-show against.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('N9 order without a customer refused', h || ': ' || sqlerrm); end;

  begin perform public.record_no_show('00000000-0000-0000-0000-0000000e0006', 1);
    insert into r(check_name,outcome) values ('N10 pending order refused', 'ALLOWED');
  -- expect: validation: A no-show cannot be recorded on a pending confirmation order.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('N10 pending order refused', h || ': ' || sqlerrm); end;

  o := public.record_no_show('00000000-0000-0000-0000-0000000e0004', 1);
  -- expect: cancelled / 2
  insert into r(check_name,outcome) values ('N11 cancelled order can be recorded',
    o.status::text || ' / ' || (select no_show_count from public.customers where id = o.customer_id));

  begin perform public.undo_no_show('00000000-0000-0000-0000-0000000e0001', 2, 'Customer came late');
    insert into r(check_name,outcome) values ('N12 counter cannot undo', 'ALLOWED');
  -- expect: forbidden: Only an admin can undo a no-show.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('N12 counter cannot undo', h || ': ' || sqlerrm); end;

  begin perform public.set_customer_blocked('00000000-0000-0000-0000-00000000c001', true, 'Repeated no-shows');
    insert into r(check_name,outcome) values ('N13 counter cannot block', 'ALLOWED');
  -- expect: forbidden: Only an admin can block or unblock customers.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('N13 counter cannot block', h || ': ' || sqlerrm); end;
end $$;

-- ===== Admin =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000005a1","role":"authenticated"}', true);
do $$
declare o public.orders; c public.customers; h text;
begin
  begin perform public.undo_no_show('00000000-0000-0000-0000-0000000e0001', 2, '  ');
    insert into r(check_name,outcome) values ('N14 undo needs a reason', 'ALLOWED');
  -- expect: validation: Give a reason for undoing the no-show.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('N14 undo needs a reason', h || ': ' || sqlerrm); end;

  o := public.undo_no_show('00000000-0000-0000-0000-0000000e0001', 2, 'Customer came late');
  -- expect: true / 3 / 1 / Customer came late
  insert into r(check_name,outcome) values ('N15 admin undoes a no-show',
    (o.no_show_at is null and o.no_show_by is null)::text || ' / ' || o.version || ' / '
    || (select no_show_count from public.customers where id = o.customer_id) || ' / '
    || (select reason from public.order_events where order_id = o.id and event_type = 'no_show_undone'));

  begin perform public.undo_no_show('00000000-0000-0000-0000-0000000e0001', 3, 'Again');
    insert into r(check_name,outcome) values ('N16 undo without a no-show refused', 'ALLOWED');
  -- expect: validation: No no-show is recorded for this order.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('N16 undo without a no-show refused', h || ': ' || sqlerrm); end;

  o := public.record_no_show('00000000-0000-0000-0000-0000000e0001', 3);
  -- expect: 2 (recording again after an undo counts again)
  insert into r(check_name,outcome) values ('N17 re-record after undo',
    (select no_show_count from public.customers where id = o.customer_id)::text);

  begin perform public.set_customer_blocked('00000000-0000-0000-0000-00000000c001', true, '');
    insert into r(check_name,outcome) values ('N18 block needs a reason', 'ALLOWED');
  -- expect: validation: Give a reason for blocking.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('N18 block needs a reason', h || ': ' || sqlerrm); end;

  c := public.set_customer_blocked('00000000-0000-0000-0000-00000000c001', true, ' Repeated no-shows ');
  -- expect: true / Repeated no-shows
  insert into r(check_name,outcome) values ('N19 admin blocks', c.is_blocked::text || ' / ' || c.blocked_reason);

  begin perform public.set_customer_blocked('00000000-0000-0000-0000-00000000c001', true, 'Twice');
    insert into r(check_name,outcome) values ('N20 blocking twice refused', 'ALLOWED');
  -- expect: conflict: This customer is already blocked.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('N20 blocking twice refused', h || ': ' || sqlerrm); end;

  begin perform public.create_order(gen_random_uuid(), 'CALL',
        jsonb_build_array(jsonb_build_object('variant_id', gen_random_uuid(), 'quantity', 1)),
        p_customer_name => 'NS Customer', p_customer_phone => '90000 00501', p_due_at => (((now() at time zone 'Asia/Kolkata')::date + 3) + time '12:00') at time zone 'Asia/Kolkata');
    insert into r(check_name,outcome) values ('N21 create_order refuses the blocked phone', 'ALLOWED');
  -- expect: blocked: This phone number is blocked. An admin can override with a reason.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('N21 create_order refuses the blocked phone', h || ': ' || sqlerrm); end;

  begin perform public.set_customer_blocked('00000000-0000-0000-0000-00000000c001', false, null);
    insert into r(check_name,outcome) values ('N22 unblock needs a reason', 'ALLOWED');
  -- expect: validation: Give a reason for unblocking.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('N22 unblock needs a reason', h || ': ' || sqlerrm); end;

  c := public.set_customer_blocked('00000000-0000-0000-0000-00000000c001', false, 'Owner spoke to customer');
  -- expect: false / null
  insert into r(check_name,outcome) values ('N23 admin unblocks; current reason cleared',
    c.is_blocked::text || ' / ' || coalesce(c.blocked_reason, 'null'));
  -- expect: blocked: Repeated no-shows | unblocked: Owner spoke to customer
  insert into r(check_name,outcome) values ('N24 block history keeps both reasons',
    (select string_agg(event_type || ': ' || reason, ' | ' order by id) from public.customer_events
     where customer_id = c.id));
end $$;

-- ===== Direct writes =====
do $$
declare h text;
begin
  begin update public.customers set is_blocked = true where id = '00000000-0000-0000-0000-00000000c001';
    insert into r(check_name,outcome) values ('N25 direct customer update refused', 'ALLOWED');
  -- expect: permission denied for table customers
  exception when others then insert into r(check_name,outcome) values ('N25 direct customer update refused', sqlerrm); end;
  begin insert into public.customer_events (customer_id, event_type, reason) values ('00000000-0000-0000-0000-00000000c001', 'blocked', 'x');
    insert into r(check_name,outcome) values ('N26 direct customer event insert refused', 'ALLOWED');
  -- expect: permission denied for table customer_events
  exception when others then insert into r(check_name,outcome) values ('N26 direct customer event insert refused', sqlerrm); end;
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
