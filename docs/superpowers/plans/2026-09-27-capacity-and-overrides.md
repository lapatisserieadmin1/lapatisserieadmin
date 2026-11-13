# Capacity Caps and Override Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce per-weekday pickup windows with order limits and per-category daily order caps (with festival date overrides), and replace the three hand-written admin override blocks with one shared prompt.

**Architecture:** Capacity rules live in Postgres next to the existing opening-hours and lead-time checks: a new `private.capacity_problem` is called by `create_order`, `confirm_locked`, and `reschedule_order`, raising `slot` or `capacity` errors that admins can override with a reason. Settings are edited through two admin-only RPCs plus RLS-guarded table writes. The Next.js app gets a shared `<OverridePrompt>`, a `<PickupWindows>` availability panel, and a Settings → Capacity section.

**Tech Stack:** Supabase Postgres (plpgsql, RLS), Next.js 16 App Router (server actions, React 19 client components), Tailwind v4, zod.

**Spec:** `docs/superpowers/specs/2026-09-27-capacity-and-overrides-design.md`

## Global Constraints

- Supabase project ref: `hljkydruionasnouyrpu` (live project; there is no staging). Apply migrations with the Supabase MCP `apply_migration` tool; run SQL with `execute_sql`.
- **Never issue bills or run `counter_sale` success paths against the live project.** SQL tests must run inside `begin … rollback`.
- Money in integer paise; all date/time logic in the business timezone (`private.business_timezone()` in SQL, `web/src/lib/time.ts` in TS).
- Every new table: RLS enabled; `revoke all … from anon, authenticated`, then grant only what is needed; audit trigger `private.audit_row('<pk>')`.
- Every new `private` function: `revoke execute … from public` (Postgres grants execute to PUBLIC by default).
- New functions are `security definer` with `set search_path = ''` and fully qualified names, like existing ones.
- Staff-facing errors via `private.fail(message, kind)`; kinds used here: `slot`, `capacity`, `forbidden`, `validation`.
- Override reason: at least **5** characters after trimming, checked in the database and the UI.
- Counted orders: status not in (`draft`, `rejected`, `cancelled`) and `is_immediate = false`.
- Next.js 16: read `web/node_modules/next/dist/docs/` if an API is unfamiliar; `params`/`searchParams` are Promises.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01PTPBQkwFkmJ2tEChqUmHFB
  ```
- Work on branch `phase-4c-capacity`.

## Review Focus

1. **Boundary times:** a pickup exactly at 11:00 with windows 9–11 and 11–13 must count in 11–13; a pickup exactly at the last window's end (13:00) must be accepted. (Task 2 checks C4, C5.)
2. **Limits lowered below existing bookings:** existing orders stay untouched, confirm of a pending order in that window is refused as `capacity`, and the panel shows e.g. `3/2 booked · Full`. (Task 2 check D5; Task 5 renders `used >= max` as Full.)
3. **Walk-in immediate orders on a day whose windows are full/zero:** must still go through. (Task 2 check C9.)
4. **Empty or half-typed pickup date in the form:** the availability panel must render nothing rather than spin or throw. (Task 5 `PickupWindows` guards the day key.)
5. **Rescheduling within its own full window:** must not be refused because of the order itself. (Task 2 check D4.)

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260927000400_capacity.sql` (create) | Tables, `order_items.category_id`, overlap triggers, RLS/grants, `set_pickup_windows`, `set_date_windows` |
| `supabase/migrations/20260927000410_capacity_enforcement.sql` (create) | Capacity helper functions, `pickup_availability`, replaced `create_order`/`confirm_locked`/`confirm_order`/`reschedule_order` |
| `supabase/tests/capacity_logic.sql` (create) | SQL rule checks (rolled back) |
| `web/src/lib/database.types.ts` (regenerate) | DB types |
| `web/src/lib/orders.ts` (modify) | `capacity` overridable; `OVERRIDE_REASON_MIN` |
| `web/src/lib/capacity.ts` (create) | Availability types, `formatClock` |
| `web/src/components/override-prompt.tsx` (create) | Shared refusal + override UI |
| `web/src/components/pickup-windows.tsx` (create) | Day availability panel |
| `web/src/app/admin/orders/actions.ts` (modify) | `pickupAvailabilityAction` |
| `web/src/app/admin/orders/new/order-entry.tsx`, `new/page.tsx` (modify) | Use prompt + panel; category ids |
| `web/src/app/admin/orders/[id]/order-actions.tsx`, `[id]/page.tsx` (modify) | Use prompt + panel; timeline details |
| `web/src/app/admin/settings/capacity-actions.ts` (create) | Capacity server actions |
| `web/src/app/admin/settings/capacity-forms.tsx` (create) | Capacity editors |
| `web/src/app/admin/settings/page.tsx` (modify) | Capacity section |
| `PRD.md`, `TODO.md`, `HANDOVER.md`, `PROJECT_RULES.md`, spec (modify) | Docs |

Spec deviations (record in the spec in Task 7): the migration is split into `0400` (schema) and `0410` (enforcement); weekday/date window lists are saved through `set_pickup_windows` / `set_date_windows` RPCs so each save is atomic; non-admins see the database message (which already says "An admin can override with a reason") with no extra line.

---

### Task 1: Capacity schema and settings RPCs

**Files:**
- Create: `supabase/tests/capacity_logic.sql` (settings part only in this task)
- Create: `supabase/migrations/20260927000400_capacity.sql`

**Interfaces:**
- Produces tables `public.pickup_windows(id, weekday, starts_at, ends_at, max_orders, created_at)`, `public.category_daily_caps(category_id, max_orders, updated_at)`, `public.capacity_overrides(id, on_date, kind, category_id, starts_at, ends_at, max_orders, note, created_by, created_at)`, column `public.order_items.category_id uuid`.
- Produces `public.set_pickup_windows(p_weekdays smallint[], p_windows jsonb) returns void` and `public.set_date_windows(p_date date, p_note text, p_windows jsonb) returns void`. `p_windows` = `[{"starts_at":"09:00","ends_at":"11:00","max_orders":6|null}]`; an empty array clears.

- [ ] **Step 1: Write the failing settings test**

Create `supabase/tests/capacity_logic.sql`:

```sql
-- Capacity windows, category caps, and overrides (Phase 4C). Runs in a transaction and rolls back.
-- order_number_seq is not transactional: each run consumes order numbers
-- (reset with `alter sequence public.order_number_seq restart with 1001` only while no real orders exist).
-- Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

-- Local timestamp p_days after today at p_time, in the business timezone.
create function pg_temp.ts(p_days integer, p_time time) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Kolkata')::date + p_days) + p_time) at time zone 'Asia/Kolkata'
$$;
create function pg_temp.items(p_key text, p_qty integer) returns jsonb language sql stable as $$
  select jsonb_build_array(jsonb_build_object('variant_id', (select v from ctx where k = p_key), 'quantity', p_qty))
$$;

-- Clean, predictable configuration (all rolled back).
delete from public.capacity_overrides;
delete from public.category_daily_caps;
delete from public.pickup_windows;
delete from public.closures;
update public.business_hours set opens_at = '09:00', closes_at = '21:00', is_closed = false;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-0000000004a1','cap-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000004c1','cap-c@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-0000000004a1','Cap Admin','admin'),
 ('00000000-0000-0000-0000-0000000004c1','Cap Counter','counter');
insert into public.categories (name) values ('T Cap Cakes'), ('T Cap Puffs');
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Cap Cake', 'ready_stock', 500 from public.categories where name = 'T Cap Cakes';
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Cap Puff', 'ready_stock', 1800 from public.categories where name = 'T Cap Puffs';
insert into public.product_variants (product_id, name, price_paise)
  select id, 'Each', 50000 from public.products where name = 'T Cap Cake';
insert into public.product_variants (product_id, name, price_paise)
  select id, 'Each', 3000 from public.products where name = 'T Cap Puff';
insert into ctx select 'cake', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Cap Cake';
insert into ctx select 'puff', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Cap Puff';
insert into ctx select 'cakes_cat', id::text from public.categories where name = 'T Cap Cakes';
insert into ctx select 'puffs_cat', id::text from public.categories where name = 'T Cap Puffs';
-- Day 200 ahead has no real orders. Its weekday differs from today's (200 mod 7 = 4) and from day 201's.
insert into ctx values ('day', ((now() at time zone 'Asia/Kolkata')::date + 200)::text);
insert into ctx values ('dow', extract(dow from (now() at time zone 'Asia/Kolkata')::date + 200)::text);
insert into ctx values ('today_dow', extract(dow from (now() at time zone 'Asia/Kolkata')::date)::text);

set local role authenticated;

-- ===== Admin: settings =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000004a1","role":"authenticated"}', true);
do $$
declare dow smallint := (select v::smallint from ctx where k = 'dow');
begin
  perform public.set_pickup_windows(array[dow],
    '[{"starts_at":"09:00","ends_at":"11:00","max_orders":2},{"starts_at":"11:00","ends_at":"13:00","max_orders":null}]');
  -- expect: 2
  insert into r(check_name,outcome) values ('A1 admin sets weekday windows', (select count(*) from public.pickup_windows where weekday = dow)::text);

  begin perform public.set_pickup_windows(array[dow], '[{"starts_at":"09:00","ends_at":"11:00"},{"starts_at":"10:00","ends_at":"12:00"}]');
    insert into r(check_name,outcome) values ('A2 overlapping windows refused', 'ALLOWED');
  -- expect: Pickup windows on the same day cannot overlap (…)
  exception when others then insert into r(check_name,outcome) values ('A2 overlapping windows refused', sqlerrm); end;

  begin perform public.set_pickup_windows(array[dow], '[{"starts_at":"12:00","ends_at":"11:00"}]');
    insert into r(check_name,outcome) values ('A3 window ending before start refused', 'ALLOWED');
  -- expect: Each window must end after it starts.
  exception when others then insert into r(check_name,outcome) values ('A3 window ending before start refused', sqlerrm); end;

  -- expect: 2 (failed saves left the earlier list intact)
  insert into r(check_name,outcome) values ('A4 failed saves keep previous windows', (select count(*) from public.pickup_windows where weekday = dow)::text);

  -- Today's weekday: one all-day window with no places, to prove walk-ins skip capacity (C9).
  perform public.set_pickup_windows(array[(select v::smallint from ctx where k = 'today_dow')],
    '[{"starts_at":"00:00","ends_at":"23:59","max_orders":0}]');
  insert into public.category_daily_caps (category_id, max_orders) values ((select v::uuid from ctx where k = 'cakes_cat'), 1);

  begin perform public.set_date_windows((now() at time zone 'Asia/Kolkata')::date - 1, 'Past', '[{"starts_at":"09:00","ends_at":"10:00"}]');
    insert into r(check_name,outcome) values ('A5 date override in the past refused', 'ALLOWED');
  -- expect: Choose today or a later date.
  exception when others then insert into r(check_name,outcome) values ('A5 date override in the past refused', sqlerrm); end;
end $$;

-- ===== Counter: settings are admin-only =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000004c1","role":"authenticated"}', true);
do $$ begin
  begin perform public.set_pickup_windows(array[1::smallint], '[]');
    insert into r(check_name,outcome) values ('E1 counter cannot change windows', 'ALLOWED');
  -- expect: Only an admin can change pickup windows.
  exception when others then insert into r(check_name,outcome) values ('E1 counter cannot change windows', sqlerrm); end;

  begin insert into public.category_daily_caps (category_id, max_orders) values ((select v::uuid from ctx where k = 'puffs_cat'), 3);
    insert into r(check_name,outcome) values ('E2 counter cannot set caps', 'ALLOWED');
  -- expect: new row violates row-level security policy …
  exception when others then insert into r(check_name,outcome) values ('E2 counter cannot set caps', sqlerrm); end;
end $$;

-- ORDER CHECKS (added in Task 2) GO HERE

reset role;
select check_name, outcome from r order by n;
rollback;
```

- [ ] **Step 2: Run the test to verify it fails**

Run the whole file with the Supabase MCP `execute_sql` tool (project `hljkydruionasnouyrpu`).
Expected: error `relation "public.capacity_overrides" does not exist` (whole script aborts; rollback is implicit).

- [ ] **Step 3: Write the schema migration**

Create `supabase/migrations/20260927000400_capacity.sql`:

```sql
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
```

- [ ] **Step 4: Apply the migration**

Supabase MCP `apply_migration` with `project_id: hljkydruionasnouyrpu`, `name: capacity`, `query:` the file contents.
Expected: success.

- [ ] **Step 5: Run the test to verify it passes**

Run `supabase/tests/capacity_logic.sql` with `execute_sql`.
Expected rows:
- `A1` → `2`
- `A2` → `Pickup windows on the same day cannot overlap (9:00 AM–11:00 AM and 10:00 AM–12:00 PM).` (the two ranges may appear in either order)
- `A3` → `Each window must end after it starts.`
- `A4` → `2`
- `A5` → `Choose today or a later date.`
- `E1` → `Only an admin can change pickup windows.`
- `E2` → starts with `new row violates row-level security policy`

If `to_char(time, 'FMHH12:MI AM')` prints differently, match the format already produced by `private.pickup_slot_problem` (same call) and update the expected comments.

- [ ] **Step 6: Run the advisors**

Supabase MCP `get_advisors` for `security` and `performance`. Expected: no new findings on the three tables apart from the known, intentional `SECURITY DEFINER` notices (see HANDOVER §4). Fix any missing-index or RLS finding before continuing.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260927000400_capacity.sql supabase/tests/capacity_logic.sql
git commit -m "Capacity: pickup windows, category caps, date overrides schema"
```

---

### Task 2: Capacity enforcement in the order functions

**Files:**
- Modify: `supabase/tests/capacity_logic.sql` (replace the `-- ORDER CHECKS (added in Task 2) GO HERE` line)
- Create: `supabase/migrations/20260927000410_capacity_enforcement.sql`

**Interfaces:**
- Consumes: Task 1 tables and RPCs.
- Produces `private.capacity_problem(p_order_id uuid, p_due timestamptz, out message text, out kind text)`; `public.pickup_availability(p_date date) returns jsonb` shaped `{ "windows": [{ "starts_at": "09:00", "ends_at": "11:00", "used": 2, "max": 2|null }], "categories": [{ "category_id": uuid, "name": text, "used": 1, "max": 1 }] }`.
- `create_order`, `confirm_order`, `reschedule_order` keep their signatures. New error kind `capacity`; `slot` also covers "outside every window". Override timeline data keys: `slot`, `lead_time`, `capacity` (strings or absent); `rescheduled` events keep `override` = the override reason.

- [ ] **Step 1: Confirm the live functions match the migration files**

Run with `execute_sql`:

```sql
select p.proname, md5(pg_get_functiondef(p.oid))
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where (n.nspname, p.proname) in (('public','create_order'),('public','confirm_order'),('public','reschedule_order'),('private','confirm_locked'));
```

Then check the live bodies: `select pg_get_functiondef('public.create_order(uuid, public.order_source, jsonb, text, text, timestamptz, text, text, boolean, text)'::regprocedure);` (and the same for the other three). Each must match the corresponding function in `supabase/migrations/20260927000200_orders.sql`. If any differs, stop and report — the replacement below is based on those file versions.

- [ ] **Step 2: Add the failing order checks**

In `supabase/tests/capacity_logic.sql`, replace the line `-- ORDER CHECKS (added in Task 2) GO HERE` with:

```sql
-- ===== Counter: orders against windows and caps =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000004c1","role":"authenticated"}', true);
do $$
declare o public.orders; o2 public.orders; h text;
begin
  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '09:30'));
  o2 := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '10:00'));
  insert into ctx values ('o1', o.id::text), ('o2', o2.id::text);
  -- expect: pending_confirmation pending_confirmation
  insert into r(check_name,outcome) values ('C1 two orders fill window 9-11', o.status || ' ' || o2.status);

  begin perform public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '10:30'));
    insert into r(check_name,outcome) values ('C2 full window refused', 'ALLOWED');
  -- expect: capacity: Pickup window 9:00 AM–11:00 AM is full (2/2). An admin can override with a reason.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C2 full window refused', h || ': ' || sqlerrm); end;

  begin perform public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '10:30'),
        p_override_reason => 'Counter wants it');
    insert into r(check_name,outcome) values ('C3 counter cannot override', 'ALLOWED');
  -- expect: forbidden: Only an admin can override scheduling rules.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C3 counter cannot override', h || ': ' || sqlerrm); end;

  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '11:00'));
  -- expect: pending_confirmation (11:00 belongs to the unlimited 11-13 window)
  insert into r(check_name,outcome) values ('C4 boundary time goes to the later window', o.status::text);

  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '13:00'));
  -- expect: pending_confirmation
  insert into r(check_name,outcome) values ('C5 end of last window accepted', o.status::text);

  begin perform public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '14:00'));
    insert into r(check_name,outcome) values ('C6 time outside every window refused', 'ALLOWED');
  -- expect: slot: 2:00 PM is outside the pickup windows for <Weekday DD Mon>. An admin can override with a reason.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C6 time outside every window refused', h || ': ' || sqlerrm); end;

  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('cake', 3),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '11:30'));
  -- expect: pending_confirmation cat=true (3 cakes use one of one place; category snapshot stored)
  insert into r(check_name,outcome) values ('C7 cap counts orders, not units',
    o.status || ' cat=' || ((select category_id from public.order_items where order_id = o.id) = (select v::uuid from ctx where k = 'cakes_cat'))::text);

  begin perform public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('cake', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '12:00'));
    insert into r(check_name,outcome) values ('C8 capped category refused', 'ALLOWED');
  -- expect: capacity: T Cap Cakes: 1/1 orders on <DD Mon>. An admin can override with a reason.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C8 capped category refused', h || ': ' || sqlerrm); end;

  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 2), p_confirm => true);
  -- expect: confirmed (today's weekday has one window with 0 places)
  insert into r(check_name,outcome) values ('C9 walk-in immediate order skips capacity', o.status::text);

  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(201, '14:00'));
  -- expect: pending_confirmation
  insert into r(check_name,outcome) values ('C10 weekday without windows is unrestricted', o.status::text);
end $$;

-- ===== Admin: overrides, reschedule, confirm, festival days, availability =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000004a1","role":"authenticated"}', true);
do $$
declare o public.orders; h text; o1 uuid := (select v::uuid from ctx where k = 'o1'); day date := (select v::date from ctx where k = 'day');
begin
  o := public.reject_order((select v::uuid from ctx where k = 'o2'), 1, 'Test rejection');
  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '10:45'));
  insert into ctx values ('o3', o.id::text);
  -- expect: pending_confirmation (the rejected order no longer counts)
  insert into r(check_name,outcome) values ('D1 rejected orders free their place', o.status::text);

  o := public.reschedule_order(o1, (select version from public.orders where id = o1), pg_temp.ts(200, '10:30'), 'Customer asked');
  -- expect: true (window is 2/2 but the order itself is not counted)
  insert into r(check_name,outcome) values ('D4 reschedule within its own full window', (o.due_at = pg_temp.ts(200, '10:30'))::text);

  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '10:15'),
        p_override_reason => 'Owner approved extra festival order');
  -- expect: Pickup window 9:00 AM–11:00 AM is full (2/2).
  insert into r(check_name,outcome) values ('D2 admin override records capacity detail',
    (select data ->> 'capacity' from public.order_events where order_id = o.id and event_type = 'override'));

  begin perform public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '10:20'),
        p_override_reason => 'ok');
    insert into r(check_name,outcome) values ('D3 short override reason refused', 'ALLOWED');
  -- expect: validation: Give an override reason of at least 5 characters.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('D3 short override reason refused', h || ': ' || sqlerrm); end;

  begin perform public.confirm_order((select v::uuid from ctx where k = 'o3'), 1);
    insert into r(check_name,outcome) values ('D5 confirm re-checks an over-full window', 'ALLOWED');
  -- expect: capacity: Pickup window 9:00 AM–11:00 AM is full (2/2). An admin can override with a reason.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('D5 confirm re-checks an over-full window', h || ': ' || sqlerrm); end;

  perform public.set_date_windows(day, 'Diwali', '[{"starts_at":"15:00","ends_at":"17:00","max_orders":5}]');
  o := public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '16:00'));
  -- expect: pending_confirmation
  insert into r(check_name,outcome) values ('D6a festival windows replace the weekday list', o.status::text);
  begin perform public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '10:05'));
    insert into r(check_name,outcome) values ('D6b weekday window unavailable on festival day', 'ALLOWED');
  -- expect: slot: 10:05 AM is outside the pickup windows for <Weekday DD Mon>. …
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('D6b weekday window unavailable on festival day', h || ': ' || sqlerrm); end;

  insert into public.capacity_overrides (on_date, kind, category_id, max_orders, note)
    values (day, 'category', (select v::uuid from ctx where k = 'puffs_cat'), 0, 'No puffs on Diwali');
  begin perform public.create_order(gen_random_uuid(), 'IN_STORE', pg_temp.items('puff', 1),
        p_customer_name => 'Cap Test', p_customer_phone => '9000000401', p_due_at => pg_temp.ts(200, '16:30'));
    insert into r(check_name,outcome) values ('D7 category date override of 0 blocks the category', 'ALLOWED');
  -- expect: capacity: T Cap Puffs: <n>/0 orders on <DD Mon>. …
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('D7 category date override of 0 blocks the category', h || ': ' || sqlerrm); end;

  -- expect: {"windows": [{"max": 5, "used": 1, "ends_at": "17:00", "starts_at": "15:00"}], "categories": [cakes used 1 max 1, puffs max 0 …]}
  insert into r(check_name,outcome) values ('D8 availability for the festival day', public.pickup_availability(day)::text);

  -- expect: true
  insert into r(check_name,outcome) values ('D9 capacity check holds the per-day advisory lock',
    exists (select 1 from pg_locks where locktype = 'advisory' and pid = pg_backend_pid() and objsubid = 2
            and objid = (day - date '2000-01-01')::oid)::text);
end $$;
```

- [ ] **Step 3: Run the test to verify it fails**

Run the file with `execute_sql`.
Expected: `C2` → `ALLOWED` (no capacity enforcement yet) and `C6` → `ALLOWED`, among others. If the script aborts instead (for example `pickup_availability` does not exist), that also counts as failing.

- [ ] **Step 4: Write the enforcement migration**

Create `supabase/migrations/20260927000410_capacity_enforcement.sql`:

```sql
-- Phase 4C: enforce pickup windows and category caps in create/confirm/reschedule (AC-32),
-- and require override reasons of at least 5 characters (AC-36).
-- create_order, confirm_locked, confirm_order and reschedule_order are copied from
-- 20260927000200_orders.sql with the capacity changes marked "4C".

-- Orders that use capacity on a business-local day (excluding one order, usually the one being checked).
create function private.counted_orders(p_day date, p_exclude uuid)
returns setof public.orders
language sql
stable
security definer
set search_path = ''
as $$
  select o.* from public.orders o
  where o.status not in ('draft', 'rejected', 'cancelled')
    and not o.is_immediate
    and o.id is distinct from p_exclude
    and o.due_at >= (p_day::timestamp at time zone private.business_timezone())
    and o.due_at < ((p_day + 1)::timestamp at time zone private.business_timezone())
$$;

-- The window list for a day: that date's festival override if any, otherwise the weekday list.
create function private.windows_for_date(p_day date)
returns table (starts_at time, ends_at time, max_orders integer)
language sql
stable
security definer
set search_path = ''
as $$
  select w.starts_at, w.ends_at, w.max_orders from public.capacity_overrides w
  where w.on_date = p_day and w.kind = 'window'
  union all
  select w.starts_at, w.ends_at, w.max_orders from public.pickup_windows w
  where w.weekday = extract(dow from p_day)
    and not exists (select 1 from public.capacity_overrides c where c.on_date = p_day and c.kind = 'window')
$$;

-- The window a local pickup time belongs to. A time on the boundary of two windows belongs to the later one;
-- the end time of a window with no window after it still belongs to that window.
create function private.window_for(p_local timestamp)
returns table (starts_at time, ends_at time, max_orders integer)
language sql
stable
security definer
set search_path = ''
as $$
  select w.starts_at, w.ends_at, w.max_orders
  from private.windows_for_date(p_local::date) w
  where w.starts_at <= p_local::time and p_local::time <= w.ends_at
  order by w.starts_at desc
  limit 1
$$;

create function private.category_cap(p_day date, p_category uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select max_orders from public.capacity_overrides where on_date = p_day and kind = 'category' and category_id = p_category),
    (select max_orders from public.category_daily_caps where category_id = p_category)
  )
$$;

-- Null message when the order fits; otherwise the first problem and its kind ('slot' or 'capacity').
-- Volatile on purpose: after taking the lock, each statement must see orders committed meanwhile.
create function private.capacity_problem(p_order_id uuid, p_due timestamptz, out message text, out kind text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  tz text := private.business_timezone();
  local_ts timestamp := p_due at time zone tz;
  day date := (p_due at time zone tz)::date;
  win record;
  cat record;
  used integer;
begin
  -- Serialise capacity checks per business day so two bookings cannot both take the last place.
  perform pg_advisory_xact_lock(hashtext('capacity'), day - date '2000-01-01');

  if exists (select 1 from private.windows_for_date(day)) then
    select * into win from private.window_for(local_ts);
    if not found then
      message := format('%s is outside the pickup windows for %s.', to_char(local_ts, 'FMHH12:MI AM'), to_char(local_ts, 'FMDay DD Mon'));
      kind := 'slot';
      return;
    end if;
    if win.max_orders is not null then
      select count(*) into used
      from private.counted_orders(day, p_order_id) o
      where (select x.starts_at from private.window_for(o.due_at at time zone tz) x) = win.starts_at;
      if used >= win.max_orders then
        message := format('Pickup window %s–%s is full (%s/%s).',
          to_char(win.starts_at, 'FMHH12:MI AM'), to_char(win.ends_at, 'FMHH12:MI AM'), used, win.max_orders);
        kind := 'capacity';
        return;
      end if;
    end if;
  end if;

  for cat in
    select c.id, c.name, private.category_cap(day, c.id) as cap
    from public.categories c
    where c.id in (select oi.category_id from public.order_items oi
                   where oi.order_id = p_order_id and oi.quantity > oi.cancelled_quantity)
    order by c.name
  loop
    continue when cat.cap is null;
    select count(*) into used
    from private.counted_orders(day, p_order_id) o
    where exists (select 1 from public.order_items oi
                  where oi.order_id = o.id and oi.category_id = cat.id and oi.quantity > oi.cancelled_quantity);
    if used >= cat.cap then
      message := format('%s: %s/%s orders on %s.', cat.name, used, cat.cap, to_char(day, 'FMDD Mon'));
      kind := 'capacity';
      return;
    end if;
  end loop;
end;
$$;

-- Window and category usage for one business-local day, for the staff order screens (and the website later).
create function public.pickup_availability(p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  tz text := private.business_timezone();
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('You do not have permission to see pickup availability.', 'forbidden');
  end if;
  return jsonb_build_object(
    'windows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'starts_at', to_char(w.starts_at, 'HH24:MI'),
        'ends_at', to_char(w.ends_at, 'HH24:MI'),
        'max', w.max_orders,
        'used', (select count(*) from private.counted_orders(p_date, null) o
                 where (select x.starts_at from private.window_for(o.due_at at time zone tz) x) = w.starts_at)
      ) order by w.starts_at)
      from private.windows_for_date(p_date) w), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', c.id,
        'name', c.name,
        'max', c.cap,
        'used', (select count(*) from private.counted_orders(p_date, null) o
                 where exists (select 1 from public.order_items oi
                               where oi.order_id = o.id and oi.category_id = c.id and oi.quantity > oi.cancelled_quantity))
      ) order by c.name)
      from (select cc.id, cc.name, private.category_cap(p_date, cc.id) as cap from public.categories cc) c
      where c.cap is not null), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Replaced order functions
-- ---------------------------------------------------------------------------

create or replace function private.confirm_locked(o public.orders, p_override_reason text)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  role public.staff_role := private.current_staff_role();
  unmapped text;
  problem text;
  cap_msg text; -- 4C
  cap_kind text; -- 4C
  result public.orders;
begin
  if role = 'counter' and o.source <> 'IN_STORE' then
    perform private.fail('Only an admin can confirm call and online orders.', 'forbidden');
  end if;
  if role is null or role not in ('admin', 'counter') then
    perform private.fail('You do not have permission to confirm orders.', 'forbidden');
  end if;
  if o.status not in ('draft', 'pending_confirmation') then
    perform private.fail(format('Only draft or pending orders can be confirmed; this one is %s.', replace(o.status::text, '_', ' ')));
  end if;

  -- Pick up kitchen mappings fixed since the order was taken, then block if any are still missing (AC-06).
  update public.order_items oi
  set kitchen_id = v.kitchen_id
  from public.product_variants v
  where oi.order_id = o.id and oi.variant_id = v.id
    and oi.prep_type = 'made_to_order' and oi.kitchen_id is null and v.kitchen_id is not null;

  select string_agg(product_name || ' — ' || variant_name, ', ') into unmapped
  from public.order_items
  where order_id = o.id and prep_type = 'made_to_order' and kitchen_id is null and quantity > cancelled_quantity;
  if unmapped is not null then
    perform private.fail(format('Assign a preparing kitchen before confirming: %s.', unmapped), 'unmapped');
  end if;

  problem := private.lead_time_problem(o.id, o.requested_due_at);
  if problem is not null and p_override_reason is null then
    perform private.fail(problem || ' An admin can override with a reason.', 'lead_time');
  end if;

  -- 4C: windows and category caps (walk-in immediate orders do not reserve capacity).
  if not o.is_immediate then
    select c.message, c.kind into cap_msg, cap_kind from private.capacity_problem(o.id, o.requested_due_at) c;
    if cap_msg is not null and p_override_reason is null then
      perform private.fail(cap_msg || ' An admin can override with a reason.', cap_kind);
    end if;
  end if;

  update public.orders
  set status = 'confirmed',
      confirmed_due_at = requested_due_at,
      confirmed_by = auth.uid(),
      confirmed_at = now(),
      version = version + 1
  where id = o.id
  returning * into result;

  perform private.log_order_event(o.id, 'confirmed', p_override_reason,
    jsonb_strip_nulls(jsonb_build_object('lead_time', problem, 'capacity', cap_msg))); -- 4C
  return result;
end;
$$;

create or replace function public.create_order(
  p_idempotency_key uuid,
  p_source public.order_source,
  p_items jsonb,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_due_at timestamptz default null,
  p_customer_notes text default null,
  p_internal_notes text default null,
  p_confirm boolean default false,
  p_override_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  role public.staff_role := private.current_staff_role();
  o public.orders;
  item jsonb;
  line integer := 0;
  v record;
  qty integer;
  variant uuid;
  customer uuid;
  blocked boolean;
  subtotal bigint := 0;
  tax bigint := 0;
  line_total bigint;
  line_tax bigint;
  problem text;
  cap_msg text; -- 4C
  cap_kind text; -- 4C
  immediate boolean := p_due_at is null;
  due timestamptz := coalesce(p_due_at, now());
  v_name text := nullif(trim(coalesce(p_customer_name, '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_customer_phone, ''), '[\s()-]', '', 'g'), '');
  override text := nullif(trim(coalesce(p_override_reason, '')), '');
begin
  if role is null or role not in ('admin', 'counter') then
    perform private.fail('You do not have permission to create orders.', 'forbidden');
  end if;

  -- Retried submissions return the original order (AC-07).
  select * into o from public.orders where idempotency_key = p_idempotency_key;
  if found then
    return o;
  end if;

  if p_source = 'ONLINE' then
    perform private.fail('Online orders are placed through the website.');
  end if;
  if override is not null and role <> 'admin' then
    perform private.fail('Only an admin can override scheduling rules.', 'forbidden');
  end if;
  if override is not null and length(override) < 5 then -- 4C
    perform private.fail('Give an override reason of at least 5 characters.');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    perform private.fail('Add at least one item.');
  end if;
  if jsonb_array_length(p_items) > 50 then
    perform private.fail('An order can have at most 50 lines.');
  end if;
  if v_phone is not null and v_phone !~ '^\+?[0-9]{10,15}$' then
    perform private.fail('Enter a valid phone number (10 to 15 digits).');
  end if;
  if v_name is not null and length(v_name) > 80 then
    perform private.fail('Customer name is too long.');
  end if;
  if p_source = 'CALL' and (v_name is null or v_phone is null) then
    perform private.fail('Call orders need the customer''s name and phone number.');
  end if;
  if immediate and p_source <> 'IN_STORE' then
    perform private.fail('Call orders need a pickup date and time.');
  end if;
  if not immediate and (v_name is null or v_phone is null) then
    perform private.fail('Future pickups need the customer''s name and phone number.');
  end if;

  if not immediate then
    if due < now() - interval '5 minutes' then
      perform private.fail('The pickup time is in the past.');
    end if;
    problem := private.pickup_slot_problem(due);
    if problem is not null and override is null then
      perform private.fail(problem || ' An admin can override with a reason.', 'slot');
    end if;
  end if;

  if v_phone is not null then
    insert into public.customers (full_name, phone)
    values (coalesce(v_name, 'Customer'), v_phone)
    on conflict (phone) where phone is not null
      do update set full_name = coalesce(excluded.full_name, public.customers.full_name)
    returning id, is_blocked into customer, blocked;
    if blocked and override is null then
      perform private.fail('This phone number is blocked. An admin can override with a reason.', 'blocked');
    end if;
  end if;

  insert into public.orders (
    idempotency_key, source, status, customer_id, customer_name, customer_phone,
    is_immediate, requested_due_at, customer_notes, internal_notes, created_by
  ) values (
    p_idempotency_key, p_source, 'pending_confirmation', customer, v_name, v_phone,
    immediate, due, nullif(trim(p_customer_notes), ''), nullif(trim(p_internal_notes), ''), auth.uid()
  )
  returning * into o;

  for item in select value from jsonb_array_elements(p_items)
  loop
    line := line + 1;
    begin
      qty := (item ->> 'quantity')::integer;
      variant := (item ->> 'variant_id')::uuid;
    exception when others then
      perform private.fail(format('Line %s is not valid.', line));
    end;
    if qty is null or qty < 1 or qty > 999 then
      perform private.fail(format('Line %s: quantity must be between 1 and 999.', line));
    end if;

    select p.id as product_id, p.name as product_name, p.category_id, p.prep_type, p.is_veg, p.contains_egg, p.allergens,
           p.tax_rate_bps, p.hsn_code, p.is_available as product_available, p.archived_at as product_archived,
           pv.id as variant_id, pv.name as variant_name, pv.price_paise, pv.kitchen_id, pv.lead_time_minutes,
           pv.is_eggless, pv.is_available as variant_available, pv.archived_at as variant_archived
    into v
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    where pv.id = variant;

    if not found then
      perform private.fail(format('Line %s: this item is no longer in the catalogue.', line));
    end if;
    if v.product_archived is not null or v.variant_archived is not null
       or not v.product_available or not v.variant_available then
      perform private.fail(format('%s — %s is not available.', v.product_name, v.variant_name), 'unavailable');
    end if;
    if length(coalesce(item ->> 'notes', '')) > 500 then
      perform private.fail(format('Line %s: notes are too long.', line));
    end if;

    line_total := v.price_paise * qty;
    line_tax := round(line_total * v.tax_rate_bps::numeric / (10000 + v.tax_rate_bps));

    insert into public.order_items (
      order_id, line_no, product_id, variant_id, category_id, product_name, variant_name, prep_type, kitchen_id,
      is_veg, contains_egg, is_eggless, allergens, lead_time_minutes, unit_price_paise, tax_rate_bps,
      hsn_code, quantity, line_total_paise, tax_paise, notes
    ) values (
      o.id, line, v.product_id, v.variant_id, v.category_id, v.product_name, v.variant_name, v.prep_type,
      case when v.prep_type = 'made_to_order' then v.kitchen_id end,
      v.is_veg, v.contains_egg, v.is_eggless, v.allergens, v.lead_time_minutes, v.price_paise, v.tax_rate_bps,
      v.hsn_code, qty, line_total, line_tax, nullif(trim(item ->> 'notes'), '')
    );

    subtotal := subtotal + line_total;
    tax := tax + line_tax;
  end loop;

  problem := private.lead_time_problem(o.id, due);
  if problem is not null and override is null then
    perform private.fail(problem || ' An admin can override with a reason.', 'lead_time');
  end if;

  -- 4C: windows and category caps (walk-in immediate orders do not reserve capacity).
  if not immediate then
    select c.message, c.kind into cap_msg, cap_kind from private.capacity_problem(o.id, due) c;
    if cap_msg is not null and override is null then
      perform private.fail(cap_msg || ' An admin can override with a reason.', cap_kind);
    end if;
  end if;

  update public.orders
  set subtotal_paise = subtotal, total_paise = subtotal, tax_paise = tax
  where id = o.id
  returning * into o;

  perform private.log_order_event(o.id, 'created', null, jsonb_build_object('source', p_source, 'immediate', immediate));
  if override is not null then
    perform private.log_order_event(o.id, 'override', override,
      jsonb_strip_nulls(jsonb_build_object('slot', private.pickup_slot_problem(due), 'lead_time', problem, 'capacity', cap_msg))); -- 4C
  end if;

  if p_confirm then
    o := private.confirm_locked(o, override);
  end if;
  return o;
end;
$$;

create or replace function public.confirm_order(p_order_id uuid, p_expected_version integer, p_override_reason text default null)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  override text := nullif(trim(coalesce(p_override_reason, '')), '');
begin
  if override is not null and not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can override scheduling rules.', 'forbidden');
  end if;
  if override is not null and length(override) < 5 then -- 4C
    perform private.fail('Give an override reason of at least 5 characters.');
  end if;
  return private.confirm_locked(private.lock_order(p_order_id, p_expected_version), override);
end;
$$;

create or replace function public.reschedule_order(
  p_order_id uuid,
  p_expected_version integer,
  p_due_at timestamptz,
  p_reason text,
  p_override_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  old_due timestamptz;
  reason text := nullif(trim(coalesce(p_reason, '')), '');
  override text := nullif(trim(coalesce(p_override_reason, '')), '');
  slot text;
  lead text;
  cap_msg text; -- 4C
  cap_kind text; -- 4C
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can reschedule orders.', 'forbidden');
  end if;
  if reason is null then
    perform private.fail('Give a reason for the new pickup time.');
  end if;
  if override is not null and length(override) < 5 then -- 4C
    perform private.fail('Give an override reason of at least 5 characters.');
  end if;
  if p_due_at is null or p_due_at < now() - interval '5 minutes' then
    perform private.fail('Choose a pickup time in the future.');
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if o.status not in ('draft', 'pending_confirmation', 'confirmed') then
    perform private.fail('Only orders that have not started preparation can be rescheduled here.');
  end if;

  slot := private.pickup_slot_problem(p_due_at);
  lead := private.lead_time_problem(o.id, p_due_at);
  select c.message, c.kind into cap_msg, cap_kind from private.capacity_problem(o.id, p_due_at) c; -- 4C
  if (slot is not null or lead is not null or cap_msg is not null) and override is null then
    perform private.fail(coalesce(slot, lead, cap_msg) || ' An admin can override with a reason.',
      coalesce(case when slot is not null then 'slot' end, case when lead is not null then 'lead_time' end, cap_kind));
  end if;

  old_due := o.due_at;
  update public.orders
  set requested_due_at = p_due_at,
      confirmed_due_at = case when status = 'confirmed' then p_due_at else confirmed_due_at end,
      is_immediate = false,
      version = version + 1
  where id = o.id
  returning * into o;

  perform private.log_order_event(o.id, 'rescheduled', reason,
    jsonb_build_object('from', old_due, 'to', p_due_at) ||
    case when override is not null
      then jsonb_strip_nulls(jsonb_build_object('override', override, 'slot', slot, 'lead_time', lead, 'capacity', cap_msg))
      else '{}' end);
  return o;
end;
$$;

-- ---------------------------------------------------------------------------
-- Security
-- ---------------------------------------------------------------------------

revoke execute on function
  private.counted_orders(date, uuid),
  private.windows_for_date(date),
  private.window_for(timestamp),
  private.category_cap(date, uuid),
  private.capacity_problem(uuid, timestamptz)
  from public;

revoke execute on function public.pickup_availability(date) from public, anon;
grant execute on function public.pickup_availability(date) to authenticated;
```

- [ ] **Step 5: Apply the migration**

Supabase MCP `apply_migration`, `name: capacity_enforcement`, `query:` the file contents. Expected: success.

- [ ] **Step 6: Run the capacity test to verify it passes**

Run `supabase/tests/capacity_logic.sql`. Expected outcomes are the `-- expect:` comments. Key rows:
- `C2` → `capacity: Pickup window 9:00 AM–11:00 AM is full (2/2). An admin can override with a reason.`
- `C6` → `slot: 2:00 PM is outside the pickup windows for …`
- `C7` → `pending_confirmation cat=true`
- `C8` → `capacity: T Cap Cakes: 1/1 orders on …`
- `C9` → `confirmed`
- `D2` → `Pickup window 9:00 AM–11:00 AM is full (2/2).`
- `D3` → `validation: Give an override reason of at least 5 characters.`
- `D4` → `true`
- `D5` → `capacity: Pickup window 9:00 AM–11:00 AM is full (2/2). …`
- `D8` → windows array has exactly one entry `15:00`–`17:00` with `used` 1, `max` 5; categories include `T Cap Cakes` (used 1, max 1) and `T Cap Puffs` (max 0)
- `D9` → `true`

- [ ] **Step 7: Re-run the existing SQL tests**

Run `supabase/tests/orders_logic.sql` and `supabase/tests/billing_logic.sql` with `execute_sql`. Expected: same outcomes as before (22/22 and all pass). They run with no capacity configuration, so every weekday is unrestricted. One expected wording change: none (the order functions' messages are unchanged).

- [ ] **Step 8: Advisors**

`get_advisors` security and performance. Expected: only the known intentional `SECURITY DEFINER` notices.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260927000410_capacity_enforcement.sql supabase/tests/capacity_logic.sql
git commit -m "Capacity: enforce windows and category caps in order functions"
```

---

### Task 3: Types and shared TypeScript helpers

**Files:**
- Regenerate: `web/src/lib/database.types.ts`
- Modify: `web/src/lib/orders.ts:61`
- Create: `web/src/lib/capacity.ts`
- Modify: `web/src/app/admin/orders/actions.ts` (append)

**Interfaces:**
- Produces `OVERRIDABLE_KINDS` including `"capacity"`, `OVERRIDE_REASON_MIN = 5` (from `@/lib/orders`).
- Produces from `@/lib/capacity`: `type WindowUsage = { starts_at: string; ends_at: string; used: number; max: number | null }`, `type CategoryUsage = { category_id: string; name: string; used: number; max: number }`, `type PickupAvailability = { windows: WindowUsage[]; categories: CategoryUsage[] }`, `type WindowInput = { starts_at: string; ends_at: string; max_orders: number | null }`, `formatClock(hhmm: string): string`.
- Produces `pickupAvailabilityAction(dayKey: string): Promise<PickupAvailability | null>` in `web/src/app/admin/orders/actions.ts`.

- [ ] **Step 1: Regenerate database types**

Supabase MCP `generate_typescript_types` for `hljkydruionasnouyrpu`. Write the output to `web/src/lib/database.types.ts`, keeping the first-line comment `// Generated from the Supabase schema. Regenerate after migrations; do not edit by hand.`

- [ ] **Step 2: Typecheck the regeneration alone**

Run: `cd web && npm run typecheck`
Expected: PASS. If errors appear because generated `Insert` types now allow order-table inserts or a helper type changed name, fix the call sites (do not re-add hand edits to the types file).

- [ ] **Step 3: Update `web/src/lib/orders.ts`**

Replace the last line `export const OVERRIDABLE_KINDS = new Set(["slot", "lead_time", "blocked"]);` with:

```ts
// Refusals an admin may override with a recorded reason (AC-32, AC-36).
export const OVERRIDABLE_KINDS = new Set(["slot", "lead_time", "blocked", "capacity"]);

// Matches the database check in create_order, confirm_order and reschedule_order.
export const OVERRIDE_REASON_MIN = 5;
```

- [ ] **Step 4: Create `web/src/lib/capacity.ts`**

```ts
// Shapes returned by public.pickup_availability (migration 0410).
export type WindowUsage = { starts_at: string; ends_at: string; used: number; max: number | null };
export type CategoryUsage = { category_id: string; name: string; used: number; max: number };
export type PickupAvailability = { windows: WindowUsage[]; categories: CategoryUsage[] };

// Window rows as sent to set_pickup_windows / set_date_windows.
export type WindowInput = { starts_at: string; ends_at: string; max_orders: number | null };

// "09:00" -> "9:00 AM", "13:30" -> "1:30 PM".
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}
```

- [ ] **Step 5: Add the availability action**

In `web/src/app/admin/orders/actions.ts`, add to the imports:

```ts
import type { PickupAvailability } from "@/lib/capacity";
```

and append after `rescheduleOrderAction`:

```ts
// Window and category usage for one business-local day ("YYYY-MM-DD"). Null when it cannot be loaded.
export async function pickupAvailabilityAction(dayKey: string): Promise<PickupAvailability | null> {
  await assertRole(["admin", "counter"]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pickup_availability", { p_date: dayKey });
  if (error) return null;
  return data as unknown as PickupAvailability;
}
```

- [ ] **Step 6: Verify**

Run: `cd web && npm run typecheck && npm run lint`
Expected: both pass. Then quick check of `formatClock` with node:

```bash
cd web && node -e "const f=(s)=>{const [h,m]=s.split(':').map(Number);return `${h%12===0?12:h%12}:${String(m).padStart(2,'0')} ${h<12?'AM':'PM'}`};console.log(['00:00','09:00','12:00','13:30','23:59'].map(f).join(' | '))"
```
Expected: `12:00 AM | 9:00 AM | 12:00 PM | 1:30 PM | 11:59 PM` (same logic as `formatClock`).

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/database.types.ts web/src/lib/orders.ts web/src/lib/capacity.ts web/src/app/admin/orders/actions.ts
git commit -m "Capacity: regenerate types, availability action, override constants"
```

---

### Task 4: Shared override prompt

**Files:**
- Create: `web/src/components/override-prompt.tsx`
- Modify: `web/src/app/admin/orders/new/order-entry.tsx`
- Modify: `web/src/app/admin/orders/[id]/order-actions.tsx`

**Interfaces:**
- Consumes: `OVERRIDABLE_KINDS`, `OVERRIDE_REASON_MIN` from `@/lib/orders`.
- Produces `OverridePrompt({ error, isAdmin, pending, title?, actionLabel?, onOverride })` where `error: { message: string; kind?: string }` and `onOverride: (reason: string) => void`.

There is no component test framework in the repo; verification is typecheck, lint, and the browser pass in Task 7.

- [ ] **Step 1: Create `web/src/components/override-prompt.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { OVERRIDABLE_KINDS, OVERRIDE_REASON_MIN } from "@/lib/orders";

export type ActionFailure = { message: string; kind?: string };

// Shows why an action was refused. For overridable refusals, admins can retry it with a
// reason that is recorded in the order timeline (AC-36). Others see the refusal only; the
// database message already says an admin can override.
export function OverridePrompt({
  error,
  isAdmin,
  pending,
  title,
  actionLabel = "Save with override",
  onOverride,
}: {
  error: ActionFailure;
  isAdmin: boolean;
  pending: boolean;
  title?: string;
  actionLabel?: string;
  onOverride: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const canOverride = isAdmin && Boolean(error.kind && OVERRIDABLE_KINDS.has(error.kind));

  return (
    <Alert tone="danger" title={title}>
      <p>{error.message}</p>
      {canOverride && (
        <div className="mt-3 flex flex-col gap-2 text-ink">
          <Field label="Override reason (recorded in the timeline)" htmlFor="override-reason" hint={`At least ${OVERRIDE_REASON_MIN} characters.`}>
            <Input
              id="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Owner approved an extra festival order"
              maxLength={300}
            />
          </Field>
          <Button
            type="button"
            variant="danger"
            disabled={pending || reason.trim().length < OVERRIDE_REASON_MIN}
            onClick={() => onOverride(reason.trim())}
          >
            {pending ? "Saving…" : actionLabel}
          </Button>
        </div>
      )}
    </Alert>
  );
}
```

- [ ] **Step 2: Use it in `order-entry.tsx`**

1. Replace the import `import { OVERRIDABLE_KINDS } from "@/lib/orders";` with `import { OverridePrompt } from "@/components/override-prompt";`.
2. Delete the state line `const [overrideReason, setOverrideReason] = useState("");`.
3. Change `function submit(withOverride: boolean) {` to `function submit(overrideReason?: string) {` and the field `overrideReason: withOverride ? overrideReason : undefined,` to `overrideReason,`.
4. Delete `const canOverride = isAdmin && error?.kind && OVERRIDABLE_KINDS.has(error.kind);`.
5. Replace the whole `{error && ( <Alert tone="danger" title="Order not saved"> … </Alert> )}` block with:

```tsx
        {error && (
          <OverridePrompt
            key={error.message}
            title="Order not saved"
            error={error}
            isAdmin={isAdmin}
            pending={pending}
            onOverride={(reason) => submit(reason)}
          />
        )}
```

6. Change the main button's `onClick={() => submit(false)}` to `onClick={() => submit()}`.

- [ ] **Step 3: Use it in `order-actions.tsx`**

1. Imports: replace `OVERRIDABLE_KINDS, ` in the `@/lib/orders` import (keep the other names) and add `import { OverridePrompt } from "@/components/override-prompt";`.
2. Replace `type Mode = null | "reject" | "cancel" | "reschedule" | "override";` with:

```tsx
type Mode = null | "reject" | "cancel" | "reschedule";
type Attempt = (overrideReason?: string) => Promise<{ ok?: boolean; message?: string; kind?: string }>;
```

3. In `OrderActions`, delete `const [override, setOverride] = useState("");` and replace `const [error, setError] = useState<Failure | null>(null);` with:

```tsx
  const [failed, setFailed] = useState<{ error: Failure; retry: Attempt } | null>(null);
```

4. Replace the whole `function run(...) { ... }` with:

```tsx
  // Runs an action; on refusal keeps it so an admin can retry it with an override reason.
  function run(attempt: Attempt, overrideReason?: string) {
    setFailed(null);
    start(async () => {
      const result = await attempt(overrideReason);
      if (result.ok) {
        setMode(null);
        setReason("");
        router.refresh();
      } else {
        setFailed({ error: { message: result.message ?? "Something went wrong.", kind: result.kind }, retry: attempt });
      }
    });
  }
```

5. Delete `const overrideWanted = isAdmin && error?.kind && OVERRIDABLE_KINDS.has(error.kind);`.
6. Confirm button: `onClick={() => run((o) => confirmOrderAction({ orderId, version, overrideReason: o }))}`.
7. In the Reschedule/Reject/Cancel toggle buttons, replace each `setError(null);` with `setFailed(null);`.
8. Delete the whole `{mode === "override" && ( … )}` block.
9. Reject/cancel button: `onClick={() => run(() => (mode === "reject" ? rejectOrderAction : cancelOrderAction)({ orderId, version, reason }))}` (unchanged apart from `run`'s new type).
10. In the reschedule panel, delete the `{overrideWanted && ( <Field …resched-override…> )}` block, and replace its buttons with:

```tsx
          <div className="flex gap-2">
            <Button disabled={pending || reason.trim().length < 3}
              onClick={() => run((o) => rescheduleOrderAction({ orderId, version, dueLocal: newDue, reason, overrideReason: o }))}>
              {pending ? "Saving…" : "Save new time"}
            </Button>
            <Button variant="secondary" onClick={() => { setMode(null); setFailed(null); }}>Close</Button>
          </div>
```

11. Replace the final `{error && mode !== "override" && <ErrorBox … />}` with:

```tsx
      {failed && (failed.error.kind === "conflict" ? (
        <ErrorBox error={failed.error} onReload={() => { setFailed(null); router.refresh(); }} />
      ) : (
        <OverridePrompt
          key={failed.error.message}
          error={failed.error}
          isAdmin={isAdmin}
          pending={pending}
          onOverride={(reason) => run(failed.retry, reason)}
        />
      ))}
```

- [ ] **Step 4: Verify**

Run: `cd web && npm run typecheck && npm run lint`
Expected: both pass; `grep -rn "overrideWanted\|canOverride\|mode === \"override\"" web/src` returns nothing.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/override-prompt.tsx web/src/app/admin/orders/new/order-entry.tsx "web/src/app/admin/orders/[id]/order-actions.tsx"
git commit -m "Orders: one shared admin override prompt (AC-36)"
```

---

### Task 5: Availability panel in new-order and reschedule, timeline details

**Files:**
- Create: `web/src/components/pickup-windows.tsx`
- Modify: `web/src/app/admin/orders/new/page.tsx`, `web/src/app/admin/orders/new/order-entry.tsx`
- Modify: `web/src/app/admin/orders/[id]/order-actions.tsx`, `web/src/app/admin/orders/[id]/page.tsx`

**Interfaces:**
- Consumes: `pickupAvailabilityAction`, `formatClock`, `PickupAvailability`.
- Produces `PickupWindows({ dayKey, time, categoryIds, onPick })`: `dayKey` "YYYY-MM-DD" (anything else renders nothing), `time` "HH:MM", `categoryIds: string[]`, `onPick(time: "HH:MM")`.
- `CatalogueProduct` gains `categoryId: string`; `OrderActions` gains prop `categoryIds: string[]`.

- [ ] **Step 1: Create `web/src/components/pickup-windows.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { formatClock, type PickupAvailability } from "@/lib/capacity";
import { pickupAvailabilityAction } from "@/app/admin/orders/actions";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Shows the day's pickup windows with bookings, and caps for the categories in this order.
// Full windows stay selectable: saving then asks an admin for an override reason.
export function PickupWindows({
  dayKey,
  time,
  categoryIds,
  onPick,
}: {
  dayKey: string;
  time: string;
  categoryIds: string[];
  onPick: (time: string) => void;
}) {
  const [loaded, setLoaded] = useState<{ dayKey: string; data: PickupAvailability | null } | null>(null);
  const validDay = DAY_KEY.test(dayKey);

  useEffect(() => {
    if (!validDay) return;
    let live = true;
    pickupAvailabilityAction(dayKey).then((data) => {
      if (live) setLoaded({ dayKey, data });
    });
    return () => {
      live = false;
    };
  }, [dayKey, validDay]);

  if (!validDay) return null;
  if (!loaded || loaded.dayKey !== dayKey) return <p className="text-sm text-muted">Checking availability…</p>;
  if (!loaded.data) return <p className="text-sm text-muted">Could not load availability for this day.</p>;

  const { windows, categories } = loaded.data;
  const capped = categories.filter((c) => categoryIds.includes(c.category_id));

  return (
    <div className="flex flex-col gap-2">
      {windows.length === 0 ? (
        <p className="text-sm text-muted">No pickup windows set for this day; any time within opening hours.</p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Pickup windows">
          {windows.map((w) => {
            const full = w.max !== null && w.used >= w.max;
            const selected = time >= w.starts_at && time < w.ends_at;
            return (
              <li key={w.starts_at}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onPick(w.starts_at)}
                  className={cx(
                    "rounded-lg border px-3 py-1.5 text-left text-sm",
                    selected ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-brand",
                    full && "text-danger",
                  )}
                >
                  {formatClock(w.starts_at)}–{formatClock(w.ends_at)} ·{" "}
                  {w.max === null ? `${w.used} booked` : `${w.used}/${w.max} booked`}
                  {full && <span className="ml-1 font-semibold">Full</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {capped.map((c) => (
        <p key={c.category_id} className={cx("text-sm", c.used >= c.max ? "text-danger" : "text-muted")}>
          {c.name}: {c.used}/{c.max} orders on this day{c.used >= c.max ? " — full" : ""}
        </p>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Pass category ids into the new-order catalogue**

In `web/src/app/admin/orders/new/page.tsx`, change the select string's start from `"id, name, is_veg, …"` to `"id, name, category_id, is_veg, contains_egg, prep_type, categories(name, sort_order), product_variants(id, name, price_paise, is_eggless, lead_time_minutes, kitchen_id, is_available, archived_at, sort_order)"`, and in the `.map((p) => ({` object add `categoryId: p.category_id,` after `category: p.categories?.name ?? "",`.

In `order-entry.tsx`, add `categoryId: string;` to `CatalogueProduct` after `category: string;`.

- [ ] **Step 3: Show the panel in `order-entry.tsx`**

Add `import { PickupWindows } from "@/components/pickup-windows";`. After the `unmapped` constant add:

```tsx
  const categoryIds = [...new Set(lines.map((l) => variantIndex.get(l.variantId)?.product.categoryId).filter((id): id is string => Boolean(id)))];
```

Directly after the `</Field>` that closes the "Pickup date and time" field (inside `{!pickupNow && ( … )}`), wrap both in a fragment so the block reads:

```tsx
          {!pickupNow && (
            <>
              <Field label="Pickup date and time" htmlFor="due" hint={maxLead > 0 ? `These items need ${formatLeadTime(maxLead)} of preparation.` : "Bakery timezone."}>
                <Input id="due" type="datetime-local" value={dueLocal} min={minDueLocal} onChange={(e) => setDueLocal(e.target.value)} required />
              </Field>
              <PickupWindows
                dayKey={dueLocal.slice(0, 10)}
                time={dueLocal.slice(11, 16)}
                categoryIds={categoryIds}
                onPick={(t) => setDueLocal(`${dueLocal.slice(0, 10)}T${t}`)}
              />
            </>
          )}
```

- [ ] **Step 4: Show the panel in the reschedule form**

In `order-actions.tsx`: add `import { PickupWindows } from "@/components/pickup-windows";`, add `categoryIds: string[];` to the `OrderActions` props type and `categoryIds,` to its destructured parameters. In the reschedule panel, after the closing `</div>` of the `grid gap-3 sm:grid-cols-2` block, add:

```tsx
          <PickupWindows
            dayKey={newDue.slice(0, 10)}
            time={newDue.slice(11, 16)}
            categoryIds={categoryIds}
            onPick={(t) => setNewDue(`${newDue.slice(0, 10)}T${t}`)}
          />
```

In `web/src/app/admin/orders/[id]/page.tsx`, add to the `<OrderActions … />` props:

```tsx
                categoryIds={[...new Set((items ?? []).map((i) => i.category_id).filter((id): id is string => Boolean(id)))]}
```

- [ ] **Step 5: Timeline details for overrides**

In `web/src/app/admin/orders/[id]/page.tsx`, in the timeline `<li>`, directly before `{e.reason && <p className="text-xs">Reason: {e.reason}</p>}` add:

```tsx
                    {(["slot", "lead_time", "capacity"] as const).map((k) =>
                      typeof data[k] === "string" ? <p key={k} className="text-xs">Overrode: {data[k] as string}</p> : null,
                    )}
                    {e.event_type === "rescheduled" && typeof data.override === "string" && (
                      <p className="text-xs">Override reason: {data.override}</p>
                    )}
```

- [ ] **Step 6: Verify**

Run: `cd web && npm run typecheck && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/pickup-windows.tsx web/src/app/admin/orders
git commit -m "Orders: pickup window availability in new-order and reschedule"
```

---

### Task 6: Settings → Capacity

**Files:**
- Create: `web/src/app/admin/settings/capacity-actions.ts`
- Create: `web/src/app/admin/settings/capacity-forms.tsx`
- Modify: `web/src/app/admin/settings/page.tsx`

**Interfaces:**
- Consumes: `set_pickup_windows`, `set_date_windows` RPCs; `category_daily_caps`, `capacity_overrides` tables; `WindowInput`, `formatClock`; `rpcError`; `ActionState`.
- Produces server actions: `saveWeekdayWindows(input: { weekdays: number[]; windows: WindowRowInput[] }): Promise<ActionState>`, `saveCategoryCaps(prev: ActionState, formData: FormData): Promise<ActionState>`, `addDateOverride(input: DateOverrideInput): Promise<ActionState>`, `removeDateOverride(input: { onDate: string; kind: "window" | "category"; id?: string }): Promise<void>`. `WindowRowInput = { start: string; end: string; max: string }` (form strings; `max` blank = no limit).

- [ ] **Step 1: Create `web/src/app/admin/settings/capacity-actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbError, text } from "@/lib/form";
import { rpcError } from "@/lib/orders";
import { getBusinessTimezone } from "@/lib/settings";
import { zonedDayKey } from "@/lib/time";
import type { WindowInput } from "@/lib/capacity";
import type { ActionState } from "@/components/form-status";

const clock = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM.");
const rowSchema = z
  .object({ start: clock, end: clock, max: z.string().trim().regex(/^\d{0,4}$/, "Limits are whole numbers.") })
  .refine((r) => r.end > r.start, { message: "Each window must end after it starts." });

export type WindowRowInput = z.input<typeof rowSchema>;

function toWindows(rows: z.output<typeof rowSchema>[]): WindowInput[] {
  return rows.map((r) => ({ starts_at: r.start, ends_at: r.end, max_orders: r.max === "" ? null : Number(r.max) }));
}

function done(message: string): ActionState {
  revalidatePath("/admin/settings");
  revalidatePath("/admin/orders", "layout");
  return { ok: true, message };
}

export async function saveWeekdayWindows(input: { weekdays: number[]; windows: WindowRowInput[] }): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = z
    .object({ weekdays: z.array(z.number().int().min(0).max(6)).min(1), windows: z.array(rowSchema).max(24) })
    .safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the windows." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_pickup_windows", {
    p_weekdays: parsed.data.weekdays,
    p_windows: toWindows(parsed.data.windows),
  });
  if (error) return { message: rpcError(error).message };
  return done(parsed.data.weekdays.length > 1 ? "Windows saved for all days." : "Windows saved.");
}

export async function saveCategoryCaps(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const ids = formData.getAll("category_id").filter((v): v is string => typeof v === "string");
  const upserts: { category_id: string; max_orders: number }[] = [];
  const removals: string[] = [];
  for (const id of ids) {
    if (!z.uuid().safeParse(id).success) return { message: "Invalid category." };
    const value = text(formData, `cap_${id}`);
    if (value === "") removals.push(id);
    else if (/^\d{1,4}$/.test(value)) upserts.push({ category_id: id, max_orders: Number(value) });
    else return { message: "Caps must be whole numbers of 0 or more.", fieldErrors: { [`cap_${id}`]: "Whole number" } };
  }

  const supabase = await createClient();
  if (upserts.length > 0) {
    const { error } = await supabase.from("category_daily_caps").upsert(upserts);
    if (error) return dbError(error, "category cap");
  }
  if (removals.length > 0) {
    const { error } = await supabase.from("category_daily_caps").delete().in("category_id", removals);
    if (error) return dbError(error, "category cap");
  }
  return done("Category caps saved.");
}

const dateOverrideSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("window"),
    onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
    note: z.string().trim().min(1, "Give a short note, e.g. Diwali.").max(120),
    windows: z.array(rowSchema).min(1, "Add at least one window.").max(24),
  }),
  z.object({
    kind: z.literal("category"),
    onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
    note: z.string().trim().min(1, "Give a short note, e.g. Diwali.").max(120),
    categoryId: z.uuid("Choose a category."),
    max: z.string().trim().regex(/^\d{1,4}$/, "Enter a whole number (0 closes the category that day)."),
  }),
]);

export type DateOverrideInput = z.input<typeof dateOverrideSchema>;

export async function addDateOverride(input: DateOverrideInput): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = dateOverrideSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the override." };
  const data = parsed.data;
  if (data.onDate < zonedDayKey(new Date(), await getBusinessTimezone())) return { message: "Choose today or a later date." };

  const supabase = await createClient();
  if (data.kind === "window") {
    const { error } = await supabase.rpc("set_date_windows", { p_date: data.onDate, p_note: data.note, p_windows: toWindows(data.windows) });
    if (error) return { message: rpcError(error).message };
  } else {
    const { error } = await supabase.from("capacity_overrides").insert({
      on_date: data.onDate,
      kind: "category",
      category_id: data.categoryId,
      max_orders: Number(data.max),
      note: data.note,
    });
    if (error) return error.code === "23505" ? { message: "That category already has an override on this date." } : dbError(error, "override");
  }
  return done("Date override added.");
}

export async function removeDateOverride(input: { onDate: string; kind: "window" | "category"; id?: string }) {
  await assertRole(["admin"]);
  const supabase = await createClient();
  const query = supabase.from("capacity_overrides").delete().eq("on_date", input.onDate).eq("kind", input.kind);
  const { error } = input.kind === "category" && input.id ? await query.eq("id", input.id) : await query;
  if (error) throw new Error(dbError(error, "override").message);
  revalidatePath("/admin/settings");
  revalidatePath("/admin/orders", "layout");
}
```

- [ ] **Step 2: Create `web/src/app/admin/settings/capacity-forms.tsx`**

```tsx
"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { FormMessage, SubmitButton, type ActionState } from "@/components/form-status";
import { addDateOverride, removeDateOverride, saveCategoryCaps, saveWeekdayWindows, type WindowRowInput } from "./capacity-actions";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // staff read the week from Monday

type Row = WindowRowInput & { key: string };
const newRow = (start = "09:00", end = "11:00"): Row => ({ key: crypto.randomUUID(), start, end, max: "" });

// Editable list of windows (start, end, optional limit).
function WindowRows({ rows, onChange, idPrefix }: { rows: Row[]; onChange: (rows: Row[]) => void; idPrefix: string }) {
  const update = (key: string, patch: Partial<Row>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2">
      {rows.length === 0 && <p className="text-sm text-muted">No windows: any time within opening hours can be booked.</p>}
      {rows.map((r, i) => (
        <div key={r.key} className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`${idPrefix}-start-${i}`}>Window {i + 1} starts</label>
          <Input id={`${idPrefix}-start-${i}`} type="time" value={r.start} onChange={(e) => update(r.key, { start: e.target.value })} className="w-32" />
          <span className="text-sm text-muted">to</span>
          <label className="sr-only" htmlFor={`${idPrefix}-end-${i}`}>Window {i + 1} ends</label>
          <Input id={`${idPrefix}-end-${i}`} type="time" value={r.end} onChange={(e) => update(r.key, { end: e.target.value })} className="w-32" />
          <label className="sr-only" htmlFor={`${idPrefix}-max-${i}`}>Window {i + 1} order limit</label>
          <Input id={`${idPrefix}-max-${i}`} inputMode="numeric" placeholder="No limit" value={r.max}
            onChange={(e) => update(r.key, { max: e.target.value.replace(/\D/g, "").slice(0, 4) })} className="w-28" />
          <span className="text-sm text-muted">orders</span>
          <Button type="button" variant="ghost" onClick={() => onChange(rows.filter((x) => x.key !== r.key))}>Remove</Button>
        </div>
      ))}
      <div>
        <Button type="button" variant="secondary"
          onClick={() => onChange([...rows, rows.length ? newRow(rows[rows.length - 1].end, rows[rows.length - 1].end) : newRow()])}>
          Add window
        </Button>
      </div>
    </div>
  );
}

export type WindowRecord = { weekday: number; starts_at: string; ends_at: string; max_orders: number | null };

export function WeekdayWindowsForm({ windows }: { windows: WindowRecord[] }) {
  // Built once; keys are only for React lists.
  const [byDay, setByDay] = useState(() => Object.fromEntries(
    WEEK_ORDER.map((d) => [
      d,
      windows
        .filter((w) => w.weekday === d)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((w) => ({ key: crypto.randomUUID(), start: w.starts_at.slice(0, 5), end: w.ends_at.slice(0, 5), max: w.max_orders === null ? "" : String(w.max_orders) })),
    ]),
  ) as Record<number, Row[]>);
  const [day, setDay] = useState(1);
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();

  function save(weekdays: number[]) {
    const rows = byDay[day].map(({ start: s, end, max }) => ({ start: s, end, max }));
    start(async () => {
      const result = await saveWeekdayWindows({ weekdays, windows: rows });
      setState(result);
      if (result.ok && weekdays.length > 1) setByDay(Object.fromEntries(WEEK_ORDER.map((d) => [d, byDay[day].map((r) => ({ ...r, key: crypto.randomUUID() }))])));
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Weekday">
        {WEEK_ORDER.map((d) => (
          <Button key={d} type="button" role="tab" aria-selected={d === day} variant={d === day ? "primary" : "secondary"}
            onClick={() => { setDay(d); setState({}); }}>
            {DAYS[d].slice(0, 3)} ({byDay[d].length})
          </Button>
        ))}
      </div>
      <WindowRows idPrefix={`wd-${day}`} rows={byDay[day]} onChange={(rows) => setByDay({ ...byDay, [day]: rows })} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled={pending} onClick={() => save([day])}>{pending ? "Saving…" : `Save for ${DAYS[day]}`}</Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => save(WEEK_ORDER)}>Use these windows for every day</Button>
        <FormMessage state={state} />
      </div>
    </div>
  );
}

export function CategoryCapsForm({ categories, caps }: { categories: { id: string; name: string }[]; caps: Record<string, number> }) {
  const [state, action] = useActionState<ActionState, FormData>(saveCategoryCaps, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col divide-y divide-line">
        {categories.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 py-2">
            <label htmlFor={`cap_${c.id}`} className="text-sm font-medium">{c.name}</label>
            <input type="hidden" name="category_id" value={c.id} />
            <Input id={`cap_${c.id}`} name={`cap_${c.id}`} inputMode="numeric" placeholder="No cap" className="w-28"
              defaultValue={caps[c.id] === undefined ? "" : String(caps[c.id])} />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4">
        <SubmitButton>Save caps</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function DateOverrideForm({ categories, minDate }: { categories: { id: string; name: string }[]; minDate: string }) {
  const [kind, setKind] = useState<"window" | "category">("window");
  const [onDate, setOnDate] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>(() => [newRow()]);
  const [categoryId, setCategoryId] = useState("");
  const [max, setMax] = useState("");
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const result = kind === "window"
        ? await addDateOverride({ kind, onDate, note, windows: rows.map(({ start: s, end, max: m }) => ({ start: s, end, max: m })) })
        : await addDateOverride({ kind, onDate, note, categoryId, max });
      setState(result);
      if (result.ok) { setNote(""); setMax(""); setRows([newRow()]); }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Date" htmlFor="ov-date">
          <Input id="ov-date" type="date" min={minDate} value={onDate} onChange={(e) => setOnDate(e.target.value)} />
        </Field>
        <Field label="Note" htmlFor="ov-note" className="min-w-56 flex-1">
          <Input id="ov-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="e.g. Diwali" />
        </Field>
      </div>
      <div className="flex gap-4" role="radiogroup" aria-label="Override type">
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" className="accent-brand" checked={kind === "window"} onChange={() => setKind("window")} /> Replace the day&apos;s windows
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" className="accent-brand" checked={kind === "category"} onChange={() => setKind("category")} /> Change one category&apos;s cap
        </label>
      </div>
      {kind === "window" ? (
        <WindowRows idPrefix="ov" rows={rows} onChange={setRows} />
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Category" htmlFor="ov-cat">
            <Select id="ov-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Choose…</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Max orders that day" htmlFor="ov-max" hint="0 stops orders for this category that day.">
            <Input id="ov-max" inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, "").slice(0, 4))} className="w-28" />
          </Field>
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button type="button" disabled={pending} onClick={submit}>{pending ? "Adding…" : "Add override"}</Button>
        <FormMessage state={state} />
      </div>
    </div>
  );
}

export function RemoveOverrideButton({ onDate, kind, id }: { onDate: string; kind: "window" | "category"; id?: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant="ghost" disabled={pending} onClick={() => start(() => removeDateOverride({ onDate, kind, id }))}>
      {pending ? "Removing…" : "Remove"}
    </Button>
  );
}
```

- [ ] **Step 3: Add the Capacity section to `settings/page.tsx`**

1. Imports: add
```tsx
import { CategoryCapsForm, DateOverrideForm, RemoveOverrideButton, WeekdayWindowsForm } from "./capacity-forms";
import { formatClock } from "@/lib/capacity";
```
2. Replace the `Promise.all` destructuring and list with:

```tsx
  const today = zonedDayKey(new Date(), tz);
  const [{ data: settings, error }, { data: hours }, { data: closures }, { data: windows }, { data: categories }, { data: caps }, { data: overrides }] =
    await Promise.all([
      supabase.from("business_settings").select("*").single(),
      supabase.from("business_hours").select("*").order("weekday"),
      supabase.from("closures").select("*").gte("closed_on", today).order("closed_on"),
      supabase.from("pickup_windows").select("weekday, starts_at, ends_at, max_orders"),
      supabase.from("categories").select("id, name").eq("is_active", true).order("sort_order").order("name"),
      supabase.from("category_daily_caps").select("category_id, max_orders"),
      supabase.from("capacity_overrides").select("id, on_date, kind, starts_at, ends_at, max_orders, note, categories(name)").gte("on_date", today).order("on_date").order("starts_at"),
    ]);
  const overrideDays = [...new Set((overrides ?? []).map((o) => o.on_date))];
```
3. After the Closures `</Card>` add:

```tsx
          <Card>
            <h2 className="text-lg font-semibold">Pickup windows</h2>
            <p className="mb-4 mt-1 text-sm text-muted">
              Time windows customers can pick up in, with the most orders each window takes. A day with no windows accepts any time within opening hours. Full windows can only be booked by an admin with a reason.
            </p>
            <WeekdayWindowsForm windows={windows ?? []} />
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Daily category caps</h2>
            <p className="mb-4 mt-1 text-sm text-muted">Most orders per day that include this category, e.g. 8 custom cakes. Leave blank for no cap.</p>
            {categories && categories.length > 0 ? (
              <CategoryCapsForm categories={categories} caps={Object.fromEntries((caps ?? []).map((c) => [c.category_id, c.max_orders]))} />
            ) : (
              <p className="text-sm text-muted">Add categories in Products first.</p>
            )}
          </Card>
          <Card>
            <h2 className="text-lg font-semibold">Festival and special days</h2>
            <p className="mb-4 mt-1 text-sm text-muted">Replace one date&apos;s windows, or change one category&apos;s cap for that date. Use Closures for days the bakery is shut.</p>
            <DateOverrideForm categories={categories ?? []} minDate={today} />
            {overrideDays.length > 0 && (
              <ul className="mt-4 divide-y divide-line">
                {overrideDays.map((day) => {
                  const rows = (overrides ?? []).filter((o) => o.on_date === day);
                  const windowRows = rows.filter((o) => o.kind === "window");
                  return (
                    <li key={day} className="flex flex-col gap-1 py-2 text-sm">
                      <span className="font-medium">{formatDayHeading(day)}</span>
                      {windowRows.length > 0 && (
                        <div className="flex items-center justify-between gap-3">
                          <span>
                            {windowRows[0].note}: windows{" "}
                            {windowRows.map((w) => `${formatClock(w.starts_at!.slice(0, 5))}–${formatClock(w.ends_at!.slice(0, 5))}${w.max_orders === null ? "" : ` (${w.max_orders})`}`).join(", ")}
                          </span>
                          <RemoveOverrideButton onDate={day} kind="window" />
                        </div>
                      )}
                      {rows.filter((o) => o.kind === "category").map((c) => (
                        <div key={c.id} className="flex items-center justify-between gap-3">
                          <span>{c.note}: {c.categories?.name} cap {c.max_orders}</span>
                          <RemoveOverrideButton onDate={day} kind="category" id={c.id} />
                        </div>
                      ))}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
```

- [ ] **Step 4: Verify**

Run: `cd web && npm run typecheck && npm run lint && npm run build`
Expected: all pass. If lint flags a `react-hooks` rule, fix the code rather than disabling the rule.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/admin/settings
git commit -m "Settings: pickup windows, category caps, festival overrides"
```

---

### Task 7: Browser verification and docs

**Files:**
- Modify: `PRD.md`, `TODO.md`, `HANDOVER.md`, `PROJECT_RULES.md`, `docs/superpowers/specs/2026-09-27-capacity-and-overrides-design.md`

- [ ] **Step 1: Browser pass (live project; test orders only, no bills)**

Start `cd web && npm run dev`, sign in as the demo admin (password in `web/.admin-password.txt`), and use Chrome (claude-in-chrome tools). Check, noting every defect:
1. Settings → Pickup windows: add Mon windows 9–11 (limit 1) and 11–13; save; reload shows them; "Use these windows for every day"; overlapping windows show the overlap message.
2. Category caps: set a cap of 1 on one category; clear it; save.
3. Festival day: add a window override and a category override for a future date; both list; remove both.
4. New call order for a Monday: the panel shows `9:00 AM–11:00 AM · 0/1 booked`; clicking a window sets the time; save. Second order in the same window: refusal shows `…is full (1/1)…` with the reason field; a 4-character reason keeps the button disabled; a proper reason saves; the timeline shows "Admin override" with `Overrode: Pickup window…`.
5. Order detail → Reschedule: panel shows windows for the new date; a full window leads to the prompt; retry with a reason succeeds.
6. Sign in as a counter user if available (`supabase/tests/qa_users.sql`) and confirm the refusal shows no override field.
7. Afterwards, as admin: remove test windows/caps, cancel the test orders (reason "Browser test"). Do **not** issue bills.

Fix defects found (with a commit per fix) and re-run `npm run typecheck && npm run lint && npm run build`.

- [ ] **Step 2: Reset test data**

Run with `execute_sql`: `select count(*) from public.orders where status not in ('cancelled','rejected');` If 0 real orders exist (only browser-test orders, all cancelled), ask the owner before deleting anything; at minimum leave the sequence. Only if the owner agrees and no real orders exist: `alter sequence public.order_number_seq restart with 1001` after removing test orders.

- [ ] **Step 3: Update docs**

- `PRD.md` 5F "Daily order caps and cut-offs": replace the cut-off sentence with "Cut-offs are not used; product lead times cover them (owner decision, 2026-09-27). Pickup windows are defined per weekday with an order limit each; date overrides replace a day's windows or a category's cap." Section 14 item 23: mark caps decided, cut-offs dropped.
- `TODO.md`: tick Phase 3 "Add capacity caps, cut-offs, and pickup slots (4C)" with a note "cut-offs dropped"; tick the two Phase 4 items for slot/day caps and the admin override action; tick Phase 4C items 1 and 3; update the status line.
- `HANDOVER.md`: phase table (4C partly done), migration list (`capacity`, `capacity_enforcement`), tests table (`capacity_logic.sql`, result), error kinds (`capacity`), "Nobody has clicked through" caveat updated with what the browser pass covered.
- `PROJECT_RULES.md` decision log: rows for windows per weekday, caps count orders, cut-offs dropped, admin-only capacity override, 5-character override reason.
- Spec: add a "Deviations" note (two migrations; RPCs for window saves; no extra non-admin line).

- [ ] **Step 4: Final verification**

Run `supabase/tests/capacity_logic.sql`, `orders_logic.sql`, `billing_logic.sql` once more, and `cd web && npm run typecheck && npm run lint && npm run build`. Record results in HANDOVER's tests table.

- [ ] **Step 5: Commit**

```bash
git add PRD.md TODO.md HANDOVER.md PROJECT_RULES.md docs/superpowers/specs/2026-09-27-capacity-and-overrides-design.md
git commit -m "Docs: Phase 4C capacity caps and override prompt"
```
