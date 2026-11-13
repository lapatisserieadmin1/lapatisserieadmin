-- Phase 4C: pickup windows per weekday, daily order caps per category, and date overrides for festivals.
-- Enforcement lives in 20260927000410_capacity_enforcement.sql. Cut-offs were dropped (lead times cover them).

-- Category snapshot on order lines (lines are snapshots; product_id can become null when a product is deleted).
alter table public.order_items
  add column category_id uuid references public.categories (id) on delete set null;
create index order_items_category_id_idx on public.order_items (category_id);

create table public.pickup_windows (
  id uuid primary key default gen_random_uuid(),
  weekday smallint not null check (weekday between 0 and 6), -- 0 = Sunday, as extract(dow)
  starts_at time not null,
  ends_at time not null,
  max_orders integer check (max_orders is null or max_orders >= 0), -- null = no limit
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index pickup_windows_weekday_idx on public.pickup_windows (weekday, starts_at);

create table public.category_daily_caps (
  category_id uuid primary key references public.categories (id) on delete cascade,
  max_orders integer not null check (max_orders >= 0),
  updated_at timestamptz not null default now()
);

create table public.capacity_overrides (
  id uuid primary key default gen_random_uuid(),
  on_date date not null,
  kind text not null check (kind in ('window', 'category')),
  category_id uuid references public.categories (id) on delete cascade,
  starts_at time,
  ends_at time,
  max_orders integer check (max_orders is null or max_orders >= 0),
  note text not null check (length(trim(note)) between 1 and 120),
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (
    (kind = 'window' and category_id is null and starts_at is not null and ends_at is not null and ends_at > starts_at)
    or (kind = 'category' and category_id is not null and max_orders is not null and starts_at is null and ends_at is null)
  )
);
create index capacity_overrides_date_idx on public.capacity_overrides (on_date);
create index capacity_overrides_category_id_idx on public.capacity_overrides (category_id);
create index capacity_overrides_created_by_idx on public.capacity_overrides (created_by);
create unique index capacity_overrides_category_day_key on public.capacity_overrides (on_date, category_id) where kind = 'category';

create trigger category_daily_caps_updated_at before update on public.category_daily_caps
  for each row execute function private.set_updated_at();

create trigger pickup_windows_audit after insert or update or delete on public.pickup_windows
  for each row execute function private.audit_row('id');
create trigger category_daily_caps_audit after insert or update or delete on public.category_daily_caps
  for each row execute function private.audit_row('category_id');
create trigger capacity_overrides_audit after insert or update or delete on public.capacity_overrides
  for each row execute function private.audit_row('id');

-- Windows on one day must not overlap. AFTER ROW triggers run at statement end, so rows inserted
-- together by one statement see each other.
create function private.check_pickup_window_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  other record;
begin
  select * into other from public.pickup_windows w
  where w.weekday = new.weekday and w.id <> new.id and w.starts_at < new.ends_at and new.starts_at < w.ends_at
  limit 1;
  if found then
    perform private.fail(format('Pickup windows on the same day cannot overlap (%s–%s and %s–%s).',
      to_char(other.starts_at, 'FMHH12:MI AM'), to_char(other.ends_at, 'FMHH12:MI AM'),
      to_char(new.starts_at, 'FMHH12:MI AM'), to_char(new.ends_at, 'FMHH12:MI AM')));
  end if;
  return null;
end;
$$;
create trigger pickup_windows_no_overlap after insert or update on public.pickup_windows
  for each row execute function private.check_pickup_window_overlap();

create function private.check_override_window_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  other record;
begin
  if new.kind <> 'window' then
    return null;
  end if;
  select * into other from public.capacity_overrides w
  where w.kind = 'window' and w.on_date = new.on_date and w.id <> new.id
    and w.starts_at < new.ends_at and new.starts_at < w.ends_at
  limit 1;
  if found then
    perform private.fail(format('Pickup windows on the same day cannot overlap (%s–%s and %s–%s).',
      to_char(other.starts_at, 'FMHH12:MI AM'), to_char(other.ends_at, 'FMHH12:MI AM'),
      to_char(new.starts_at, 'FMHH12:MI AM'), to_char(new.ends_at, 'FMHH12:MI AM')));
  end if;
  return null;
end;
$$;
create trigger capacity_overrides_no_overlap after insert or update on public.capacity_overrides
  for each row execute function private.check_override_window_overlap();

-- Validates a window list: [{"starts_at":"09:00","ends_at":"11:00","max_orders":6|null}, ...].
create function private.validate_windows(p_windows jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  w jsonb;
begin
  if p_windows is null or jsonb_typeof(p_windows) <> 'array' then
    perform private.fail('The window list is not valid.');
  end if;
  if jsonb_array_length(p_windows) > 24 then
    perform private.fail('A day can have at most 24 pickup windows.');
  end if;
  for w in select value from jsonb_array_elements(p_windows)
  loop
    if coalesce(w ->> 'starts_at', '') !~ '^\d{2}:\d{2}$' or coalesce(w ->> 'ends_at', '') !~ '^\d{2}:\d{2}$' then
      perform private.fail('Enter window times as HH:MM.');
    end if;
    if (w ->> 'ends_at')::time <= (w ->> 'starts_at')::time then
      perform private.fail('Each window must end after it starts.');
    end if;
    if w ? 'max_orders' and jsonb_typeof(w -> 'max_orders') <> 'null'
       and (jsonb_typeof(w -> 'max_orders') <> 'number' or (w ->> 'max_orders')::numeric < 0
            or (w ->> 'max_orders')::numeric <> trunc((w ->> 'max_orders')::numeric)) then
      perform private.fail('Order limits must be whole numbers of 0 or more.');
    end if;
  end loop;
end;
$$;

-- Replaces the window list of each given weekday in one transaction.
create function public.set_pickup_windows(p_weekdays smallint[], p_windows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can change pickup windows.', 'forbidden');
  end if;
  if p_weekdays is null or cardinality(p_weekdays) = 0 or exists (select 1 from unnest(p_weekdays) d where d not between 0 and 6) then
    perform private.fail('Choose at least one valid day.');
  end if;
  perform private.validate_windows(p_windows);

  delete from public.pickup_windows where weekday = any (p_weekdays);
  insert into public.pickup_windows (weekday, starts_at, ends_at, max_orders)
  select d, (w ->> 'starts_at')::time, (w ->> 'ends_at')::time, (w ->> 'max_orders')::integer
  from unnest(p_weekdays) d, jsonb_array_elements(p_windows) w;
end;
$$;

-- Replaces one date's window list (festival days). An empty list removes the date override.
create function public.set_date_windows(p_date date, p_note text, p_windows jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can change pickup windows.', 'forbidden');
  end if;
  if p_date is null or p_date < (now() at time zone private.business_timezone())::date then
    perform private.fail('Choose today or a later date.');
  end if;
  perform private.validate_windows(p_windows);
  if jsonb_array_length(p_windows) > 0 and (note is null or length(note) > 120) then
    perform private.fail('Give a short note for this date, e.g. Diwali.');
  end if;

  delete from public.capacity_overrides where on_date = p_date and kind = 'window';
  insert into public.capacity_overrides (on_date, kind, starts_at, ends_at, max_orders, note)
  select p_date, 'window', (w ->> 'starts_at')::time, (w ->> 'ends_at')::time, (w ->> 'max_orders')::integer, note
  from jsonb_array_elements(p_windows) w;
end;
$$;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------

alter table public.pickup_windows enable row level security;
alter table public.category_daily_caps enable row level security;
alter table public.capacity_overrides enable row level security;

create policy "Staff read pickup windows" on public.pickup_windows for select to authenticated
  using ((select private.is_staff()));
create policy "Staff read category caps" on public.category_daily_caps for select to authenticated
  using ((select private.is_staff()));
create policy "Admins add category caps" on public.category_daily_caps for insert to authenticated
  with check ((select private.is_admin()));
create policy "Admins update category caps" on public.category_daily_caps for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "Admins remove category caps" on public.category_daily_caps for delete to authenticated
  using ((select private.is_admin()));
create policy "Staff read capacity overrides" on public.capacity_overrides for select to authenticated
  using ((select private.is_staff()));
create policy "Admins add capacity overrides" on public.capacity_overrides for insert to authenticated
  with check ((select private.is_admin()));
create policy "Admins remove capacity overrides" on public.capacity_overrides for delete to authenticated
  using ((select private.is_admin()));

revoke all on public.pickup_windows, public.category_daily_caps, public.capacity_overrides from anon, authenticated;
grant select on public.pickup_windows to authenticated; -- written only through set_pickup_windows
grant select, insert, update, delete on public.category_daily_caps to authenticated;
grant select, insert, delete on public.capacity_overrides to authenticated;

revoke execute on function
  private.check_pickup_window_overlap(),
  private.check_override_window_overlap(),
  private.validate_windows(jsonb)
  from public;

revoke execute on function
  public.set_pickup_windows(smallint[], jsonb),
  public.set_date_windows(date, text, jsonb)
  from public, anon;
grant execute on function
  public.set_pickup_windows(smallint[], jsonb),
  public.set_date_windows(date, text, jsonb)
  to authenticated;
