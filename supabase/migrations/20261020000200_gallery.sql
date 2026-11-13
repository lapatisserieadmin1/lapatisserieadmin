-- Website gallery (owner, 2026-10-20): admins add photos; the website's Gallery section shows them.
--
-- gallery_photos: photos in the public product-photos bucket under gallery/, with an optional caption,
-- an order and a show/hide switch. website_content() now also returns the shown photos (up to 60);
-- while there are none the website keeps its built-in photos.

create table public.gallery_photos (
  id uuid primary key default gen_random_uuid(),
  image_url text not null check (length(image_url) <= 500 and image_url ~ '/storage/v1/object/public/product-photos/gallery/'),
  caption text check (caption is null or length(trim(caption)) between 1 and 60),
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index gallery_photos_shown_idx on public.gallery_photos (sort_order, created_at desc) where is_active;

create trigger gallery_photos_updated_at before update on public.gallery_photos
  for each row execute function private.set_updated_at();
create trigger gallery_photos_audit after insert or update or delete on public.gallery_photos
  for each row execute function private.audit_row('id');

alter table public.gallery_photos enable row level security;
create policy "Staff read gallery" on public.gallery_photos for select to authenticated
  using ((select private.is_staff()));
create policy "Admins add gallery photos" on public.gallery_photos for insert to authenticated
  with check ((select private.is_admin()));
create policy "Admins change gallery photos" on public.gallery_photos for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins remove gallery photos" on public.gallery_photos for delete to authenticated
  using ((select private.is_admin()));

revoke all on public.gallery_photos from anon, authenticated;
grant select, insert, update, delete on public.gallery_photos to authenticated;

-- Active offers for today (business time zone), the 12 newest approved reviews and the gallery.
create or replace function public.website_content()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with today as (select (now() at time zone private.business_timezone())::date as d)
  select jsonb_build_object(
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'title', o.title, 'body', o.body, 'image_url', o.image_url,
        'button_label', o.button_label, 'button_link', o.button_link, 'ends_on', o.ends_on
      ) order by o.sort_order, o.created_at desc)
      from public.offers o, today
      where o.is_active
        and (o.starts_on is null or o.starts_on <= today.d)
        and (o.ends_on is null or o.ends_on >= today.d)), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', r.customer_name, 'rating', r.rating, 'comment', r.comment, 'created_at', r.created_at
      ) order by r.created_at desc)
      from (select * from public.reviews where status = 'approved' order by created_at desc limit 12) r), '[]'::jsonb),
    'gallery', coalesce((
      select jsonb_agg(jsonb_build_object('image_url', g.image_url, 'caption', g.caption) order by g.sort_order, g.created_at desc)
      from (select * from public.gallery_photos where is_active order by sort_order, created_at desc limit 60) g), '[]'::jsonb)
  )
$$;
