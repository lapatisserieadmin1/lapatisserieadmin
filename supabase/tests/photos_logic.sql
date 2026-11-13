-- Product and custom cake photos (2026-10-09). Runs in a transaction and rolls back.
-- Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-000000000fa1','ph-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000fc1','ph-c@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-000000000fa1','Ph Admin','admin'),
 ('00000000-0000-0000-0000-000000000fc1','Ph Counter','counter');
insert into public.categories (name) values ('T Ph Bakes');
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Ph Cake', 'made_to_order', 500 from public.categories where name = 'T Ph Bakes';
insert into ctx select 'P', id::text from public.products where name = 'T Ph Cake';
delete from public.pickup_windows;
delete from public.closures;
update public.business_hours set opens_at = '09:00', closes_at = '21:00', is_closed = false;

-- expect: product-photos true / custom-cake-photos false
insert into r(check_name,outcome) values ('S1 two photo buckets, only product photos public',
  (select string_agg(id || ' ' || public, ' / ' order by id desc) from storage.buckets where id in ('product-photos', 'custom-cake-photos')));

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000fc1","role":"authenticated"}', true);
do $$
declare p uuid := (select v::uuid from ctx where k = 'P'); o public.orders;
begin
  begin perform public.set_product_image(p, 'https://x.supabase.co/storage/v1/object/public/product-photos/a.jpg');
    insert into r(check_name,outcome) values ('S2 counter staff cannot set product photos', 'ALLOWED');
  -- expect: Only an admin can change product photos.
  exception when others then insert into r(check_name,outcome) values ('S2 counter staff cannot set product photos', sqlerrm); end;

  o := public.create_custom_cake_order(gen_random_uuid(), 'CALL', 'Ph Cust', '9000000931',
    (((now() at time zone 'Asia/Kolkata')::date + 3) + time '12:00') at time zone 'Asia/Kolkata', 100000,
    '{"flavour": "Vanilla", "weight_kg": 1}');
  insert into ctx values ('O', o.id::text);
  begin perform public.set_custom_cake_photos(o.id, array['someone-else/x.jpg']);
    insert into r(check_name,outcome) values ('S3 a cake photo must sit under its order', 'ALLOWED');
  -- expect: The photo is not stored under this order.
  exception when others then insert into r(check_name,outcome) values ('S3 a cake photo must sit under its order', sqlerrm); end;

  perform public.set_custom_cake_photos(o.id, array[o.id || '/ref.jpg']);
  -- expect: true
  insert into r(check_name,outcome) values ('S4 counter staff add a cake photo',
    ((select photo_paths from public.custom_cakes where order_id = o.id) = array[o.id || '/ref.jpg'])::text);
  perform public.set_custom_cake_photos(o.id, array(select o.id || '/' || g || '.jpg' from generate_series(1, 5) g));
  -- expect: 5
  insert into r(check_name,outcome) values ('S4b up to 5 cake photos',
    (select cardinality(photo_paths) from public.custom_cakes where order_id = o.id)::text);
  begin perform public.set_custom_cake_photos(o.id, array(select o.id || '/' || g || '.jpg' from generate_series(1, 6) g));
    insert into r(check_name,outcome) values ('S4c a sixth photo is refused', 'ALLOWED');
  -- expect: A custom cake can have up to 5 reference photos.
  exception when others then insert into r(check_name,outcome) values ('S4c a sixth photo is refused', sqlerrm); end;
  begin perform public.set_custom_cake_photos(o.id, array[o.id || '/1.jpg', o.id || '/1.jpg']);
    insert into r(check_name,outcome) values ('S4d the same photo twice is refused', 'ALLOWED');
  -- expect: The same photo is listed twice.
  exception when others then insert into r(check_name,outcome) values ('S4d the same photo twice is refused', sqlerrm); end;
  perform public.set_custom_cake_photos(o.id, '{}');
  -- expect: 0
  insert into r(check_name,outcome) values ('S5 the cake photos can be removed',
    (select cardinality(photo_paths) from public.custom_cakes where order_id = o.id)::text);
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000fa1","role":"authenticated"}', true);
do $$
declare p uuid := (select v::uuid from ctx where k = 'P');
begin
  begin perform public.set_product_image(p, 'https://evil.example.com/a.jpg');
    insert into r(check_name,outcome) values ('S6 a photo from elsewhere is refused', 'ALLOWED');
  -- expect: Upload the photo to product photos first.
  exception when others then insert into r(check_name,outcome) values ('S6 a photo from elsewhere is refused', sqlerrm); end;

  perform public.set_product_image(p, 'https://x.supabase.co/storage/v1/object/public/product-photos/' || p || '/a.jpg');
  -- expect: true
  insert into r(check_name,outcome) values ('S7 an admin sets a product photo',
    ((select image_url from public.products where id = p) like '%/product-photos/%')::text);
  perform public.set_product_image(p, null);
  -- expect: NULL
  insert into r(check_name,outcome) values ('S8 the product photo can be removed',
    coalesce((select image_url from public.products where id = p), 'NULL'));
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
