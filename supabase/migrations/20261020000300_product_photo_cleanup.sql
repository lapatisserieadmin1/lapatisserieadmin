-- Removing a photo from product-photos (replaced offer photos, deleted gallery photos) needs the admin to
-- be able to select the object: Storage looks the file up before it deletes it. Without this policy the
-- removal silently did nothing and the old file stayed in the bucket (found 2026-10-20).
create policy "Admins read product photos" on storage.objects for select to authenticated
  using (bucket_id = 'product-photos' and (select private.is_admin()));
