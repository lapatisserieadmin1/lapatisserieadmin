-- Offers & Banners and Reviews (owner, 2026-10-18): the last "Coming soon" items.
--
-- offers: admins write them; the website shows the active ones (website_content).
-- reviews: customers send them from the website (submit_review, no login); they wait as pending until an
--   admin approves or hides them; the website shows the approved ones (website_content).

create table public.offers (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 80),
  body text check (body is null or length(body) <= 300),
  image_url text check (image_url is null or length(image_url) <= 500),
  button_label text check (button_label is null or length(button_label) <= 30),
  -- A page on the website (#products, #contact) or a full https:// address.
  button_link text check (button_link is null or (length(button_link) <= 300 and button_link ~ '^(#[A-Za-z][A-Za-z0-9_-]*|/[^\s]*|https://[^\s]+)$')),
  starts_on date,
  ends_on date,
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order between 0 and 9999),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_on is null or ends_on is null or ends_on >= starts_on)
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  customer_name text not null check (length(trim(customer_name)) between 1 and 60),
  rating smallint not null check (rating between 1 and 5),
  comment text not null check (length(trim(comment)) between 1 and 600),
  status text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index reviews_status_created_idx on public.reviews (status, created_at desc);
create index reviews_decided_by_idx on public.reviews (decided_by);

create trigger offers_updated_at before update on public.offers
  for each row execute function private.set_updated_at();
create trigger offers_audit after insert or update or delete on public.offers
  for each row execute function private.audit_row('id');
create trigger reviews_audit after insert or update or delete on public.reviews
  for each row execute function private.audit_row('id');

-- Who decided and when, whenever the status changes.
create function private.stamp_review_decision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.decided_at := case when new.status = 'pending' then null else now() end;
    new.decided_by := case when new.status = 'pending' then null else auth.uid() end;
  end if;
  return new;
end;
$$;
create trigger reviews_stamp_decision before update on public.reviews
  for each row execute function private.stamp_review_decision();

alter table public.offers enable row level security;
alter table public.reviews enable row level security;

create policy "Staff read offers" on public.offers for select to authenticated
  using ((select private.is_staff()));
create policy "Admins insert offers" on public.offers for insert to authenticated
  with check ((select private.is_admin()));
create policy "Admins update offers" on public.offers for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins delete offers" on public.offers for delete to authenticated
  using ((select private.is_admin()));

create policy "Staff read reviews" on public.reviews for select to authenticated
  using ((select private.is_staff()));
create policy "Admins update reviews" on public.reviews for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins delete reviews" on public.reviews for delete to authenticated
  using ((select private.is_admin()));

revoke all on public.offers, public.reviews from anon, authenticated;
grant select, insert, update, delete on public.offers to authenticated;
-- Reviews arrive only through submit_review; staff change status, never the customer's words.
grant select, delete on public.reviews to authenticated;
grant update (status) on public.reviews to authenticated;

-- ---------------------------------------------------------------------------
-- Website
-- ---------------------------------------------------------------------------

-- Active offers for today (business time zone) and the 12 newest approved reviews.
create function public.website_content()
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
      from (select * from public.reviews where status = 'approved' order by created_at desc limit 12) r), '[]'::jsonb)
  )
$$;

-- Anyone may call this. The review waits for an admin. At most 20 new reviews an hour in total.
create function public.submit_review(p_name text, p_rating integer, p_comment text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
begin
  if v_name is null or length(v_name) > 60 then
    perform private.fail('Please enter your name (up to 60 characters).');
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    perform private.fail('Please choose 1 to 5 stars.');
  end if;
  if v_comment is null or length(v_comment) > 600 then
    perform private.fail('Please write your review (up to 600 characters).');
  end if;
  perform pg_advisory_xact_lock(hashtext('website_review'));
  if (select count(*) from public.reviews where created_at > now() - interval '1 hour') >= 20 then
    perform private.fail('We are receiving a lot of reviews right now. Please try again later.', 'busy');
  end if;
  insert into public.reviews (customer_name, rating, comment) values (v_name, p_rating, v_comment);
end;
$$;

revoke execute on function public.website_content(), public.submit_review(text, integer, text) from public, anon, authenticated;
grant execute on function public.website_content(), public.submit_review(text, integer, text) to anon, authenticated;
