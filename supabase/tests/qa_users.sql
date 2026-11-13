-- Creates temporary QA logins for the end-to-end scripts in web/scripts/e2e/.
-- Replace CHANGE_ME with a throwaway password (pass the same value as QA_PW). Prefer running on STAGING.
do $$
declare u record;
begin
  for u in select * from (values
    ('33333333-3333-4333-8333-333333333333'::uuid, 'qa-admin@auri.test', 'QA Admin', 'admin'::public.staff_role),
    ('44444444-4444-4444-8444-444444444444'::uuid, 'qa-counter@auri.test', 'QA Counter', 'counter'::public.staff_role)
  ) as t(id, email, name, role)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
      reauthentication_token, phone_change, phone_change_token)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      extensions.crypt('CHANGE_ME', extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '', '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
      jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now());
    insert into public.staff_profiles (user_id, full_name, role) values (u.id, u.name, u.role);
  end loop;
end $$;

-- Cleanup after the scripts (only works while the test orders have no payments or bills;
-- payments, bills, and credit notes are permanent by design):
-- delete from public.orders where customer_name like 'E2E %';
-- delete from public.customers where full_name like 'E2E %';
-- delete from public.product_variants where product_id in (select id from public.products where name like 'E2E %');
-- delete from public.products where name like 'E2E %';
-- delete from public.categories where name like 'E2E%';
-- delete from auth.users where id in ('33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444');
