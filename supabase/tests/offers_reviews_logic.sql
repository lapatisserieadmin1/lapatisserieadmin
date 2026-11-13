-- Offers & Banners and Reviews (2026-10-18).
-- Runs in a transaction and rolls back. Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
grant all on r to anon, authenticated;
grant usage on sequence r_n_seq to anon, authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-000000000fa1','or-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000fc1','or-c@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-000000000fa1','Or Admin','admin'),
 ('00000000-0000-0000-0000-000000000fc1','Or Counter','counter');

-- Visitors: send reviews, see nothing pending, cannot touch the tables.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform public.submit_review(' Anu ', 5, ' Lovely cake! ');
  perform public.submit_review('Ravi', 4, 'Good croissants');
  -- expect: 0
  insert into r(check_name,outcome) values ('R1 a new review waits for approval',
    jsonb_array_length(public.website_content() -> 'reviews')::text);

  begin perform public.submit_review('X', 6, 'too many stars');
    insert into r(check_name,outcome) values ('R2 rating must be 1 to 5', 'ALLOWED');
  -- expect: Please choose 1 to 5 stars.
  exception when others then insert into r(check_name,outcome) values ('R2 rating must be 1 to 5', sqlerrm); end;

  begin perform public.submit_review('X', 5, '   ');
    insert into r(check_name,outcome) values ('R3 an empty review is refused', 'ALLOWED');
  -- expect: Please write your review (up to 600 characters).
  exception when others then insert into r(check_name,outcome) values ('R3 an empty review is refused', sqlerrm); end;

  begin insert into public.reviews (customer_name, rating, comment, status) values ('Spam', 5, 'x', 'approved');
    insert into r(check_name,outcome) values ('R4 visitors cannot write the table', 'ALLOWED');
  -- expect: permission denied for table reviews
  exception when others then insert into r(check_name,outcome) values ('R4 visitors cannot write the table', sqlerrm); end;

  begin perform 1 from public.offers;
    insert into r(check_name,outcome) values ('R5 visitors cannot read offers directly', 'ALLOWED');
  -- expect: permission denied for table offers
  exception when others then insert into r(check_name,outcome) values ('R5 visitors cannot read offers directly', sqlerrm); end;
end $$;

-- Counter staff: read, cannot change.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000fc1","role":"authenticated"}', true);
do $$
declare n integer;
begin
  -- expect: 2
  insert into r(check_name,outcome) values ('R6 counter staff see pending reviews', (select count(*) from public.reviews where status = 'pending')::text);
  update public.reviews set status = 'approved';
  get diagnostics n = row_count;
  -- expect: 0
  insert into r(check_name,outcome) values ('R7 counter staff cannot approve', n::text);
  begin insert into public.offers (title) values ('Counter offer');
    insert into r(check_name,outcome) values ('R8 counter staff cannot add offers', 'ALLOWED');
  -- expect: new row violates row-level security policy for table "offers"
  exception when others then insert into r(check_name,outcome) values ('R8 counter staff cannot add offers', sqlerrm); end;
end $$;

-- Admin: approve, hide, edit offers.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000fa1","role":"authenticated"}', true);
do $$
begin
  update public.reviews set status = 'approved' where customer_name = 'Anu';
  update public.reviews set status = 'hidden' where customer_name = 'Ravi';
  -- expect: approved by admin
  insert into r(check_name,outcome) values ('R9 approving records who and when',
    (select status || case when decided_by = '00000000-0000-0000-0000-000000000fa1' and decided_at is not null then ' by admin' else ' ?' end
     from public.reviews where customer_name = 'Anu'));

  begin update public.reviews set comment = 'Changed words' where customer_name = 'Anu';
    insert into r(check_name,outcome) values ('R10 staff cannot change a customer''s words', 'ALLOWED');
  -- expect: permission denied for table reviews
  exception when others then insert into r(check_name,outcome) values ('R10 staff cannot change a customer''s words', sqlerrm); end;

  insert into public.offers (title, body, button_label, button_link, sort_order) values ('Diwali box', '10% off sweet boxes', 'Order now', '#contact', 1);
  insert into public.offers (title, ends_on) values ('Expired', current_date - 1);
  insert into public.offers (title, starts_on) values ('Future', current_date + 5);
  insert into public.offers (title, is_active) values ('Switched off', false);
  begin insert into public.offers (title, button_link) values ('Bad link', 'javascript:alert(1)');
    insert into r(check_name,outcome) values ('R11 only page or https links', 'ALLOWED');
  -- expect: new row for relation "offers" violates check constraint "offers_button_link_check"
  exception when others then insert into r(check_name,outcome) values ('R11 only page or https links', sqlerrm); end;
end $$;

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
declare c jsonb := public.website_content();
begin
  -- expect: Anu 5 Lovely cake!
  insert into r(check_name,outcome) values ('R12 the website shows only approved reviews, trimmed',
    (select string_agg((x ->> 'name') || ' ' || (x ->> 'rating') || ' ' || (x ->> 'comment'), ',') from jsonb_array_elements(c -> 'reviews') x));
  -- expect: Diwali box
  insert into r(check_name,outcome) values ('R13 the website shows only active offers for today',
    (select string_agg(x ->> 'title', ',') from jsonb_array_elements(c -> 'offers') x));
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
