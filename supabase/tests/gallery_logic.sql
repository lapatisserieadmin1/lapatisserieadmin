-- Website gallery (2026-10-20). Runs in a transaction and rolls back.
-- Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
grant all on r to anon, authenticated;
grant usage on sequence r_n_seq to anon, authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-000000000ea1','ga-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000ec1','ga-c@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000ef1','ga-f@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-000000000ea1','Ga Admin','admin'),
 ('00000000-0000-0000-0000-000000000ec1','Ga Counter','counter'),
 ('00000000-0000-0000-0000-000000000ef1','Ga Chef','chef');
delete from public.gallery_photos;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000ea1","role":"authenticated"}', true);
insert into public.gallery_photos (image_url, caption, sort_order) values
  ('https://x.supabase.co/storage/v1/object/public/product-photos/gallery/b.jpg', 'Second', 2),
  ('https://x.supabase.co/storage/v1/object/public/product-photos/gallery/a.jpg', 'First', 1),
  ('https://x.supabase.co/storage/v1/object/public/product-photos/gallery/c.jpg', null, 3);
update public.gallery_photos set is_active = false where image_url like '%/c.jpg';
do $$ begin
  begin insert into public.gallery_photos (image_url) values ('https://evil.example.com/x.jpg');
    insert into r(check_name,outcome) values ('G1 only photos uploaded to the gallery folder', 'ALLOWED');
  -- expect: new row for relation "gallery_photos" violates check constraint …
  exception when others then insert into r(check_name,outcome) values ('G1 only photos uploaded to the gallery folder', sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000ec1","role":"authenticated"}', true);
do $$ begin
  begin insert into public.gallery_photos (image_url) values ('https://x.supabase.co/storage/v1/object/public/product-photos/gallery/d.jpg');
    insert into r(check_name,outcome) values ('G2 counter staff cannot add photos', 'ALLOWED');
  -- expect: new row violates row-level security policy for table "gallery_photos"
  exception when others then insert into r(check_name,outcome) values ('G2 counter staff cannot add photos', sqlerrm); end;
end $$;
-- expect: 3
insert into r(check_name,outcome) values ('G3 counter staff can see the list', (select count(*) from public.gallery_photos)::text);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000ef1","role":"authenticated"}', true);
-- expect: 0
insert into r(check_name,outcome) values ('G4 chefs see no gallery rows', (select count(*) from public.gallery_photos)::text);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
-- expect: First, Second
insert into r(check_name,outcome) values ('G5 the website gets shown photos in order, hidden ones left out',
  (select string_agg(coalesce(g ->> 'caption', '-'), ', ') from jsonb_array_elements(public.website_content() -> 'gallery') g));
do $$ begin
  begin perform count(*) from public.gallery_photos;
    insert into r(check_name,outcome) values ('G6 visitors cannot read the table', 'ALLOWED');
  -- expect: permission denied for table gallery_photos
  exception when others then insert into r(check_name,outcome) values ('G6 visitors cannot read the table', sqlerrm); end;
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
