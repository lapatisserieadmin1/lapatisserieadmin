-- Editing the items on pending and confirmed orders (Phase 4C). Runs in a transaction and rolls back.
-- Test orders are inserted directly with order numbers from 990101, so order_number_seq is not consumed.
-- Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-0000000006a1','ed-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000006c1','ed-c@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000006f1','ed-f@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-0000000006a1','Ed Admin','admin'),
 ('00000000-0000-0000-0000-0000000006c1','Ed Counter','counter'),
 ('00000000-0000-0000-0000-0000000006f1','Ed Chef','chef');

-- Clean capacity configuration (all rolled back).
delete from public.capacity_overrides;
delete from public.category_daily_caps;
delete from public.pickup_windows;

insert into public.kitchens (code, name) values ('TEK', 'T Edit Kitchen');
insert into public.categories (name) values ('T Ed Cakes'), ('T Ed Puffs');
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Ed Cake', 'ready_stock', 500 from public.categories where name = 'T Ed Cakes';
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Ed Custom Cake', 'made_to_order', 500 from public.categories where name = 'T Ed Cakes';
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Ed Puff', 'ready_stock', 1800 from public.categories where name = 'T Ed Puffs';
insert into public.product_variants (product_id, name, price_paise)
  select id, 'Each', 50000 from public.products where name = 'T Ed Cake';
insert into public.product_variants (product_id, name, price_paise, lead_time_minutes, kitchen_id)
  select id, '1 kg', 120000, 1440, (select id from public.kitchens where code = 'TEK') from public.products where name = 'T Ed Custom Cake';
insert into public.product_variants (product_id, name, price_paise)
  select id, 'Each', 3000 from public.products where name = 'T Ed Puff';
insert into ctx select 'cake', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Ed Cake';
insert into ctx select 'custom', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Ed Custom Cake';
insert into ctx select 'puff', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Ed Puff';

-- Orders straight into the table; lines snapshot the catalogue as create_order does.
create function pg_temp.mk_order(p_num bigint, p_status public.order_status, p_due timestamptz) returns uuid language sql as $$
  insert into public.orders (order_number, idempotency_key, source, status, customer_name, customer_phone, requested_due_at, confirmed_due_at)
  values (p_num, gen_random_uuid(), 'CALL', p_status, 'Ed Customer', '9000000601', p_due,
          case when p_status not in ('draft', 'pending_confirmation') then p_due end)
  returning id
$$;
create function pg_temp.mk_line(p_order uuid, p_key text, p_qty integer) returns uuid language sql as $$
  insert into public.order_items (
    order_id, line_no, product_id, variant_id, category_id, product_name, variant_name, prep_type, kitchen_id,
    is_veg, contains_egg, is_eggless, allergens, lead_time_minutes, unit_price_paise, tax_rate_bps,
    quantity, line_total_paise, tax_paise)
  select p_order, coalesce((select max(line_no) from public.order_items where order_id = p_order), 0) + 1,
         p.id, pv.id, p.category_id, p.name, pv.name, p.prep_type, pv.kitchen_id,
         p.is_veg, p.contains_egg, pv.is_eggless, p.allergens, pv.lead_time_minutes, pv.price_paise, p.tax_rate_bps,
         p_qty, pv.price_paise * p_qty, 0
  from public.product_variants pv join public.products p on p.id = pv.product_id
  where pv.id = (select v::uuid from ctx where k = p_key)
  returning id
$$;
create function pg_temp.day3() returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Kolkata')::date + 3) + time '12:00') at time zone 'Asia/Kolkata'
$$;

-- P pending: cake ×1 · C confirmed: cake ×1, puff ×2 · N confirmed, due in 2 hours: cake ×1
-- Q pending: cake ×1 · D pending with a ₹400 discount: cake ×1 · R ready (packed) · B confirmed with a bill
insert into ctx values ('P', pg_temp.mk_order(990101, 'pending_confirmation', pg_temp.day3())::text);
insert into ctx values ('C', pg_temp.mk_order(990102, 'confirmed', pg_temp.day3())::text);
insert into ctx values ('N', pg_temp.mk_order(990103, 'confirmed', now() + interval '2 hours')::text);
insert into ctx values ('Q', pg_temp.mk_order(990104, 'pending_confirmation', pg_temp.day3())::text);
insert into ctx values ('D', pg_temp.mk_order(990105, 'pending_confirmation', pg_temp.day3())::text);
insert into ctx values ('R', pg_temp.mk_order(990106, 'ready', pg_temp.day3())::text);
insert into ctx values ('B', pg_temp.mk_order(990107, 'confirmed', pg_temp.day3())::text);
insert into ctx select 'P1', pg_temp.mk_line(v::uuid, 'cake', 1)::text from ctx where k = 'P';
insert into ctx select 'C1', pg_temp.mk_line(v::uuid, 'cake', 1)::text from ctx where k = 'C';
insert into ctx select 'C2', pg_temp.mk_line(v::uuid, 'puff', 2)::text from ctx where k = 'C';
insert into ctx select 'N1', pg_temp.mk_line(v::uuid, 'cake', 1)::text from ctx where k = 'N';
insert into ctx select 'Q1', pg_temp.mk_line(v::uuid, 'cake', 1)::text from ctx where k = 'Q';
insert into ctx select 'D1', pg_temp.mk_line(v::uuid, 'cake', 1)::text from ctx where k = 'D';
insert into ctx select 'R1', pg_temp.mk_line(v::uuid, 'cake', 1)::text from ctx where k = 'R';
insert into ctx select 'B1', pg_temp.mk_line(v::uuid, 'cake', 1)::text from ctx where k = 'B';
update public.orders set discount_paise = 40000, discount_reason = 'Regular' where id = (select v::uuid from ctx where k = 'D');
select private.recalc_order_totals(v::uuid) from ctx where k in ('P', 'C', 'N', 'Q', 'D', 'R', 'B');
insert into public.bills (order_id, bill_number, financial_year, sequence_number, business, lines,
  subtotal_paise, discount_paise, total_paise, taxable_paise, cgst_paise, sgst_paise)
  select v::uuid, 'TEST/ED/1', 'TEST', 1, '{}', '[]', 0, 0, 0, 0, 0, 0 from ctx where k = 'B';

-- The catalogue price changes after the orders were taken.
update public.product_variants set price_paise = 60000 where id = (select v::uuid from ctx where k = 'cake');

set local role authenticated;

-- ===== Chef =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000006f1","role":"authenticated"}', true);
do $$
declare h text;
begin
  begin perform public.update_order_items((select v::uuid from ctx where k = 'P'), 1,
          jsonb_build_array(jsonb_build_object('line_id', (select v from ctx where k = 'P1'), 'quantity', 2)));
    insert into r(check_name,outcome) values ('E1 chef cannot edit', 'ALLOWED');
  -- expect: forbidden: You do not have permission to change orders.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('E1 chef cannot edit', h || ': ' || sqlerrm); end;
end $$;

-- ===== Counter =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000006c1","role":"authenticated"}', true);
do $$
declare o public.orders; h text; p uuid := (select v::uuid from ctx where k = 'P');
begin
  o := public.update_order_items(p, 1, jsonb_build_array(
    jsonb_build_object('line_id', (select v from ctx where k = 'P1'), 'quantity', 2),
    jsonb_build_object('variant_id', (select v from ctx where k = 'puff'), 'quantity', 3),
    jsonb_build_object('variant_id', (select v from ctx where k = 'cake'), 'quantity', 1, 'notes', ' Happy Birthday ')));
  -- expect: pending_confirmation / 2 / 169000 (2 × 500 kept price + 3 × 30 + 1 × 600 new price)
  insert into r(check_name,outcome) values ('E2 counter edits a pending order',
    o.status::text || ' / ' || o.version || ' / ' || o.total_paise);
  -- expect: 1:2:50000:- | 2:3:3000:- | 3:1:60000:Happy Birthday
  insert into r(check_name,outcome) values ('E3 kept line keeps its price; new lines take today''s',
    (select string_agg(line_no || ':' || quantity || ':' || unit_price_paise || ':' || coalesce(notes, '-'), ' | ' order by line_no)
     from public.order_items where order_id = p));
  -- expect: 3 / 50000 / 169000
  insert into r(check_name,outcome) values ('E4 timeline entry',
    (select jsonb_array_length(data -> 'changes') || ' / ' || (data ->> 'total_from') || ' / ' || (data ->> 'total_to')
     from public.order_events where order_id = p and event_type = 'items_changed'));

  begin perform public.update_order_items(p, 1, jsonb_build_array(jsonb_build_object('line_id', (select v from ctx where k = 'P1'), 'quantity', 5)));
    insert into r(check_name,outcome) values ('E5 stale version refused', 'ALLOWED');
  -- expect: conflict: This order was changed by someone else. …
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('E5 stale version refused', h || ': ' || sqlerrm); end;

  begin perform public.update_order_items((select v::uuid from ctx where k = 'C'), 1,
          jsonb_build_array(jsonb_build_object('line_id', (select v from ctx where k = 'C1'), 'quantity', 2)), 'Customer called');
    insert into r(check_name,outcome) values ('E6 counter cannot edit a confirmed order', 'ALLOWED');
  -- expect: forbidden: Only an admin can change the items on a confirmed order.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('E6 counter cannot edit a confirmed order', h || ': ' || sqlerrm); end;

  begin perform public.update_order_items((select v::uuid from ctx where k = 'Q'), 1,
          jsonb_build_array(jsonb_build_object('line_id', (select v from ctx where k = 'Q1'), 'quantity', 2)), null, 'Owner said yes');
    insert into r(check_name,outcome) values ('E7 counter cannot override', 'ALLOWED');
  -- expect: forbidden: Only an admin can override scheduling rules.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('E7 counter cannot override', h || ': ' || sqlerrm); end;
end $$;

-- ===== Admin =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000006a1","role":"authenticated"}', true);
do $$
declare o public.orders; h text;
  c uuid := (select v::uuid from ctx where k = 'C');
  n uuid := (select v::uuid from ctx where k = 'N');
  q uuid := (select v::uuid from ctx where k = 'Q');
  d uuid := (select v::uuid from ctx where k = 'D');
begin
  begin perform public.update_order_items(c, 1, jsonb_build_array(jsonb_build_object('line_id', (select v from ctx where k = 'C2'), 'quantity', 2)));
    insert into r(check_name,outcome) values ('E8 confirmed edit needs a reason', 'ALLOWED');
  -- expect: validation: Give a reason for changing a confirmed order.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('E8 confirmed edit needs a reason', h || ': ' || sqlerrm); end;

  o := public.update_order_items(c, 1, jsonb_build_array(jsonb_build_object('line_id', (select v from ctx where k = 'C2'), 'quantity', 2)), 'Customer dropped the cake');
  -- expect: confirmed / 6000 / 1 line / {"to": 0, "from": 1, "item": "T Ed Cake — Each"} / Customer dropped the cake
  insert into r(check_name,outcome) values ('E9 admin removes a line from a confirmed order',
    o.status::text || ' / ' || o.total_paise || ' / ' || (select count(*) from public.order_items where order_id = c) || ' line / '
    || (select (data -> 'changes' -> 0)::text || ' / ' || reason from public.order_events where order_id = c and event_type = 'items_changed'));

  begin perform public.update_order_items(c, 2, '[]'::jsonb, 'Nothing');
    insert into r(check_name,outcome) values ('E10 empty list refused', 'ALLOWED');
  -- expect: validation: An order needs at least one item. Cancel the order instead.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('E10 empty list refused', h || ': ' || sqlerrm); end;

  begin perform public.update_order_items(c, 2, jsonb_build_array(jsonb_build_object('line_id', (select v from ctx where k = 'C2'), 'quantity', 2)), 'Same');
    insert into r(check_name,outcome) values ('E11 unchanged list refused', 'ALLOWED');
  -- expect: validation: Nothing was changed.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('E11 unchanged list refused', h || ': ' || sqlerrm); end;

  begin perform public.update_order_items(c, 2, jsonb_build_array(jsonb_build_object('line_id', (select v from ctx where k = 'N1'), 'quantity', 2)), 'Wrong order');
    insert into r(check_name,outcome) values ('E12 line from another order refused', 'ALLOWED');
  -- expect: conflict: Line 1 is not on this order. Reload and try again.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('E12 line from another order refused', h || ': ' || sqlerrm); end;

  begin perform public.update_order_items(n, 1, jsonb_build_array(
          jsonb_build_object('line_id', (select v from ctx where k = 'N1'), 'quantity', 1),
          jsonb_build_object('variant_id', (select v from ctx where k = 'custom'), 'quantity', 1)), 'Add a custom cake');
    insert into r(check_name,outcome) values ('E13 added item too close to pickup refused', 'ALLOWED');
  -- expect: lead_time: The added items need 24 h 0 min of preparation; the earliest pickup is … An admin can override with a reason.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('E13 added item too close to pickup refused', h || ': ' || sqlerrm); end;

  o := public.update_order_items(n, 1, jsonb_build_array(
         jsonb_build_object('line_id', (select v from ctx where k = 'N1'), 'quantity', 1),
         jsonb_build_object('variant_id', (select v from ctx where k = 'custom'), 'quantity', 1)), 'Add a custom cake', 'Chef has one ready');
  -- expect: 170000 / true
  insert into r(check_name,outcome) values ('E14 admin override for lead time',
    o.total_paise || ' / ' || exists (select 1 from public.order_events where order_id = n and event_type = 'override'
                                      and reason = 'Chef has one ready' and data ? 'lead_time')::text);

  -- Puffs are capped at 1 order a day; P and C already have puffs on day 3.
  insert into public.category_daily_caps (category_id, max_orders)
    select id, 1 from public.categories where name = 'T Ed Puffs';
  begin perform public.update_order_items(q, 1, jsonb_build_array(
          jsonb_build_object('line_id', (select v from ctx where k = 'Q1'), 'quantity', 1),
          jsonb_build_object('variant_id', (select v from ctx where k = 'puff'), 'quantity', 1)));
    insert into r(check_name,outcome) values ('E15 newly added capped category refused', 'ALLOWED');
  -- expect: capacity: T Ed Puffs: 2/1 orders on <DD Mon>. An admin can override with a reason.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('E15 newly added capped category refused', h || ': ' || sqlerrm); end;

  o := public.update_order_items(q, 1, jsonb_build_array(
         jsonb_build_object('line_id', (select v from ctx where k = 'Q1'), 'quantity', 3)));
  -- expect: 150000 (more of a category already on the order is not rechecked against caps)
  insert into r(check_name,outcome) values ('E16 more of an existing category allowed', o.total_paise::text);

  o := public.update_order_items(d, 1, jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k = 'cake'), 'quantity', 1)));
  -- expect: 60000 / 40000 / 20000 (discount kept; old cake line removed, new one at today's price)
  insert into r(check_name,outcome) values ('E17a discount kept', o.subtotal_paise || ' / ' || o.discount_paise || ' / ' || o.total_paise);
  o := public.update_order_items(d, 2, jsonb_build_array(
         jsonb_build_object('line_id', (select id::text from public.order_items where order_id = d), 'quantity', 1),
         jsonb_build_object('variant_id', (select v from ctx where k = 'puff'), 'quantity', 1)), null, 'Owner allows the puff');
  o := public.update_order_items(d, 3, jsonb_build_array(
         jsonb_build_object('line_id', (select id::text from public.order_items where order_id = d and unit_price_paise = 3000), 'quantity', 1)));
  -- expect: 3000 / 3000 / 0 (discount capped at the new subtotal)
  insert into r(check_name,outcome) values ('E17b discount capped at the new subtotal', o.subtotal_paise || ' / ' || o.discount_paise || ' / ' || o.total_paise);

  begin perform public.update_order_items((select v::uuid from ctx where k = 'R'), 1,
          jsonb_build_array(jsonb_build_object('line_id', (select v from ctx where k = 'R1'), 'quantity', 2)), 'Late change');
    insert into r(check_name,outcome) values ('E18 packed order refused until reopened', 'ALLOWED');
  -- expect: kitchen: This order is packed. Reopen packing before changing its items.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('E18 packed order refused until reopened', h || ': ' || sqlerrm); end;

  begin perform public.update_order_items((select v::uuid from ctx where k = 'B'), 1,
          jsonb_build_array(jsonb_build_object('line_id', (select v from ctx where k = 'B1'), 'quantity', 2)), 'After billing');
    insert into r(check_name,outcome) values ('E19 billed order refused', 'ALLOWED');
  -- expect: billed: This order already has a bill. Issue a credit note instead.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('E19 billed order refused', h || ': ' || sqlerrm); end;

  update public.product_variants set is_available = false where id = (select v::uuid from ctx where k = 'custom');
  begin perform public.update_order_items(n, 2, jsonb_build_array(
          jsonb_build_object('line_id', (select v from ctx where k = 'N1'), 'quantity', 1),
          jsonb_build_object('line_id', (select id::text from public.order_items where order_id = n and line_no = 2), 'quantity', 2)),
          'Two custom cakes', 'Override does not help');
    insert into r(check_name,outcome) values ('E20 unavailable item cannot be increased', 'ALLOWED');
  -- expect: unavailable: T Ed Custom Cake — 1 kg is not available, so its quantity cannot be increased.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('E20 unavailable item cannot be increased', h || ': ' || sqlerrm); end;
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
