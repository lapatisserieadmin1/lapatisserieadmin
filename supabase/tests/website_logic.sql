-- Public website: catalogue and orders sent in without a login (2026-10-16).
-- Runs in a transaction and rolls back. Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to anon, authenticated;
grant usage on sequence r_n_seq to anon, authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-000000000ea1','web-a@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-000000000ea1','Web Admin','admin');

delete from public.capacity_overrides;
delete from public.category_daily_caps;
delete from public.pickup_windows;
delete from public.closures;
update public.business_hours set opens_at = '09:00', closes_at = '21:00', is_closed = false;

insert into public.categories (name, sort_order) values ('T Web Cakes', 1);
insert into public.categories (name, is_active) values ('T Web Hidden', false);
insert into public.products (category_id, name, description, prep_type, tax_rate_bps)
  select id, 'T Web Truffle', 'Dark chocolate', 'made_to_order', 500 from public.categories where name = 'T Web Cakes';
insert into public.products (category_id, name, prep_type, archived_at)
  select id, 'T Web Archived', 'ready_stock', now() from public.categories where name = 'T Web Cakes';
insert into public.products (category_id, name, prep_type)
  select id, 'T Web In Hidden Category', 'ready_stock' from public.categories where name = 'T Web Hidden';
insert into public.product_variants (product_id, name, price_paise, lead_time_minutes, sort_order)
  select id, '1 kg', 150000, 4320, 2 from public.products where name = 'T Web Truffle';
insert into public.product_variants (product_id, name, price_paise, sort_order)
  select id, '500 g', 80000, 1 from public.products where name = 'T Web Truffle';
insert into public.product_variants (product_id, name, price_paise, is_available)
  select id, '2 kg (off)', 280000, false from public.products where name = 'T Web Truffle';
insert into public.product_variants (product_id, name, price_paise)
  select id, 'Each', 1000 from public.products where name in ('T Web Archived', 'T Web In Hidden Category');
insert into ctx select 'half', v.id::text from public.product_variants v where v.name = '500 g';
insert into ctx select 'kg', v.id::text from public.product_variants v where v.name = '1 kg';
insert into ctx select 'off', v.id::text from public.product_variants v where v.name = '2 kg (off)';
insert into public.customers (full_name, phone, is_blocked, blocked_reason) values ('Blocked Person', '9000000999', true, 'spam');
insert into public.customers (full_name, phone) values ('Known Name', '9000000955');

create function pg_temp.day(p_days integer, p_time time default '12:00') returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Kolkata')::date + p_days) + p_time) at time zone 'Asia/Kolkata'
$$;
create function pg_temp.half(q integer default 1) returns jsonb language sql stable as $$
  select jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k = 'half'), 'quantity', q))
$$;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare res jsonb; cat jsonb; key uuid := gen_random_uuid();
begin
  cat := public.website_catalogue();
  -- expect: T Web Truffle
  insert into r(check_name,outcome) values ('W1 the catalogue lists only orderable products',
    (select string_agg(e ->> 'name', ',') from jsonb_array_elements(cat) e where e ->> 'name' like 'T Web%'));
  -- expect: 80000 / 500 g,1 kg / no tax
  insert into r(check_name,outcome) values ('W2 lowest price, available variants in order, nothing staff-only',
    (select (e ->> 'from_paise') || ' / ' || (select string_agg(x ->> 'name', ',') from jsonb_array_elements(e -> 'variants') x)
       || ' / ' || case when e ? 'tax_rate_bps' or e -> 'variants' -> 0 ? 'kitchen_id' then 'leaks' else 'no tax' end
     from jsonb_array_elements(cat) e where e ->> 'name' = 'T Web Truffle'));

  res := public.submit_website_order(key, ' Priya ', '98400 00001', pg_temp.day(3), 'Happy birthday Anu on top',
    'birthday', 'Priya@Example.com', pg_temp.half(2));
  insert into ctx values ('ref', res ->> 'reference');
  -- expect: same
  insert into r(check_name,outcome) values ('W5 a retry returns the same order',
    case when public.submit_website_order(key, 'Priya', '9840000001', pg_temp.day(3), 'x') ->> 'reference' = res ->> 'reference'
      then 'same' else 'different' end);

  res := public.submit_website_order(gen_random_uuid(), 'Known Visitor', '9000000955', pg_temp.day(3), 'A custom unicorn cake, 2 kg', 'custom');
  insert into ctx values ('known', res ->> 'reference');

  begin perform public.submit_website_order(gen_random_uuid(), 'X', '12345', pg_temp.day(3), 'cake');
    insert into r(check_name,outcome) values ('W7 a bad phone is refused', 'ALLOWED');
  -- expect: Please enter a valid phone number (10 to 15 digits).
  exception when others then insert into r(check_name,outcome) values ('W7 a bad phone is refused', sqlerrm); end;

  begin perform public.submit_website_order(gen_random_uuid(), 'X', '9840000002', now() - interval '1 hour', 'cake');
    insert into r(check_name,outcome) values ('W8 a past time is refused', 'ALLOWED');
  -- expect: Please choose a pickup time in the future.
  exception when others then insert into r(check_name,outcome) values ('W8 a past time is refused', sqlerrm); end;

  begin perform public.submit_website_order(gen_random_uuid(), 'X', '9840000002', pg_temp.day(3, '23:00'), 'cake');
    insert into r(check_name,outcome) values ('W9 a time outside opening hours is refused', 'ALLOWED');
  -- expect: Pickup on <day> must be between 9:00 AM and 9:00 PM.
  exception when others then insert into r(check_name,outcome) values ('W9 a time outside opening hours is refused', sqlerrm); end;

  begin perform public.submit_website_order(gen_random_uuid(), 'X', '9840000002', pg_temp.day(2),
      null, null, null, jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k = 'kg'), 'quantity', 1)));
    insert into r(check_name,outcome) values ('W10 lead time is enforced', 'ALLOWED');
  -- expect: These items need 72 h 0 min of preparation; the earliest pickup is <time>.
  exception when others then insert into r(check_name,outcome) values ('W10 lead time is enforced', sqlerrm); end;

  begin perform public.submit_website_order(gen_random_uuid(), 'X', '9840000002', pg_temp.day(3), null, null, null,
      jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k = 'off'), 'quantity', 1)));
    insert into r(check_name,outcome) values ('W11 an unavailable item is refused', 'ALLOWED');
  -- expect: One of the items is no longer available. Please reload the page and try again.
  exception when others then insert into r(check_name,outcome) values ('W11 an unavailable item is refused', sqlerrm); end;

  begin perform public.submit_website_order(gen_random_uuid(), 'Blocked', '9000000999', pg_temp.day(3), 'cake');
    insert into r(check_name,outcome) values ('W12 a blocked phone is refused', 'ALLOWED');
  -- expect: We could not take this order online. Please call us to order.
  exception when others then insert into r(check_name,outcome) values ('W12 a blocked phone is refused', sqlerrm); end;

  begin perform public.submit_website_order(gen_random_uuid(), 'X', '9840000002', pg_temp.day(3), 'cake', p_fulfilment => 'setup');
    insert into r(check_name,outcome) values ('W13 set-up needs an address', 'ALLOWED');
  -- expect: Set-up orders need the customer's address.
  exception when others then insert into r(check_name,outcome) values ('W13 set-up needs an address', sqlerrm); end;

  res := public.submit_website_order(gen_random_uuid(), 'Setup Person', '9840000003', pg_temp.day(4), 'Wedding tower',
    'wedding', p_fulfilment => 'setup', p_setup_address => ' 5 Lake View Road ');
  insert into ctx values ('setup', res ->> 'reference');

  perform public.submit_website_order(gen_random_uuid(), 'Priya', '9840000001', pg_temp.day(3), 'second');
  perform public.submit_website_order(gen_random_uuid(), 'Priya', '9840000001', pg_temp.day(3), 'third');
  begin perform public.submit_website_order(gen_random_uuid(), 'Priya', '9840000001', pg_temp.day(3), 'fourth');
    insert into r(check_name,outcome) values ('W15 a fourth waiting order from one phone is refused', 'ALLOWED');
  -- expect: You already have orders waiting for us to confirm. We will call you soon, or WhatsApp us.
  exception when others then insert into r(check_name,outcome) values ('W15 a fourth waiting order from one phone is refused', sqlerrm); end;

  begin perform public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.half());
    insert into r(check_name,outcome) values ('W16 anon cannot use the staff order function', 'ALLOWED');
  -- expect: <permission denied for function create_order|You do not have permission to create orders.>
  exception when others then insert into r(check_name,outcome) values ('W16 anon cannot use the staff order function', sqlerrm); end;

  begin perform 1 from public.orders limit 1;
    insert into r(check_name,outcome) values ('W17 anon cannot read orders', 'ALLOWED');
  -- expect: permission denied for table orders
  exception when others then insert into r(check_name,outcome) values ('W17 anon cannot read orders', sqlerrm); end;
end $$;

reset role;
-- Read back as the database owner (anon cannot read orders).
-- expect: ONLINE / pending_confirmation / 160000 / 1
insert into r(check_name,outcome) values ('W3 a website order arrives pending with its items',
  (select o.source || ' / ' || o.status || ' / ' || o.total_paise || ' / ' || (select count(*) from public.order_items i where i.order_id = o.id)
   from public.orders o where o.reference = (select v from ctx where k = 'ref')));
-- expect: Website order — Birthday cake | Email: priya@example.com |  | Happy birthday Anu on top
insert into r(check_name,outcome) values ('W4 the order notes carry the type, email and message',
  (select replace(customer_notes, E'\n', ' | ') from public.orders where reference = (select v from ctx where k = 'ref')));
-- expect: 0 / Known Name / Known Visitor
insert into r(check_name,outcome) values ('W6 a request with no items has total 0; the customer keeps their name',
  (select o.total_paise || ' / ' || c.full_name || ' / ' || o.customer_name
   from public.orders o join public.customers c on c.id = o.customer_id where o.reference = (select v from ctx where k = 'known')));
-- expect: setup / 5 Lake View Road
insert into r(check_name,outcome) values ('W14 a set-up order keeps the address',
  (select fulfilment || ' / ' || setup_address from public.orders where reference = (select v from ctx where k = 'setup')));

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000ea1","role":"authenticated"}', true);
do $$
declare o public.orders;
begin
  select * into o from public.orders where reference = (select v from ctx where k = 'ref');
  o := public.confirm_order(o.id, o.version);
  -- expect: confirmed
  insert into r(check_name,outcome) values ('W18 an admin confirms a website order', o.status::text);
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
