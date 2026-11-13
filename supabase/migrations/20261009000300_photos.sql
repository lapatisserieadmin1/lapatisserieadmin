-- 2026-10-09 (owner): product photos and custom cake reference photos.
--
-- product-photos: public (the future website shows them), admins upload; products.image_url keeps the
--   public URL, set through set_product_image.
-- custom-cake-photos: private, admin and counter staff upload and view (signed URLs); custom_cakes.photo_path
--   keeps the object path "<order_id>/<file>", set through set_custom_cake_photo.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('product-photos', 'product-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('custom-cake-photos', 'custom-cake-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Admins add product photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-photos' and (select private.is_admin()));
create policy "Admins change product photos" on storage.objects for update to authenticated
  using (bucket_id = 'product-photos' and (select private.is_admin()));
create policy "Admins remove product photos" on storage.objects for delete to authenticated
  using (bucket_id = 'product-photos' and (select private.is_admin()));

create policy "Admin and counter read cake photos" on storage.objects for select to authenticated
  using (bucket_id = 'custom-cake-photos' and (select private.has_role(array['admin', 'counter']::public.staff_role[])));
create policy "Admin and counter add cake photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'custom-cake-photos' and (select private.has_role(array['admin', 'counter']::public.staff_role[])));
create policy "Admin and counter remove cake photos" on storage.objects for delete to authenticated
  using (bucket_id = 'custom-cake-photos' and (select private.has_role(array['admin', 'counter']::public.staff_role[])));

-- Admins only. Null clears the photo; otherwise the URL must be a product-photos public URL.
create function public.set_product_image(p_product_id uuid, p_image_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  url text := nullif(trim(coalesce(p_image_url, '')), '');
begin
  if not private.is_admin() then
    perform private.fail('Only an admin can change product photos.', 'forbidden');
  end if;
  if url is not null and (url !~ '^https?://' or position('/storage/v1/object/public/product-photos/' in url) = 0 or length(url) > 500) then
    perform private.fail('Upload the photo to product photos first.');
  end if;
  update public.products set image_url = url where id = p_product_id;
  if not found then
    perform private.fail('Product not found.', 'not_found');
  end if;
end;
$$;

-- Admin and counter staff, until the order is closed. Null clears the photo.
create function public.set_custom_cake_photo(p_order_id uuid, p_photo_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  path text := nullif(trim(coalesce(p_photo_path, '')), '');
  st public.order_status;
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to change orders.', 'forbidden');
  end if;
  select status into st from public.orders where id = p_order_id;
  if not found then
    perform private.fail('Order not found.', 'not_found');
  end if;
  if st in ('completed', 'cancelled', 'rejected') then
    perform private.fail(format('The cake photo cannot change on a %s order.', st::text));
  end if;
  if path is not null and (path not like p_order_id::text || '/%' or length(path) > 300 or path like '%..%') then
    perform private.fail('The photo is not stored under this order.');
  end if;
  update public.custom_cakes set photo_path = path where order_id = p_order_id;
  if not found then
    perform private.fail('This order has no custom cake.', 'not_found');
  end if;
  perform private.log_order_event(p_order_id, 'custom_cake_photo', null,
    jsonb_build_object('action', case when path is null then 'removed' else 'added' end));
end;
$$;

revoke execute on function public.set_product_image(uuid, text), public.set_custom_cake_photo(uuid, text) from public, anon;
grant execute on function public.set_product_image(uuid, text), public.set_custom_cake_photo(uuid, text) to authenticated;
