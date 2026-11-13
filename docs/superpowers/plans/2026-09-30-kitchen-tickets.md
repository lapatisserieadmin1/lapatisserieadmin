# Kitchen Tickets (Phase 5A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirmed orders produce one kitchen ticket per kitchen that chefs work through on a tablet screen (acknowledge, start, mark lines ready, report issues, acknowledge stop-work), with admin and counter views, a printed ticket, and order-level progress flags.

**Architecture:** Three new tables (`kitchen_tickets`, `kitchen_ticket_lines`, `kitchen_issues`) plus a progress view. Chefs can read only rows for their assigned kitchens, and the rows are written only by `security definer` functions. `private.build_tickets` is called from the shared confirm step and rebuilds tickets when a confirmed order is edited or rescheduled, but only while every ticket is still New. `cancel_order` cancels tickets and raises stop-work notices. The Next.js app adds a chef screen that polls a change stamp every 10 seconds, a shared ticket card used by chef, admin and counter screens, an 80mm print page, the admin KOT page, and kitchen badges on the order screens.

**Tech Stack:** Supabase Postgres (plpgsql, RLS), Next.js 16 App Router (server components, server actions, React 19 client components), Tailwind v4, zod, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-30-kitchen-tickets-design.md`

## Global Constraints

- Supabase project ref: `hljkydruionasnouyrpu` (live; there is no staging). Apply the migration with the Supabase MCP `apply_migration` tool **only in Task 5**, after every SQL check passes. Run SQL with `execute_sql`.
- SQL tests run inside a transaction that is aborted. `execute_sql` returns only the last statement's result, so the final statement raises the results as an exception, which also rolls everything back (see "Running SQL checks" below).
- Test orders are inserted directly with order numbers from **990201**. Never call `create_order` in the new tests, because it consumes the live `order_number_seq`.
- Tickets hold **no prices, no customer name, phone or notes, and no internal notes**.
- Chefs must keep **no access** to `orders`, `order_items`, `payments`, `customers`, `order_events`, `bills`, `credit_notes`.
- Admin exception reason: at least **5** characters after trimming. Issue note and resolution: **3 to 500** characters.
- New error kinds: `kitchen` (not overridable; do not add it to `OVERRIDABLE_KINDS`) and `forbidden`.
- Every new table: RLS enabled; `revoke all … from anon, authenticated`; `grant select … to authenticated`; audit trigger `private.audit_row('id')`.
- Every new function: `security definer`, `set search_path = ''`, fully qualified names. `private` functions: `revoke execute … from public`. `public` functions: `revoke execute … from public, anon`, then `grant execute … to authenticated`.
- All times in the business timezone (`private.business_timezone()` in SQL; `web/src/lib/time.ts` in TypeScript).
- Next.js 16: `params`/`searchParams` are Promises; `PageProps<"/route">` is a global type from `next typegen`. The `react-hooks/purity` lint rule rejects `Date.now()` during render; `new Date()` and `Date.parse(...)` are accepted.
- Unit tests run with `npm test` (Node strips types). A tested module may only have **type-only** imports from `@/…`.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
  ```
- Work on branch `phase-5a-kitchen-tickets` (already created; the spec is committed there).

## Review Focus

1. **A chef assigned to both kitchens, or to none.** The screen must show both kitchens' tickets with a working kitchen switch; a chef with no kitchen sees the "not assigned" alert and no tickets. (Task 2 checks B7 and B8; Task 6 page handles `chef.kitchens.length === 0` and the `k` switch.)
2. **Double taps and two chefs tapping the same line.** Repeating an action or setting the same ready count must change nothing and log nothing. (Task 3 checks C1 and C6b.)
3. **The order is cancelled while a chef is mid-work.** A stop-work notice appears with the lines and the counts already made, and any further start or ready is refused. (Task 4 checks D8 to D10; Task 6 `StopWorkNotice` shows "N already made".)
4. **The tablet loses connection while tapping Ready.** The card must say "Not saved, check the connection" and must not show the line as ready; the header switches to Offline. (Task 6 `useTicketAction` catch branch and `RefreshStatus` catch branch.)
5. **An overdue ticket from yesterday.** It must still appear under Today and sort first. (Task 5 unit test "overdue work from an earlier day is in Today and comes first".)

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260930000300_kitchen_tickets.sql` (create) | Enums, tables, view, access, ticket building, chef functions, changed order functions, backfill, grants |
| `supabase/tests/kitchen_logic.sql` (create) | SQL rule checks (rolled back) |
| `web/src/lib/database.types.ts` (modify) | Types for the new tables, view, functions, enums |
| `web/src/lib/kitchen.ts` (create) | Pure kitchen types, labels, `groupQueue` |
| `web/src/lib/kitchen.test.ts` (create) | Unit tests for `groupQueue` |
| `web/src/lib/kitchen-data.ts` (create) | Server-only ticket query, mapper, change stamp |
| `web/src/app/kitchen/actions.ts` (create) | Server actions for ticket actions, issues, prints, stamp |
| `web/src/components/kitchen/refresh-status.tsx` (create) | 10-second poll, "Updated N s ago", Offline banner |
| `web/src/components/kitchen/ticket-card.tsx` (create) | `TicketCard`, `StopWorkNotice`, `PrintTicketButton`, issue form |
| `web/src/app/kitchen/page.tsx` (modify) | Chef screen |
| `web/src/app/print/print-button.tsx` (create) | Client print button |
| `web/src/app/print/kot/[id]/page.tsx` (create) | 80mm ticket print |
| `web/src/app/admin/kot/page.tsx` (replace) | Admin/counter KOT overview |
| `web/src/app/admin/kot/resolve-issue.tsx` (create) | Resolve-issue form |
| `web/src/app/admin/nav.tsx` (modify) | KOT visible to counter staff |
| `web/src/components/order-badges.tsx` (modify) | `KitchenFlags` badges |
| `web/src/app/admin/orders/page.tsx` (modify) | Kitchen badges in the order list |
| `web/src/app/admin/calendar/order-row.tsx`, `page.tsx` (modify) | Kitchen badges in the calendar |
| `web/src/app/admin/orders/[id]/page.tsx`, `order-actions.tsx` (modify) | Kitchen card, timeline labels, hide edit/reschedule once the kitchen has acknowledged |
| `HANDOVER.md`, `TODO.md` (modify) | Docs |

### Running SQL checks

Before Task 5 the migration is not applied, so each run prepends it. From the repo root:

```bash
cd "/c/Users/SANDY/Desktop/auri bakery/supabase"
{ echo "begin;"
  cat migrations/20260930000300_kitchen_tickets.sql
  sed '1,/^begin;$/d' tests/kitchen_logic.sql | sed '/^reset role;$/,$d'
  echo "reset role;"
  echo "do \$\$ begin raise exception E'RESULTS\\n%', (select string_agg(check_name || ' => ' || coalesce(outcome,'NULL'), E'\\n' order by n) from r); end \$\$;"
} > "$TMPDIR/kitchen_run.sql"
```

Paste the content of `$TMPDIR/kitchen_run.sql` into `execute_sql`. The error message lists every check as `name => outcome`. Compare each outcome with the `-- expect:` comment above it in the test file. After Task 5, drop the `cat migrations/…` line.

---

### Task 1: Kitchen schema and access

**Files:**
- Create: `supabase/migrations/20260930000300_kitchen_tickets.sql`
- Create: `supabase/tests/kitchen_logic.sql`

**Interfaces:**
- Produces: enums `public.ticket_status` (`new`, `acknowledged`, `preparing`, `ready`, `cancelled`) and `public.ticket_line_status` (`pending`, `preparing`, `ready`, `cancelled`). Tables `public.kitchen_tickets`, `public.kitchen_ticket_lines`, `public.kitchen_issues`, with columns exactly as in Step 3. View `public.order_kitchen_progress(order_id, ticket_count, ready_count, all_ready, open_issues, stop_work_pending)`. Function `private.can_see_kitchen(p_kitchen_id uuid) returns boolean`.

- [ ] **Step 1: Write the test file with setup and the schema checks**

Create `supabase/tests/kitchen_logic.sql`:

```sql
-- Kitchen tickets (Phase 5A). Runs in a transaction and rolls back.
-- Orders are inserted directly with order numbers from 990201, so order_number_seq is not consumed.
-- Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-0000000007a1','kt-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000007c1','kt-c@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000007f1','kt-f1@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000007f2','kt-f2@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-0000000007a1','Kt Admin','admin'),
 ('00000000-0000-0000-0000-0000000007c1','Kt Counter','counter'),
 ('00000000-0000-0000-0000-0000000007f1','Kt Chef One','chef'),
 ('00000000-0000-0000-0000-0000000007f2','Kt Chef Two','chef');
insert into public.kitchens (code, name) values ('TK1', 'T Kitchen One'), ('TK2', 'T Kitchen Two');
-- Chef one works in kitchen one only; chef two in both.
insert into public.staff_kitchens (user_id, kitchen_id)
  select '00000000-0000-0000-0000-0000000007f1'::uuid, id from public.kitchens where code = 'TK1'
  union all
  select '00000000-0000-0000-0000-0000000007f2'::uuid, id from public.kitchens where code in ('TK1', 'TK2');

-- Predictable scheduling rules (all rolled back).
delete from public.capacity_overrides;
delete from public.category_daily_caps;
delete from public.pickup_windows;
delete from public.closures;
update public.business_hours set opens_at = '09:00', closes_at = '21:00', is_closed = false;

insert into public.categories (name) values ('T Kt Bakes');
insert into public.products (category_id, name, prep_type, tax_rate_bps, allergens)
  select id, 'T Kt Cake', 'made_to_order', 500, '{milk}' from public.categories where name = 'T Kt Bakes';
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Kt Bread', 'made_to_order', 500 from public.categories where name = 'T Kt Bakes';
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, 'T Kt Puff', 'ready_stock', 1800 from public.categories where name = 'T Kt Bakes';
insert into public.product_variants (product_id, name, price_paise, lead_time_minutes, kitchen_id)
  select p.id, '1 kg', 50000, 120, k.id from public.products p, public.kitchens k where p.name = 'T Kt Cake' and k.code = 'TK1';
insert into public.product_variants (product_id, name, price_paise, lead_time_minutes, kitchen_id)
  select p.id, 'Loaf', 8000, 60, k.id from public.products p, public.kitchens k where p.name = 'T Kt Bread' and k.code = 'TK2';
insert into public.product_variants (product_id, name, price_paise)
  select id, 'Each', 3000 from public.products where name = 'T Kt Puff';
insert into ctx select 'cake', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Kt Cake';
insert into ctx select 'bread', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Kt Bread';
insert into ctx select 'puff', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Kt Puff';

-- Noon on day p_days after today, business time.
create function pg_temp.day(p_days integer) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Kolkata')::date + p_days) + time '12:00') at time zone 'Asia/Kolkata'
$$;
-- Pending call order inserted straight into the table.
create function pg_temp.mk_order(p_num bigint, p_due timestamptz) returns uuid language sql as $$
  insert into public.orders (order_number, idempotency_key, source, status, customer_name, customer_phone, requested_due_at)
  values (p_num, gen_random_uuid(), 'CALL', 'pending_confirmation', 'Kt Customer', '9000000701', p_due)
  returning id
$$;
-- Order line snapshotting the catalogue, as create_order does.
create function pg_temp.mk_line(p_order uuid, p_key text, p_qty integer, p_notes text default null) returns uuid language sql as $$
  insert into public.order_items (
    order_id, line_no, product_id, variant_id, category_id, product_name, variant_name, prep_type, kitchen_id,
    is_veg, contains_egg, is_eggless, allergens, lead_time_minutes, unit_price_paise, tax_rate_bps,
    quantity, line_total_paise, tax_paise, notes)
  select p_order, coalesce((select max(line_no) from public.order_items where order_id = p_order), 0) + 1,
         p.id, pv.id, p.category_id, p.name, pv.name, p.prep_type,
         case when p.prep_type = 'made_to_order' then pv.kitchen_id end,
         p.is_veg, p.contains_egg, pv.is_eggless, p.allergens, pv.lead_time_minutes, pv.price_paise, p.tax_rate_bps,
         p_qty, pv.price_paise * p_qty, 0, p_notes
  from public.product_variants pv join public.products p on p.id = pv.product_id
  where pv.id = (select v::uuid from ctx where k = p_key)
  returning id
$$;

-- A: cake ×2 (Happy Birthday), bread ×3, puff ×1 · P: puff ×2 only · E: cake ×1, bread ×1 (edits) · Q: cake ×1 (stays pending)
insert into ctx values ('A', pg_temp.mk_order(990201, pg_temp.day(3))::text);
insert into ctx values ('P', pg_temp.mk_order(990202, pg_temp.day(3))::text);
insert into ctx values ('E', pg_temp.mk_order(990203, pg_temp.day(3))::text);
insert into ctx values ('Q', pg_temp.mk_order(990204, pg_temp.day(3))::text);
select pg_temp.mk_line((select v::uuid from ctx where k = 'A'), 'cake', 2, 'Happy Birthday');
select pg_temp.mk_line((select v::uuid from ctx where k = 'A'), 'bread', 3);
select pg_temp.mk_line((select v::uuid from ctx where k = 'A'), 'puff', 1);
select pg_temp.mk_line((select v::uuid from ctx where k = 'P'), 'puff', 2);
select pg_temp.mk_line((select v::uuid from ctx where k = 'E'), 'cake', 1);
select pg_temp.mk_line((select v::uuid from ctx where k = 'E'), 'bread', 1);
select pg_temp.mk_line((select v::uuid from ctx where k = 'Q'), 'cake', 1);
select private.recalc_order_totals(v::uuid) from ctx where k in ('A', 'P', 'E', 'Q');

set local role authenticated;

-- ===== Schema and access (Task 1) =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
do $$
begin
  -- expect: 0
  insert into r(check_name,outcome) values ('S1 no price or customer columns on kitchen tables',
    (select count(*) from information_schema.columns where table_schema = 'public'
       and table_name in ('kitchen_tickets', 'kitchen_ticket_lines', 'kitchen_issues', 'order_kitchen_progress')
       and column_name ~ '(price|paise|customer|phone)')::text);
  begin
    insert into public.kitchen_tickets (order_id, kitchen_id, reference, source, due_at, start_by)
      values ((select v::uuid from ctx where k = 'A'), (select id from public.kitchens where code = 'TK1'), 'X', 'CALL', now(), now());
    insert into r(check_name,outcome) values ('S2 direct ticket insert refused', 'ALLOWED');
  -- expect: permission denied for table kitchen_tickets
  exception when others then insert into r(check_name,outcome) values ('S2 direct ticket insert refused', sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007f1","role":"authenticated"}', true);
do $$
begin
  -- expect: 0 / 0 / 0 / 0
  insert into r(check_name,outcome) values ('S3 chef can read the kitchen tables',
    (select count(*) from public.kitchen_tickets where order_id = (select v::uuid from ctx where k = 'A'))::text
    || ' / ' || (select count(*) from public.kitchen_ticket_lines l join public.kitchen_tickets t on t.id = l.ticket_id
                 where t.order_id = (select v::uuid from ctx where k = 'A'))
    || ' / ' || (select count(*) from public.kitchen_issues i join public.kitchen_tickets t on t.id = i.ticket_id
                 where t.order_id = (select v::uuid from ctx where k = 'A'))
    || ' / ' || (select count(*) from public.order_kitchen_progress where order_id = (select v::uuid from ctx where k = 'A')));
end $$;

reset role;
select check_name, outcome from r order by n;
rollback;
```

Later tasks insert their sections **above** the line `reset role;`.

- [ ] **Step 2: Run the checks to verify they fail**

Create an empty migration file first, so the run command works: `touch supabase/migrations/20260930000300_kitchen_tickets.sql`. Build and run as in "Running SQL checks".
Expected: the run stops with an error like `relation "public.kitchen_tickets" does not exist` (no `RESULTS`).

- [ ] **Step 3: Write the schema migration**

Write `supabase/migrations/20260930000300_kitchen_tickets.sql`:

```sql
-- Phase 5A: kitchen tickets (docs/superpowers/specs/2026-09-30-kitchen-tickets-design.md).
-- Confirmed orders get one ticket per kitchen. Chefs read only their kitchens' tickets and never
-- see prices, customers, or other order data. Tickets are written only through the functions below.

create type public.ticket_status as enum ('new', 'acknowledged', 'preparing', 'ready', 'cancelled');
create type public.ticket_line_status as enum ('pending', 'preparing', 'ready', 'cancelled');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.kitchen_tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  kitchen_id uuid not null references public.kitchens (id) on delete restrict,
  reference text not null unique,
  revision integer not null default 1 check (revision >= 1),
  source public.order_source not null,
  status public.ticket_status not null default 'new',
  due_at timestamptz not null,
  start_by timestamptz not null,
  revised_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by uuid references auth.users (id) on delete set null,
  started_at timestamptz,
  started_by uuid references auth.users (id) on delete set null,
  ready_at timestamptz,
  ready_by uuid references auth.users (id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text,
  stop_work_acknowledged_at timestamptz,
  stop_work_acknowledged_by uuid references auth.users (id) on delete set null,
  print_count integer not null default 0 check (print_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, kitchen_id)
);
create index kitchen_tickets_queue_idx on public.kitchen_tickets (kitchen_id, status, due_at);
create index kitchen_tickets_updated_at_idx on public.kitchen_tickets (updated_at desc);
create index kitchen_tickets_acknowledged_by_idx on public.kitchen_tickets (acknowledged_by);
create index kitchen_tickets_started_by_idx on public.kitchen_tickets (started_by);
create index kitchen_tickets_ready_by_idx on public.kitchen_tickets (ready_by);
create index kitchen_tickets_stop_work_by_idx on public.kitchen_tickets (stop_work_acknowledged_by);

-- Snapshot of the order's made-to-order lines for one kitchen. order_item_id becomes null when an
-- edit deletes the order line, so a stop-work ticket keeps showing what to stop.
create table public.kitchen_ticket_lines (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.kitchen_tickets (id) on delete cascade,
  order_item_id uuid unique references public.order_items (id) on delete set null,
  line_no integer not null,
  product_name text not null,
  variant_name text not null,
  quantity integer not null check (quantity >= 1),
  ready_quantity integer not null default 0,
  is_veg boolean not null,
  contains_egg boolean not null,
  is_eggless boolean not null,
  allergens text[] not null default '{}',
  notes text,
  lead_time_minutes integer not null,
  status public.ticket_line_status not null default 'pending',
  check (ready_quantity between 0 and quantity)
);
create index kitchen_ticket_lines_ticket_id_idx on public.kitchen_ticket_lines (ticket_id);

create table public.kitchen_issues (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.kitchen_tickets (id) on delete cascade,
  line_id uuid references public.kitchen_ticket_lines (id) on delete set null,
  kind text not null check (kind in ('ingredient', 'equipment', 'quality', 'other')),
  note text not null check (length(trim(note)) between 3 and 500),
  reported_by uuid references auth.users (id) on delete set null,
  reported_at timestamptz not null default now(),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  resolution text check (resolution is null or length(trim(resolution)) between 3 and 500),
  check ((resolved_at is null) = (resolution is null))
);
create index kitchen_issues_ticket_id_idx on public.kitchen_issues (ticket_id);
create index kitchen_issues_line_id_idx on public.kitchen_issues (line_id);
create index kitchen_issues_reported_by_idx on public.kitchen_issues (reported_by);
create index kitchen_issues_resolved_by_idx on public.kitchen_issues (resolved_by);

create trigger kitchen_tickets_updated_at before update on public.kitchen_tickets
  for each row execute function private.set_updated_at();
create trigger kitchen_tickets_audit after insert or update or delete on public.kitchen_tickets
  for each row execute function private.audit_row('id');
create trigger kitchen_ticket_lines_audit after insert or update or delete on public.kitchen_ticket_lines
  for each row execute function private.audit_row('id');
create trigger kitchen_issues_audit after insert or update or delete on public.kitchen_issues
  for each row execute function private.audit_row('id');

-- One row per order with tickets, for the order lists, calendar, and order page.
create view public.order_kitchen_progress
with (security_invoker = true)
as
select
  t.order_id,
  count(*) filter (where t.status <> 'cancelled') as ticket_count,
  count(*) filter (where t.status = 'ready') as ready_count,
  (count(*) filter (where t.status <> 'cancelled') > 0
   and count(*) filter (where t.status not in ('ready', 'cancelled')) = 0) as all_ready,
  (select count(*) from public.kitchen_issues i join public.kitchen_tickets t2 on t2.id = i.ticket_id
   where t2.order_id = t.order_id and i.resolved_at is null) as open_issues,
  count(*) filter (where t.status = 'cancelled' and t.stop_work_acknowledged_at is null) as stop_work_pending
from public.kitchen_tickets t
group by t.order_id;

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

-- Admin and counter see every kitchen; a chef sees the kitchens assigned in staff_kitchens.
create function private.can_see_kitchen(p_kitchen_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_staff_role() in ('admin', 'counter'), false)
    or (private.current_staff_role() = 'chef'
        and exists (select 1 from public.staff_kitchens sk
                    where sk.user_id = (select auth.uid()) and sk.kitchen_id = p_kitchen_id))
$$;

alter table public.kitchen_tickets enable row level security;
alter table public.kitchen_ticket_lines enable row level security;
alter table public.kitchen_issues enable row level security;

create policy "Staff read tickets of their kitchens" on public.kitchen_tickets for select to authenticated
  using ((select private.can_see_kitchen(kitchen_id)));
create policy "Staff read ticket lines of their kitchens" on public.kitchen_ticket_lines for select to authenticated
  using (exists (select 1 from public.kitchen_tickets t where t.id = ticket_id));
create policy "Staff read issues of their kitchens" on public.kitchen_issues for select to authenticated
  using (exists (select 1 from public.kitchen_tickets t where t.id = ticket_id));

revoke all on public.kitchen_tickets, public.kitchen_ticket_lines, public.kitchen_issues, public.order_kitchen_progress
  from anon, authenticated;
grant select on public.kitchen_tickets, public.kitchen_ticket_lines, public.kitchen_issues, public.order_kitchen_progress
  to authenticated;

revoke execute on function private.can_see_kitchen(uuid) from public;
grant execute on function private.can_see_kitchen(uuid) to authenticated;
```

- [ ] **Step 4: Run the checks to verify they pass**

Build and run as in "Running SQL checks".
Expected:
```
S1 no price or customer columns on kitchen tables => 0
S2 direct ticket insert refused => permission denied for table kitchen_tickets
S3 chef can read the kitchen tables => 0 / 0 / 0 / 0
```

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/SANDY/Desktop/auri bakery"
git add supabase/migrations/20260930000300_kitchen_tickets.sql supabase/tests/kitchen_logic.sql
git commit -m "Kitchen: ticket tables, progress view, kitchen-scoped access

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Ticket building on confirmation

**Files:**
- Modify: `supabase/migrations/20260930000300_kitchen_tickets.sql` (append)
- Modify: `supabase/tests/kitchen_logic.sql` (insert above `reset role;`)

**Interfaces:**
- Consumes: the Task 1 tables.
- Produces: `private.fill_ticket_lines(p_ticket_id uuid) returns void`; `private.ticket_signature(p_order_id uuid, p_kitchen_id uuid) returns jsonb`; `private.build_tickets(p_order_id uuid) returns integer` (the number of existing tickets revised or cancelled; 0 on a first build). `private.confirm_locked` now calls `build_tickets`. Ticket reference = `orders.reference || '-' || kitchens.code`.

- [ ] **Step 1: Add the failing build checks**

Insert above `reset role;` in `supabase/tests/kitchen_logic.sql`:

```sql
-- ===== Ticket building (Task 2) =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
do $$
declare
  o public.orders;
  a uuid := (select v::uuid from ctx where k = 'A');
  p uuid := (select v::uuid from ctx where k = 'P');
begin
  o := public.confirm_order(a, 1);
  -- expect: confirmed / B-990201-TK1, B-990201-TK2
  insert into r(check_name,outcome) values ('B1 confirming creates one ticket per kitchen',
    o.status::text || ' / ' || (select string_agg(reference, ', ' order by reference) from public.kitchen_tickets where order_id = a));
  -- expect: B-990201-TK1: 2×T Kt Cake (Happy Birthday) {milk} | B-990201-TK2: 3×T Kt Bread {}
  insert into r(check_name,outcome) values ('B2 lines per kitchen; ready-stock left out',
    (select string_agg(t.reference || ': ' || l.quantity || '×' || l.product_name || coalesce(' (' || l.notes || ')', '') || ' ' || l.allergens::text,
                       ' | ' order by t.reference)
     from public.kitchen_tickets t join public.kitchen_ticket_lines l on l.ticket_id = t.id where t.order_id = a));
  -- expect: true / true
  insert into r(check_name,outcome) values ('B3 start by is pickup minus the longest lead time',
    (select string_agg((start_by = due_at - make_interval(mins => case when reference like '%-TK1' then 120 else 60 end))::text, ' / ' order by reference)
     from public.kitchen_tickets where order_id = a));
  -- expect: new r1 null / new r1 null
  insert into r(check_name,outcome) values ('B4 first build is revision 1, not revised',
    (select string_agg(status || ' r' || revision || ' ' || coalesce(revised_at::text, 'null'), ' / ' order by reference)
     from public.kitchen_tickets where order_id = a));
  o := public.confirm_order(p, 1);
  -- expect: confirmed / 0
  insert into r(check_name,outcome) values ('B5 ready-stock-only order gets no ticket',
    o.status::text || ' / ' || (select count(*) from public.kitchen_tickets where order_id = p));
  -- expect: 2 / 0 / false / 0 / 0
  insert into r(check_name,outcome) values ('B6 progress row',
    (select ticket_count || ' / ' || ready_count || ' / ' || all_ready || ' / ' || open_issues || ' / ' || stop_work_pending
     from public.order_kitchen_progress where order_id = a));

  insert into ctx select 'A1', id::text from public.kitchen_tickets where order_id = a and reference like '%-TK1';
  insert into ctx select 'A2', id::text from public.kitchen_tickets where order_id = a and reference like '%-TK2';
  insert into ctx select 'A1cake', l.id::text from public.kitchen_ticket_lines l join public.kitchen_tickets t on t.id = l.ticket_id
    where t.order_id = a and l.product_name = 'T Kt Cake';
  insert into ctx select 'A2bread', l.id::text from public.kitchen_ticket_lines l join public.kitchen_tickets t on t.id = l.ticket_id
    where t.order_id = a and l.product_name = 'T Kt Bread';
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007f1","role":"authenticated"}', true);
do $$
begin
  -- expect: B-990201-TK1 / 0
  insert into r(check_name,outcome) values ('B7 chef one sees only kitchen one, and no orders',
    (select string_agg(reference, ', ') from public.kitchen_tickets where order_id = (select v::uuid from ctx where k = 'A'))
    || ' / ' || (select count(*) from public.orders));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007f2","role":"authenticated"}', true);
do $$
begin
  -- expect: 2 / 2
  insert into r(check_name,outcome) values ('B8 chef two sees both kitchens',
    (select count(*) from public.kitchen_tickets where order_id = (select v::uuid from ctx where k = 'A'))::text
    || ' / ' || (select count(*) from public.kitchen_ticket_lines l join public.kitchen_tickets t on t.id = l.ticket_id
                 where t.order_id = (select v::uuid from ctx where k = 'A')));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007c1","role":"authenticated"}', true);
do $$
begin
  -- expect: 2
  insert into r(check_name,outcome) values ('B9 counter staff see every kitchen',
    (select count(*) from public.kitchen_tickets where order_id = (select v::uuid from ctx where k = 'A'))::text);
end $$;
```

- [ ] **Step 2: Run the checks to verify they fail**

Build and run.
Expected: `B1 … => confirmed / ` with an empty ticket list (a NULL outcome), because confirmation does not build tickets yet. Other B checks show `NULL` or wrong values.

- [ ] **Step 3: Append ticket building and the new `confirm_locked`**

Append to the migration:

```sql
-- ---------------------------------------------------------------------------
-- Ticket building
-- ---------------------------------------------------------------------------

-- Replaces a ticket's lines with the order's current made-to-order lines for its kitchen.
create function private.fill_ticket_lines(p_ticket_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.kitchen_ticket_lines where ticket_id = p_ticket_id;
  insert into public.kitchen_ticket_lines (
    ticket_id, order_item_id, line_no, product_name, variant_name, quantity,
    is_veg, contains_egg, is_eggless, allergens, notes, lead_time_minutes)
  select t.id, oi.id, oi.line_no, oi.product_name, oi.variant_name, oi.quantity - oi.cancelled_quantity,
         oi.is_veg, oi.contains_egg, oi.is_eggless, oi.allergens, oi.notes, oi.lead_time_minutes
  from public.kitchen_tickets t
  join public.order_items oi on oi.order_id = t.order_id and oi.kitchen_id = t.kitchen_id
  where t.id = p_ticket_id and oi.prep_type = 'made_to_order' and oi.quantity > oi.cancelled_quantity;
$$;

-- What one kitchen should see of an order, in the same shape as its ticket lines, to detect changes.
create function private.ticket_signature(p_order_id uuid, p_kitchen_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_array(oi.id, oi.product_name, oi.variant_name,
                                              oi.quantity - oi.cancelled_quantity, oi.notes) order by oi.line_no), '[]')
  from public.order_items oi
  where oi.order_id = p_order_id and oi.kitchen_id = p_kitchen_id
    and oi.prep_type = 'made_to_order' and oi.quantity > oi.cancelled_quantity
$$;

-- Creates or refreshes the order's tickets: one per kitchen with active made-to-order lines.
-- Unchanged tickets are left alone; changed or reopened ones get revision + 1; kitchens that no
-- longer have lines are cancelled (a stop-work notice). Callers must have checked that no ticket is
-- past New (private.kitchen_guard) before an order edit. Returns the number of existing tickets
-- revised or cancelled (0 on a first build).
create function private.build_tickets(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  k record;
  t public.kitchen_tickets;
  current_lines jsonb;
  changed integer := 0;
  dropped integer;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then
    perform private.fail('Order not found.', 'not_found');
  end if;

  for k in
    select oi.kitchen_id, kc.code, max(oi.lead_time_minutes) as lead
    from public.order_items oi
    join public.kitchens kc on kc.id = oi.kitchen_id
    where oi.order_id = o.id and oi.prep_type = 'made_to_order' and oi.quantity > oi.cancelled_quantity
    group by oi.kitchen_id, kc.code
  loop
    select * into t from public.kitchen_tickets where order_id = o.id and kitchen_id = k.kitchen_id for update;
    if not found then
      insert into public.kitchen_tickets (order_id, kitchen_id, reference, source, due_at, start_by)
      values (o.id, k.kitchen_id, o.reference || '-' || k.code, o.source, o.due_at,
              o.due_at - make_interval(mins => k.lead))
      returning * into t;
      perform private.fill_ticket_lines(t.id);
    else
      select coalesce(jsonb_agg(jsonb_build_array(l.order_item_id, l.product_name, l.variant_name, l.quantity, l.notes)
                                order by l.line_no), '[]')
      into current_lines
      from public.kitchen_ticket_lines l where l.ticket_id = t.id;
      if t.status = 'cancelled' or t.due_at is distinct from o.due_at
         or current_lines is distinct from private.ticket_signature(o.id, k.kitchen_id) then
        perform private.fill_ticket_lines(t.id);
        update public.kitchen_tickets
        set status = 'new', revision = revision + 1, revised_at = now(),
            due_at = o.due_at, start_by = o.due_at - make_interval(mins => k.lead),
            acknowledged_at = null, acknowledged_by = null, started_at = null, started_by = null,
            ready_at = null, ready_by = null, cancelled_at = null, cancel_reason = null,
            stop_work_acknowledged_at = null, stop_work_acknowledged_by = null
        where id = t.id;
        changed := changed + 1;
      end if;
    end if;
  end loop;

  -- Kitchens with no active lines left: stop their work. Their lines stay as a record.
  -- (Alias kt, not t: t is a variable here.)
  update public.kitchen_ticket_lines l
  set status = 'cancelled'
  from public.kitchen_tickets kt
  where l.ticket_id = kt.id and kt.order_id = o.id and kt.status <> 'cancelled'
    and not exists (select 1 from public.order_items oi
                    where oi.order_id = o.id and oi.kitchen_id = kt.kitchen_id
                      and oi.prep_type = 'made_to_order' and oi.quantity > oi.cancelled_quantity);
  update public.kitchen_tickets kt
  set status = 'cancelled', cancelled_at = now(), cancel_reason = 'Removed from the order'
  where kt.order_id = o.id and kt.status <> 'cancelled'
    and not exists (select 1 from public.order_items oi
                    where oi.order_id = o.id and oi.kitchen_id = kt.kitchen_id
                      and oi.prep_type = 'made_to_order' and oi.quantity > oi.cancelled_quantity);
  get diagnostics dropped = row_count;
  return changed + dropped;
end;
$$;

revoke execute on function
  private.fill_ticket_lines(uuid),
  private.ticket_signature(uuid, uuid),
  private.build_tickets(uuid)
  from public;
```

Then generate the replaced `private.confirm_locked` from its latest definition (migration `20260927000410`) and append it. Run from the repo root:

```bash
cd "/c/Users/SANDY/Desktop/auri bakery"
python - <<'EOF'
from pathlib import Path
src = Path("supabase/migrations/20260927000410_capacity_enforcement.sql").read_text(encoding="utf-8")
header = "create or replace function private.confirm_locked("
i = src.rindex(header)
body = src[i:src.index("\n$$;", i) + len("\n$$;")]
anchor = "  returning * into result;\n"
assert body.count(anchor) == 1
body = body.replace(anchor, anchor + "\n  perform private.build_tickets(result.id); -- 5A: tickets on confirmation\n")
out = Path("supabase/migrations/20260930000300_kitchen_tickets.sql")
out.write_text(out.read_text(encoding="utf-8") + "\n-- Confirming now creates the kitchen tickets (5A).\n" + body + "\n", encoding="utf-8")
EOF
grep -n "build_tickets(result.id)" supabase/migrations/20260930000300_kitchen_tickets.sql
```

Expected: one matching line.

- [ ] **Step 4: Run the checks to verify they pass**

Build and run.
Expected (S1 to S3 unchanged):
```
B1 confirming creates one ticket per kitchen => confirmed / B-990201-TK1, B-990201-TK2
B2 lines per kitchen; ready-stock left out => B-990201-TK1: 2×T Kt Cake (Happy Birthday) {milk} | B-990201-TK2: 3×T Kt Bread {}
B3 start by is pickup minus the longest lead time => true / true
B4 first build is revision 1, not revised => new r1 null / new r1 null
B5 ready-stock-only order gets no ticket => confirmed / 0
B6 progress row => 2 / 0 / false / 0 / 0
B7 chef one sees only kitchen one, and no orders => B-990201-TK1 / 0
B8 chef two sees both kitchens => 2 / 2
B9 counter staff see every kitchen => 2
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260930000300_kitchen_tickets.sql supabase/tests/kitchen_logic.sql
git commit -m "Kitchen: build tickets per kitchen when an order is confirmed

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Chef actions and issues

**Files:**
- Modify: `supabase/migrations/20260930000300_kitchen_tickets.sql` (append)
- Modify: `supabase/tests/kitchen_logic.sql` (insert above `reset role;`)

**Interfaces:**
- Consumes: Task 1 tables, Task 2 tickets.
- Produces (public, `security definer`, granted to `authenticated`):
  - `acknowledge_ticket(p_ticket_id uuid, p_reason text default null) returns kitchen_tickets`
  - `start_ticket(p_ticket_id uuid, p_reason text default null) returns kitchen_tickets`
  - `set_line_ready(p_line_id uuid, p_ready_quantity integer, p_reason text default null) returns kitchen_tickets`
  - `report_issue(p_ticket_id uuid, p_kind text, p_note text, p_line_id uuid default null) returns kitchen_issues`
  - `resolve_issue(p_issue_id uuid, p_resolution text) returns kitchen_issues`
  - `acknowledge_stop_work(p_ticket_id uuid, p_reason text default null) returns kitchen_tickets`
  - `record_ticket_print(p_ticket_id uuid) returns integer`
- Produces (private): `lock_ticket(uuid)`, `ticket_actor(uuid, text) returns text` ('chef' or 'admin'), `log_ticket_event(kitchen_tickets, text, text, jsonb)`, `start_ticket_locked(kitchen_tickets, text)`, `sync_ticket(uuid)`.
- Timeline event types: `ticket_acknowledged`, `ticket_started`, `ticket_ready`, `ready_count_corrected` (data `line`, `from`, `to`), `kitchen_issue_reported` / `kitchen_issue_resolved` (data `kind`, `note`), `stop_work_acknowledged`. Every event's data has `ticket` (reference) and `kitchen` (name).

- [ ] **Step 1: Add the failing action checks**

Insert above `reset role;`:

```sql
-- ===== Chef actions and issues (Task 3) =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007f1","role":"authenticated"}', true);
do $$
declare
  t public.kitchen_tickets; t2 public.kitchen_tickets; h text; n integer;
  a1 uuid := (select v::uuid from ctx where k = 'A1');
  a2 uuid := (select v::uuid from ctx where k = 'A2');
  cake uuid := (select v::uuid from ctx where k = 'A1cake');
begin
  t := public.acknowledge_ticket(a1);
  t2 := public.acknowledge_ticket(a1);
  -- expect: acknowledged / true
  insert into r(check_name,outcome) values ('C1 acknowledging twice changes nothing',
    t2.status::text || ' / ' || (t2.acknowledged_at = t.acknowledged_at)::text);

  begin perform public.start_ticket(a2);
    insert into r(check_name,outcome) values ('C2 chef cannot act on another kitchen', 'ALLOWED');
  -- expect: forbidden: This ticket belongs to a kitchen you are not assigned to.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C2 chef cannot act on another kitchen', h || ': ' || sqlerrm); end;

  t := public.set_line_ready(cake, 1);
  -- expect: preparing / preparing
  insert into r(check_name,outcome) values ('C3 part ready starts the ticket',
    (select status::text from public.kitchen_ticket_lines where id = cake) || ' / ' || t.status);
  t := public.set_line_ready(cake, 2);
  -- expect: ready / ready
  insert into r(check_name,outcome) values ('C4 full count makes line and ticket ready',
    (select status::text from public.kitchen_ticket_lines where id = cake) || ' / ' || t.status);
  t := public.set_line_ready(cake, 1);
  -- expect: preparing / preparing / null
  insert into r(check_name,outcome) values ('C5 lowering the count drops back to preparing',
    (select status::text from public.kitchen_ticket_lines where id = cake) || ' / ' || t.status || ' / ' || coalesce(t.ready_at::text, 'null'));

  begin perform public.set_line_ready(cake, 5);
    insert into r(check_name,outcome) values ('C6 ready count above the quantity refused', 'ALLOWED');
  -- expect: validation: Enter a ready count from 0 to 2.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C6 ready count above the quantity refused', h || ': ' || sqlerrm); end;
  t2 := public.set_line_ready(cake, 1);
  -- expect: true
  insert into r(check_name,outcome) values ('C6b same count again changes nothing', (t2.updated_at = t.updated_at)::text);

  perform public.report_issue(a1, 'ingredient', ' Out of cream ', cake);
  begin perform public.report_issue(a1, 'other', 'x');
    insert into r(check_name,outcome) values ('C7 issue note too short', 'ALLOWED');
  -- expect: validation: Describe the issue in at least 3 characters.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C7 issue note too short', h || ': ' || sqlerrm); end;
  begin perform public.resolve_issue((select id from public.kitchen_issues where ticket_id = a1), 'Fixed it');
    insert into r(check_name,outcome) values ('C8 chef cannot resolve issues', 'ALLOWED');
  -- expect: forbidden: Only an admin can resolve kitchen issues.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C8 chef cannot resolve issues', h || ': ' || sqlerrm); end;

  n := public.record_ticket_print(a1);
  n := public.record_ticket_print(a1);
  -- expect: 2
  insert into r(check_name,outcome) values ('C9 prints are counted', n::text);
  begin perform public.record_ticket_print(a2);
    insert into r(check_name,outcome) values ('C10 chef cannot print another kitchen''s ticket', 'ALLOWED');
  -- expect: forbidden: This ticket belongs to a kitchen you are not assigned to.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C10 chef cannot print another kitchen''s ticket', h || ': ' || sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007f2","role":"authenticated"}', true);
do $$
declare t public.kitchen_tickets;
begin
  t := public.set_line_ready((select v::uuid from ctx where k = 'A2bread'), 3);
  -- expect: ready
  insert into r(check_name,outcome) values ('C11 chef two finishes kitchen two in one tap', t.status::text);
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007c1","role":"authenticated"}', true);
do $$
declare h text; a1 uuid := (select v::uuid from ctx where k = 'A1');
begin
  begin perform public.start_ticket(a1);
    insert into r(check_name,outcome) values ('C12 counter staff cannot act on tickets', 'ALLOWED');
  -- expect: forbidden: Only the kitchen can update tickets.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C12 counter staff cannot act on tickets', h || ': ' || sqlerrm); end;
  begin perform public.report_issue(a1, 'other', 'Counter note');
    insert into r(check_name,outcome) values ('C13 counter staff cannot report issues', 'ALLOWED');
  -- expect: forbidden: Only the kitchen can update tickets.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C13 counter staff cannot report issues', h || ': ' || sqlerrm); end;
  -- expect: false / 1
  insert into r(check_name,outcome) values ('C14 progress while kitchen one is short',
    (select all_ready || ' / ' || open_issues from public.order_kitchen_progress where order_id = (select v::uuid from ctx where k = 'A')));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007f1","role":"authenticated"}', true);
do $$
begin
  perform public.set_line_ready((select v::uuid from ctx where k = 'A1cake'), 2);
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
do $$
declare h text; a uuid := (select v::uuid from ctx where k = 'A'); a2 uuid := (select v::uuid from ctx where k = 'A2');
begin
  -- expect: true / preparing v3 / 1
  insert into r(check_name,outcome) values ('C15 all kitchens ready; order stays preparing',
    (select all_ready::text from public.order_kitchen_progress where order_id = a)
    || ' / ' || (select status || ' v' || version from public.orders where id = a)
    || ' / ' || (select count(*) from public.order_events where order_id = a and event_type = 'ready_count_corrected'));
  begin perform public.acknowledge_ticket(a2, 'ok');
    insert into r(check_name,outcome) values ('C16 admin exception needs a reason', 'ALLOWED');
  -- expect: forbidden: Give a reason of at least 5 characters for acting on a kitchen ticket.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('C16 admin exception needs a reason', h || ': ' || sqlerrm); end;
  perform public.resolve_issue((select id from public.kitchen_issues where ticket_id = (select v::uuid from ctx where k = 'A1')), ' Bought more cream ');
  -- expect: 0 / Bought more cream
  insert into r(check_name,outcome) values ('C17 admin resolves the issue',
    (select open_issues::text from public.order_kitchen_progress where order_id = a)
    || ' / ' || (select resolution from public.kitchen_issues where ticket_id = (select v::uuid from ctx where k = 'A1')));
  -- expect: kitchen_issue_reported, kitchen_issue_resolved, ready_count_corrected, ticket_acknowledged, ticket_ready, ticket_started
  insert into r(check_name,outcome) values ('C18 kitchen events in the order timeline',
    (select string_agg(distinct event_type, ', ' order by event_type) from public.order_events
     where order_id = a and event_type not in ('created', 'confirmed')));
  -- expect: B-990201-TK1 / T Kitchen One
  insert into r(check_name,outcome) values ('C19 events name the ticket and kitchen',
    (select data ->> 'ticket' || ' / ' || (data ->> 'kitchen') from public.order_events
     where order_id = a and event_type = 'ticket_acknowledged'));
end $$;
```

- [ ] **Step 2: Run the checks to verify they fail**

Build and run.
Expected: an error such as `function public.acknowledge_ticket(uuid) does not exist`.

- [ ] **Step 3: Append the chef functions**

Append to the migration:

```sql
-- ---------------------------------------------------------------------------
-- Chef actions
-- ---------------------------------------------------------------------------
-- Chef actions take no version number: each states an end result, so a repeat or a double tap
-- changes nothing. Any change to the order's status bumps the order version.

create function private.lock_ticket(p_ticket_id uuid)
returns public.kitchen_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.kitchen_tickets;
begin
  select * into t from public.kitchen_tickets where id = p_ticket_id for update;
  if not found then
    perform private.fail('Ticket not found.', 'not_found');
  end if;
  return t;
end;
$$;

-- 'chef' for a chef assigned to the kitchen; 'admin' for an admin acting as an exception with a
-- reason (at least 5 characters). Refuses everyone else, including counter staff.
create function private.ticket_actor(p_kitchen_id uuid, p_reason text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  role public.staff_role := private.current_staff_role();
  reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if role = 'chef' then
    if not exists (select 1 from public.staff_kitchens sk where sk.user_id = auth.uid() and sk.kitchen_id = p_kitchen_id) then
      perform private.fail('This ticket belongs to a kitchen you are not assigned to.', 'forbidden');
    end if;
    return 'chef';
  end if;
  if role = 'admin' then
    if reason is null or length(reason) < 5 then
      perform private.fail('Give a reason of at least 5 characters for acting on a kitchen ticket.', 'forbidden');
    end if;
    return 'admin';
  end if;
  perform private.fail('Only the kitchen can update tickets.', 'forbidden');
  return null;
end;
$$;

-- Writes an order timeline entry naming the ticket and kitchen.
create function private.log_ticket_event(t public.kitchen_tickets, p_type text, p_reason text default null, p_data jsonb default '{}')
returns void
language sql
security definer
set search_path = ''
as $$
  select private.log_order_event(t.order_id, p_type, nullif(trim(coalesce(p_reason, '')), ''),
    jsonb_build_object('ticket', t.reference, 'kitchen', (select k.name from public.kitchens k where k.id = t.kitchen_id))
    || coalesce(p_data, '{}'))
$$;

-- Starts a locked ticket: acknowledges it if needed, moves pending lines to preparing, and moves a
-- confirmed order to preparing.
create function private.start_ticket_locked(t public.kitchen_tickets, p_reason text)
returns public.kitchen_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.kitchen_tickets;
begin
  update public.kitchen_tickets
  set status = 'preparing',
      acknowledged_at = coalesce(acknowledged_at, now()),
      acknowledged_by = coalesce(acknowledged_by, auth.uid()),
      started_at = now(),
      started_by = auth.uid()
  where id = t.id
  returning * into result;
  update public.kitchen_ticket_lines set status = 'preparing' where ticket_id = t.id and status = 'pending';
  update public.orders set status = 'preparing', version = version + 1 where id = t.order_id and status = 'confirmed';
  perform private.log_ticket_event(result, 'ticket_started', p_reason);
  return result;
end;
$$;

-- Derives the ticket's ready state from its lines. Always touches updated_at so the chef screen's
-- change stamp moves.
create function private.sync_ticket(p_ticket_id uuid)
returns public.kitchen_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.kitchen_tickets;
  all_ready boolean;
begin
  select * into t from public.kitchen_tickets where id = p_ticket_id;
  select coalesce(bool_and(status = 'ready'), false) into all_ready from public.kitchen_ticket_lines where ticket_id = t.id;
  if all_ready and t.status <> 'ready' then
    update public.kitchen_tickets set status = 'ready', ready_at = now(), ready_by = auth.uid()
    where id = t.id returning * into t;
    perform private.log_ticket_event(t, 'ticket_ready');
  elsif not all_ready and t.status = 'ready' then
    update public.kitchen_tickets set status = 'preparing', ready_at = null, ready_by = null
    where id = t.id returning * into t;
  else
    update public.kitchen_tickets set updated_at = now() where id = t.id returning * into t;
  end if;
  return t;
end;
$$;

create function public.acknowledge_ticket(p_ticket_id uuid, p_reason text default null)
returns public.kitchen_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.kitchen_tickets := private.lock_ticket(p_ticket_id);
  actor text := private.ticket_actor(t.kitchen_id, p_reason);
begin
  if t.status = 'cancelled' then
    perform private.fail('This ticket was cancelled. Stop work on it.');
  end if;
  if t.status <> 'new' then
    return t;
  end if;
  update public.kitchen_tickets set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = auth.uid()
  where id = t.id returning * into t;
  perform private.log_ticket_event(t, 'ticket_acknowledged', case when actor = 'admin' then p_reason end);
  return t;
end;
$$;

create function public.start_ticket(p_ticket_id uuid, p_reason text default null)
returns public.kitchen_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.kitchen_tickets := private.lock_ticket(p_ticket_id);
  actor text := private.ticket_actor(t.kitchen_id, p_reason);
begin
  if t.status = 'cancelled' then
    perform private.fail('This ticket was cancelled. Stop work on it.');
  end if;
  if t.status in ('preparing', 'ready') then
    return t;
  end if;
  return private.start_ticket_locked(t, case when actor = 'admin' then p_reason end);
end;
$$;

-- Sets how many of a line are ready (0..quantity). Starting is implied; lowering the count is a
-- recorded correction.
create function public.set_line_ready(p_line_id uuid, p_ready_quantity integer, p_reason text default null)
returns public.kitchen_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  ln public.kitchen_ticket_lines;
  t public.kitchen_tickets;
  actor text;
  admin_reason text;
begin
  select * into ln from public.kitchen_ticket_lines where id = p_line_id;
  if not found then
    perform private.fail('Ticket line not found.', 'not_found');
  end if;
  t := private.lock_ticket(ln.ticket_id);
  actor := private.ticket_actor(t.kitchen_id, p_reason);
  admin_reason := case when actor = 'admin' then p_reason end;
  if t.status = 'cancelled' then
    perform private.fail('This ticket was cancelled. Stop work on it.');
  end if;
  select * into ln from public.kitchen_ticket_lines where id = p_line_id for update;
  if p_ready_quantity is null or p_ready_quantity < 0 or p_ready_quantity > ln.quantity then
    perform private.fail(format('Enter a ready count from 0 to %s.', ln.quantity));
  end if;
  if p_ready_quantity = ln.ready_quantity then
    return t;
  end if;

  if p_ready_quantity > 0 and t.status in ('new', 'acknowledged') then
    t := private.start_ticket_locked(t, admin_reason);
  end if;
  update public.kitchen_ticket_lines
  set ready_quantity = p_ready_quantity,
      status = (case
        when p_ready_quantity = quantity then 'ready'
        when p_ready_quantity > 0 or t.status in ('preparing', 'ready') then 'preparing'
        else 'pending' end)::public.ticket_line_status
  where id = ln.id;
  if p_ready_quantity < ln.ready_quantity then
    perform private.log_ticket_event(t, 'ready_count_corrected', admin_reason,
      jsonb_build_object('line', ln.product_name || ' — ' || ln.variant_name, 'from', ln.ready_quantity, 'to', p_ready_quantity));
  end if;
  return private.sync_ticket(t.id);
end;
$$;

create function public.report_issue(p_ticket_id uuid, p_kind text, p_note text, p_line_id uuid default null)
returns public.kitchen_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.kitchen_tickets := private.lock_ticket(p_ticket_id);
  v_note text := trim(coalesce(p_note, ''));
  i public.kitchen_issues;
begin
  -- Reporting is not an exception, so an admin needs no reason; chefs must be assigned; others are refused.
  if private.current_staff_role() is distinct from 'admin' then
    perform private.ticket_actor(t.kitchen_id, null);
  end if;
  if t.status = 'cancelled' then
    perform private.fail('This ticket was cancelled. Stop work on it.');
  end if;
  if p_line_id is not null and not exists (select 1 from public.kitchen_ticket_lines where id = p_line_id and ticket_id = t.id) then
    perform private.fail('That item is not on this ticket.');
  end if;
  if p_kind is null or p_kind not in ('ingredient', 'equipment', 'quality', 'other') then
    perform private.fail('Choose what kind of issue this is.');
  end if;
  if length(v_note) < 3 then
    perform private.fail('Describe the issue in at least 3 characters.');
  end if;
  if length(v_note) > 500 then
    perform private.fail('Keep the note under 500 characters.');
  end if;

  insert into public.kitchen_issues (ticket_id, line_id, kind, note, reported_by)
  values (t.id, p_line_id, p_kind, v_note, auth.uid())
  returning * into i;
  update public.kitchen_tickets set updated_at = now() where id = t.id;
  perform private.log_ticket_event(t, 'kitchen_issue_reported', null, jsonb_build_object('kind', p_kind, 'note', v_note));
  return i;
end;
$$;

create function public.resolve_issue(p_issue_id uuid, p_resolution text)
returns public.kitchen_issues
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resolution text := trim(coalesce(p_resolution, ''));
  i public.kitchen_issues;
  t public.kitchen_tickets;
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can resolve kitchen issues.', 'forbidden');
  end if;
  if length(v_resolution) < 3 or length(v_resolution) > 500 then
    perform private.fail('Describe how the issue was resolved (3 to 500 characters).');
  end if;
  select * into i from public.kitchen_issues where id = p_issue_id for update;
  if not found then
    perform private.fail('Issue not found.', 'not_found');
  end if;
  if i.resolved_at is not null then
    perform private.fail('This issue is already resolved.');
  end if;

  update public.kitchen_issues
  set resolved_at = now(), resolved_by = auth.uid(), resolution = v_resolution
  where id = i.id
  returning * into i;
  update public.kitchen_tickets set updated_at = now() where id = i.ticket_id returning * into t;
  perform private.log_ticket_event(t, 'kitchen_issue_resolved', v_resolution, jsonb_build_object('kind', i.kind, 'note', i.note));
  return i;
end;
$$;

create function public.acknowledge_stop_work(p_ticket_id uuid, p_reason text default null)
returns public.kitchen_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.kitchen_tickets := private.lock_ticket(p_ticket_id);
  actor text := private.ticket_actor(t.kitchen_id, p_reason);
begin
  if t.status <> 'cancelled' then
    perform private.fail('This ticket is not cancelled.');
  end if;
  if t.stop_work_acknowledged_at is not null then
    return t;
  end if;
  update public.kitchen_tickets set stop_work_acknowledged_at = now(), stop_work_acknowledged_by = auth.uid()
  where id = t.id returning * into t;
  perform private.log_ticket_event(t, 'stop_work_acknowledged', case when actor = 'admin' then p_reason end);
  return t;
end;
$$;

-- Counts prints so reprints are labelled COPY. Chefs of the kitchen, admin, and counter may print.
create function public.record_ticket_print(p_ticket_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.kitchen_tickets := private.lock_ticket(p_ticket_id);
  n integer;
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.ticket_actor(t.kitchen_id, null);
  end if;
  update public.kitchen_tickets set print_count = print_count + 1 where id = t.id returning print_count into n;
  return n;
end;
$$;

revoke execute on function
  private.lock_ticket(uuid),
  private.ticket_actor(uuid, text),
  private.log_ticket_event(public.kitchen_tickets, text, text, jsonb),
  private.start_ticket_locked(public.kitchen_tickets, text),
  private.sync_ticket(uuid)
  from public;
revoke execute on function
  public.acknowledge_ticket(uuid, text),
  public.start_ticket(uuid, text),
  public.set_line_ready(uuid, integer, text),
  public.report_issue(uuid, text, text, uuid),
  public.resolve_issue(uuid, text),
  public.acknowledge_stop_work(uuid, text),
  public.record_ticket_print(uuid)
  from public, anon;
grant execute on function
  public.acknowledge_ticket(uuid, text),
  public.start_ticket(uuid, text),
  public.set_line_ready(uuid, integer, text),
  public.report_issue(uuid, text, text, uuid),
  public.resolve_issue(uuid, text),
  public.acknowledge_stop_work(uuid, text),
  public.record_ticket_print(uuid)
  to authenticated;
```

Note: variables that share a name with a column they touch (`note`, `resolution`) are prefixed `v_`, and table aliases never reuse a variable name. PL/pgSQL rejects such clashes as ambiguous. Keep to this if you change these functions.

- [ ] **Step 4: Run the checks to verify they pass**

Build and run.
Expected (S and B unchanged):
```
C1 acknowledging twice changes nothing => acknowledged / true
C2 chef cannot act on another kitchen => forbidden: This ticket belongs to a kitchen you are not assigned to.
C3 part ready starts the ticket => preparing / preparing
C4 full count makes line and ticket ready => ready / ready
C5 lowering the count drops back to preparing => preparing / preparing / null
C6 ready count above the quantity refused => validation: Enter a ready count from 0 to 2.
C6b same count again changes nothing => true
C7 issue note too short => validation: Describe the issue in at least 3 characters.
C8 chef cannot resolve issues => forbidden: Only an admin can resolve kitchen issues.
C9 prints are counted => 2
C10 chef cannot print another kitchen's ticket => forbidden: This ticket belongs to a kitchen you are not assigned to.
C11 chef two finishes kitchen two in one tap => ready
C12 counter staff cannot act on tickets => forbidden: Only the kitchen can update tickets.
C13 counter staff cannot report issues => forbidden: Only the kitchen can update tickets.
C14 progress while kitchen one is short => false / 1
C15 all kitchens ready; order stays preparing => true / preparing v3 / 1
C16 admin exception needs a reason => forbidden: Give a reason of at least 5 characters for acting on a kitchen ticket.
C17 admin resolves the issue => 0 / Bought more cream
C18 kitchen events in the order timeline => kitchen_issue_reported, kitchen_issue_resolved, ready_count_corrected, ticket_acknowledged, ticket_ready, ticket_started
C19 events name the ticket and kitchen => B-990201-TK1 / T Kitchen One
```

Note: C6b compares `updated_at` within one transaction, where `now()` does not change; it passes because the repeat returns early without writing. If it prints `true` even with the early return removed, that check is too weak. Then compare `(select count(*) from public.audit_events where table_name = 'kitchen_ticket_lines')` before and after instead (check the audit table's column names in `20260927000100_foundation.sql`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260930000300_kitchen_tickets.sql supabase/tests/kitchen_logic.sql
git commit -m "Kitchen: chef actions, ready counts, issues, stop-work, print count

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Order changes, cancellation, backfill

**Files:**
- Modify: `supabase/migrations/20260930000300_kitchen_tickets.sql` (append)
- Modify: `supabase/tests/kitchen_logic.sql` (insert above `reset role;`)

**Interfaces:**
- Consumes: `private.build_tickets` (Task 2).
- Produces: `private.kitchen_guard(p_order_id uuid) returns void`, which raises kind `kitchen`. Replaced `public.update_order_items`, `public.reschedule_order` and `public.cancel_order`, with the same signatures as today. New timeline event `tickets_revised` (data `cause`: `items_changed` or `rescheduled`).

- [ ] **Step 1: Add the failing order-change checks**

Insert above `reset role;`:

```sql
-- ===== Order changes and cancellation (Task 4) =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
do $$
declare
  o public.orders;
  e uuid := (select v::uuid from ctx where k = 'E');
  cake_line uuid := (select id from public.order_items where order_id = (select v::uuid from ctx where k = 'E') and product_name = 'T Kt Cake');
begin
  o := public.confirm_order(e, 1);                                               -- version 2
  -- expect: new, new
  insert into r(check_name,outcome) values ('D1 edit order starts with two new tickets',
    (select string_agg(status::text, ', ' order by reference) from public.kitchen_tickets where order_id = e));

  o := public.update_order_items(e, 2, jsonb_build_array(jsonb_build_object('line_id', cake_line, 'quantity', 2)),
         'Two cakes, no bread');                                                 -- version 3
  -- expect: TK1 new r2 revised | TK2 cancelled r1 Removed from the order / 1 / 1
  insert into r(check_name,outcome) values ('D2 edit rebuilds kitchen one and stops kitchen two',
    (select string_agg(right(reference, 3) || ' ' || status || ' r' || revision
                       || coalesce(' ' || cancel_reason, case when revised_at is not null then ' revised' else '' end),
                       ' | ' order by reference)
     from public.kitchen_tickets where order_id = e)
    || ' / ' || (select stop_work_pending from public.order_kitchen_progress where order_id = e)
    || ' / ' || (select count(*) from public.order_events where order_id = e and event_type = 'tickets_revised'));
  -- expect: 1 cancelled T Kt Bread
  insert into r(check_name,outcome) values ('D3 stop-work ticket keeps the removed line',
    (select count(*) || ' ' || min(l.status::text) || ' ' || min(l.product_name)
     from public.kitchen_ticket_lines l join public.kitchen_tickets t on t.id = l.ticket_id
     where t.order_id = e and t.reference like '%-TK2'));

  o := public.update_order_items(e, 3, jsonb_build_array(
         jsonb_build_object('line_id', cake_line, 'quantity', 2),
         jsonb_build_object('variant_id', (select v from ctx where k = 'bread'), 'quantity', 1)), 'Bread back on');  -- version 4
  -- expect: TK1 new r2 | TK2 new r2 / 1 line
  insert into r(check_name,outcome) values ('D4 re-adding a kitchen reopens its ticket; unchanged ticket untouched',
    (select string_agg(right(reference, 3) || ' ' || status || ' r' || revision, ' | ' order by reference)
     from public.kitchen_tickets where order_id = e)
    || ' / ' || (select count(*) from public.kitchen_ticket_lines l join public.kitchen_tickets t on t.id = l.ticket_id
                 where t.order_id = e and t.reference like '%-TK2') || ' line');

  o := public.reschedule_order(e, 4, pg_temp.day(4), 'Customer moved the pickup');  -- version 5
  -- expect: r3, r3 / true
  insert into r(check_name,outcome) values ('D5 reschedule revises every ticket',
    (select string_agg('r' || revision, ', ' order by reference) from public.kitchen_tickets where order_id = e)
    || ' / ' || (select bool_and(due_at = o.due_at)::text from public.kitchen_tickets where order_id = e));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007f1","role":"authenticated"}', true);
do $$
begin
  perform public.acknowledge_ticket((select id from public.kitchen_tickets
    where order_id = (select v::uuid from ctx where k = 'E') and reference like '%-TK1'));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
do $$
declare
  o public.orders; h text;
  e uuid := (select v::uuid from ctx where k = 'E');
  cake_line uuid := (select id from public.order_items where order_id = (select v::uuid from ctx where k = 'E') and product_name = 'T Kt Cake');
begin
  begin perform public.update_order_items(e, 5, jsonb_build_array(jsonb_build_object('line_id', cake_line, 'quantity', 3)), 'One more cake');
    insert into r(check_name,outcome) values ('D6 edit refused once the kitchen acknowledged', 'ALLOWED');
  -- expect: kitchen: The kitchen has already acknowledged this order. Cancel it and create a new one, or wait for kitchen revisions.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('D6 edit refused once the kitchen acknowledged', h || ': ' || sqlerrm); end;
  begin perform public.reschedule_order(e, 5, pg_temp.day(5), 'Later again');
    insert into r(check_name,outcome) values ('D7 reschedule refused once the kitchen acknowledged', 'ALLOWED');
  -- expect: kitchen: The kitchen has already acknowledged this order. Cancel it and create a new one, or wait for kitchen revisions.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('D7 reschedule refused once the kitchen acknowledged', h || ': ' || sqlerrm); end;

  o := public.cancel_order(e, 5, 'Customer cancelled');
  -- expect: cancelled, cancelled / 2 / cancelled, cancelled / Customer cancelled
  insert into r(check_name,outcome) values ('D8 cancelling raises stop-work on every ticket',
    (select string_agg(status::text, ', ' order by reference) from public.kitchen_tickets where order_id = e)
    || ' / ' || (select stop_work_pending from public.order_kitchen_progress where order_id = e)
    || ' / ' || (select string_agg(l.status::text, ', ' order by t.reference) from public.kitchen_ticket_lines l
                 join public.kitchen_tickets t on t.id = l.ticket_id where t.order_id = e)
    || ' / ' || (select min(cancel_reason) from public.kitchen_tickets where order_id = e));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007f1","role":"authenticated"}', true);
do $$
declare
  h text; t public.kitchen_tickets;
  tk1 uuid := (select id from public.kitchen_tickets where order_id = (select v::uuid from ctx where k = 'E') and reference like '%-TK1');
begin
  begin perform public.start_ticket(tk1);
    insert into r(check_name,outcome) values ('D9 no work on a cancelled ticket', 'ALLOWED');
  -- expect: validation: This ticket was cancelled. Stop work on it.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('D9 no work on a cancelled ticket', h || ': ' || sqlerrm); end;
  t := public.acknowledge_stop_work(tk1);
  -- expect: true
  insert into r(check_name,outcome) values ('D10 chef acknowledges the stop-work', (t.stop_work_acknowledged_at is not null)::text);
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007a1","role":"authenticated"}', true);
do $$
begin
  -- expect: 1
  insert into r(check_name,outcome) values ('D11 one stop-work still pending',
    (select stop_work_pending::text from public.order_kitchen_progress where order_id = (select v::uuid from ctx where k = 'E')));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000007c1","role":"authenticated"}', true);
do $$
declare o public.orders; q uuid := (select v::uuid from ctx where k = 'Q');
begin
  o := public.update_order_items(q, 1, jsonb_build_array(
         jsonb_build_object('line_id', (select id from public.order_items where order_id = q), 'quantity', 2)));
  -- expect: pending_confirmation / 0
  insert into r(check_name,outcome) values ('D12 pending orders have no tickets and edit as before',
    o.status::text || ' / ' || (select count(*) from public.kitchen_tickets where order_id = q));
end $$;
```

- [ ] **Step 2: Run the checks to verify they fail**

Build and run.
Expected: D2 shows `TK1 new r1 | TK2 new r1 / 0 / 0` (no rebuild yet), D6 and D7 show `ALLOWED`, and D8 shows tickets still `new`.

- [ ] **Step 3: Append the guard, the replaced order functions, and the backfill**

Append to the migration:

```sql
-- ---------------------------------------------------------------------------
-- Order changes (5A holding measure until kitchen revisions in 5C)
-- ---------------------------------------------------------------------------

-- Refuses item edits and reschedules once any live ticket is past New.
create function private.kitchen_guard(p_order_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.kitchen_tickets where order_id = p_order_id and status not in ('new', 'cancelled')) then
    perform private.fail('The kitchen has already acknowledged this order. Cancel it and create a new one, or wait for kitchen revisions.', 'kitchen');
  end if;
end;
$$;

revoke execute on function private.kitchen_guard(uuid) from public;
```

Then generate the three replaced functions from their latest definitions and append them, followed by the backfill. Run from the repo root:

```bash
cd "/c/Users/SANDY/Desktop/auri bakery"
python - <<'EOF'
from pathlib import Path

MIG = Path("supabase/migrations")

def latest(file, header):
    src = (MIG / file).read_text(encoding="utf-8")
    i = src.rindex(header)
    return src[i:src.index("\n$$;", i) + len("\n$$;")]

def insert(body, anchor, text, before=False, last=False):
    if not last:
        assert body.count(anchor) == 1, (anchor, body.count(anchor))
    k = body.rindex(anchor) if last else body.index(anchor)
    pos = k if before else k + len(anchor)
    return body[:pos] + text + body[pos:]

guard = "  if o.status = 'confirmed' then -- 5A\n    perform private.kitchen_guard(o.id);\n  end if;\n"

def rebuild(cause):
    return (f"  if o.status = 'confirmed' and private.build_tickets(o.id) > 0 then -- 5A\n"
            f"    perform private.log_order_event(o.id, 'tickets_revised', null, jsonb_build_object('cause', '{cause}'));\n"
            f"  end if;\n")

items = latest("20260930000200_edit_order_items.sql", "create function public.update_order_items(")
items = items.replace("create function public.update_order_items(", "create or replace function public.update_order_items(", 1)
items = insert(items, "  if exists (select 1 from public.bills where order_id = o.id) then\n", guard, before=True)
items = insert(items, "  return o;\nend;", rebuild("items_changed"), before=True, last=True)

resched = latest("20260927000410_capacity_enforcement.sql", "create or replace function public.reschedule_order(")
resched = insert(resched, "    perform private.fail('Only orders that have not started preparation can be rescheduled here.');\n  end if;\n", guard)
resched = insert(resched, "  return o;\nend;", rebuild("rescheduled"), before=True, last=True)

cancel = latest("20260927000300_billing.sql", "create or replace function public.cancel_order(")
cancel = insert(cancel, "  perform private.log_order_event(o.id, 'cancelled', reason);\n",
    "  -- 5A: stop kitchen work; ready counts stay on the lines as a record.\n"
    "  update public.kitchen_ticket_lines l set status = 'cancelled'\n"
    "  from public.kitchen_tickets t\n"
    "  where l.ticket_id = t.id and t.order_id = o.id and t.status <> 'cancelled';\n"
    "  update public.kitchen_tickets\n"
    "  set status = 'cancelled', cancelled_at = now(), cancel_reason = reason\n"
    "  where order_id = o.id and status <> 'cancelled';\n")

backfill = """
-- ---------------------------------------------------------------------------
-- Backfill: tickets for confirmed or preparing orders that have none (the live database has no
-- orders today; this is a safety net).
-- ---------------------------------------------------------------------------
select private.build_tickets(o.id)
from public.orders o
where o.status in ('confirmed', 'preparing')
  and not exists (select 1 from public.kitchen_tickets t where t.order_id = o.id);
"""

out = MIG / "20260930000300_kitchen_tickets.sql"
out.write_text(out.read_text(encoding="utf-8")
    + "\n-- Item edits on confirmed orders: refused once the kitchen acknowledged; otherwise tickets are rebuilt.\n" + items + "\n"
    + "\n-- Reschedules: same rule as item edits.\n" + resched + "\n"
    + "\n-- Cancelling stops kitchen work.\n" + cancel + "\n"
    + backfill, encoding="utf-8")
EOF
grep -c "5A" supabase/migrations/20260930000300_kitchen_tickets.sql
```

Expected: the count includes the five new `-- 5A` markers (two guards, two rebuilds, one cancel block) plus the one from Task 2.

- [ ] **Step 4: Run the checks to verify they pass**

Build and run.
Expected (earlier checks unchanged):
```
D1 edit order starts with two new tickets => new, new
D2 edit rebuilds kitchen one and stops kitchen two => TK1 new r2 revised | TK2 cancelled r1 Removed from the order / 1 / 1
D3 stop-work ticket keeps the removed line => 1 cancelled T Kt Bread
D4 re-adding a kitchen reopens its ticket; unchanged ticket untouched => TK1 new r2 | TK2 new r2 / 1 line
D5 reschedule revises every ticket => r3, r3 / true
D6 edit refused once the kitchen acknowledged => kitchen: The kitchen has already acknowledged this order. Cancel it and create a new one, or wait for kitchen revisions.
D7 reschedule refused once the kitchen acknowledged => kitchen: The kitchen has already acknowledged this order. Cancel it and create a new one, or wait for kitchen revisions.
D8 cancelling raises stop-work on every ticket => cancelled, cancelled / 2 / cancelled, cancelled / Customer cancelled
D9 no work on a cancelled ticket => validation: This ticket was cancelled. Stop work on it.
D10 chef acknowledges the stop-work => true
D11 one stop-work still pending => 1
D12 pending orders have no tickets and edit as before => pending_confirmation / 0
```

- [ ] **Step 5: Re-run the existing SQL test files with the migration prepended**

For each of `orders_logic.sql`, `billing_logic.sql`, `capacity_logic.sql`, `no_show_logic.sql` and `edit_items_logic.sql`, build a run file the same way, with `tests/kitchen_logic.sql` replaced by that file:

```bash
cd "/c/Users/SANDY/Desktop/auri bakery/supabase"
for f in orders_logic billing_logic capacity_logic no_show_logic edit_items_logic; do
  { echo "begin;"; cat migrations/20260930000300_kitchen_tickets.sql
    sed '1,/^begin;$/d' "tests/$f.sql" | sed '/^reset role;$/,$d'
    echo "reset role;"
    echo "do \$\$ begin raise exception E'RESULTS\\n%', (select string_agg(check_name || ' => ' || coalesce(outcome,'NULL'), E'\\n' order by n) from r); end \$\$;"
  } > "$TMPDIR/${f}_run.sql"
done
```

Run each through `execute_sql`, and compare every outcome with the file's `-- expect:` comments. If a file keeps its results somewhere other than table `r`, adapt the final `raise` to that file's result query.

Any difference must be explained by tickets now existing. For example, a timeline listing on a rescheduled confirmed order now includes `tickets_revised`. Update that file's `-- expect:` comment and note it in the commit. Any other difference is a bug in this migration: fix it before continuing.

Note: `orders_logic.sql` and `capacity_logic.sql` consume `order_number_seq` (sequences are not transactional). That was already true before this plan.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260930000300_kitchen_tickets.sql supabase/tests/
git commit -m "Kitchen: rebuild tickets on edits while new, refuse after acknowledgement, stop-work on cancel

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Apply the migration; types and the queue helper

**Files:**
- Modify: `web/src/lib/database.types.ts`
- Create: `web/src/lib/kitchen.ts`
- Create: `web/src/lib/kitchen.test.ts`
- Create: `web/src/lib/kitchen-data.ts`

**Interfaces:**
- Consumes: the complete migration from Tasks 1 to 4.
- Produces:
  - `web/src/lib/kitchen.ts`:
    - types `TicketStatus`, `TicketLineStatus`, `IssueKind`, `KitchenTicketLine`, `KitchenIssue`, `KitchenTicket`, `QueueGroup<T>`;
    - `ticketStatusLabel`, `ticketStatusTone`, `issueKindLabel`, `ADMIN_KITCHEN_REASON_MIN`;
    - `groupQueue(tickets, { now, todayKey, tomorrowKey, dayKeyOf })`.
  - `web/src/lib/kitchen-data.ts`: `ticketsQuery(supabase)`, `toKitchenTickets(rows)`, `ticketStamp(supabase): Promise<string>`.

- [ ] **Step 1: Apply the migration**

Use `apply_migration` with name `kitchen_tickets` and the full content of `supabase/migrations/20260930000300_kitchen_tickets.sql`. Then run `list_migrations` and confirm the last entry is `kitchen_tickets`.

- [ ] **Step 2: Re-run the kitchen checks against the applied schema**

Build the run file without the `cat migrations/…` line and run it. Expected: every S, B, C and D outcome as listed in Tasks 1 to 4.

Then check nothing was left behind:

```sql
select (select count(*) from public.orders) orders, (select count(*) from public.kitchen_tickets) tickets;
```

Expected: `0 | 0`.

- [ ] **Step 3: Run the advisors**

Run `get_advisors` for `security` and for `performance`.
- **Expected:** only the known findings:
  - `authenticated_security_definer_function_executable` (now including the 7 new public functions; intentional, each checks the role);
  - unused indexes;
  - `document_sequences` with no policy;
  - leaked-password protection.
- **Fix anything new**, such as an unindexed foreign key on a new table, and append the fix to the migration file, applying it as `kitchen_tickets_fixes`.

- [ ] **Step 4: Add the types**

In `web/src/lib/database.types.ts`:

(a) After the `type RpcReturnsOrder = { … }` block, add:

```ts
type KitchenTicketRow = {
  acknowledged_at: string | null
  acknowledged_by: string | null
  cancel_reason: string | null
  cancelled_at: string | null
  created_at: string
  due_at: string
  id: string
  kitchen_id: string
  order_id: string
  print_count: number
  ready_at: string | null
  ready_by: string | null
  reference: string
  revised_at: string | null
  revision: number
  source: Database["public"]["Enums"]["order_source"]
  start_by: string
  started_at: string | null
  started_by: string | null
  status: Database["public"]["Enums"]["ticket_status"]
  stop_work_acknowledged_at: string | null
  stop_work_acknowledged_by: string | null
  updated_at: string
}

type KitchenIssueRow = {
  id: string
  kind: string
  line_id: string | null
  note: string
  reported_at: string
  reported_by: string | null
  resolution: string | null
  resolved_at: string | null
  resolved_by: string | null
  ticket_id: string
}

type RpcReturnsTicket = {
  Returns: KitchenTicketRow
  SetofOptions: { from: "*"; to: "kitchen_tickets"; isOneToOne: true; isSetofReturn: false }
}

type RpcReturnsIssue = {
  Returns: KitchenIssueRow
  SetofOptions: { from: "*"; to: "kitchen_issues"; isOneToOne: true; isSetofReturn: false }
}
```

(b) In `Tables`, immediately before `      kitchens: {`, add:

```ts
      kitchen_issues: {
        Row: KitchenIssueRow
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "kitchen_issues_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "kitchen_ticket_lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_issues_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "kitchen_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_ticket_lines: {
        Row: {
          allergens: string[]
          contains_egg: boolean
          id: string
          is_eggless: boolean
          is_veg: boolean
          lead_time_minutes: number
          line_no: number
          notes: string | null
          order_item_id: string | null
          product_name: string
          quantity: number
          ready_quantity: number
          status: Database["public"]["Enums"]["ticket_line_status"]
          ticket_id: string
          variant_name: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "kitchen_ticket_lines_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: true
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_ticket_lines_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "kitchen_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      kitchen_tickets: {
        Row: KitchenTicketRow
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: "kitchen_tickets_kitchen_id_fkey"
            columns: ["kitchen_id"]
            isOneToOne: false
            referencedRelation: "kitchens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kitchen_tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
```

(c) In `Views`, immediately before `      order_summaries: {`, add:

```ts
      order_kitchen_progress: {
        Row: {
          all_ready: boolean | null
          open_issues: number | null
          order_id: string | null
          ready_count: number | null
          stop_work_pending: number | null
          ticket_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "kitchen_tickets_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
```

(d) In `Functions`, immediately before `      apply_discount:`, add:

```ts
      acknowledge_stop_work: RpcReturnsTicket & {
        Args: { p_reason?: string; p_ticket_id: string }
      }
      acknowledge_ticket: RpcReturnsTicket & {
        Args: { p_reason?: string; p_ticket_id: string }
      }
      record_ticket_print: {
        Args: { p_ticket_id: string }
        Returns: number
      }
      report_issue: RpcReturnsIssue & {
        Args: { p_kind: string; p_line_id?: string; p_note: string; p_ticket_id: string }
      }
      resolve_issue: RpcReturnsIssue & {
        Args: { p_issue_id: string; p_resolution: string }
      }
      set_line_ready: RpcReturnsTicket & {
        Args: { p_line_id: string; p_ready_quantity: number; p_reason?: string }
      }
      start_ticket: RpcReturnsTicket & {
        Args: { p_reason?: string; p_ticket_id: string }
      }
```

(e) In `Enums`, after the `staff_role` line, add:

```ts
      ticket_line_status: "pending" | "preparing" | "ready" | "cancelled"
      ticket_status: "new" | "acknowledged" | "preparing" | "ready" | "cancelled"
```

and in `Constants.public.Enums`, after `staff_role: [...]`, add:

```ts
      ticket_line_status: ["pending", "preparing", "ready", "cancelled"],
      ticket_status: ["new", "acknowledged", "preparing", "ready", "cancelled"],
```

- [ ] **Step 5: Write the failing queue test**

Create `web/src/lib/kitchen.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { groupQueue } from "./kitchen.ts";

// Day keys taken straight from the ISO date keep the test independent of timezones.
const opts = {
  now: new Date("2026-10-01T09:00:00Z"),
  todayKey: "2026-10-01",
  tomorrowKey: "2026-10-02",
  dayKeyOf: (iso: string) => iso.slice(0, 10),
};

const ticket = (id: string, due: string, startBy: string) => ({ id, due_at: due, start_by: startBy });

test("groups tickets into Today, Tomorrow and Later, leaving out empty groups", () => {
  const groups = groupQueue(
    [
      ticket("later", "2026-10-05T10:00:00Z", "2026-10-05T08:00:00Z"),
      ticket("today", "2026-10-01T12:00:00Z", "2026-10-01T10:00:00Z"),
    ],
    opts,
  );
  assert.deepEqual(groups.map((g) => [g.key, g.tickets.map((t) => t.id)]), [
    ["today", ["today"]],
    ["later", ["later"]],
  ]);
});

test("overdue work from an earlier day is in Today and comes first", () => {
  const groups = groupQueue(
    [
      ticket("soon", "2026-10-01T10:00:00Z", "2026-10-01T08:30:00Z"),
      ticket("yesterday", "2026-09-30T15:00:00Z", "2026-09-30T13:00:00Z"),
      ticket("tomorrow", "2026-10-02T09:00:00Z", "2026-10-02T07:00:00Z"),
    ],
    opts,
  );
  assert.deepEqual(groups[0].tickets.map((t) => t.id), ["yesterday", "soon"]);
  assert.equal(groups[1].key, "tomorrow");
});

test("within a group, earlier start-by first, then earlier pickup", () => {
  const groups = groupQueue(
    [
      ticket("b", "2026-10-01T16:00:00Z", "2026-10-01T12:00:00Z"),
      ticket("c", "2026-10-01T15:00:00Z", "2026-10-01T12:00:00Z"),
      ticket("a", "2026-10-01T18:00:00Z", "2026-10-01T10:00:00Z"),
    ],
    opts,
  );
  assert.deepEqual(groups[0].tickets.map((t) => t.id), ["a", "c", "b"]);
});
```

Run: `cd "/c/Users/SANDY/Desktop/auri bakery/web" && npm test`
Expected: FAIL, because `./kitchen.ts` cannot be found.

- [ ] **Step 6: Write `web/src/lib/kitchen.ts`**

```ts
// Kitchen ticket types, labels and queue ordering. Pure: imported by unit tests, so keep any
// imports from "@/" type-only.
import type { Enums } from "@/lib/database.types";
import type { OrderSource } from "@/lib/orders";

export type TicketStatus = Enums<"ticket_status">;
export type TicketLineStatus = Enums<"ticket_line_status">;
export type IssueKind = "ingredient" | "equipment" | "quality" | "other";

export type KitchenTicketLine = {
  id: string;
  line_no: number;
  product_name: string;
  variant_name: string;
  quantity: number;
  ready_quantity: number;
  is_veg: boolean;
  contains_egg: boolean;
  is_eggless: boolean;
  allergens: string[];
  notes: string | null;
  lead_time_minutes: number;
  status: TicketLineStatus;
};

export type KitchenIssue = {
  id: string;
  line_id: string | null;
  kind: string;
  note: string;
  reported_at: string;
  resolved_at: string | null;
  resolution: string | null;
};

export type KitchenTicket = {
  id: string;
  order_id: string;
  kitchen_id: string;
  reference: string;
  revision: number;
  source: OrderSource;
  status: TicketStatus;
  due_at: string;
  start_by: string;
  revised_at: string | null;
  ready_at: string | null;
  cancel_reason: string | null;
  cancelled_at: string | null;
  stop_work_acknowledged_at: string | null;
  print_count: number;
  lines: KitchenTicketLine[];
  issues: KitchenIssue[];
};

export const ticketStatusLabel: Record<TicketStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  preparing: "Preparing",
  ready: "Ready",
  cancelled: "Cancelled",
};

export const ticketStatusTone: Record<TicketStatus, "neutral" | "brand" | "ok" | "warn" | "danger"> = {
  new: "warn",
  acknowledged: "brand",
  preparing: "brand",
  ready: "ok",
  cancelled: "danger",
};

export const issueKindLabel: Record<IssueKind, string> = {
  ingredient: "Ingredient out",
  equipment: "Equipment",
  quality: "Quality",
  other: "Other",
};

// Matches private.ticket_actor: admins acting as the kitchen give a reason of at least this length.
export const ADMIN_KITCHEN_REASON_MIN = 5;

export type QueueGroup<T> = { key: "today" | "tomorrow" | "later"; label: string; tickets: T[] };

// The chef's active queue: Today (including overdue work from earlier days), Tomorrow, Later.
// Within a group: overdue first, then earliest start-by, then earliest pickup. Empty groups are left out.
export function groupQueue<T extends { due_at: string; start_by: string }>(
  tickets: T[],
  opts: { now: Date; todayKey: string; tomorrowKey: string; dayKeyOf: (iso: string) => string },
): QueueGroup<T>[] {
  const groups: QueueGroup<T>[] = [
    { key: "today", label: "Today", tickets: [] },
    { key: "tomorrow", label: "Tomorrow", tickets: [] },
    { key: "later", label: "Later", tickets: [] },
  ];
  for (const t of tickets) {
    const day = opts.dayKeyOf(t.due_at);
    const group = day <= opts.todayKey ? groups[0] : day === opts.tomorrowKey ? groups[1] : groups[2];
    group.tickets.push(t);
  }
  const now = opts.now.getTime();
  const overdueFirst = (t: T) => (Date.parse(t.due_at) < now ? 0 : 1);
  for (const g of groups) {
    g.tickets.sort(
      (a, b) =>
        overdueFirst(a) - overdueFirst(b) ||
        Date.parse(a.start_by) - Date.parse(b.start_by) ||
        Date.parse(a.due_at) - Date.parse(b.due_at),
    );
  }
  return groups.filter((g) => g.tickets.length > 0);
}
```

Run: `npm test`
Expected: PASS, 7 tests (4 capacity + 3 kitchen).

- [ ] **Step 7: Write `web/src/lib/kitchen-data.ts`**

```ts
import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { KitchenTicket } from "@/lib/kitchen";

type Client = Awaited<ReturnType<typeof createClient>>;

// Everything a ticket card shows. No prices or customer data exist on these tables.
const TICKET_SELECT =
  "id, order_id, kitchen_id, reference, revision, source, status, due_at, start_by, revised_at, ready_at, cancel_reason, cancelled_at, stop_work_acknowledged_at, print_count, kitchen_ticket_lines(id, line_no, product_name, variant_name, quantity, ready_quantity, is_veg, contains_egg, is_eggless, allergens, notes, lead_time_minutes, status), kitchen_issues(id, line_id, kind, note, reported_at, resolved_at, resolution)";

// Tickets the signed-in staff member may see (RLS limits chefs to their kitchens). Add filters, then
// pass the result's data to toKitchenTickets.
export function ticketsQuery(supabase: Client) {
  return supabase.from("kitchen_tickets").select(TICKET_SELECT);
}

type TicketRows = NonNullable<Awaited<ReturnType<typeof ticketsQuery>>["data"]>;

export function toKitchenTickets(rows: TicketRows | null): KitchenTicket[] {
  return (rows ?? []).map(({ kitchen_ticket_lines, kitchen_issues, ...ticket }) => ({
    ...ticket,
    lines: [...kitchen_ticket_lines].sort((a, b) => a.line_no - b.line_no),
    issues: [...kitchen_issues].sort((a, b) => a.reported_at.localeCompare(b.reported_at)),
  }));
}

// Changes whenever any visible ticket changes: every ticket write touches updated_at. The chef
// screen compares it every 10 seconds and reloads only when it differs.
export async function ticketStamp(supabase: Client): Promise<string> {
  const { data, count, error } = await supabase
    .from("kitchen_tickets")
    .select("updated_at", { count: "exact" })
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return `${count ?? 0}:${data?.[0]?.updated_at ?? ""}`;
}
```

- [ ] **Step 8: Typecheck and lint**

Run: `cd "/c/Users/SANDY/Desktop/auri bakery/web" && npm run typecheck && npm run lint`
Expected: both succeed with no errors.

- [ ] **Step 9: Commit**

```bash
cd "/c/Users/SANDY/Desktop/auri bakery"
git add web/src/lib/database.types.ts web/src/lib/kitchen.ts web/src/lib/kitchen.test.ts web/src/lib/kitchen-data.ts
git commit -m "Kitchen: types, queue grouping helper with tests, ticket queries

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Chef screen

**Files:**
- Create: `web/src/app/kitchen/actions.ts`
- Create: `web/src/components/kitchen/refresh-status.tsx`
- Create: `web/src/components/kitchen/ticket-card.tsx`
- Modify: `web/src/app/kitchen/page.tsx` (replace)

**Interfaces:**
- Consumes: `ticketsQuery`, `toKitchenTickets`, `ticketStamp` (Task 5); `groupQueue` and the labels (Task 5); the RPCs (Tasks 3 and 4).
- Produces:
  - Server actions:
    - `kitchenStampAction(): Promise<string>`
    - `acknowledgeTicketAction(ticketId, reason?)`
    - `startTicketAction(ticketId, reason?)`
    - `setLineReadyAction(lineId, readyQuantity, reason?)`
    - `reportIssueAction({ ticketId, lineId, kind, note })`
    - `acknowledgeStopWorkAction(ticketId, reason?)`
    - `recordTicketPrintAction(ticketId): Result<{ count }>`
    - `resolveIssueAction(issueId, resolution)`
  - Components:
    - `TicketCard({ ticket, tz, mode, nowIso, orderHref? })`
    - `StopWorkNotice({ ticket, tz, mode })`
    - `PrintTicketButton({ ticketId })`
    - `RefreshStatus({ stamp, tz, loadedAt })`
  - `mode` is `"chef" | "admin" | "view"`.

- [ ] **Step 1: Write the server actions**

Create `web/src/app/kitchen/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { rpcError, type RpcFailure } from "@/lib/orders";
import { ticketStamp } from "@/lib/kitchen-data";

type Result<T = object> = ({ ok: true } & T) | ({ ok?: false } & RpcFailure);

const uuid = z.uuid();
// Admins act as the kitchen with a reason; chefs send none (the database ignores it for chefs).
const reasonArg = (reason?: string) => reason?.trim().slice(0, 300) || undefined;

function afterTicketChange() {
  revalidatePath("/kitchen");
  revalidatePath("/admin", "layout");
}

export async function kitchenStampAction(): Promise<string> {
  await assertRole(["chef", "admin", "counter"]);
  return ticketStamp(await createClient());
}

export async function acknowledgeTicketAction(ticketId: string, reason?: string): Promise<Result> {
  await assertRole(["chef", "admin"]);
  if (!uuid.safeParse(ticketId).success) return { message: "Invalid ticket." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_ticket", { p_ticket_id: ticketId, p_reason: reasonArg(reason) });
  if (error) return rpcError(error);
  afterTicketChange();
  return { ok: true };
}

export async function startTicketAction(ticketId: string, reason?: string): Promise<Result> {
  await assertRole(["chef", "admin"]);
  if (!uuid.safeParse(ticketId).success) return { message: "Invalid ticket." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("start_ticket", { p_ticket_id: ticketId, p_reason: reasonArg(reason) });
  if (error) return rpcError(error);
  afterTicketChange();
  return { ok: true };
}

export async function setLineReadyAction(lineId: string, readyQuantity: number, reason?: string): Promise<Result> {
  await assertRole(["chef", "admin"]);
  if (!uuid.safeParse(lineId).success) return { message: "Invalid item." };
  if (!Number.isInteger(readyQuantity) || readyQuantity < 0 || readyQuantity > 999) return { message: "Enter a whole number." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_line_ready", {
    p_line_id: lineId,
    p_ready_quantity: readyQuantity,
    p_reason: reasonArg(reason),
  });
  if (error) return rpcError(error);
  afterTicketChange();
  return { ok: true };
}

const issueSchema = z.object({
  ticketId: z.uuid(),
  lineId: z.uuid().nullable(),
  kind: z.enum(["ingredient", "equipment", "quality", "other"]),
  note: z.string().trim().min(3, "Describe the issue in at least 3 characters.").max(500),
});

export async function reportIssueAction(input: z.input<typeof issueSchema>): Promise<Result> {
  await assertRole(["chef", "admin"]);
  const parsed = issueSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the issue." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("report_issue", {
    p_ticket_id: parsed.data.ticketId,
    p_kind: parsed.data.kind,
    p_note: parsed.data.note,
    p_line_id: parsed.data.lineId ?? undefined,
  });
  if (error) return rpcError(error);
  afterTicketChange();
  return { ok: true };
}

export async function acknowledgeStopWorkAction(ticketId: string, reason?: string): Promise<Result> {
  await assertRole(["chef", "admin"]);
  if (!uuid.safeParse(ticketId).success) return { message: "Invalid ticket." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_stop_work", { p_ticket_id: ticketId, p_reason: reasonArg(reason) });
  if (error) return rpcError(error);
  afterTicketChange();
  return { ok: true };
}

export async function recordTicketPrintAction(ticketId: string): Promise<Result<{ count: number }>> {
  await assertRole(["chef", "admin", "counter"]);
  if (!uuid.safeParse(ticketId).success) return { message: "Invalid ticket." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_ticket_print", { p_ticket_id: ticketId });
  if (error) return rpcError(error);
  return { ok: true, count: data };
}

export async function resolveIssueAction(issueId: string, resolution: string): Promise<Result> {
  await assertRole(["admin"]);
  if (!uuid.safeParse(issueId).success) return { message: "Invalid issue." };
  const text = resolution.trim();
  if (text.length < 3 || text.length > 500) return { message: "Describe how the issue was resolved (3 to 500 characters)." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_issue", { p_issue_id: issueId, p_resolution: text });
  if (error) return rpcError(error);
  afterTicketChange();
  return { ok: true };
}
```

- [ ] **Step 2: Write the refresh indicator**

Create `web/src/components/kitchen/refresh-status.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatTime } from "@/lib/time";
import { kitchenStampAction } from "@/app/kitchen/actions";

const POLL_MS = 10_000;

// Checks for ticket changes every 10 seconds while the tab is visible, and reloads the page data
// only when something changed. A failed check shows the Offline banner until the next success.
export function RefreshStatus({ stamp, tz, loadedAt }: { stamp: string; tz: string; loadedAt: string }) {
  const router = useRouter();
  const known = useRef(stamp);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    known.current = stamp;
  }, [stamp]);

  useEffect(() => {
    let live = true;
    async function poll() {
      if (document.visibilityState !== "visible") return;
      try {
        const next = await kitchenStampAction();
        if (!live) return;
        const at = Date.now();
        setOffline(false);
        setLastOk(at);
        setNow(at);
        if (next !== known.current) {
          known.current = next;
          router.refresh();
        }
      } catch {
        if (live) setOffline(true);
      }
    }
    const timer = setInterval(poll, POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 5_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      live = false;
      clearInterval(timer);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [router]);

  if (offline) {
    return (
      <p role="alert" className="rounded-lg bg-danger px-3 py-2 text-base font-semibold text-white">
        Offline, showing data from {formatTime(new Date(lastOk ?? Date.parse(loadedAt)), tz)}
      </p>
    );
  }
  const seconds = lastOk !== null && now !== null ? Math.max(0, Math.round((now - lastOk) / 1000)) : null;
  return (
    <p className="text-sm text-muted" aria-live="polite">
      {seconds === null ? "Live · checks every 10 s" : `Updated ${seconds} s ago`}
    </p>
  );
}
```

- [ ] **Step 3: Write the ticket card, stop-work notice, print button and issue form**

Create `web/src/components/kitchen/ticket-card.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Field, Input, Select, Textarea, VegMark, cx } from "@/components/ui";
import { SourceBadge } from "@/components/order-badges";
import { formatDateTime, formatTime } from "@/lib/time";
import {
  ADMIN_KITCHEN_REASON_MIN,
  issueKindLabel,
  ticketStatusLabel,
  ticketStatusTone,
  type IssueKind,
  type KitchenTicket,
} from "@/lib/kitchen";
import {
  acknowledgeStopWorkAction,
  acknowledgeTicketAction,
  recordTicketPrintAction,
  reportIssueAction,
  setLineReadyAction,
  startTicketAction,
} from "@/app/kitchen/actions";

// chef: a chef on their own kitchen. admin: an admin acting as the kitchen (reason required).
// view: counter staff and finished tickets (print only).
export type TicketMode = "chef" | "admin" | "view";

type Outcome = { ok?: boolean; message?: string };

// Runs a ticket action. A thrown error means the request never reached the server, so nothing was
// saved; the page data is refreshed either way so the card shows what the server has.
function useTicketAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  function run(action: () => Promise<Outcome>, onDone?: () => void) {
    setError(null);
    start(async () => {
      try {
        const result = await action();
        if (result.ok) onDone?.();
        else setError(result.message ?? "Could not save.");
      } catch {
        setError("Not saved, check the connection.");
      }
      router.refresh();
    });
  }
  return { pending, error, run };
}

function AdminReason({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field
      label="Reason for acting as the kitchen (recorded)"
      htmlFor={`reason-${id}`}
      hint={`At least ${ADMIN_KITCHEN_REASON_MIN} characters.`}
      className="mt-3"
    >
      <Input id={`reason-${id}`} value={value} onChange={(e) => onChange(e.target.value)} maxLength={300} />
    </Field>
  );
}

export function TicketCard({
  ticket,
  tz,
  mode,
  nowIso,
  orderHref,
}: {
  ticket: KitchenTicket;
  tz: string;
  mode: TicketMode;
  nowIso: string;
  orderHref?: string;
}) {
  const { pending, error, run } = useTicketAction();
  const [reason, setReason] = useState("");
  const [partLine, setPartLine] = useState<string | null>(null);
  const [partCount, setPartCount] = useState("");
  const [reporting, setReporting] = useState(false);

  const now = Date.parse(nowIso);
  const open = ticket.status !== "cancelled";
  const working = open && ticket.status !== "ready";
  const lateStart = working && Date.parse(ticket.start_by) < now;
  const overdue = working && Date.parse(ticket.due_at) < now;
  const canAct = mode === "chef" || (mode === "admin" && reason.trim().length >= ADMIN_KITCHEN_REASON_MIN);
  const adminReason = mode === "admin" ? reason.trim() : undefined;
  const openIssues = ticket.issues.filter((i) => !i.resolved_at);

  return (
    <article className={cx("rounded-xl border bg-surface p-4", overdue ? "border-2 border-danger" : "border-line")}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-mono text-lg font-semibold">{ticket.reference}</h3>
            <SourceBadge source={ticket.source} />
            {ticket.revision > 1 && <Badge tone="warn">Revised</Badge>}
            <Badge tone={ticketStatusTone[ticket.status]}>{ticketStatusLabel[ticket.status]}</Badge>
          </div>
          {orderHref && (
            <Link href={orderHref} className="text-sm text-brand hover:underline">
              Open order
            </Link>
          )}
        </div>
        <div className="text-right">
          <p className={cx("text-lg font-semibold", overdue && "text-danger")}>Pickup {formatDateTime(ticket.due_at, tz)}</p>
          <p className={cx("text-sm", lateStart ? "font-semibold text-danger" : "text-muted")}>
            Start by {formatTime(ticket.start_by, tz)}
          </p>
        </div>
      </header>

      {mode === "admin" && working && <AdminReason id={ticket.id} value={reason} onChange={setReason} />}

      <ul className="mt-3 divide-y divide-line">
        {ticket.lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-lg font-semibold">
                <span className="mr-2 text-2xl tabular-nums">{l.quantity}×</span>
                {l.product_name} — {l.variant_name}
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <VegMark isVeg={l.is_veg} />
                {l.is_eggless ? <Badge tone="ok">Eggless</Badge> : l.contains_egg && <Badge tone="warn">Contains egg</Badge>}
                {l.allergens.length > 0 && <span className="font-medium text-danger">Allergens: {l.allergens.join(", ")}</span>}
              </div>
              {l.notes && <p className="mt-2 rounded-lg bg-warn-soft px-3 py-2 text-base font-medium">“{l.notes}”</p>}
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={cx("text-sm tabular-nums", l.ready_quantity === l.quantity ? "font-semibold text-ok" : "text-muted")}>
                {l.ready_quantity}/{l.quantity} ready
              </span>
              {working && mode !== "view" && (
                <div className="flex gap-2">
                  {l.ready_quantity < l.quantity && (
                    <Button
                      className="px-5 py-3 text-base"
                      disabled={pending || !canAct}
                      onClick={() => run(() => setLineReadyAction(l.id, l.quantity, adminReason))}
                    >
                      Ready
                    </Button>
                  )}
                  <Button
                    variant="secondary"
                    className="py-3"
                    disabled={pending || !canAct}
                    onClick={() => {
                      setPartLine(partLine === l.id ? null : l.id);
                      setPartCount(String(l.ready_quantity));
                    }}
                  >
                    Part ready
                  </Button>
                </div>
              )}
              {partLine === l.id && (
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    run(() => setLineReadyAction(l.id, Number(partCount), adminReason), () => setPartLine(null));
                  }}
                >
                  <label htmlFor={`part-${l.id}`} className="text-sm">
                    Ready
                  </label>
                  <Input
                    id={`part-${l.id}`}
                    inputMode="numeric"
                    className="w-20 text-center text-base"
                    value={partCount}
                    onChange={(e) => setPartCount(e.target.value.replace(/\D/g, ""))}
                  />
                  <span className="text-sm text-muted">of {l.quantity}</span>
                  <Button type="submit" variant="secondary" disabled={pending || partCount === ""}>
                    Save
                  </Button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>

      {openIssues.length > 0 && (
        <Alert tone="danger" title="Issue reported">
          <ul>
            {openIssues.map((i) => (
              <li key={i.id}>
                {issueKindLabel[i.kind as IssueKind] ?? i.kind}: {i.note}
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {open && (
        <footer className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {mode !== "view" && ticket.status === "new" && (
            <Button variant="secondary" className="py-3" disabled={pending || !canAct}
              onClick={() => run(() => acknowledgeTicketAction(ticket.id, adminReason))}>
              Acknowledge
            </Button>
          )}
          {mode !== "view" && (ticket.status === "new" || ticket.status === "acknowledged") && (
            <Button className="py-3" disabled={pending || !canAct} onClick={() => run(() => startTicketAction(ticket.id, adminReason))}>
              Start
            </Button>
          )}
          {mode !== "view" && working && (
            <Button variant="secondary" className="py-3" onClick={() => setReporting(!reporting)}>
              Report issue
            </Button>
          )}
          <PrintTicketButton ticketId={ticket.id} />
        </footer>
      )}
      {reporting && <IssueForm ticket={ticket} onDone={() => setReporting(false)} />}
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </article>
  );
}

function IssueForm({ ticket, onDone }: { ticket: KitchenTicket; onDone: () => void }) {
  const { pending, error, run } = useTicketAction();
  const [kind, setKind] = useState<IssueKind>("ingredient");
  const [lineId, setLineId] = useState("");
  const [note, setNote] = useState("");

  return (
    <form
      className="mt-3 flex flex-col gap-3 rounded-lg border border-line p-3"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => reportIssueAction({ ticketId: ticket.id, lineId: lineId || null, kind, note }), onDone);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What happened" htmlFor={`kind-${ticket.id}`}>
          <Select id={`kind-${ticket.id}`} value={kind} onChange={(e) => setKind(e.target.value as IssueKind)}>
            {(Object.keys(issueKindLabel) as IssueKind[]).map((k) => (
              <option key={k} value={k}>
                {issueKindLabel[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Item" htmlFor={`line-${ticket.id}`}>
          <Select id={`line-${ticket.id}`} value={lineId} onChange={(e) => setLineId(e.target.value)}>
            <option value="">Whole ticket</option>
            {ticket.lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.product_name} — {l.variant_name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Note for the admin" htmlFor={`note-${ticket.id}`}>
        <Textarea id={`note-${ticket.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} required />
      </Field>
      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={pending || note.trim().length < 3}>
          {pending ? "Sending…" : "Send to admin"}
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Close
        </Button>
      </div>
    </form>
  );
}

export function StopWorkNotice({ ticket, tz, mode }: { ticket: KitchenTicket; tz: string; mode: TicketMode }) {
  const { pending, error, run } = useTicketAction();
  const [reason, setReason] = useState("");
  const canAct = mode === "chef" || (mode === "admin" && reason.trim().length >= ADMIN_KITCHEN_REASON_MIN);

  return (
    <article role="alert" className="rounded-xl border-2 border-danger bg-danger-soft p-4">
      <p className="text-xl font-bold text-danger">STOP WORK · {ticket.reference}</p>
      <p className="mt-1 text-base">
        {ticket.cancel_reason ?? "Cancelled"}
        {ticket.cancelled_at && ` · ${formatTime(ticket.cancelled_at, tz)}`}
      </p>
      <ul className="mt-2 text-base">
        {ticket.lines.map((l) => (
          <li key={l.id}>
            {l.quantity}× {l.product_name} — {l.variant_name}
            {l.ready_quantity > 0 && ` (${l.ready_quantity} already made)`}
          </li>
        ))}
      </ul>
      {mode === "admin" && <AdminReason id={`stop-${ticket.id}`} value={reason} onChange={setReason} />}
      {mode !== "view" && (
        <Button
          variant="danger"
          className="mt-3 py-3 text-base"
          disabled={pending || !canAct}
          onClick={() => run(() => acknowledgeStopWorkAction(ticket.id, mode === "admin" ? reason.trim() : undefined))}
        >
          {pending ? "Saving…" : "I've stopped this work"}
        </Button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </article>
  );
}

// Records the print first (so reprints show COPY), then opens the 80mm ticket in a new tab. The tab
// opens during the click so pop-up blockers allow it.
export function PrintTicketButton({ ticketId }: { ticketId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="secondary"
        className="py-3"
        disabled={pending}
        onClick={() => {
          setError(null);
          const win = window.open("", "_blank");
          start(async () => {
            try {
              const result = await recordTicketPrintAction(ticketId);
              if (result.ok) {
                if (win) win.location.href = `/print/kot/${ticketId}`;
              } else {
                win?.close();
                setError(result.message ?? "Could not print.");
              }
            } catch {
              win?.close();
              setError("Not saved, check the connection.");
            }
          });
        }}
      >
        {pending ? "Preparing…" : "Print"}
      </Button>
      {error && (
        <span role="alert" className="text-sm text-danger">
          {error}
        </span>
      )}
    </>
  );
}
```

- [ ] **Step 4: Replace the chef screen**

Replace `web/src/app/kitchen/page.tsx` with:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { addDays, zonedDayKey, zonedDayRange } from "@/lib/time";
import { groupQueue } from "@/lib/kitchen";
import { ticketStamp, ticketsQuery, toKitchenTickets } from "@/lib/kitchen-data";
import { Alert, EmptyState, cx } from "@/components/ui";
import { RefreshStatus } from "@/components/kitchen/refresh-status";
import { StopWorkNotice, TicketCard } from "@/components/kitchen/ticket-card";

export const metadata: Metadata = { title: "Kitchen" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" ? v : "";
}

function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "rounded-full border px-4 py-2 text-base font-medium",
        active ? "border-brand bg-brand-soft text-brand-strong" : "border-line bg-surface hover:border-brand",
      )}
    >
      {children}
    </Link>
  );
}

export default async function KitchenPage({ searchParams }: PageProps<"/kitchen">) {
  const chef = await requireRole(["chef"]);
  const params = await searchParams;
  const tab = str(params.tab) === "done" ? "done" : "active";
  const kitchenId = chef.kitchens.some((k) => k.id === str(params.k)) ? str(params.k) : "all";
  const src = str(params.src) === "in_store" || str(params.src) === "online_call" ? str(params.src) : "all";
  const tz = await getBusinessTimezone();
  const now = new Date();
  const nowIso = now.toISOString();
  const todayKey = zonedDayKey(now, tz);
  const since = zonedDayRange(todayKey, tz).start.toISOString();

  const supabase = await createClient();
  let active = ticketsQuery(supabase).in("status", ["new", "acknowledged", "preparing"]);
  let stops = ticketsQuery(supabase).eq("status", "cancelled").is("stop_work_acknowledged_at", null).order("cancelled_at");
  let done = ticketsQuery(supabase)
    .or(`and(status.eq.ready,ready_at.gte."${since}"),and(status.eq.cancelled,stop_work_acknowledged_at.gte."${since}")`)
    .order("due_at");
  if (kitchenId !== "all") {
    active = active.eq("kitchen_id", kitchenId);
    stops = stops.eq("kitchen_id", kitchenId);
    done = done.eq("kitchen_id", kitchenId);
  }
  if (src === "in_store") active = active.eq("source", "IN_STORE");
  if (src === "online_call") active = active.in("source", ["ONLINE", "CALL"]);

  const [activeRes, stopsRes, doneRes, stamp] = await Promise.all([active, stops, done, ticketStamp(supabase)]);
  const stopTickets = toKitchenTickets(stopsRes.data);
  const doneTickets = toKitchenTickets(doneRes.data);
  const groups = groupQueue(toKitchenTickets(activeRes.data), {
    now,
    todayKey,
    tomorrowKey: addDays(todayKey, 1),
    dayKeyOf: (iso) => zonedDayKey(iso, tz),
  });
  const loadError = activeRes.error ?? stopsRes.error ?? doneRes.error;
  const link = (overrides: Record<string, string>) => `/kitchen?${new URLSearchParams({ tab, k: kitchenId, src, ...overrides })}`;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-surface px-5 py-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-brand">Auri Bakery · Kitchen</p>
          <h1 className="text-xl font-semibold">
            {chef.kitchens.length ? chef.kitchens.map((k) => k.name).join(" + ") : "No kitchen assigned"}
          </h1>
        </div>
        <RefreshStatus stamp={stamp} tz={tz} loadedAt={nowIso} />
        <div className="flex items-center gap-4">
          <span className="text-base">{chef.fullName}</span>
          <form action={signOut}>
            <button type="submit" className="rounded-lg border border-line px-4 py-2.5 text-base font-medium hover:bg-brand-soft">
              Sign out
            </button>
          </form>
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-5 p-5">
        {chef.kitchens.length === 0 ? (
          <Alert tone="danger" title="You are not assigned to a kitchen">
            Ask an admin to assign you to a kitchen before tickets can appear here.
          </Alert>
        ) : (
          <>
            {loadError && <Alert tone="danger" title="Could not load tickets">{loadError.message}</Alert>}

            {stopTickets.length > 0 && (
              <section aria-label="Stop-work notices" className="flex flex-col gap-3">
                {stopTickets.map((t) => (
                  <StopWorkNotice key={t.id} ticket={t} tz={tz} mode="chef" />
                ))}
              </section>
            )}

            <nav aria-label="Ticket views" className="flex flex-wrap items-center gap-2">
              <Chip href={link({ tab: "active" })} active={tab === "active"}>Active</Chip>
              <Chip href={link({ tab: "done" })} active={tab === "done"}>Done today</Chip>
              <span className="mx-2 h-6 w-px bg-line" aria-hidden />
              <Chip href={link({ src: "all" })} active={src === "all"}>All</Chip>
              <Chip href={link({ src: "in_store" })} active={src === "in_store"}>In-store</Chip>
              <Chip href={link({ src: "online_call" })} active={src === "online_call"}>Online &amp; Call</Chip>
              {chef.kitchens.length > 1 && (
                <>
                  <span className="mx-2 h-6 w-px bg-line" aria-hidden />
                  <Chip href={link({ k: "all" })} active={kitchenId === "all"}>All kitchens</Chip>
                  {chef.kitchens.map((k) => (
                    <Chip key={k.id} href={link({ k: k.id })} active={kitchenId === k.id}>{k.name}</Chip>
                  ))}
                </>
              )}
            </nav>

            {tab === "active" ? (
              groups.length === 0 ? (
                <EmptyState title="No active tickets">New tickets appear here as soon as an order is confirmed.</EmptyState>
              ) : (
                groups.map((g) => (
                  <section key={g.key} className="flex flex-col gap-3">
                    <h2 className="text-xl font-semibold">
                      {g.label} <span className="text-muted">({g.tickets.length})</span>
                    </h2>
                    <div className="grid gap-4 xl:grid-cols-2">
                      {g.tickets.map((t) => (
                        <TicketCard key={t.id} ticket={t} tz={tz} mode="chef" nowIso={nowIso} />
                      ))}
                    </div>
                  </section>
                ))
              )
            ) : doneTickets.length === 0 ? (
              <EmptyState title="Nothing finished yet today" />
            ) : (
              <div className="grid gap-4 xl:grid-cols-2">
                {doneTickets.map((t) => (
                  <TicketCard key={t.id} ticket={t} tz={tz} mode="view" nowIso={nowIso} />
                ))}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Typecheck, lint, build**

Run: `cd "/c/Users/SANDY/Desktop/auri bakery/web" && npm run typecheck && npm run lint && npm run build`
Expected: all succeed. If lint flags something inside `RefreshStatus` (for example `react-hooks/set-state-in-effect`), keep all state updates inside the interval and event callbacks, which is how the code above already works, and do not call setters directly in the effect body.

- [ ] **Step 6: Commit**

```bash
cd "/c/Users/SANDY/Desktop/auri bakery"
git add web/src/app/kitchen web/src/components/kitchen
git commit -m "Kitchen: chef screen with queue, ready counts, issues, stop-work, 10 s refresh

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Printed kitchen ticket

**Files:**
- Create: `web/src/app/print/print-button.tsx`
- Create: `web/src/app/print/kot/[id]/page.tsx`

**Interfaces:**
- Consumes: `ticketsQuery`, `toKitchenTickets` (Task 5). `PrintTicketButton` (Task 6) opens `/print/kot/[id]` after recording the print.

- [ ] **Step 1: Write the print button**

Create `web/src/app/print/print-button.tsx`:

```tsx
"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong">
      Print
    </button>
  );
}
```

- [ ] **Step 2: Write the ticket print page**

Create `web/src/app/print/kot/[id]/page.tsx`:

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { sourceLabel } from "@/lib/orders";
import { formatDateTime, formatTime } from "@/lib/time";
import { ticketsQuery, toKitchenTickets } from "@/lib/kitchen-data";
import { PrintButton } from "../../print-button";

export const metadata: Metadata = { title: "Kitchen ticket" };

// 80mm kitchen ticket. No prices. Opened by the Print button after the print is counted, so a
// count above 1 means this is a reprint (COPY). RLS limits chefs to their own kitchens.
export default async function KitchenTicketPrintPage({ params }: PageProps<"/print/kot/[id]">) {
  await requireRole(["admin", "counter", "chef"]);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const tz = await getBusinessTimezone();

  const supabase = await createClient();
  const [ticket] = toKitchenTickets((await ticketsQuery(supabase).eq("id", id)).data);
  if (!ticket) notFound();
  const { data: kitchen } = await supabase.from("kitchens").select("name").eq("id", ticket.kitchen_id).maybeSingle();

  return (
    <div className="min-h-screen bg-canvas print:bg-white">
      <style>{`@page { size: 80mm auto; margin: 3mm; }`}</style>
      <div className="mx-auto flex w-[76mm] justify-end pt-4 print:hidden">
        <PrintButton />
      </div>
      <article className="mx-auto mt-4 w-[76mm] bg-white p-3 font-mono text-[12px] leading-snug text-black shadow print:mt-0 print:w-full print:p-0 print:shadow-none">
        {ticket.print_count > 1 && <p className="mb-1 border-2 border-black text-center text-base font-bold">COPY</p>}
        {ticket.print_count === 0 && <p className="mb-1 text-center">PREVIEW · not recorded</p>}
        <p className="text-center text-sm font-bold">KITCHEN ORDER TICKET</p>
        <p className="text-center text-lg font-bold">{ticket.reference}</p>
        <p className="text-center">
          {kitchen?.name} · {sourceLabel[ticket.source]}
          {ticket.revision > 1 && ` · Revision ${ticket.revision}`}
        </p>
        {ticket.status === "cancelled" && <p className="mt-1 border-2 border-black text-center font-bold">CANCELLED · DO NOT MAKE</p>}
        <div className="mt-2 border-y border-dashed border-black py-1">
          <p className="font-bold">Pickup: {formatDateTime(ticket.due_at, tz)}</p>
          <p>Start by: {formatTime(ticket.start_by, tz)}</p>
        </div>
        <ul>
          {ticket.lines.map((l) => (
            <li key={l.id} className="border-b border-dashed border-black py-1">
              <p className="text-sm font-bold">
                {l.quantity} × {l.product_name}
              </p>
              <p>{l.variant_name}</p>
              <p>
                {l.is_veg ? "VEG" : "NON-VEG"} · {l.is_eggless ? "EGGLESS" : l.contains_egg ? "CONTAINS EGG" : "NO EGG"}
              </p>
              {l.allergens.length > 0 && <p>Allergens: {l.allergens.join(", ")}</p>}
              {l.notes && <p className="font-bold">Note: {l.notes}</p>}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-center">Printed {formatDateTime(new Date(), tz)}</p>
      </article>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck, lint, build**

Run: `cd "/c/Users/SANDY/Desktop/auri bakery/web" && npm run typecheck && npm run lint && npm run build`
Expected: all succeed; the build's route list includes `/print/kot/[id]`.

- [ ] **Step 4: Commit**

```bash
cd "/c/Users/SANDY/Desktop/auri bakery"
git add web/src/app/print
git commit -m "Kitchen: 80mm ticket print with COPY on reprints

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Admin KOT overview

**Files:**
- Replace: `web/src/app/admin/kot/page.tsx`
- Create: `web/src/app/admin/kot/resolve-issue.tsx`
- Modify: `web/src/app/admin/nav.tsx:16`

**Interfaces:**
- Consumes: `ticketsQuery`, `toKitchenTickets` (Task 5); `TicketCard`, `StopWorkNotice` and `resolveIssueAction` (Task 6).

- [ ] **Step 1: Write the resolve form**

Create `web/src/app/admin/kot/resolve-issue.tsx`:

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui";
import { resolveIssueAction } from "@/app/kitchen/actions";

export function ResolveIssueForm({ issueId }: { issueId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Resolve
      </Button>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await resolveIssueAction(issueId, text);
          if (result.ok) {
            setOpen(false);
            router.refresh();
          } else {
            setError(result.message ?? "Could not save.");
          }
        });
      }}
    >
      <label htmlFor={`resolve-${issueId}`} className="sr-only">
        How it was resolved
      </label>
      <Input id={`resolve-${issueId}`} className="w-64" value={text} onChange={(e) => setText(e.target.value)}
        maxLength={500} placeholder="How it was resolved" autoFocus />
      <Button type="submit" disabled={pending || text.trim().length < 3}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
        Close
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
```

- [ ] **Step 2: Replace the KOT page**

Replace `web/src/app/admin/kot/page.tsx` with:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { issueKindLabel, type IssueKind } from "@/lib/kitchen";
import { ticketsQuery, toKitchenTickets } from "@/lib/kitchen-data";
import { formatDateTime, zonedDayKey, zonedDayRange } from "@/lib/time";
import { Button, Card, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { StopWorkNotice, TicketCard } from "@/components/kitchen/ticket-card";
import { ResolveIssueForm } from "./resolve-issue";

export const metadata: Metadata = { title: "KOT" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" ? v : "";
}

const STATUSES = ["open", "ready", "cancelled", "all"] as const;
const STATUS_LABEL: Record<(typeof STATUSES)[number], string> = { open: "Open", ready: "Ready", cancelled: "Cancelled", all: "All" };

export default async function KotPage({ searchParams }: PageProps<"/admin/kot">) {
  const staff = await requireRole(["admin", "counter"]);
  const isAdmin = staff.role === "admin";
  const mode = isAdmin ? "admin" : "view";
  const params = await searchParams;
  const tz = await getBusinessTimezone();
  const now = new Date();
  const nowIso = now.toISOString();
  const today = zonedDayKey(now, tz);
  const day = /^\d{4}-\d{2}-\d{2}$/.test(str(params.day)) ? str(params.day) : today;
  const kitchen = str(params.kitchen);
  const source = str(params.source) === "in_store" || str(params.source) === "online_call" ? str(params.source) : "";
  const status = STATUSES.find((s) => s === str(params.status)) ?? "open";
  const { start, end } = zonedDayRange(day, tz);

  const supabase = await createClient();
  let query = ticketsQuery(supabase).gte("due_at", start.toISOString()).lt("due_at", end.toISOString()).order("due_at");
  if (kitchen) query = query.eq("kitchen_id", kitchen);
  if (source === "in_store") query = query.eq("source", "IN_STORE");
  if (source === "online_call") query = query.in("source", ["ONLINE", "CALL"]);
  if (status === "open") query = query.in("status", ["new", "acknowledged", "preparing"]);
  else if (status !== "all") query = query.eq("status", status);

  const [{ data: rows, error }, { data: kitchens }, { data: issues }, { data: stopRows }] = await Promise.all([
    query,
    supabase.from("kitchens").select("id, name").order("sort_order"),
    supabase
      .from("kitchen_issues")
      .select("id, kind, note, reported_at, kitchen_tickets(reference, order_id)")
      .is("resolved_at", null)
      .order("reported_at"),
    ticketsQuery(supabase).eq("status", "cancelled").is("stop_work_acknowledged_at", null).order("cancelled_at"),
  ]);
  const tickets = toKitchenTickets(rows);
  const stops = toKitchenTickets(stopRows);
  const kitchenName = new Map((kitchens ?? []).map((k) => [k.id, k.name]));

  return (
    <>
      <PageHeader title="KOT" description={`Kitchen tickets by pickup time (${tz}). Chefs work these on the kitchen screen.`} />

      <div className="flex flex-col gap-6">
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Open issues</h2>
          {!issues || issues.length === 0 ? (
            <p className="text-sm text-muted">No open issues.</p>
          ) : (
            <ul className="divide-y divide-line">
              {issues.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">
                      {issueKindLabel[i.kind as IssueKind] ?? i.kind}: {i.note}
                    </p>
                    <p className="text-sm text-muted">
                      {i.kitchen_tickets && (
                        <Link href={`/admin/orders/${i.kitchen_tickets.order_id}`} className="font-mono text-brand hover:underline">
                          {i.kitchen_tickets.reference}
                        </Link>
                      )}{" "}
                      · {formatDateTime(i.reported_at, tz)}
                    </p>
                  </div>
                  {isAdmin && <ResolveIssueForm issueId={i.id} />}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {stops.length > 0 && (
          <section aria-label="Stop-work not yet acknowledged" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Stop-work not yet acknowledged</h2>
            {stops.map((t) => (
              <StopWorkNotice key={t.id} ticket={t} tz={tz} mode={mode} />
            ))}
          </section>
        )}

        <form className="flex flex-wrap items-end gap-3" role="search">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="kot-day" className="text-sm font-medium">Pickup day</label>
            <Input id="kot-day" type="date" name="day" defaultValue={day} />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="kot-kitchen" className="text-sm font-medium">Kitchen</label>
            <Select id="kot-kitchen" name="kitchen" defaultValue={kitchen}>
              <option value="">All kitchens</option>
              {(kitchens ?? []).map((k) => (
                <option key={k.id} value={k.id}>{k.name}</option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="kot-source" className="text-sm font-medium">Source</label>
            <Select id="kot-source" name="source" defaultValue={source}>
              <option value="">All</option>
              <option value="in_store">In-store</option>
              <option value="online_call">Online &amp; Call</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="kot-status" className="text-sm font-medium">Status</label>
            <Select id="kot-status" name="status" defaultValue={status}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </div>
          <Button type="submit" variant="secondary">Show</Button>
        </form>

        {error ? (
          <p role="alert" className="text-sm text-danger">Could not load tickets: {error.message}</p>
        ) : tickets.length === 0 ? (
          <EmptyState title="No tickets match">Tickets appear when orders with made-to-order items are confirmed.</EmptyState>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {tickets.map((t) => (
              <div key={t.id} className="flex flex-col gap-1">
                <p className="text-sm text-muted">{kitchenName.get(t.kitchen_id)}</p>
                <TicketCard ticket={t} tz={tz} mode={mode} nowIso={nowIso} orderHref={`/admin/orders/${t.order_id}`} />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Show KOT to counter staff**

In `web/src/app/admin/nav.tsx`, change

```ts
  { href: "/admin/kot", label: "KOT", roles: ["admin"] },
```

to

```ts
  { href: "/admin/kot", label: "KOT", roles: ["admin", "counter"] },
```

- [ ] **Step 4: Typecheck, lint, build**

Run: `cd "/c/Users/SANDY/Desktop/auri bakery/web" && npm run typecheck && npm run lint && npm run build`
Expected: all succeed.

- [ ] **Step 5: Commit**

```bash
cd "/c/Users/SANDY/Desktop/auri bakery"
git add web/src/app/admin/kot web/src/app/admin/nav.tsx
git commit -m "KOT: admin and counter overview with open issues and stop-work

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Kitchen state on the order screens

**Files:**
- Modify: `web/src/components/order-badges.tsx`
- Modify: `web/src/app/admin/orders/page.tsx`
- Modify: `web/src/app/admin/calendar/order-row.tsx`, `web/src/app/admin/calendar/page.tsx`
- Modify: `web/src/app/admin/orders/[id]/page.tsx`, `web/src/app/admin/orders/[id]/order-actions.tsx`

**Interfaces:**
- Consumes: `order_kitchen_progress` (Task 1), `ticketsQuery`/`toKitchenTickets` (Task 5), `TicketCard`/`StopWorkNotice` (Task 6).
- Produces: `KitchenFlags({ progress })` and type `KitchenProgress = { all_ready: boolean | null; open_issues: number | null }` in `order-badges.tsx`; an `OrderActions` prop `kitchenLocked: boolean`.

- [ ] **Step 1: Add the badges**

Append to `web/src/components/order-badges.tsx`:

```tsx
export type KitchenProgress = { all_ready: boolean | null; open_issues: number | null };

// Kitchen state from order_kitchen_progress. Ready itself is set by packing (Phase 5B).
export function KitchenFlags({ progress }: { progress?: KitchenProgress }) {
  if (!progress) return null;
  return (
    <>
      {progress.all_ready && <Badge tone="ok">All kitchen items ready</Badge>}
      {(progress.open_issues ?? 0) > 0 && <Badge tone="danger">Issue</Badge>}
    </>
  );
}
```

- [ ] **Step 2: Show them in the order list**

In `web/src/app/admin/orders/page.tsx`:

(a) Change the import `import { SourceBadge, StatusBadge } from "@/components/order-badges";` to
`import { KitchenFlags, SourceBadge, StatusBadge } from "@/components/order-badges";`

(b) Immediately after the line `const dueToday = Object.fromEntries(counts) as Record<ListKey, number>;` add:

```ts
  const orderIds = (orders ?? []).map((o) => o.id).filter((v): v is string => Boolean(v));
  const { data: progress } = orderIds.length
    ? await supabase.from("order_kitchen_progress").select("order_id, all_ready, open_issues").in("order_id", orderIds)
    : { data: [] };
  const progressById = new Map((progress ?? []).map((p) => [p.order_id, p]));
```

(c) Replace the status cell

```tsx
                    <td className="px-4 py-3">{o.status && <StatusBadge status={o.status} />}</td>
```

with

```tsx
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {o.status && <StatusBadge status={o.status} />}
                        <KitchenFlags progress={o.id ? progressById.get(o.id) : undefined} />
                      </div>
                    </td>
```

- [ ] **Step 3: Show them in the calendar**

In `web/src/app/admin/calendar/order-row.tsx`:
(a) Change the badge import to `import { KitchenFlags, SourceBadge, StatusBadge, type KitchenProgress } from "@/components/order-badges";`
(b) Add `kitchen?: KitchenProgress;` as the last field of `CalendarOrder`.
(c) After `{o.status && <StatusBadge status={o.status} />}`, add `<KitchenFlags progress={o.kitchen} />`.

In `web/src/app/admin/calendar/page.tsx`, replace

```ts
  const byDay: OrdersByDay = new Map();
  for (const o of orders ?? []) {
    if (!o.due_at) continue;
    const key = zonedDayKey(o.due_at, tz);
    byDay.set(key, [...(byDay.get(key) ?? []), o]);
  }
```

with

```ts
  const orderIds = (orders ?? []).map((o) => o.id).filter((v): v is string => Boolean(v));
  const { data: progress } = orderIds.length
    ? await supabase.from("order_kitchen_progress").select("order_id, all_ready, open_issues").in("order_id", orderIds)
    : { data: [] };
  const progressById = new Map((progress ?? []).map((p) => [p.order_id, p]));

  const byDay: OrdersByDay = new Map();
  for (const o of orders ?? []) {
    if (!o.due_at) continue;
    const key = zonedDayKey(o.due_at, tz);
    byDay.set(key, [...(byDay.get(key) ?? []), { ...o, kitchen: o.id ? progressById.get(o.id) : undefined }]);
  }
```

- [ ] **Step 4: Kitchen card, timeline and edit locks on the order page**

In `web/src/app/admin/orders/[id]/order-actions.tsx`:
(a) Add `kitchenLocked,` to the destructured `OrderActions` props and `kitchenLocked: boolean;` to its prop type.
(b) Change `const reschedulable = awaiting || status === "confirmed";` to
`const reschedulable = (awaiting || status === "confirmed") && !kitchenLocked;`

In `web/src/app/admin/orders/[id]/page.tsx`:

(a) Add the imports:

```ts
import { ticketsQuery, toKitchenTickets } from "@/lib/kitchen-data";
import { StopWorkNotice, TicketCard } from "@/components/kitchen/ticket-card";
```

(b) Add to `eventLabel`, after `completed: "Completed",`:

```ts
  ticket_acknowledged: "Kitchen acknowledged",
  ticket_started: "Kitchen started",
  ticket_ready: "Kitchen ticket ready",
  ready_count_corrected: "Ready count corrected",
  kitchen_issue_reported: "Kitchen issue reported",
  kitchen_issue_resolved: "Kitchen issue resolved",
  stop_work_acknowledged: "Stop-work acknowledged",
  tickets_revised: "Kitchen tickets revised",
```

(c) Replace

```ts
  const canEditItems = !bill && (["draft", "pending_confirmation"].includes(order.status) || (order.status === "confirmed" && isAdmin));
```

with

```ts
  const tickets = toKitchenTickets((await ticketsQuery(supabase).eq("order_id", id).order("reference")).data);
  // Once any live ticket is past New, items and pickup time are locked until kitchen revisions (5C).
  const kitchenLocked = tickets.some((t) => t.status !== "new" && t.status !== "cancelled");
  const kitchenAllReady = tickets.some((t) => t.status !== "cancelled") && tickets.every((t) => t.status === "ready" || t.status === "cancelled");
  const kitchenIssues = tickets.some((t) => t.issues.some((i) => !i.resolved_at));
  const canEditItems =
    !bill && !kitchenLocked && (["draft", "pending_confirmation"].includes(order.status) || (order.status === "confirmed" && isAdmin));
```

(d) In the `PageHeader` description, after `<StatusBadge status={order.status} />`, add:

```tsx
            <KitchenFlags progress={{ all_ready: kitchenAllReady, open_issues: kitchenIssues ? 1 : 0 }} />
```

and change the badge import to `import { KitchenFlags, SourceBadge, StatusBadge } from "@/components/order-badges";`.

(e) Pass the new prop to `OrderActions`: add `kitchenLocked={kitchenLocked}` next to `categoryIds={…}`.

(f) Immediately before `<Card className="lg:col-span-2">` that contains `<h2 className="mb-3 text-lg font-semibold">Timeline</h2>`, insert:

```tsx
          {tickets.length > 0 && (
            <Card className="lg:col-span-2">
              <h2 className="mb-3 text-lg font-semibold">Kitchen</h2>
              {kitchenLocked && !closed && (
                <p className="mb-3 text-sm text-muted">
                  The kitchen has acknowledged this order, so its items and pickup time can&apos;t be changed here. Cancel and recreate it if needed.
                </p>
              )}
              <div className="grid gap-4 xl:grid-cols-2">
                {tickets.map((t) =>
                  t.status === "cancelled" && !t.stop_work_acknowledged_at ? (
                    <StopWorkNotice key={t.id} ticket={t} tz={tz} mode={isAdmin ? "admin" : "view"} />
                  ) : (
                    <TicketCard key={t.id} ticket={t} tz={tz} mode={isAdmin ? "admin" : "view"} nowIso={new Date().toISOString()} />
                  ),
                )}
              </div>
            </Card>
          )}
```

(g) In the timeline item, immediately after `{typeof data.no_show_count === "number" && (…)}`'s closing `)}`, add:

```tsx
                    {typeof data.ticket === "string" && (
                      <p className="font-mono text-xs">
                        {data.ticket}
                        {typeof data.kitchen === "string" && ` · ${data.kitchen}`}
                      </p>
                    )}
                    {e.event_type === "ready_count_corrected" && typeof data.line === "string" && (
                      <p className="text-xs">{data.line}: {String(data.from)} → {String(data.to)} ready</p>
                    )}
                    {typeof data.kind === "string" && typeof data.note === "string" && (
                      <p className="text-xs">{data.kind}: {data.note}</p>
                    )}
```

- [ ] **Step 5: Typecheck, lint, test, build**

Run: `cd "/c/Users/SANDY/Desktop/auri bakery/web" && npm run typecheck && npm run lint && npm test && npm run build`
Expected: all succeed; `npm test` reports 7 passing tests.

- [ ] **Step 6: Commit**

```bash
cd "/c/Users/SANDY/Desktop/auri bakery"
git add web/src
git commit -m "Orders: kitchen card, kitchen badges, lock edits once the kitchen acknowledged

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Docs and final verification

**Files:**
- Modify: `HANDOVER.md`, `TODO.md`

- [ ] **Step 1: Update HANDOVER.md**

- **Section 1 table:** set the Phase 5 row to "**5A done** (kitchen tickets core loop; section 11). 5B packing and handover, 5C revisions after release, 5D PIN sign-in: not started."
- **Section 4 "How writes work" function list:** add `acknowledge_ticket`, `start_ticket`, `set_line_ready`, `report_issue`, `resolve_issue`, `acknowledge_stop_work`, `record_ticket_print`.
- **Section 4 "Invariants":** change the chef line to "Chefs see **only kitchen tickets for their assigned kitchens** (no orders, payments, or customer data)."
- **Section 4 migration names:** append `kitchen_tickets`.
- **Section 5 tests table:** add a `supabase/tests/kitchen_logic.sql` row (checks S1 to D12, orders from 990201), and note `web/src/lib/kitchen.test.ts` (3 tests) next to the capacity unit tests.
- **Section 7:** remove "Placeholder pages: KOT … Kitchen" (keep Reports).
- **Section 8:** replace item 4 with the remaining Phase 5 pieces (5B, 5C, 5D) in that order.
- **Section 10:** change the last bullet to say 5A implemented the holding measure (edits refused once the kitchen acknowledged) and that 5C must replace it.
- **Append section 11** "Kitchen tickets (Phase 5A, built 2026-09-30)", summarising:
  - the tables and the progress view;
  - tickets created on confirmation, and rebuilt while every ticket is New;
  - stop-work on cancel;
  - chef actions without a version check;
  - admin exceptions with a reason;
  - the 10-second change stamp;
  - print counting (COPY);
  - the demo chef login still needs creating (`npm run create-admin -- --email chef@auri.test --name "Demo Chef" --role chef`, then assign kitchens in Staff & Kitchens) before anyone can use `/kitchen`.

- [ ] **Step 2: Update TODO.md**

In "Phase 5 — KOT and chef workflow", tick:
- "Generate separate kitchen tickets from the relevant order items."
- "Implement chef queues, kitchen schedule, source filters, and order/item detail."
- "Implement acknowledgement, preparation, partial quantities, readiness, and issue reporting."
- "Implement KOT browser print/reprint (80mm) preserving ticket identity and revision."
- "Show eggless/veg marks prominently on KOT lines (AC-33)."

Replace "Implement Scheduled/New release timing, restart recovery, and duplicate prevention." with "[x] Release on confirmation (owner decision 2026-09-30: no scheduled release); duplicate prevention via one ticket per kitchen per order."

Mark "Implement live updates, connectivity state, and recovery." done with a note: "10-second change stamp; Realtime deferred."

Leave packing/handover, revisions, and reassignment unticked, labelled 5B or 5C. Update the status line at the top to say 5A is built, with 5B next.

- [ ] **Step 3: Full verification**

Run: `cd "/c/Users/SANDY/Desktop/auri bakery/web" && npm run typecheck && npm run lint && npm test && npm run build`
Expected: all succeed.

Re-run `supabase/tests/kitchen_logic.sql` against the live schema (without the migration prefix). Expected: every outcome matches its `-- expect:` comment.

- [ ] **Step 4: Commit**

```bash
cd "/c/Users/SANDY/Desktop/auri bakery"
git add HANDOVER.md TODO.md
git commit -m "Docs: Phase 5A kitchen tickets in handover and TODO

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Final review**

Request a whole-branch code review (superpowers:requesting-code-review) against the spec, and fix confirmed findings before offering to push, merge and deploy.
