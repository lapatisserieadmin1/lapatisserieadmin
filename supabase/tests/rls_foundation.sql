-- Access-rule checks for the foundation schema. Run in the Supabase SQL editor (or via MCP execute_sql).
-- Everything happens inside a transaction that is rolled back; expected outcomes are in check_name.
begin;
insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-00000000000a','admin@test.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-00000000000c','chef@test.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-00000000000e','nobody@test.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-00000000000a','Test Admin','admin'),
 ('00000000-0000-0000-0000-00000000000c','Test Chef','chef');
insert into public.categories (name) values ('Test Cakes');
insert into public.products (category_id, name) select id, 'Test Cake' from public.categories where name='Test Cakes';
insert into public.product_variants (product_id, name, price_paise) select id, '1 kg', 90000 from public.products where name='Test Cake';

create temp table results (check_name text, outcome text) on commit drop;
grant all on results to authenticated, anon;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
insert into results select 'chef sees no products: reads through chef_work only (expect 0)', count(*)::text from public.products;
insert into results select 'chef sees staff rows (expect 1 = self)', count(*)::text from public.staff_profiles;
update public.product_variants set price_paise = 1;
insert into results select 'chef sees no prices (expect 0)', count(*)::text from public.product_variants;
insert into results select 'chef sees no settings (expect 0)', count(*)::text from public.business_settings;
do $$ begin
  begin insert into public.products (category_id, name) values (gen_random_uuid(), 'X');
    insert into results values ('chef insert product (expect denied)', 'ALLOWED');
  exception when insufficient_privilege then insert into results values ('chef insert product (expect denied)', 'denied'); end;
end $$;
insert into results select 'chef sees audit rows (expect 0)', count(*)::text from public.audit_events;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000e","role":"authenticated"}', true);
insert into results select 'non-staff sees products (expect 0)', count(*)::text from public.products;
insert into results select 'non-staff sees kitchens (expect 0)', count(*)::text from public.kitchens;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
update public.product_variants set price_paise = 95000;
insert into results select 'admin price update (expect 95000)', (select string_agg(price_paise::text, ',') from public.product_variants);
insert into results select 'admin sees audit rows (expect > 0)', count(*)::text from public.audit_events;
do $$ begin
  begin update public.staff_profiles set role='chef' where user_id='00000000-0000-0000-0000-00000000000a';
    insert into results values ('demote last admin (expect blocked)', 'ALLOWED');
  exception when raise_exception then insert into results values ('demote last admin (expect blocked)', 'blocked'); end;
end $$;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
do $$ begin
  begin perform 1 from public.products; insert into results values ('anon read products (expect denied)', 'ALLOWED');
  exception when insufficient_privilege then insert into results values ('anon read products (expect denied)', 'denied'); end;
end $$;

reset role;
select * from results;
rollback;
