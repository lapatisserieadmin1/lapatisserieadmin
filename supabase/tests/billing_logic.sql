-- Phase 4B billing checks (counter sale, discounts, bills, credit notes). Runs in a transaction; rolled back.
-- order_number_seq is not transactional; reset it only while no real orders exist.
-- Expected outcomes (2026-09-27) are noted beside each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-0000000000a1','a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000000c1','c@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-0000000000a1','T Admin','admin'),
 ('00000000-0000-0000-0000-0000000000c1','T Counter','counter');
update public.business_settings set gstin = '33ABCDE1234F1Z5';
insert into public.categories (name) values ('T Cat');
insert into public.products (category_id, name, prep_type, tax_rate_bps, hsn_code) select id, 'T Puff', 'ready_stock', 1800, '1905' from public.categories where name='T Cat';
insert into public.products (category_id, name, prep_type, tax_rate_bps) select id, 'T Cookies', 'ready_stock', 500 from public.categories where name='T Cat';
insert into public.products (category_id, name, prep_type, tax_rate_bps) select id, 'T Cake', 'made_to_order', 500 from public.categories where name='T Cat';
insert into public.product_variants (product_id, name, price_paise) select id, 'Each', 3000 from public.products where name='T Puff';
insert into public.product_variants (product_id, name, price_paise) select id, 'Box', 15000 from public.products where name='T Cookies';
insert into public.product_variants (product_id, name, price_paise, kitchen_id, lead_time_minutes) select p.id, '1 kg', 90000, k.id, 0 from public.products p, public.kitchens k where p.name='T Cake' and k.code='K1';
insert into ctx select 'puff', v.id::text from public.product_variants v join public.products p on p.id=v.product_id where p.name='T Puff';
insert into ctx select 'cookies', v.id::text from public.product_variants v join public.products p on p.id=v.product_id where p.name='T Cookies';
insert into ctx select 'cake', v.id::text from public.product_variants v join public.products p on p.id=v.product_id where p.name='T Cake';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
do $$
declare res jsonb; res2 jsonb; b public.bills; items jsonb;
begin
  items := jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k='puff'), 'quantity', 3),
                             jsonb_build_object('variant_id', (select v from ctx where k='cookies'), 'quantity', 1));
  res := public.counter_sale('30000000-0000-0000-0000-000000000001', items,
    jsonb_build_array(jsonb_build_object('method','cash','amount_paise', 20000), jsonb_build_object('method','upi','amount_paise', 1600, 'reference','UPI9')),
    'percent', 1000, 'Regular customer');
  select * into b from public.bills where id = (res->>'bill_id')::uuid;
  -- expect: completed AB/<fy>/00001 total=21600 kot_lines=0
  insert into r(check_name,outcome) values ('counter sale completes with bill (AC-28)',
    (select status::text from public.orders where id=(res->>'order_id')::uuid) || ' ' || b.bill_number || ' total=' || b.total_paise ||
    ' kot_lines=' || (select count(*) from public.order_items where order_id=(res->>'order_id')::uuid and prep_type='made_to_order'));
  -- expect: cgst+sgst=1879 tax=1879 taxable+tax=total:true line_disc_sum=2400
  insert into r(check_name,outcome) values ('bill GST splits and line discounts reconcile (AC-29)',
    'cgst+sgst=' || (b.cgst_paise + b.sgst_paise) || ' tax=' || (select tax_paise from public.orders where id = b.order_id) ||
    ' taxable+tax=total:' || (b.taxable_paise + b.cgst_paise + b.sgst_paise = b.total_paise) ||
    ' line_disc_sum=' || (select sum((l->>'discount_paise')::bigint) from jsonb_array_elements(b.lines) l));
  -- expect: cgst=939 sgst=940 (split per GST rate: 1236 -> 618/618, 643 -> 321/322; matches the printed rate table)
  insert into r(check_name,outcome) values ('CGST/SGST split per rate', 'cgst=' || b.cgst_paise || ' sgst=' || b.sgst_paise);
  insert into r(check_name,outcome) values ('balance after counter sale (expect 0)', (select balance_paise::text from public.order_summaries where id = b.order_id));
  res2 := public.counter_sale('30000000-0000-0000-0000-000000000001', items, '[]'::jsonb);
  insert into r(check_name,outcome) values ('counter sale retry returns same bill', (res2->>'bill_id' = res->>'bill_id')::text || ' bills=' || (select count(*) from public.bills));

  begin perform public.counter_sale(gen_random_uuid(), items, jsonb_build_array(jsonb_build_object('method','cash','amount_paise', 20400)), 'percent', 1500, 'friend');
    insert into r(check_name,outcome) values ('counter limited to 10% discount', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('counter limited to 10% discount', sqlerrm); end;

  begin perform public.counter_sale(gen_random_uuid(), jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k='cake'), 'quantity', 1)),
      jsonb_build_array(jsonb_build_object('method','cash','amount_paise', 90000)));
    insert into r(check_name,outcome) values ('made-to-order refused at counter, nothing saved', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('made-to-order refused at counter, nothing saved', sqlerrm || ' | orders=' || (select count(*) from public.orders)); end;

  begin perform public.counter_sale(gen_random_uuid(), items, jsonb_build_array(jsonb_build_object('method','cash','amount_paise', 100)));
    insert into r(check_name,outcome) values ('payments must equal total', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('payments must equal total', sqlerrm); end;

  res := public.counter_sale(gen_random_uuid(), jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k='puff'), 'quantity', 1)),
    jsonb_build_array(jsonb_build_object('method','cash','amount_paise', 3000)));
  -- expect: AB/<fy>/00002
  insert into r(check_name,outcome) values ('next bill number is gap-free after failed sales', res->>'bill_number');
  insert into ctx values ('sale2', res->>'order_id'), ('sale2bill', res->>'bill_id');
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
do $$
declare o public.orders; b public.bills; cn public.credit_notes;
begin
  o := public.create_order(gen_random_uuid(), 'CALL', jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k='cake'), 'quantity', 1)),
       p_customer_name => 'Meera', p_customer_phone => '9840000001', p_due_at => (((now() at time zone 'Asia/Kolkata')::date + 1 + time '12:00') at time zone 'Asia/Kolkata'));
  begin perform public.issue_bill(o.id);
    insert into r(check_name,outcome) values ('pending order cannot be billed', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('pending order cannot be billed', sqlerrm); end;

  o := public.apply_discount(o.id, o.version, 'amount', 5000, 'Loyalty');
  -- expect: total=85000 tax=4048
  insert into r(check_name,outcome) values ('admin amount discount recalculates', 'total=' || o.total_paise || ' tax=' || o.tax_paise);
  o := public.confirm_order(o.id, o.version);
  b := public.issue_bill(o.id);
  insert into r(check_name,outcome) values ('confirmed order billed; reissue returns same', b.bill_number || ' same=' || ((public.issue_bill(o.id)).id = b.id)::text);

  begin perform public.apply_discount(o.id, (select version from public.orders where id=o.id), 'amount', 100, 'late');
    insert into r(check_name,outcome) values ('no discount after billing', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('no discount after billing', sqlerrm); end;

  begin perform public.cancel_order(o.id, (select version from public.orders where id=o.id), 'Customer cancelled');
    insert into r(check_name,outcome) values ('billed order cannot be cancelled before credit', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('billed order cannot be cancelled before credit', sqlerrm); end;

  begin perform public.issue_credit_note(b.id, gen_random_uuid(), b.total_paise + 1, 'Too much');
    insert into r(check_name,outcome) values ('credit cannot exceed bill', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('credit cannot exceed bill', sqlerrm); end;

  cn := public.issue_credit_note(b.id, '40000000-0000-0000-0000-000000000001', b.total_paise, 'Order cancelled by customer');
  perform public.issue_credit_note(b.id, '40000000-0000-0000-0000-000000000001', b.total_paise, 'Order cancelled by customer');
  insert into r(check_name,outcome) values ('full credit note issued once', cn.credit_note_number || ' cgst+sgst=' || (cn.cgst_paise + cn.sgst_paise) || ' count=' || (select count(*) from public.credit_notes));
  o := public.cancel_order(o.id, (select version from public.orders where id=o.id), 'Customer cancelled');
  insert into r(check_name,outcome) values ('cancel allowed after full credit (expect balance=0)', o.status || ' balance=' || (select balance_paise from public.order_summaries where id=o.id));

  cn := public.issue_credit_note((select v::uuid from ctx where k='sale2bill'), gen_random_uuid(), 1000, 'Damaged puff');
  insert into r(check_name,outcome) values ('partial credit on paid sale shows refund due (expect -1000)', (select balance_paise::text from public.order_summaries where id=(select v::uuid from ctx where k='sale2')));

  begin update public.bills set total_paise = 1;
    insert into r(check_name,outcome) values ('bills immutable', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('bills immutable', sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
do $$ begin
  begin perform public.issue_credit_note((select v::uuid from ctx where k='sale2bill'), gen_random_uuid(), 100, 'counter try');
    insert into r(check_name,outcome) values ('counter cannot issue credit notes', 'ALLOWED');
  exception when others then insert into r(check_name,outcome) values ('counter cannot issue credit notes', sqlerrm); end;
end $$;

reset role;
-- expect: 2026-27 2027-28 2026-27 (April 1 IST starts the new year)
insert into r(check_name,outcome) values ('financial year boundaries (IST)',
  private.financial_year('2027-03-31 18:00:00+00') || ' ' || private.financial_year('2027-03-31 18:40:00+00') || ' ' || private.financial_year('2027-01-15 00:00:00+00'));
select check_name, outcome from r order by n;
rollback;
