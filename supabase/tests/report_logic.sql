-- Daily sales report (Phase 7). Runs in a transaction and rolls back.
-- Bills, credit notes and payments are inserted directly for a fixed day D = 2026-11-10 (India time),
-- with orders numbered from 990501, so no live sequence is consumed. Expected outcomes are in the
-- comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-000000000aa1','rp-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000ac1','rp-c@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-000000000aa1','Rp Admin','admin'),
 ('00000000-0000-0000-0000-000000000ac1','Rp Counter','counter');
update public.business_settings set timezone = 'Asia/Kolkata';

insert into public.categories (name) values ('T Rp Cakes'), ('T Rp Puffs');
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Rp Cake', 'ready_stock', 500 from public.categories where name = 'T Rp Cakes';
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Rp Puff', 'ready_stock', 1800 from public.categories where name = 'T Rp Puffs';
insert into public.product_variants (product_id, name, price_paise)
  select id, '1 kg', 50000 from public.products where name = 'T Rp Cake';
insert into public.product_variants (product_id, name, price_paise)
  select id, 'Each', 3000 from public.products where name = 'T Rp Puff';

-- D at hh:mi India time.
create function pg_temp.at(p_day_offset integer, p_time text) returns timestamptz language sql immutable as $$
  select ((date '2026-11-10' + p_day_offset) + p_time::time) at time zone 'Asia/Kolkata'
$$;
create function pg_temp.mk_order(p_num bigint, p_source text) returns uuid language sql as $$
  insert into public.orders (order_number, idempotency_key, source, status, customer_name, customer_phone, requested_due_at)
  values (p_num, gen_random_uuid(), p_source::public.order_source, 'completed', 'Rp Customer', '9000000a01', pg_temp.at(0, '12:00'))
  returning id
$$;
create function pg_temp.mk_line(p_order uuid, p_product text, p_line integer, p_qty integer) returns void language sql as $$
  insert into public.order_items (
    order_id, line_no, product_id, variant_id, category_id, product_name, variant_name, prep_type, kitchen_id,
    is_veg, contains_egg, is_eggless, allergens, lead_time_minutes, unit_price_paise, tax_rate_bps,
    quantity, line_total_paise, tax_paise)
  select p_order, p_line, p.id, pv.id, p.category_id, p.name, pv.name, p.prep_type, null,
         p.is_veg, p.contains_egg, pv.is_eggless, p.allergens, pv.lead_time_minutes, pv.price_paise, p.tax_rate_bps,
         p_qty, pv.price_paise * p_qty, 0
  from public.product_variants pv join public.products p on p.id = pv.product_id where p.name = p_product
$$;
create function pg_temp.line(p_no integer, p_name text, p_variant text, p_qty integer, p_gross bigint, p_disc bigint, p_tax bigint)
returns jsonb language sql immutable as $$
  select jsonb_build_object('line_no', p_no, 'name', p_name, 'variant', p_variant, 'quantity', p_qty,
    'gross_paise', p_gross, 'discount_paise', p_disc, 'net_paise', p_gross - p_disc, 'tax_paise', p_tax)
$$;
create function pg_temp.mk_bill(p_order uuid, p_seq integer, p_at timestamptz, p_lines jsonb,
  p_subtotal bigint, p_discount bigint, p_cgst bigint, p_sgst bigint) returns uuid language sql as $$
  insert into public.bills (order_id, bill_number, financial_year, sequence_number, issued_at, business, lines,
    subtotal_paise, discount_paise, total_paise, taxable_paise, cgst_paise, sgst_paise)
  values (p_order, 'TRP/2026-27/' || p_seq, 'TRP-2026-27', p_seq, p_at, '{}', p_lines,
    p_subtotal, p_discount, p_subtotal - p_discount, p_subtotal - p_discount - p_cgst - p_sgst, p_cgst, p_sgst)
  returning id
$$;
create function pg_temp.mk_credit(p_bill uuid, p_seq integer, p_at timestamptz, p_total bigint, p_cgst bigint, p_sgst bigint)
returns void language sql as $$
  insert into public.credit_notes (bill_id, idempotency_key, credit_note_number, financial_year, sequence_number, issued_at,
    reason, total_paise, taxable_paise, cgst_paise, sgst_paise)
  values (p_bill, gen_random_uuid(), 'TRP-CN/' || p_seq, 'TRP-2026-27', p_seq, p_at, 'Returned puffs',
    p_total, p_total - p_cgst - p_sgst, p_cgst, p_sgst)
$$;
create function pg_temp.mk_pay(p_order uuid, p_kind text, p_method text, p_amount bigint, p_at timestamptz)
returns void language sql as $$
  insert into public.payments (order_id, idempotency_key, kind, method, amount_paise, recorded_at, paid_at)
  values (p_order, gen_random_uuid(), p_kind::public.payment_kind, p_method::public.payment_method, p_amount, p_at, p_at)
$$;

insert into ctx values ('O1', pg_temp.mk_order(990501, 'IN_STORE')::text);
insert into ctx values ('O2', pg_temp.mk_order(990502, 'CALL')::text);
insert into ctx values ('O3', pg_temp.mk_order(990503, 'ONLINE')::text);
insert into ctx values ('O4', pg_temp.mk_order(990504, 'CALL')::text);
select pg_temp.mk_line((select v::uuid from ctx where k = 'O1'), 'T Rp Cake', 1, 2);
select pg_temp.mk_line((select v::uuid from ctx where k = 'O1'), 'T Rp Puff', 2, 3);
select pg_temp.mk_line((select v::uuid from ctx where k = 'O2'), 'T Rp Cake', 1, 1);
select pg_temp.mk_line((select v::uuid from ctx where k = 'O3'), 'T Rp Cake', 1, 1);

-- B1 (in store, D 10:00): cakes ×2 with ₹100 off, puffs ×3. B2 (call, D 23:30). B3 (online, D+1 00:30, outside).
insert into ctx select 'B1', pg_temp.mk_bill((select v::uuid from ctx where k = 'O1'), 1, pg_temp.at(0, '10:00'),
  jsonb_build_array(pg_temp.line(1, 'T Rp Cake', '1 kg', 2, 100000, 10000, 4286), pg_temp.line(2, 'T Rp Puff', 'Each', 3, 9000, 0, 1373)),
  109000, 10000, 2829, 2830)::text;
insert into ctx select 'B2', pg_temp.mk_bill((select v::uuid from ctx where k = 'O2'), 2, pg_temp.at(0, '23:30'),
  jsonb_build_array(pg_temp.line(1, 'T Rp Cake', '1 kg', 1, 50000, 0, 2381)), 50000, 0, 1190, 1191)::text;
insert into ctx select 'B3', pg_temp.mk_bill((select v::uuid from ctx where k = 'O3'), 3, pg_temp.at(1, '00:30'),
  jsonb_build_array(pg_temp.line(1, 'T Rp Cake', '1 kg', 1, 50000, 0, 2381)), 50000, 0, 1190, 1191)::text;
-- CN1 on B1 the same day; CN2 on B3 the next day (outside).
select pg_temp.mk_credit((select v::uuid from ctx where k = 'B1'), 1, pg_temp.at(0, '15:00'), 9000, 214, 215);
select pg_temp.mk_credit((select v::uuid from ctx where k = 'B3'), 2, pg_temp.at(1, '09:00'), 50000, 1190, 1191);
-- Money: O1 cash and a cash refund; O2 UPI deposit the day before (outside) and UPI balance; O4 card deposit, never billed.
select pg_temp.mk_pay((select v::uuid from ctx where k = 'O1'), 'payment', 'cash', 99000, pg_temp.at(0, '10:00'));
select pg_temp.mk_pay((select v::uuid from ctx where k = 'O1'), 'refund', 'cash', 9000, pg_temp.at(0, '15:00'));
select pg_temp.mk_pay((select v::uuid from ctx where k = 'O2'), 'payment', 'upi', 20000, pg_temp.at(-1, '18:00'));
select pg_temp.mk_pay((select v::uuid from ctx where k = 'O2'), 'payment', 'upi', 30000, pg_temp.at(0, '23:00'));
-- Entered the next day, but paid on D.
insert into public.payments (order_id, idempotency_key, kind, method, amount_paise, recorded_at, paid_at)
values ((select v::uuid from ctx where k = 'O4'), gen_random_uuid(), 'payment', 'card', 15000,
  pg_temp.at(1, '12:00'), pg_temp.at(0, '12:00'));

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000aa1","role":"authenticated"}', true);
do $$
declare
  rep jsonb := public.sales_report(date '2026-11-10', date '2026-11-10');
  s jsonb := rep -> 'summary';
  empty jsonb := public.sales_report(date '2026-12-10', date '2026-12-10');
  h text;
begin
  -- expect: 2 / 159000 / 10000 / 149000 / 8040 / 1 / 9000 / 429 / 140000 / 7611
  insert into r(check_name,outcome) values ('R1 summary for the day',
    concat_ws(' / ', s ->> 'bills', s ->> 'gross_paise', s ->> 'discount_paise', s ->> 'billed_paise', s ->> 'tax_paise',
      s ->> 'credit_notes', s ->> 'credited_paise', s ->> 'credited_tax_paise', s ->> 'net_paise', s ->> 'net_tax_paise'));
  -- expect: 4019 / 4021 / 140960 / 214 / 215 / 8571 / 3805 / 3806 / 132389
  insert into r(check_name,outcome) values ('R1b CGST, SGST and taxable value, for bills, credit notes and net',
    concat_ws(' / ', s ->> 'cgst_paise', s ->> 'sgst_paise', s ->> 'taxable_paise',
      s ->> 'credited_cgst_paise', s ->> 'credited_sgst_paise', s ->> 'credited_taxable_paise',
      s ->> 'net_cgst_paise', s ->> 'net_sgst_paise', s ->> 'net_taxable_paise'));
  -- expect: card 15000/0, cash 99000/9000, upi 30000/0
  insert into r(check_name,outcome) values ('R2 money by method, including a deposit on an unbilled order',
    (select string_agg((e ->> 'method') || ' ' || (e ->> 'received_paise') || '/' || (e ->> 'refunded_paise'), ', ' order by n)
     from jsonb_array_elements(rep -> 'money') with ordinality x(e, n)));
  -- expect: 2026-11-10 / 144000 / 9000
  insert into r(check_name,outcome) values ('R2b daily collections use the paid-on date',
    (select concat_ws(' / ', e ->> 'date', e ->> 'received_paise', e ->> 'refunded_paise')
     from jsonb_array_elements(rep -> 'daily_money') x(e)));
  -- expect: true
  insert into r(check_name,outcome) values ('R2c a payment entered the next day is counted on its paid-on date',
    ((select count(*) from jsonb_array_elements(rep -> 'money') e where e ->> 'method' = 'card') = 1
      and jsonb_array_length(public.sales_report(date '2026-11-11', date '2026-11-11') -> 'money') = 0)::text);
  -- expect: T Rp Cake — 1 kg 3 140000, T Rp Puff — Each 3 9000
  insert into r(check_name,outcome) values ('R3 products from bill lines',
    (select string_agg((e ->> 'name') || ' — ' || (e ->> 'variant') || ' ' || (e ->> 'quantity') || ' ' || (e ->> 'net_paise'), ', ' order by n)
     from jsonb_array_elements(rep -> 'products') with ordinality x(e, n)));
  -- expect: T Rp Cakes 140000, T Rp Puffs 9000
  insert into r(check_name,outcome) values ('R4 categories through the order lines',
    (select string_agg((e ->> 'name') || ' ' || (e ->> 'net_paise'), ', ' order by n)
     from jsonb_array_elements(rep -> 'categories') with ordinality x(e, n)));
  -- expect: CALL 1 50000 0 50000, IN_STORE 1 99000 9000 90000
  insert into r(check_name,outcome) values ('R5 sources, with credit notes on their own day',
    (select string_agg(concat_ws(' ', e ->> 'source', e ->> 'bills', e ->> 'billed_paise', e ->> 'credited_paise', e ->> 'net_paise'), ', ' order by n)
     from jsonb_array_elements(rep -> 'sources') with ordinality x(e, n)));
  -- expect: true / true
  insert into r(check_name,outcome) values ('R6 totals match the bills and credit notes of the India-time day (AC-35)',
    ((s ->> 'billed_paise')::bigint = (select sum(total_paise) from public.bills
       where issued_at >= pg_temp.at(0, '00:00') and issued_at < pg_temp.at(1, '00:00')))::text || ' / ' ||
    ((s ->> 'credited_paise')::bigint = (select sum(total_paise) from public.credit_notes
       where issued_at >= pg_temp.at(0, '00:00') and issued_at < pg_temp.at(1, '00:00')))::text);
  -- expect: 0 / 0 / 0 / [] / [] / [] / [] / []
  insert into r(check_name,outcome) values ('R7 an empty day gives zeros and empty lists',
    concat_ws(' / ', empty -> 'summary' ->> 'bills', empty -> 'summary' ->> 'billed_paise', empty -> 'summary' ->> 'net_paise',
      empty ->> 'money', empty ->> 'products', empty ->> 'categories', empty ->> 'sources', '[]'));
  -- expect: 3 / 199000
  insert into r(check_name,outcome) values ('R8 a two-day range includes the bill after midnight and its credit note',
    (select (x -> 'summary' ->> 'bills') || ' / ' || (x -> 'summary' ->> 'billed_paise')
     from (select public.sales_report(date '2026-11-10', date '2026-11-11') as x) y));

  begin perform public.sales_report(date '2026-11-11', date '2026-11-10');
    insert into r(check_name,outcome) values ('R9 the start must not be after the end', 'ALLOWED');
  -- expect: Choose a start date on or before the end date.
  exception when others then insert into r(check_name,outcome) values ('R9 the start must not be after the end', sqlerrm); end;
  begin perform public.sales_report(date '2025-01-01', date '2026-11-10');
    insert into r(check_name,outcome) values ('R10 at most one year', 'ALLOWED');
  -- expect: Choose a range of at most one year.
  exception when others then insert into r(check_name,outcome) values ('R10 at most one year', sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000ac1","role":"authenticated"}', true);
do $$
declare h text;
begin
  begin perform public.sales_report(date '2026-11-10', date '2026-11-10');
    insert into r(check_name,outcome) values ('R11 counter staff cannot see the report', 'ALLOWED');
  -- expect: forbidden: Only an admin can see sales reports.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('R11 counter staff cannot see the report', h || ': ' || sqlerrm); end;
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
