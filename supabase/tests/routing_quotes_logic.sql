-- Kitchen routing, cupcake / popsicle counts, quotations, sticky notes, quotation sends and staff delete
-- (2026-10-24). Runs in a transaction and rolls back. Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-000000000da1','rq-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000da2','rq-a2@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000dc1','rq-c@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000df1','rq-f1@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000df2','rq-f2@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-000000000da1','Rq Admin','admin'),
 ('00000000-0000-0000-0000-000000000da2','Rq Admin Two','admin'),
 ('00000000-0000-0000-0000-000000000dc1','Rq Counter','counter'),
 ('00000000-0000-0000-0000-000000000df1','Rq Kitchen One','chef'),
 ('00000000-0000-0000-0000-000000000df2','Rq Kitchen Two','chef');
insert into public.staff_kitchens (user_id, kitchen_id)
  select '00000000-0000-0000-0000-000000000df1', id from public.kitchens where code = 'K1';
insert into public.staff_kitchens (user_id, kitchen_id)
  select '00000000-0000-0000-0000-000000000df2', id from public.kitchens where code = 'K2';
insert into auth.sessions (id, user_id) values
 ('00000000-0000-0000-0000-0000000005e1', '00000000-0000-0000-0000-000000000df2');

delete from public.capacity_overrides;
delete from public.category_daily_caps;
delete from public.pickup_windows;
delete from public.closures;
update public.business_hours set opens_at = '09:00', closes_at = '21:00', is_closed = false;

insert into public.categories (name) values ('T Rq Bakes');
-- No food type: products are created without is_veg.
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Rq Bread', 'made_to_order', 500 from public.categories where name = 'T Rq Bakes';
insert into public.product_variants (product_id, name, price_paise)
  select p.id, 'Loaf', 6000 from public.products p where p.name = 'T Rq Bread';
insert into ctx select 'bread', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Rq Bread';

create function pg_temp.day(p_days integer) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Kolkata')::date + p_days) + time '12:00') at time zone 'Asia/Kolkata'
$$;
create function pg_temp.as_user(p_id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_id, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.kitchen_of(p_key text) returns text language sql stable as $$
  select k.code from public.orders o join public.kitchens k on k.id = o.kitchen_id where o.id = (select v::uuid from ctx where k = p_key)
$$;

-- expect: null
insert into r(check_name,outcome) values ('R1 a new product has no food type',
  coalesce((select is_veg::text from public.products where name = 'T Rq Bread'), 'null'));

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000dc1');
do $$
declare o public.orders;
begin
  -- W: web / catalogue order, confirmed.
  o := public.create_order(gen_random_uuid(), 'IN_STORE',
    jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k = 'bread'), 'quantity', 2)),
    'Rq Walk', '9000000991', pg_temp.day(1), null, null, true);
  insert into ctx values ('W', o.id::text);
  -- C: custom cake with counts, set-up and delivery charges and an advance; confirmed.
  o := public.create_custom_cake_order(gen_random_uuid(), 'IN_STORE', 'Rq Cake Customer', '9000000992', pg_temp.day(2), 200000,
    '{"flavour": "Belgian chocolate", "weight_kg": 2, "tiers": 2, "message": "Happy 5th", "cupcake_count": 12,
      "has_popsicles": true, "setup_charge_paise": 50000, "delivery_charge_paise": 30000}',
    p_confirm => true, p_advance_paise => 100000, p_advance_method => 'upi');
  insert into ctx values ('C', o.id::text);
  -- P: custom cake, pending.
  o := public.create_custom_cake_order(gen_random_uuid(), 'CALL', 'Rq Pending', '9000000993', pg_temp.day(3), 150000,
    '{"flavour": "Vanilla", "weight_kg": 1}');
  insert into ctx values ('P', o.id::text);
end $$;

reset role;
-- expect: K2 / K1 / K1
insert into r(check_name,outcome) values ('R2 web orders go to Kitchen 2, custom cake orders to Kitchen 1',
  pg_temp.kitchen_of('W') || ' / ' || pg_temp.kitchen_of('C') || ' / ' || pg_temp.kitchen_of('P'));
-- expect: 12 true / 1 true
insert into r(check_name,outcome) values ('R3 cupcakes are a count; an old-style popsicle tick counts as 1',
  (select cupcake_count || ' ' || has_cupcakes || ' / ' || popsicle_count || ' ' || has_popsicles
   from public.custom_cakes where order_id = (select v::uuid from ctx where k = 'C')));
do $$ begin
  begin perform private.clean_cake('{"flavour": "X", "weight_kg": 1, "cupcake_count": -1}');
    insert into r(check_name,outcome) values ('R4 a negative count is refused', 'ALLOWED');
  -- expect: Cupcakes must be a whole number from 0 to 999.
  exception when others then insert into r(check_name,outcome) values ('R4 a negative count is refused', sqlerrm); end;
end $$;
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000dc1');

-- Full quotation (counter staff).
-- expect: full / 280000 / 100000 / 180000 / cake,setup,delivery
insert into r(check_name,outcome) values ('R5 counter staff get every amount: total, advance, balance, charge lines',
  (select q ->> 'mode' || ' / ' || (q -> 'amounts' ->> 'total_paise') || ' / ' || (q -> 'amounts' ->> 'advance_paise') || ' / ' ||
          (q -> 'amounts' ->> 'balance_paise') || ' / ' ||
          (select string_agg(i ->> 'kind', ',' order by (i ->> 'line_no')::int) from jsonb_array_elements(q -> 'items') i)
   from public.order_quotation((select v::uuid from ctx where k = 'C')) q));

-- Kitchen 1: the price-free version of its own confirmed order only.
select pg_temp.as_user('00000000-0000-0000-0000-000000000df1');
-- expect: kitchen / false / Belgian chocolate / 12 / Set-up charges,Delivery charges
insert into r(check_name,outcome) values ('R6 Kitchen 1 gets the price-free quotation: no amount anywhere, details and charge names kept',
  (select q ->> 'mode' || ' / ' || (q::text ~ '(paise|amounts|200000|50000|30000|100000)') || ' / ' || (q -> 'cake' ->> 'flavour') || ' / ' ||
          (q -> 'cake' ->> 'cupcake_count') || ' / ' ||
          (select string_agg(i ->> 'name', ',' order by (i ->> 'line_no')::int) from jsonb_array_elements(q -> 'items') i where i ->> 'kind' <> 'cake')
   from public.order_quotation((select v::uuid from ctx where k = 'C')) q));
do $$ begin
  begin perform public.order_quotation((select v::uuid from ctx where k = 'P'));
    insert into r(check_name,outcome) values ('R7 no quotation before confirmation', 'ALLOWED');
  -- expect: Quotation not found.
  exception when others then insert into r(check_name,outcome) values ('R7 no quotation before confirmation', sqlerrm); end;
  begin perform public.order_quotation((select v::uuid from ctx where k = 'W'));
    insert into r(check_name,outcome) values ('R8 Kitchen 1 cannot open a web order', 'ALLOWED');
  -- expect: Quotation not found.
  exception when others then insert into r(check_name,outcome) values ('R8 Kitchen 1 cannot open a web order', sqlerrm); end;
  begin perform public.set_sticky_note((select v::uuid from ctx where k = 'C'), 'x', false);
    insert into r(check_name,outcome) values ('R9 kitchens cannot write sticky notes', 'ALLOWED');
  -- expect: You do not have permission to change orders.
  exception when others then insert into r(check_name,outcome) values ('R9 kitchens cannot write sticky notes', sqlerrm); end;
end $$;
-- expect: 0/0/0/0
insert into r(check_name,outcome) values ('R10 kitchens read no orders, quotation sends, payments or quotation files',
  (select count(*) from public.orders) || '/' || (select count(*) from public.quotation_sends) || '/' ||
  (select count(*) from public.payments) || '/' || (select count(*) from storage.objects where bucket_id = 'quotations'));

-- Kitchen 2: its own web order, never the custom cake.
select pg_temp.as_user('00000000-0000-0000-0000-000000000df2');
-- expect: kitchen / false
insert into r(check_name,outcome) values ('R11 Kitchen 2 gets its web order price-free',
  (select q ->> 'mode' || ' / ' || (q::text ~ '(paise|amounts)') from public.order_quotation((select v::uuid from ctx where k = 'W')) q));
do $$ begin
  begin perform public.order_quotation((select v::uuid from ctx where k = 'C'));
    insert into r(check_name,outcome) values ('R12 Kitchen 2 cannot open a custom order', 'ALLOWED');
  -- expect: Quotation not found.
  exception when others then insert into r(check_name,outcome) values ('R12 Kitchen 2 cannot open a custom order', sqlerrm); end;
end $$;

-- Sticky notes (counter staff).
select pg_temp.as_user('00000000-0000-0000-0000-000000000dc1');
select public.set_sticky_note((select v::uuid from ctx where k = 'C'), '  Gate code 4321  ', true);
-- expect: Gate code 4321 / true
insert into r(check_name,outcome) values ('R13 sticky note saved trimmed, with the WhatsApp choice',
  (select sticky_note || ' / ' || sticky_note_in_whatsapp from public.orders where id = (select v::uuid from ctx where k = 'C')));
select public.set_sticky_note((select v::uuid from ctx where k = 'C'), '   ', true);
-- expect: null / false
insert into r(check_name,outcome) values ('R14 an empty note clears the note and the WhatsApp choice',
  (select coalesce(sticky_note, 'null') || ' / ' || sticky_note_in_whatsapp from public.orders where id = (select v::uuid from ctx where k = 'C')));

-- Quotation sends.
reset role;
insert into storage.objects (bucket_id, name) select 'quotations', v || '/q1.pdf' from ctx where k = 'C';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000dc1');
do $$
declare oid uuid := (select v::uuid from ctx where k = 'C');
begin
  perform public.record_quotation_send(oid, 'pdf', 'share_sheet', 'shared', oid || '/q1.pdf', 'Hello Sir / Madam!');
  begin perform public.record_quotation_send(oid, 'pdf', 'share_sheet', 'shared', oid || '/missing.pdf');
    insert into r(check_name,outcome) values ('R15 a send needs a generated file of this order', 'ALLOWED');
  -- expect: The quotation file was not found. Prepare it again.
  exception when others then insert into r(check_name,outcome) values ('R15 a send needs a generated file of this order', sqlerrm); end;
  begin perform public.record_quotation_send(oid, 'pdf', 'share_sheet', 'shared', (select v from ctx where k = 'W') || '/q1.pdf');
    insert into r(check_name,outcome) values ('R16 another order''s file is refused', 'ALLOWED');
  -- expect: The quotation file was not found. Prepare it again.
  exception when others then insert into r(check_name,outcome) values ('R16 another order''s file is refused', sqlerrm); end;
end $$;
-- expect: 1 / pdf share_sheet shared / Rq Counter / 1
insert into r(check_name,outcome) values ('R17 the send is logged with who, format, channel and status, and on the timeline',
  (select count(*) from public.quotation_sends) || ' / ' ||
  (select format || ' ' || channel || ' ' || status || ' / ' || (select full_name from public.staff_profiles where user_id = sent_by)
   from public.quotation_sends limit 1) || ' / ' ||
  (select count(*) from public.order_events where event_type = 'quotation_sent'));
select pg_temp.as_user('00000000-0000-0000-0000-000000000df1');
do $$
declare oid uuid := (select v::uuid from ctx where k = 'C');
begin
  begin perform public.record_quotation_send(oid, 'pdf', 'share_sheet', 'shared', oid || '/q1.pdf');
    insert into r(check_name,outcome) values ('R18 kitchens cannot send quotations', 'ALLOWED');
  -- expect: You do not have permission to send quotations.
  exception when others then insert into r(check_name,outcome) values ('R18 kitchens cannot send quotations', sqlerrm); end;
end $$;

-- Sent by the server through WhatsApp Business (Cloud API).
select pg_temp.as_user('00000000-0000-0000-0000-000000000dc1');
do $$
declare oid uuid := (select v::uuid from ctx where k = 'C');
begin
  perform public.record_quotation_send(oid, 'pdf', 'cloud_api', 'sent', oid || '/q1.pdf', 'template', 'wamid.TEST1');
  perform public.record_quotation_send(oid, 'pdf', 'cloud_api', 'failed', null, 'template');
  begin perform public.record_quotation_send(oid, 'pdf', 'cloud_api', 'sent', oid || '/q1.pdf', 'template');
    insert into r(check_name,outcome) values ('R18b a server send needs WhatsApp''s message id', 'ALLOWED');
  -- expect: WhatsApp did not return a message id.
  exception when others then insert into r(check_name,outcome) values ('R18b a server send needs WhatsApp''s message id', sqlerrm); end;
  begin perform public.record_quotation_send(oid, 'pdf', 'share_sheet', 'failed', null);
    insert into r(check_name,outcome) values ('R18c only a server send can be logged as failed', 'ALLOWED');
  -- expect: Unknown way of sending.
  exception when others then insert into r(check_name,outcome) values ('R18c only a server send can be logged as failed', sqlerrm); end;
  begin perform public.record_quotation_send(oid, 'pdf', 'cloud_api', 'sent', null, 'template', 'wamid.TEST2');
    insert into r(check_name,outcome) values ('R18d a server send needs the stored file', 'ALLOWED');
  -- expect: The quotation file was not found. Prepare it again.
  exception when others then insert into r(check_name,outcome) values ('R18d a server send needs the stored file', sqlerrm); end;
end $$;
-- expect: sent wamid.TEST1 / failed / 2
insert into r(check_name,outcome) values ('R18e server sends are logged with the message id; a failure is logged but is not a timeline event',
  (select status || ' ' || message_id from public.quotation_sends where channel = 'cloud_api' and status = 'sent') || ' / ' ||
  (select string_agg(status, ',') from public.quotation_sends where channel = 'cloud_api' and status = 'failed' and file_path is null) || ' / ' ||
  (select count(*) from public.order_events where event_type = 'quotation_sent'));

-- A chef login belongs to one kitchen.
reset role;
do $$ begin
  begin
    insert into public.staff_kitchens (user_id, kitchen_id)
      select '00000000-0000-0000-0000-000000000df1', id from public.kitchens where code = 'K2';
    insert into r(check_name,outcome) values ('R19 a kitchen login cannot get a second kitchen', 'ALLOWED');
  -- expect: A kitchen login belongs to one kitchen only.
  exception when others then insert into r(check_name,outcome) values ('R19 a kitchen login cannot get a second kitchen', sqlerrm); end;
end $$;

-- Deleting orders (calendar).
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000dc1');
do $$ begin
  begin perform public.delete_order((select v::uuid from ctx where k = 'W'), (select version from public.orders where id = (select v::uuid from ctx where k = 'W')), 'Test');
    insert into r(check_name,outcome) values ('R19b counter staff cannot delete orders', 'ALLOWED');
  -- expect: Only an admin can delete orders.
  exception when others then insert into r(check_name,outcome) values ('R19b counter staff cannot delete orders', sqlerrm); end;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000da1');
do $$ begin
  begin perform public.delete_order((select v::uuid from ctx where k = 'C'), (select version from public.orders where id = (select v::uuid from ctx where k = 'C')), 'Test');
    insert into r(check_name,outcome) values ('R19c an order with an advance is not deleted', 'ALLOWED');
  -- expect: This order has payments or a bill, so it cannot be deleted. (has_money)
  exception when others then
    declare h text; begin get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('R19c an order with an advance is not deleted', sqlerrm || ' (' || h || ')'); end;
  end;
end $$;
select public.delete_order((select v::uuid from ctx where k = 'W'), (select version from public.orders where id = (select v::uuid from ctx where k = 'W')), 'Customer called it off');
reset role;
-- expect: 0 / 0 / 0 / Customer called it off
insert into r(check_name,outcome) values ('R19d a deleted order is gone with its items and tickets; the audit log keeps it with the reason',
  (select count(*) from public.orders where id = (select v::uuid from ctx where k = 'W')) || ' / ' ||
  (select count(*) from public.order_items where order_id = (select v::uuid from ctx where k = 'W')) || ' / ' ||
  (select count(*) from public.kitchen_tickets where order_id = (select v::uuid from ctx where k = 'W')) || ' / ' ||
  (select old_data ->> 'closed_reason' from public.audit_events where table_name = 'orders' and action = 'DELETE' and record_id = (select v from ctx where k = 'W')));

-- Deleting products.
insert into ctx select 'bread_product', id::text from public.products where name = 'T Rq Bread';
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000dc1');
do $$ begin
  begin perform public.delete_product((select v::uuid from ctx where k = 'bread_product'));
    insert into r(check_name,outcome) values ('R19e counter staff cannot delete products', 'ALLOWED');
  -- expect: Only an admin can delete products.
  exception when others then insert into r(check_name,outcome) values ('R19e counter staff cannot delete products', sqlerrm); end;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000da1');
select public.delete_product((select v::uuid from ctx where k = 'bread_product'));
reset role;
-- expect: 0 / 0
insert into r(check_name,outcome) values ('R19f an admin deletes a product with its sizes',
  (select count(*) from public.products where id = (select v::uuid from ctx where k = 'bread_product')) || ' / ' ||
  (select count(*) from public.product_variants where product_id = (select v::uuid from ctx where k = 'bread_product')));

-- Deleting staff.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000dc1');
do $$ begin
  begin perform public.delete_staff('00000000-0000-0000-0000-000000000df2');
    insert into r(check_name,outcome) values ('R20 counter staff cannot delete staff', 'ALLOWED');
  -- expect: Only an admin can delete staff.
  exception when others then insert into r(check_name,outcome) values ('R20 counter staff cannot delete staff', sqlerrm); end;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-000000000da1');
do $$ begin
  begin perform public.delete_staff('00000000-0000-0000-0000-000000000da1');
    insert into r(check_name,outcome) values ('R21 nobody deletes their own login', 'ALLOWED');
  -- expect: You cannot delete your own login. Ask another admin.
  exception when others then insert into r(check_name,outcome) values ('R21 nobody deletes their own login', sqlerrm); end;
end $$;
select public.delete_staff('00000000-0000-0000-0000-000000000df2');
reset role;
-- expect: false / true / 0 / 0 / Rq Kitchen Two
insert into r(check_name,outcome) values ('R22 a deleted login is inactive, marked deleted, loses its kitchen and sessions, keeps its name',
  (select is_active || ' / ' || (deleted_at is not null) from public.staff_profiles where user_id = '00000000-0000-0000-0000-000000000df2') || ' / ' ||
  (select count(*) from public.staff_kitchens where user_id = '00000000-0000-0000-0000-000000000df2') || ' / ' ||
  (select count(*) from auth.sessions where user_id = '00000000-0000-0000-0000-000000000df2') || ' / ' ||
  (select full_name from public.staff_profiles where user_id = '00000000-0000-0000-0000-000000000df2'));
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000df2');
do $$ begin
  begin perform public.chef_work(current_date, current_date + 7);
    insert into r(check_name,outcome) values ('R23 a deleted kitchen login is refused', 'ALLOWED');
  -- expect: You do not have access to the kitchen screen.
  exception when others then insert into r(check_name,outcome) values ('R23 a deleted kitchen login is refused', sqlerrm); end;
end $$;
-- The last active admin: Rq Admin Two deletes Rq Admin, then nobody can delete Rq Admin Two.
select pg_temp.as_user('00000000-0000-0000-0000-000000000da2');
select public.delete_staff('00000000-0000-0000-0000-000000000da1');
reset role;
-- expect: 1
insert into r(check_name,outcome) values ('R24 one active admin is left',
  (select count(*) from public.staff_profiles where role = 'admin' and is_active and deleted_at is null)::text);

-- Add-on (2026-10-28): its own priced line, in the total and balance; the kitchen sees only the details.
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-000000000da2');
do $$
declare o public.orders;
begin
  o := public.create_custom_cake_order(gen_random_uuid(), 'CALL', 'Rq Addon', '9000000994', pg_temp.day(2), 200000,
    '{"flavour": "Rasmalai", "weight_kg": 1, "addon_details": "Gold topper and 2 sparklers", "addon_charge_paise": 35000}',
    p_confirm => true, p_advance_paise => 50000, p_advance_method => 'upi');
  insert into ctx values ('A', o.id::text);
  insert into ctx values ('Aq', public.order_quotation(o.id)::text);
end $$;
reset role;
-- expect: 235000 / 0 / Add-on 35000 / addon
insert into r(check_name,outcome) values ('R25 the add-on amount is a line in the total; no GST on it',
  (select total_paise || ' / ' || tax_paise from public.orders where id = (select v::uuid from ctx where k = 'A')) || ' / ' ||
  (select product_name || ' ' || line_total_paise from public.order_items oi join public.custom_cakes cc on cc.addon_charge_item_id = oi.id
   where cc.order_id = (select v::uuid from ctx where k = 'A')) || ' / ' ||
  (select string_agg(i ->> 'kind', ',') from jsonb_array_elements((select v::jsonb from ctx where k = 'Aq') -> 'items') i
   where i ->> 'name' = 'Add-on'));
-- expect: 185000
insert into r(check_name,outcome) values ('R26 the advance comes off a total that includes the add-on',
  ((select v::jsonb from ctx where k = 'Aq') -> 'amounts' ->> 'balance_paise'));
do $$ begin
  begin perform private.clean_cake('{"flavour": "X", "weight_kg": 1, "addon_charge_paise": -5}');
    insert into r(check_name,outcome) values ('R27 a negative add-on amount is refused', 'ALLOWED');
  -- expect: Add-on amount must be between ₹0 and ₹10,00,000.
  exception when others then insert into r(check_name,outcome) values ('R27 a negative add-on amount is refused', sqlerrm); end;
end $$;
-- expect: 0 / 0 / La Patisserie Madras
insert into r(check_name,outcome) values ('R28 no GST rates left; the shop is La Patisserie Madras',
  (select count(*) from public.products where tax_rate_bps <> 0) || ' / ' ||
  (select custom_cake_tax_rate_bps from public.business_settings) || ' / ' ||
  (select business_name from public.business_settings));

reset role;
select check_name, outcome from r order by n;
rollback;
