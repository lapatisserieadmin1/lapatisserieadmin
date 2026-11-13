-- Packing and handover (Phase 5B; kitchen tickets switched off 2026-10-09). Runs in a transaction and rolls back.
-- Orders are inserted directly with order numbers from 990301, so order_number_seq is not consumed.
-- Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-0000000008a1','pk-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000008c1','pk-c@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000008f1','pk-f@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-0000000008a1','Pk Admin','admin'),
 ('00000000-0000-0000-0000-0000000008c1','Pk Counter','counter'),
 ('00000000-0000-0000-0000-0000000008f1','Pk Chef','chef');
insert into public.kitchens (code, name) values ('TP1', 'T Pack Kitchen');
insert into public.staff_kitchens (user_id, kitchen_id)
  select '00000000-0000-0000-0000-0000000008f1'::uuid, id from public.kitchens where code = 'TP1';

-- Predictable scheduling rules (all rolled back).
delete from public.capacity_overrides;
delete from public.category_daily_caps;
delete from public.pickup_windows;
delete from public.closures;
update public.business_hours set opens_at = '09:00', closes_at = '21:00', is_closed = false;

insert into public.categories (name) values ('T Pk Bakes');
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Pk Cake', 'made_to_order', 500 from public.categories where name = 'T Pk Bakes';
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Pk Puff', 'ready_stock', 1800 from public.categories where name = 'T Pk Bakes';
insert into public.product_variants (product_id, name, price_paise, lead_time_minutes, kitchen_id)
  select p.id, '1 kg', 50000, 120, k.id from public.products p, public.kitchens k where p.name = 'T Pk Cake' and k.code = 'TP1';
insert into public.product_variants (product_id, name, price_paise)
  select id, 'Each', 3000 from public.products where name = 'T Pk Puff';
insert into ctx select 'cake', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Pk Cake';
insert into ctx select 'puff', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Pk Puff';

-- Noon on day p_days after today, business time.
create function pg_temp.day(p_days integer) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Kolkata')::date + p_days) + time '12:00') at time zone 'Asia/Kolkata'
$$;
-- Pending call order inserted straight into the table.
create function pg_temp.mk_order(p_num bigint, p_due timestamptz) returns uuid language sql as $$
  insert into public.orders (order_number, idempotency_key, source, status, customer_name, customer_phone, requested_due_at)
  values (p_num, gen_random_uuid(), 'CALL', 'pending_confirmation', 'Pk Customer', '9000000801', p_due)
  returning id
$$;
-- Order line snapshotting the catalogue, as create_order does.
create function pg_temp.mk_line(p_order uuid, p_key text, p_qty integer) returns uuid language sql as $$
  insert into public.order_items (
    order_id, line_no, product_id, variant_id, category_id, product_name, variant_name, prep_type, kitchen_id,
    is_veg, contains_egg, is_eggless, allergens, lead_time_minutes, unit_price_paise, tax_rate_bps,
    quantity, line_total_paise, tax_paise)
  select p_order, coalesce((select max(line_no) from public.order_items where order_id = p_order), 0) + 1,
         p.id, pv.id, p.category_id, p.name, pv.name, p.prep_type,
         case when p.prep_type = 'made_to_order' then pv.kitchen_id end,
         p.is_veg, p.contains_egg, pv.is_eggless, p.allergens, pv.lead_time_minutes, pv.price_paise, p.tax_rate_bps,
         p_qty, pv.price_paise * p_qty, 0
  from public.product_variants pv join public.products p on p.id = pv.product_id
  where pv.id = (select v::uuid from ctx where k = p_key)
  returning id
$$;

-- M: cake ×1 + puff ×1 · S: puff ×2 (ready stock only) · I: cake ×1 (kitchen issue) · X: puff ×1 (cancelled)
insert into ctx values ('M', pg_temp.mk_order(990301, pg_temp.day(3))::text);
insert into ctx values ('S', pg_temp.mk_order(990302, pg_temp.day(3))::text);
insert into ctx values ('I', pg_temp.mk_order(990303, pg_temp.day(3))::text);
insert into ctx values ('X', pg_temp.mk_order(990304, pg_temp.day(3))::text);
select pg_temp.mk_line((select v::uuid from ctx where k = 'M'), 'cake', 1);
select pg_temp.mk_line((select v::uuid from ctx where k = 'M'), 'puff', 1);
select pg_temp.mk_line((select v::uuid from ctx where k = 'S'), 'puff', 2);
select pg_temp.mk_line((select v::uuid from ctx where k = 'I'), 'cake', 1);
select pg_temp.mk_line((select v::uuid from ctx where k = 'X'), 'puff', 1);
select private.recalc_order_totals(v::uuid) from ctx where k in ('M', 'S', 'I', 'X');

set local role authenticated;

-- ===== Packing =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000008a1","role":"authenticated"}', true);
do $$
begin
  perform public.confirm_order(v::uuid, 1) from ctx where k in ('M', 'S', 'I', 'X');
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000008c1","role":"authenticated"}', true);
do $$
declare h text; o public.orders; m uuid := (select v::uuid from ctx where k = 'M'); s uuid := (select v::uuid from ctx where k = 'S');
begin
  o := public.mark_packed(s, 2, '  Two puffs in one box  ');
  -- expect: ready v3 / Pk Counter / Two puffs in one box
  insert into r(check_name,outcome) values ('P2 a ready-stock-only order packs straight from confirmed',
    o.status || ' v' || o.version || ' / ' || (select full_name from public.staff_profiles where user_id = o.packed_by) || ' / ' || o.packing_note);

  o := public.mark_packed(s, 2);
  -- expect: ready v3 / 1
  insert into r(check_name,outcome) values ('P3 packing again changes nothing',
    o.status || ' v' || o.version || ' / ' || (select count(*) from public.order_events where order_id = s and event_type = 'packed'));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000008f1","role":"authenticated"}', true);
do $$
declare h text; m uuid := (select v::uuid from ctx where k = 'M'); i uuid := (select v::uuid from ctx where k = 'I');
begin
  begin perform public.mark_packed(m, 2);
    insert into r(check_name,outcome) values ('P4 chefs cannot pack', 'ALLOWED');
  -- expect: forbidden: Only admin and counter staff can pack orders.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('P4 chefs cannot pack', h || ': ' || sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000008c1","role":"authenticated"}', true);
do $$
declare h text; o public.orders; m uuid := (select v::uuid from ctx where k = 'M'); i uuid := (select v::uuid from ctx where k = 'I');
begin
  begin perform public.mark_packed(m, 1);
    insert into r(check_name,outcome) values ('P5 stale version refused', 'ALLOWED');
  -- expect: conflict: This order was changed by someone else. Reload to see the latest version.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('P5 stale version refused', h || ': ' || sqlerrm); end;

  o := public.mark_packed(m, (select version from public.orders where id = m));
  -- expect: ready / true
  insert into r(check_name,outcome) values ('P6 a confirmed order with a made-to-order item packs', o.status || ' / ' || (o.packed_at is not null)::text);

end $$;

-- ===== Handover =====
do $$
declare h text; m uuid := (select v::uuid from ctx where k = 'M');
begin
  begin perform public.record_handover(m, (select version from public.orders where id = m));
    insert into r(check_name,outcome) values ('H1 a balance due blocks handover', 'ALLOWED');
  -- expect: balance: ₹530.00 is still due. Record the payment first, or an admin can hand over on credit with a reason.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('H1 a balance due blocks handover', h || ': ' || sqlerrm); end;
  begin perform public.record_handover(m, (select version from public.orders where id = m), null, 'Pays on Friday');
    insert into r(check_name,outcome) values ('H2 counter staff cannot give credit', 'ALLOWED');
  -- expect: forbidden: Only an admin can hand over an order with a balance due.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('H2 counter staff cannot give credit', h || ': ' || sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000008a1","role":"authenticated"}', true);
do $$
declare h text; o public.orders; ver integer; m uuid := (select v::uuid from ctx where k = 'M');
begin
  begin perform public.record_handover(m, (select version from public.orders where id = m), null, 'ok');
    insert into r(check_name,outcome) values ('H3 credit needs a real reason', 'ALLOWED');
  -- expect: Give a credit reason of 5 to 300 characters.
  exception when others then insert into r(check_name,outcome) values ('H3 credit needs a real reason', sqlerrm); end;

  ver := (select version from public.orders where id = m);
  o := public.record_handover(m, ver, ' Ravi (brother) ', 'Regular customer, pays Friday');
  -- expect: completed / Ravi (brother) / Regular customer, pays Friday / AB/<fy>/00001
  insert into r(check_name,outcome) values ('H4 admin hands over on credit; the bill is issued',
    o.status || ' / ' || o.collected_by || ' / ' || o.credit_reason || ' / ' || (select bill_number from public.bills where order_id = m));
  -- expect: 53000 / 53000
  insert into r(check_name,outcome) values ('H5 the balance at handover is recorded and still due',
    (select data ->> 'balance_paise' from public.order_events where order_id = m and event_type = 'handed_over')
    || ' / ' || (select balance_paise from public.order_summaries where id = m));

  o := public.record_handover(m, ver, null, null);
  -- expect: completed / 1 handover / 1 bill
  insert into r(check_name,outcome) values ('H6 handing over again changes nothing',
    o.status || ' / ' || (select count(*) from public.order_events where order_id = m and event_type = 'handed_over') || ' handover / '
    || (select count(*) from public.bills where order_id = m) || ' bill');
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000008c1","role":"authenticated"}', true);
do $$
declare h text; o public.orders; s uuid := (select v::uuid from ctx where k = 'S'); i uuid := (select v::uuid from ctx where k = 'I');
begin
  perform public.record_payment(s, gen_random_uuid(), 'payment', 'upi', (select total_paise from public.orders where id = s));
  o := public.record_handover(s, (select version from public.orders where id = s));
  -- expect: completed / no credit / Pk Counter / AB/<fy>/00002
  insert into r(check_name,outcome) values ('H7 a paid order is handed over by counter staff',
    o.status || ' / ' || coalesce(o.credit_reason, 'no credit') || ' / '
    || (select full_name from public.staff_profiles where user_id = o.handed_over_by) || ' / '
    || (select bill_number from public.bills where order_id = s));
  begin perform public.record_handover(i, (select version from public.orders where id = i));
    insert into r(check_name,outcome) values ('H8 an unpacked order cannot be handed over', 'ALLOWED');
  -- expect: Pack the order before handing it over.
  exception when others then insert into r(check_name,outcome) values ('H8 an unpacked order cannot be handed over', sqlerrm); end;
end $$;

-- ===== Reopening and closed orders =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000008a1","role":"authenticated"}', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000008c1","role":"authenticated"}', true);
do $$
declare h text; i uuid := (select v::uuid from ctx where k = 'I');
begin
  perform public.mark_packed(i, (select version from public.orders where id = i));
  begin perform public.reopen_packing(i, (select version from public.orders where id = i), 'Wrong box used');
    insert into r(check_name,outcome) values ('R1 counter staff cannot reopen', 'ALLOWED');
  -- expect: forbidden: Only an admin can reopen a packed order.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('R1 counter staff cannot reopen', h || ': ' || sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000008a1","role":"authenticated"}', true);
do $$
declare h text; o public.orders; i uuid := (select v::uuid from ctx where k = 'I'); m uuid := (select v::uuid from ctx where k = 'M');
  x uuid := (select v::uuid from ctx where k = 'X');
begin
  begin perform public.reopen_packing(i, (select version from public.orders where id = i), 'box');
    insert into r(check_name,outcome) values ('R2 reopening needs a real reason', 'ALLOWED');
  -- expect: Give a reason of at least 5 characters for reopening.
  exception when others then insert into r(check_name,outcome) values ('R2 reopening needs a real reason', sqlerrm); end;

  o := public.reopen_packing(i, (select version from public.orders where id = i), 'Wrong box used');
  -- expect: confirmed / true / Wrong box used
  insert into r(check_name,outcome) values ('R3 admin reopens a packed order',
    o.status || ' / ' || (o.packed_at is null)::text || ' / '
    || (select reason from public.order_events where order_id = i and event_type = 'packing_reopened'));

  begin perform public.reopen_packing(m, (select version from public.orders where id = m), 'Customer came back');
    insert into r(check_name,outcome) values ('R4 a completed order cannot be reopened', 'ALLOWED');
  -- expect: Only ready orders can be reopened; this one is completed.
  exception when others then insert into r(check_name,outcome) values ('R4 a completed order cannot be reopened', sqlerrm); end;

  begin perform public.cancel_order(m, (select version from public.orders where id = m), 'Changed mind');
    insert into r(check_name,outcome) values ('R5 a completed order cannot be cancelled', 'ALLOWED');
  -- expect: refused: <message>
  exception when others then insert into r(check_name,outcome) values ('R5 a completed order cannot be cancelled', 'refused: ' || sqlerrm); end;

  perform public.cancel_order(x, (select version from public.orders where id = x), 'Customer cancelled');
  begin perform public.mark_packed(x, (select version from public.orders where id = x));
    insert into r(check_name,outcome) values ('R6 a cancelled order cannot be packed', 'ALLOWED');
  -- expect: Only confirmed or preparing orders can be packed; this one is cancelled.
  exception when others then insert into r(check_name,outcome) values ('R6 a cancelled order cannot be packed', sqlerrm); end;

  -- expect: packed, bill_issued, handed_over
  insert into r(check_name,outcome) values ('R7 the timeline records packing, the bill and the handover',
    (select string_agg(event_type, ', ' order by id) from public.order_events
     where order_id = m and event_type in ('packed', 'bill_issued', 'handed_over')));
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
