# Phase 5C Kitchen Revisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin change items and the pickup time after the kitchen has acknowledged or started an order, with the kitchen seeing an exact change list it must acknowledge before packing.

**Architecture:** One new migration replaces the 5A refusal (`private.kitchen_guard`) with `private.revise_tickets`, which updates acknowledged/started tickets in place (lines matched by `order_item_id`, ready counts kept or capped) and accumulates `pending_changes` on the ticket. `acknowledge_ticket_changes` clears them; `mark_packed` refuses while any remain. The web app reads the new columns and shows a "Changed" banner on the chef screen, the order page, the KOT page and the printed ticket.

**Tech Stack:** Supabase Postgres (plpgsql, RLS), Next.js 16 App Router, TypeScript, Tailwind v4, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-03-kitchen-revisions-design.md`

## Global Constraints

- Admins only for edits and reschedules on confirmed and preparing orders, with a reason; counter staff unchanged.
- Lowering below the ready count is allowed; the ready count is capped at the new quantity. No waste or counter-sale record (owner, 2026-10-03).
- A revised ticket keeps its status and ready counts; the chef keeps working; packing is blocked until every change is acknowledged (owner, 2026-10-03).
- Ready orders must be reopened (`reopen_packing`) before edits or reschedules. Billed orders stay locked.
- No stock counts (owner, 2026-10-02). No moving items between kitchens.
- Every new or replaced function: `security definer`, `set search_path = ''`, role check first, errors through `private.fail(message, kind)`; execute revoked from `public`/`anon`, granted to `authenticated` only for `public.*` functions.
- Lock order: the order first, then its tickets (see `private.lock_ticket`).
- Money is integer paise; tickets hold no prices or customer data.
- Next.js 16: read `web/node_modules/next/dist/docs/` before using unfamiliar APIs; `params`/`searchParams` are Promises.
- No local Postgres on the owner's machine: SQL checks run through the Supabase MCP `execute_sql` tool with the migration and the test in one rolled-back batch (Task 1, Step 1). Never apply the migration before its checks pass.

## Review Focus

1. Two edits before the chef acknowledges: the change list must show the net change (2 → 3 → 5 shows 2 → 5; 2 → 3 → 2 disappears), not two entries. Covered by V7/V8.
2. A ticket whose only remaining live lines are ready after a removal must become Ready (cancelled lines ignored), or packing could never happen. Covered by V17.
3. A ticket that is Ready but has unacknowledged changes must still appear on the chef's Active tab, not only under Done. Covered by Task 5 Step 3 (query) and the browser walk in Task 7.
4. Re-sending a removed line's id in an edit must be refused, not resurrect it with a broken `cancelled_quantity`. Covered by V16.
5. Kitchens whose every item is removed after acknowledgement must get a stop-work notice, and the removed order line must be kept as cancelled (not deleted). Covered by V23.

---

## File Structure

| File | Responsibility |
|---|---|
| Create `supabase/migrations/20261003000300_kitchen_revisions.sql` | All 5C database changes. |
| Create `supabase/tests/revisions_logic.sql` | SQL rule checks for 5C (orders from 990401). |
| Create `supabase/local/mcp-bundle.sh` | Builds one rolled-back SQL batch (migration + test) for the MCP `execute_sql` tool. |
| Modify `supabase/tests/kitchen_logic.sql` (D6–D8), `supabase/tests/edit_items_logic.sql` (order R, E18) | Old "refused once acknowledged" checks updated to 5C behaviour. |
| Modify `web/src/lib/database.types.ts` | New ticket columns, view column, RPC. |
| Modify `web/src/lib/kitchen.ts`, `web/src/lib/kitchen.test.ts` | `TicketChange` type, `parseTicketChanges`, `describeChange`, queue ordering with changed tickets first. |
| Modify `web/src/lib/kitchen-data.ts` | Select the new columns; parse changes. |
| Modify `web/src/app/kitchen/actions.ts` | `acknowledgeTicketChangesAction`. |
| Modify `web/src/components/kitchen/ticket-card.tsx` | Changed banner, removed lines. |
| Modify `web/src/app/kitchen/page.tsx` | Ready tickets with pending changes stay on Active. |
| Modify `web/src/app/print/kot/[id]/page.tsx` | REVISED rN, change list, removed lines. |
| Modify `web/src/app/admin/orders/[id]/page.tsx`, `edit-items.tsx`, `order-actions.tsx`, `fulfilment-panel.tsx` | Edits/reschedules on preparing orders, removed lines, packing blocker, timeline. |
| Modify `web/src/app/admin/kot/page.tsx` | "Awaiting acknowledgement of changes" list. |
| Modify `web/src/components/order-badges.tsx`, `web/src/app/admin/orders/page.tsx`, `web/src/app/admin/calendar/page.tsx` | "Change unacknowledged" badge. |
| Modify `HANDOVER.md`, `TODO.md` | Status and section 14 for 5C. |

---

### Task 1: Ticket revisions in the database (edits, reschedules, acknowledgement)

**Files:**
- Create: `supabase/local/mcp-bundle.sh`
- Create: `supabase/tests/revisions_logic.sql`
- Create: `supabase/migrations/20261003000300_kitchen_revisions.sql`

**Interfaces:**
- Produces (SQL): columns `kitchen_tickets.pending_changes jsonb`, `has_pending_changes boolean` (generated), `changes_acknowledged_at`, `changes_acknowledged_by`; `private.merge_ticket_changes(jsonb, jsonb) returns jsonb`; `private.revise_tickets(uuid) returns jsonb`; `private.apply_ticket_changes(uuid, text) returns void`; `public.acknowledge_ticket_changes(p_ticket_id uuid, p_reason text default null) returns kitchen_tickets`.
- Change entry shape (used by Task 4): `{"key": text, "kind": "quantity" | "notes" | "pickup", "item": text, "from": number|string|null, "to": number|string|null}`. An added line is `quantity` from 0; a removed line is `quantity` to 0; `pickup` from/to are ISO timestamps and `item` is `"Pickup"`.
- Timeline: `tickets_revised` data `{cause, tickets: [{ticket, kitchen, changes}]}`; `ticket_changes_acknowledged` data `{ticket, kitchen, changes}`.

- [ ] **Step 1: Write the MCP bundling script**

`supabase/local/mcp-bundle.sh`:

```bash
#!/usr/bin/env bash
# Builds one SQL batch for the Supabase MCP execute_sql tool (or any client that returns only the
# last result): begin; the given migrations; the test body; then an exception that lists every
# check and rolls everything back. Nothing is committed.
#
#   supabase/local/mcp-bundle.sh revisions_logic supabase/migrations/20261003000300_kitchen_revisions.sql > bundle.sql
#
# Paste the file's contents into execute_sql. Save the error message (from "RESULTS" on, without
# that first line) to a file and check it with:
#   python supabase/local/check_results.py supabase/tests/<test>.sql <saved file>
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
test=$1; shift
echo "begin;"
for m in "$@"; do cat "$m"; echo; done
# The test file without its own "begin;" and without its last two lines (select from r; rollback;).
sed '0,/^begin;$/d' "$here/../tests/$test.sql" | head -n -2
cat <<'SQL'
do $$ begin raise exception E'RESULTS\n%', (select string_agg(check_name || ' => ' || coalesce(outcome, 'NULL'), E'\n' order by n) from r); end $$;
SQL
```

Run: `chmod +x supabase/local/mcp-bundle.sh`

- [ ] **Step 2: Write the failing checks**

`supabase/tests/revisions_logic.sql`:

```sql
-- Kitchen revisions after acknowledgement (Phase 5C). Runs in a transaction and rolls back.
-- Orders are inserted directly with order numbers from 990401, so order_number_seq is not consumed.
-- Expected outcomes are in the comment above each check.
begin;
create temp table r (n serial, check_name text, outcome text) on commit drop;
create temp table ctx (k text primary key, v text) on commit drop;
grant all on r, ctx to authenticated;
grant usage on sequence r_n_seq to authenticated;

insert into auth.users (id, email, aud, role) values
 ('00000000-0000-0000-0000-0000000009a1','rv-a@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000009c1','rv-c@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000009f1','rv-f1@t.local','authenticated','authenticated'),
 ('00000000-0000-0000-0000-0000000009f2','rv-f2@t.local','authenticated','authenticated');
insert into public.staff_profiles (user_id, full_name, role) values
 ('00000000-0000-0000-0000-0000000009a1','Rv Admin','admin'),
 ('00000000-0000-0000-0000-0000000009c1','Rv Counter','counter'),
 ('00000000-0000-0000-0000-0000000009f1','Rv Chef One','chef'),
 ('00000000-0000-0000-0000-0000000009f2','Rv Chef Two','chef');
insert into public.kitchens (code, name) values ('TR1', 'T Rv Kitchen One'), ('TR2', 'T Rv Kitchen Two');
insert into public.staff_kitchens (user_id, kitchen_id)
  select '00000000-0000-0000-0000-0000000009f1'::uuid, id from public.kitchens where code = 'TR1';
insert into public.staff_kitchens (user_id, kitchen_id)
  select '00000000-0000-0000-0000-0000000009f2'::uuid, id from public.kitchens where code = 'TR2';

-- Predictable scheduling rules (all rolled back).
delete from public.capacity_overrides;
delete from public.category_daily_caps;
delete from public.pickup_windows;
delete from public.closures;
update public.business_hours set opens_at = '09:00', closes_at = '21:00', is_closed = false;

insert into public.categories (name) values ('T Rv Bakes');
insert into public.products (category_id, name, prep_type, tax_rate_bps)
  select id, x.name, 'made_to_order', 500 from public.categories, (values ('T Rv Cake'), ('T Rv Bread'), ('T Rv Cookie')) x(name)
  where categories.name = 'T Rv Bakes';
insert into public.product_variants (product_id, name, price_paise, lead_time_minutes, kitchen_id)
  select p.id, '1 kg', 50000, 60, k.id from public.products p, public.kitchens k where p.name = 'T Rv Cake' and k.code = 'TR1';
insert into public.product_variants (product_id, name, price_paise, lead_time_minutes, kitchen_id)
  select p.id, 'Loaf', 8000, 60, k.id from public.products p, public.kitchens k where p.name = 'T Rv Bread' and k.code = 'TR2';
insert into public.product_variants (product_id, name, price_paise, lead_time_minutes, kitchen_id)
  select p.id, 'Each', 2000, 30, k.id from public.products p, public.kitchens k where p.name = 'T Rv Cookie' and k.code = 'TR1';
insert into ctx select 'cake', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Rv Cake';
insert into ctx select 'bread', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Rv Bread';
insert into ctx select 'cookie', v.id::text from public.product_variants v join public.products p on p.id = v.product_id where p.name = 'T Rv Cookie';

-- Noon on day p_days after today, business time.
create function pg_temp.day(p_days integer) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Asia/Kolkata')::date + p_days) + time '12:00') at time zone 'Asia/Kolkata'
$$;
create function pg_temp.mk_order(p_num bigint, p_due timestamptz) returns uuid language sql as $$
  insert into public.orders (order_number, idempotency_key, source, status, customer_name, customer_phone, requested_due_at)
  values (p_num, gen_random_uuid(), 'CALL', 'pending_confirmation', 'Rv Customer', '9000000901', p_due)
  returning id
$$;
create function pg_temp.mk_line(p_order uuid, p_key text, p_qty integer) returns uuid language sql as $$
  insert into public.order_items (
    order_id, line_no, product_id, variant_id, category_id, product_name, variant_name, prep_type, kitchen_id,
    is_veg, contains_egg, is_eggless, allergens, lead_time_minutes, unit_price_paise, tax_rate_bps,
    quantity, line_total_paise, tax_paise)
  select p_order, coalesce((select max(line_no) from public.order_items where order_id = p_order), 0) + 1,
         p.id, pv.id, p.category_id, p.name, pv.name, p.prep_type, pv.kitchen_id,
         p.is_veg, p.contains_egg, pv.is_eggless, p.allergens, pv.lead_time_minutes, pv.price_paise, p.tax_rate_bps,
         p_qty, pv.price_paise * p_qty, 0
  from public.product_variants pv join public.products p on p.id = pv.product_id
  where pv.id = (select v::uuid from ctx where k = p_key)
  returning id
$$;
-- "status rN / Product ready/quantity status, ..." for one kitchen's ticket of an order.
create function pg_temp.tk(p_order uuid, p_code text) returns text language sql stable as $$
  select t.status || ' r' || t.revision || ' / ' ||
    coalesce((select string_agg(l.product_name || ' ' || l.ready_quantity || '/' || l.quantity || ' ' || l.status, ', ' order by l.line_no)
              from public.kitchen_ticket_lines l where l.ticket_id = t.id), '')
  from public.kitchen_tickets t join public.kitchens k on k.id = t.kitchen_id
  where t.order_id = p_order and k.code = p_code
$$;
-- "Item:from>to, ..." for one kitchen's pending changes.
create function pg_temp.pending(p_order uuid, p_code text) returns text language sql stable as $$
  select coalesce(string_agg((x.e ->> 'item') || ':' || coalesce(x.e ->> 'from', '') || '>' || coalesce(x.e ->> 'to', ''), ', ' order by x.n), '')
  from public.kitchen_tickets t
  join public.kitchens k on k.id = t.kitchen_id
  cross join lateral jsonb_array_elements(t.pending_changes) with ordinality as x(e, n)
  where t.order_id = p_order and k.code = p_code
$$;
create function pg_temp.ver(p_order uuid) returns integer language sql stable as $$
  select version from public.orders where id = p_order
$$;
create function pg_temp.line(p_order uuid, p_product text) returns text language sql stable as $$
  select id::text from public.order_items where order_id = p_order and product_name = p_product
$$;
create function pg_temp.tline(p_order uuid, p_product text) returns uuid language sql stable as $$
  select l.id from public.kitchen_ticket_lines l join public.kitchen_tickets t on t.id = l.ticket_id
  where t.order_id = p_order and l.product_name = p_product
$$;
create function pg_temp.ticket(p_order uuid, p_code text) returns uuid language sql stable as $$
  select t.id from public.kitchen_tickets t join public.kitchens k on k.id = t.kitchen_id
  where t.order_id = p_order and k.code = p_code
$$;

-- A: cake ×2 (TR1) + bread ×3 (TR2) · B: cake ×1 + bread ×1 · C: cake ×1
insert into ctx values ('A', pg_temp.mk_order(990401, pg_temp.day(3))::text);
insert into ctx values ('B', pg_temp.mk_order(990402, pg_temp.day(3))::text);
insert into ctx values ('C', pg_temp.mk_order(990403, pg_temp.day(3))::text);
select pg_temp.mk_line((select v::uuid from ctx where k = 'A'), 'cake', 2);
select pg_temp.mk_line((select v::uuid from ctx where k = 'A'), 'bread', 3);
select pg_temp.mk_line((select v::uuid from ctx where k = 'B'), 'cake', 1);
select pg_temp.mk_line((select v::uuid from ctx where k = 'B'), 'bread', 1);
select pg_temp.mk_line((select v::uuid from ctx where k = 'C'), 'cake', 1);
select private.recalc_order_totals(v::uuid) from ctx where k in ('A', 'B', 'C');

set local role authenticated;

-- Admin confirms everything.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$ begin perform public.confirm_order(v::uuid, 1) from ctx where k in ('A', 'B', 'C'); end $$;

-- Chef One starts A's cakes and finishes both; Chef Two acknowledges A's bread and starts B's bread.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);
do $$
declare a uuid := (select v::uuid from ctx where k = 'A');
begin
  perform public.start_ticket(pg_temp.ticket(a, 'TR1'));
  perform public.set_line_ready(pg_temp.tline(a, 'T Rv Cake'), 2);
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f2","role":"authenticated"}', true);
do $$
begin
  perform public.acknowledge_ticket(pg_temp.ticket((select v::uuid from ctx where k = 'A'), 'TR2'));
  perform public.start_ticket(pg_temp.ticket((select v::uuid from ctx where k = 'B'), 'TR2'));
end $$;

-- ===== Who may change a preparing order =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009c1","role":"authenticated"}', true);
do $$
declare h text; a uuid := (select v::uuid from ctx where k = 'A');
begin
  begin perform public.update_order_items(a, pg_temp.ver(a), jsonb_build_array(
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cake'), 'quantity', 3),
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Bread'), 'quantity', 3)), 'More cake');
    insert into r(check_name,outcome) values ('V1 counter staff cannot change a preparing order', 'ALLOWED');
  -- expect: forbidden: Only an admin can change the items on a confirmed order.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V1 counter staff cannot change a preparing order', h || ': ' || sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare h text; a uuid := (select v::uuid from ctx where k = 'A');
begin
  begin perform public.update_order_items(a, pg_temp.ver(a), jsonb_build_array(
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cake'), 'quantity', 3),
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Bread'), 'quantity', 3)));
    insert into r(check_name,outcome) values ('V2 a reason is required', 'ALLOWED');
  -- expect: validation: Give a reason for changing a confirmed order.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V2 a reason is required', h || ': ' || sqlerrm); end;

  -- ===== Revising acknowledged and started tickets =====
  perform public.update_order_items(a, pg_temp.ver(a), jsonb_build_array(
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cake'), 'quantity', 3),
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Bread'), 'quantity', 1),
    jsonb_build_object('variant_id', (select v from ctx where k = 'cookie'), 'quantity', 4)), 'Customer called');
  -- expect: preparing r2 / T Rv Cake 2/3 preparing, T Rv Cookie 0/4 preparing
  insert into r(check_name,outcome) values ('V3 a Ready started ticket keeps its counts and drops to Preparing', pg_temp.tk(a, 'TR1'));
  -- expect: acknowledged r2 / T Rv Bread 0/1 pending
  insert into r(check_name,outcome) values ('V4 an acknowledged ticket is revised in place', pg_temp.tk(a, 'TR2'));
  -- expect: T Rv Cake — 1 kg:2>3, T Rv Cookie — Each:0>4 | T Rv Bread — Loaf:3>1
  insert into r(check_name,outcome) values ('V5 each kitchen gets its exact change list', pg_temp.pending(a, 'TR1') || ' | ' || pg_temp.pending(a, 'TR2'));
  -- expect: preparing / 2 / true
  insert into r(check_name,outcome) values ('V6 the order stays Preparing and the timeline lists both tickets',
    (select status::text from public.orders where id = a) || ' / '
    || (select jsonb_array_length(data -> 'tickets') from public.order_events where order_id = a and event_type = 'tickets_revised' order by id desc limit 1)
    || ' / ' || (select (count(*) = 2)::text from public.kitchen_tickets where order_id = a and has_pending_changes));
end $$;

-- Chef Two finishes the bread (TR2 becomes Ready).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f2","role":"authenticated"}', true);
do $$ begin perform public.set_line_ready(pg_temp.tline((select v::uuid from ctx where k = 'A'), 'T Rv Bread'), 1); end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare a uuid := (select v::uuid from ctx where k = 'A');
begin
  perform public.update_order_items(a, pg_temp.ver(a), jsonb_build_array(
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cake'), 'quantity', 1),
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Bread'), 'quantity', 1),
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cookie'), 'quantity', 4)), 'Only one cake after all');
  -- expect: preparing r3 / T Rv Cake 1/1 ready, T Rv Cookie 0/4 preparing / T Rv Cake — 1 kg:2>1, T Rv Cookie — Each:0>4
  insert into r(check_name,outcome) values ('V7 lowering below the ready count caps it; changes merge from the last acknowledged state',
    pg_temp.tk(a, 'TR1') || ' / ' || pg_temp.pending(a, 'TR1'));

  perform public.update_order_items(a, pg_temp.ver(a), jsonb_build_array(
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cake'), 'quantity', 2),
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Bread'), 'quantity', 1),
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cookie'), 'quantity', 4)), 'Two cakes again');
  -- expect: preparing r4 / T Rv Cake 1/2 preparing, T Rv Cookie 0/4 preparing / T Rv Cookie — Each:0>4
  insert into r(check_name,outcome) values ('V8 a change back to the acknowledged quantity leaves the list',
    pg_temp.tk(a, 'TR1') || ' / ' || pg_temp.pending(a, 'TR1'));
end $$;

-- ===== Acknowledging changes =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);
do $$
declare t public.kitchen_tickets; a uuid := (select v::uuid from ctx where k = 'A');
begin
  t := public.acknowledge_ticket_changes(pg_temp.ticket(a, 'TR1'));
  -- expect: 0 / true / preparing / 1
  insert into r(check_name,outcome) values ('V9 the chef acknowledges: the list clears, work continues, the timeline records it',
    jsonb_array_length(t.pending_changes) || ' / ' || (t.changes_acknowledged_at is not null)::text || ' / ' || t.status
    || ' / ' || (select count(*) from public.order_events where order_id = a and event_type = 'ticket_changes_acknowledged'));
  t := public.acknowledge_ticket_changes(pg_temp.ticket(a, 'TR1'));
  -- expect: 1
  insert into r(check_name,outcome) values ('V10 acknowledging again changes nothing',
    (select count(*) from public.order_events where order_id = a and event_type = 'ticket_changes_acknowledged')::text);
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f2","role":"authenticated"}', true);
do $$
declare h text;
begin
  begin perform public.acknowledge_ticket_changes(pg_temp.ticket((select v::uuid from ctx where k = 'A'), 'TR1'));
    insert into r(check_name,outcome) values ('V11 a chef of another kitchen cannot acknowledge', 'ALLOWED');
  -- expect: forbidden: This ticket belongs to a kitchen you are not assigned to.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V11 a chef of another kitchen cannot acknowledge', h || ': ' || sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare h text;
begin
  begin perform public.acknowledge_ticket_changes(pg_temp.ticket((select v::uuid from ctx where k = 'A'), 'TR2'));
    insert into r(check_name,outcome) values ('V12 an admin needs a reason', 'ALLOWED');
  -- expect: forbidden: Give a reason of at least 5 characters for acting on a kitchen ticket.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V12 an admin needs a reason', h || ': ' || sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009c1","role":"authenticated"}', true);
do $$
declare h text;
begin
  begin perform public.acknowledge_ticket_changes(pg_temp.ticket((select v::uuid from ctx where k = 'A'), 'TR2'), 'Told the kitchen');
    insert into r(check_name,outcome) values ('V13 counter staff cannot acknowledge', 'ALLOWED');
  -- expect: forbidden: Only the kitchen can update tickets.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V13 counter staff cannot acknowledge', h || ': ' || sqlerrm); end;
end $$;

-- ===== Removing items =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare a uuid := (select v::uuid from ctx where k = 'A');
begin
  perform public.update_order_items(a, pg_temp.ver(a), jsonb_build_array(
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cake'), 'quantity', 2),
    jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Bread'), 'quantity', 1)), 'No cookies');
  -- expect: q4 c4 t0 / 108000 / preparing r5 / T Rv Cake 1/2 preparing, T Rv Cookie 0/0 cancelled / T Rv Cookie — Each:4>0
  insert into r(check_name,outcome) values ('V14 a removed item is kept as cancelled, out of the total, and shown to the kitchen',
    (select 'q' || quantity || ' c' || cancelled_quantity || ' t' || line_total_paise from public.order_items where order_id = a and product_name = 'T Rv Cookie')
    || ' / ' || (select total_paise from public.orders where id = a)
    || ' / ' || pg_temp.tk(a, 'TR1') || ' / ' || pg_temp.pending(a, 'TR1'));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);
do $$
declare h text;
begin
  begin perform public.set_line_ready(pg_temp.tline((select v::uuid from ctx where k = 'A'), 'T Rv Cookie'), 0);
    insert into r(check_name,outcome) values ('V15 no ready count on a removed item', 'ALLOWED');
  -- expect: validation: This item was removed from the order.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V15 no ready count on a removed item', h || ': ' || sqlerrm); end;
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare h text; a uuid := (select v::uuid from ctx where k = 'A');
begin
  begin perform public.update_order_items(a, pg_temp.ver(a), jsonb_build_array(
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cake'), 'quantity', 2),
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Bread'), 'quantity', 1),
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cookie'), 'quantity', 2)), 'Cookies back');
    insert into r(check_name,outcome) values ('V16 a removed line cannot be brought back by its id', 'ALLOWED');
  -- expect: validation: Line 3 was removed from this order. Add the item again instead.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V16 a removed line cannot be brought back by its id', h || ': ' || sqlerrm); end;

  -- B: Chef Two has started the bread; removing it stops that kitchen's work.
  perform public.update_order_items((select v::uuid from ctx where k = 'B'), pg_temp.ver((select v::uuid from ctx where k = 'B')),
    jsonb_build_array(jsonb_build_object('line_id', pg_temp.line((select v::uuid from ctx where k = 'B'), 'T Rv Cake'), 'quantity', 1)), 'No bread');
  -- expect: cancelled / Removed from the order / 1 / q1 c1
  insert into r(check_name,outcome) values ('V23 removing every item of a started kitchen raises stop-work and keeps the line',
    (select t.status || ' / ' || t.cancel_reason from public.kitchen_tickets t where t.id = pg_temp.ticket((select v::uuid from ctx where k = 'B'), 'TR2'))
    || ' / ' || (select stop_work_pending from public.order_kitchen_progress where order_id = (select v::uuid from ctx where k = 'B'))
    || ' / ' || (select 'q' || quantity || ' c' || cancelled_quantity from public.order_items
                 where order_id = (select v::uuid from ctx where k = 'B') and product_name = 'T Rv Bread'));

  -- C: nobody has acknowledged; the ticket is rebuilt as in 5A, with no change list.
  perform public.update_order_items((select v::uuid from ctx where k = 'C'), pg_temp.ver((select v::uuid from ctx where k = 'C')),
    jsonb_build_array(jsonb_build_object('line_id', pg_temp.line((select v::uuid from ctx where k = 'C'), 'T Rv Cake'), 'quantity', 2)), 'Two cakes');
  -- expect: new r2 / T Rv Cake 0/2 pending / 0
  insert into r(check_name,outcome) values ('V24 a ticket still New is rebuilt without a change list',
    pg_temp.tk((select v::uuid from ctx where k = 'C'), 'TR1') || ' / '
    || (select jsonb_array_length(pending_changes) from public.kitchen_tickets where id = pg_temp.ticket((select v::uuid from ctx where k = 'C'), 'TR1')));
end $$;

-- ===== Packing, reschedules and bills (Task 2) =====
-- TASK2-CHECKS

reset role;
select check_name, outcome from r order by n;
rollback;
```

- [ ] **Step 3: Run the checks to see them fail**

Build the bundle with no migration: `supabase/local/mcp-bundle.sh revisions_logic > "$SCRATCH/rv.sql"` (`$SCRATCH` = the session scratchpad). Pass the file's contents to the Supabase MCP `execute_sql` tool (project `hljkydruionasnouyrpu`).
Expected: an error before RESULTS, e.g. `column "has_pending_changes" does not exist` or V3 reporting `kitchen: The kitchen has already acknowledged this order…`. Either proves the checks exercise missing behaviour.

- [ ] **Step 4: Write the migration (part 1)**

`supabase/migrations/20261003000300_kitchen_revisions.sql`:

```sql
-- Phase 5C: kitchen revisions after acknowledgement (docs/superpowers/specs/2026-10-03-kitchen-revisions-design.md).
-- Admins may change items and the pickup time after the kitchen has acknowledged or started an order.
-- Acknowledged and started tickets are revised in place: lines are matched by order line, ready counts
-- are kept (capped at a lowered quantity; owner 2026-10-03), removed items stay as cancelled lines,
-- and the exact changes wait on the ticket until the kitchen acknowledges them. Packing waits for that.
-- Replaces the 5A holding measure (private.kitchen_guard).

-- ---------------------------------------------------------------------------
-- 1. Ticket columns
-- ---------------------------------------------------------------------------

alter table public.kitchen_tickets
  add column pending_changes jsonb not null default '[]' check (jsonb_typeof(pending_changes) = 'array'),
  add column has_pending_changes boolean generated always as (jsonb_array_length(pending_changes) > 0) stored,
  add column changes_acknowledged_at timestamptz,
  add column changes_acknowledged_by uuid references auth.users (id) on delete set null;
create index kitchen_tickets_changes_acknowledged_by_idx on public.kitchen_tickets (changes_acknowledged_by);
create index kitchen_tickets_pending_idx on public.kitchen_tickets (has_pending_changes) where has_pending_changes;

-- ---------------------------------------------------------------------------
-- 2. Change lists
-- ---------------------------------------------------------------------------

-- Adds new change entries to a ticket's unacknowledged list. An entry for the same key (one order
-- line's quantity, its notes, or the pickup time) keeps the first "from" and takes the new "to", so
-- the list always shows the net change since the kitchen last acknowledged; a net change of nothing
-- leaves the list.
create function private.merge_ticket_changes(p_pending jsonb, p_new jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  result jsonb := coalesce(p_pending, '[]'::jsonb);
  e jsonb;
  idx integer;
  merged jsonb;
begin
  for e in select value from jsonb_array_elements(coalesce(p_new, '[]'::jsonb))
  loop
    idx := null;
    select (x.ord - 1)::integer into idx
    from jsonb_array_elements(result) with ordinality as x(value, ord)
    where x.value ->> 'key' = e ->> 'key';
    if idx is null then
      if (e -> 'from') is distinct from (e -> 'to') then
        result := result || jsonb_build_array(e);
      end if;
    else
      merged := e || jsonb_build_object('from', result -> idx -> 'from');
      if (merged -> 'from') is not distinct from (merged -> 'to') then
        result := result - idx;
      else
        result := jsonb_set(result, array[idx::text], merged);
      end if;
    end if;
  end loop;
  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Ready state ignores removed lines; removed lines take no ready count
-- ---------------------------------------------------------------------------

create or replace function private.sync_ticket(p_ticket_id uuid, p_reason text)
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
  -- 5C: lines removed by a revision (status cancelled) do not count.
  select coalesce(bool_and(status = 'ready') filter (where status <> 'cancelled'), false) into all_ready
  from public.kitchen_ticket_lines where ticket_id = t.id;
  if all_ready and t.status <> 'ready' then
    update public.kitchen_tickets set status = 'ready', ready_at = now(), ready_by = auth.uid()
    where id = t.id returning * into t;
    perform private.log_ticket_event(t, 'ticket_ready', p_reason);
  elsif not all_ready and t.status = 'ready' then
    update public.kitchen_tickets set status = 'preparing', ready_at = null, ready_by = null
    where id = t.id returning * into t;
  else
    update public.kitchen_tickets set updated_at = now() where id = t.id returning * into t;
  end if;
  return t;
end;
$$;

create or replace function public.set_line_ready(p_line_id uuid, p_ready_quantity integer, p_reason text default null)
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
  if ln.status = 'cancelled' then -- 5C
    perform private.fail('This item was removed from the order.');
  end if;
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
  return private.sync_ticket(t.id, admin_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Revising tickets
-- ---------------------------------------------------------------------------

-- 5A rebuild, now only for tickets the kitchen has not acknowledged (New, cancelled, or none yet).
-- Acknowledged and started tickets are left to private.revise_tickets. Kitchens with no active lines
-- are still cancelled here (stop-work), whatever their state.
create or replace function private.build_tickets(p_order_id uuid)
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
    elsif t.status in ('acknowledged', 'preparing', 'ready') then
      continue; -- 5C: revised in place by private.revise_tickets
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
            stop_work_acknowledged_at = null, stop_work_acknowledged_by = null,
            pending_changes = '[]' -- 5C
        where id = t.id;
        changed := changed + 1;
      end if;
    end if;
  end loop;

  -- Kitchens with no active lines left: stop their work. Their lines stay as a record.
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

-- Revises the order's acknowledged, preparing and ready tickets in place after an item edit or a
-- reschedule. Callers hold the order lock. Returns [{ticket, kitchen, changes}] for each ticket
-- that changed.
create function private.revise_tickets(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  t public.kitchen_tickets;
  ln record;
  entries jsonb;
  summary jsonb := '[]';
  started boolean;
  new_ready integer;
begin
  select * into o from public.orders where id = p_order_id;
  -- Order, then tickets (in id order), as everywhere else.
  perform 1 from public.kitchen_tickets where order_id = o.id order by id for update;

  for t in
    select kt.* from public.kitchen_tickets kt
    where kt.order_id = o.id and kt.status in ('acknowledged', 'preparing', 'ready')
      -- A kitchen with nothing left is cancelled by build_tickets (stop-work) instead.
      and exists (select 1 from public.order_items oi
                  where oi.order_id = o.id and oi.kitchen_id = kt.kitchen_id
                    and oi.prep_type = 'made_to_order' and oi.quantity > oi.cancelled_quantity)
    order by kt.reference
  loop
    entries := '[]';
    started := t.status in ('preparing', 'ready');

    -- This kitchen's order lines, and order lines already on the ticket.
    for ln in
      select oi.id as item_id, oi.line_no, oi.product_name, oi.variant_name,
             oi.product_name || ' — ' || oi.variant_name as item,
             oi.is_veg, oi.contains_egg, oi.is_eggless, oi.allergens, oi.lead_time_minutes, oi.notes as want_notes,
             case when oi.prep_type = 'made_to_order' and oi.kitchen_id = t.kitchen_id
                  then oi.quantity - oi.cancelled_quantity else 0 end as want,
             l.id as line_id, l.quantity as have, l.ready_quantity, l.notes as have_notes
      from public.order_items oi
      left join public.kitchen_ticket_lines l on l.order_item_id = oi.id and l.ticket_id = t.id
      where oi.order_id = o.id
        and ((oi.prep_type = 'made_to_order' and oi.kitchen_id = t.kitchen_id) or l.id is not null)
      order by oi.line_no
    loop
      if ln.line_id is null then
        continue when ln.want = 0;
        insert into public.kitchen_ticket_lines (
          ticket_id, order_item_id, line_no, product_name, variant_name, quantity,
          is_veg, contains_egg, is_eggless, allergens, notes, lead_time_minutes, status)
        values (t.id, ln.item_id, ln.line_no, ln.product_name, ln.variant_name, ln.want,
          ln.is_veg, ln.contains_egg, ln.is_eggless, ln.allergens, ln.want_notes, ln.lead_time_minutes,
          (case when started then 'preparing' else 'pending' end)::public.ticket_line_status);
        entries := entries || jsonb_build_array(jsonb_build_object(
          'key', 'qty:' || ln.item_id, 'kind', 'quantity', 'item', ln.item, 'from', 0, 'to', ln.want));
      else
        if ln.want <> ln.have then
          new_ready := least(ln.ready_quantity, ln.want);
          update public.kitchen_ticket_lines
          set quantity = ln.want,
              ready_quantity = new_ready,
              status = (case
                when ln.want = 0 then 'cancelled'
                when new_ready = ln.want then 'ready'
                when new_ready > 0 or started then 'preparing'
                else 'pending' end)::public.ticket_line_status
          where id = ln.line_id;
          entries := entries || jsonb_build_array(jsonb_build_object(
            'key', 'qty:' || ln.item_id, 'kind', 'quantity', 'item', ln.item, 'from', ln.have, 'to', ln.want));
        end if;
        if ln.want > 0 and ln.want_notes is distinct from ln.have_notes then
          update public.kitchen_ticket_lines set notes = ln.want_notes where id = ln.line_id;
          entries := entries || jsonb_build_array(jsonb_build_object(
            'key', 'notes:' || ln.item_id, 'kind', 'notes', 'item', ln.item, 'from', ln.have_notes, 'to', ln.want_notes));
        end if;
      end if;
    end loop;

    if t.due_at is distinct from o.due_at then
      entries := entries || jsonb_build_array(jsonb_build_object(
        'key', 'pickup', 'kind', 'pickup', 'item', 'Pickup', 'from', t.due_at, 'to', o.due_at));
    end if;

    continue when jsonb_array_length(entries) = 0;

    update public.kitchen_tickets
    set revision = revision + 1,
        revised_at = now(),
        due_at = o.due_at,
        start_by = o.due_at - make_interval(mins => (
          select coalesce(max(l.lead_time_minutes), 0) from public.kitchen_ticket_lines l
          where l.ticket_id = t.id and l.status <> 'cancelled')),
        pending_changes = private.merge_ticket_changes(pending_changes, entries)
    where id = t.id;
    perform private.sync_ticket(t.id);
    summary := summary || jsonb_build_array(jsonb_build_object(
      'ticket', t.reference,
      'kitchen', (select k.name from public.kitchens k where k.id = t.kitchen_id),
      'changes', entries));
  end loop;
  return summary;
end;
$$;

-- After an item edit or reschedule of a confirmed or preparing order: revise acknowledged work,
-- rebuild work the kitchen has not seen, stop work for kitchens with nothing left, and log it.
create function private.apply_ticket_changes(p_order_id uuid, p_cause text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  revised jsonb := private.revise_tickets(p_order_id);
  rebuilt integer := private.build_tickets(p_order_id);
begin
  if jsonb_array_length(revised) > 0 or rebuilt > 0 then
    perform private.log_order_event(p_order_id, 'tickets_revised', null,
      jsonb_build_object('cause', p_cause, 'tickets', revised));
  end if;
end;
$$;

revoke execute on function
  private.merge_ticket_changes(jsonb, jsonb),
  private.revise_tickets(uuid),
  private.apply_ticket_changes(uuid, text)
  from public;
```

Then append `public.update_order_items`: copy the whole latest definition from `supabase/migrations/20260930000300_kitchen_tickets.sql` (the `create or replace function public.update_order_items(` block, lines 713–948) and make exactly these five changes:

(a) Replace

```sql
  o := private.lock_order(p_order_id, p_expected_version);
  if o.status = 'confirmed' then
    if role <> 'admin' then
      perform private.fail('Only an admin can change the items on a confirmed order.', 'forbidden');
    end if;
    if reason is null then
      perform private.fail('Give a reason for changing a confirmed order.');
    end if;
  elsif o.status not in ('draft', 'pending_confirmation') then
    perform private.fail(format('Items cannot be changed on a %s order.', replace(o.status::text, '_', ' ')));
  end if;
  if o.status = 'confirmed' then -- 5A
    perform private.kitchen_guard(o.id);
  end if;
```

with

```sql
  o := private.lock_order(p_order_id, p_expected_version);
  if o.status in ('confirmed', 'preparing') then -- 5C: preparing too
    if role <> 'admin' then
      perform private.fail('Only an admin can change the items on a confirmed order.', 'forbidden');
    end if;
    if reason is null then
      perform private.fail('Give a reason for changing a confirmed order.');
    end if;
  elsif o.status = 'ready' then
    perform private.fail('This order is packed. Reopen packing before changing its items.', 'kitchen');
  elsif o.status not in ('draft', 'pending_confirmation') then
    perform private.fail(format('Items cannot be changed on a %s order.', replace(o.status::text, '_', ' ')));
  end if;
```

(b) In the existing-line branch, directly after `kept := kept || line_id;`, insert

```sql
      if ln.cancelled_quantity >= ln.quantity then -- 5C
        perform private.fail(format('Line %s was removed from this order. Add the item again instead.', pos));
      end if;
```

(c) In the new-line branch, change `if o.status = 'confirmed' and v.prep_type = 'made_to_order' and v.kitchen_id is null then` to `if o.status in ('confirmed', 'preparing') and v.prep_type = 'made_to_order' and v.kitchen_id is null then`.

(d) Replace the removal loop

```sql
  -- Existing lines left out of the list are removed (the audit log keeps the deleted rows).
  for ln in
    delete from public.order_items
    where order_id = o.id and line_no <= last_existing and not (id = any (kept))
    returning *
  loop
    changes := changes || jsonb_build_array(jsonb_build_object(
      'item', ln.product_name || ' — ' || ln.variant_name, 'from', ln.quantity, 'to', 0));
  end loop;
```

with

```sql
  -- Existing lines left out of the list are removed. 5C: a line the kitchen has acknowledged stays,
  -- fully cancelled and at zero value, so the ticket keeps its history; others are deleted (the
  -- audit log keeps the deleted rows).
  for ln in
    select * from public.order_items oi
    where oi.order_id = o.id and oi.line_no <= last_existing and not (oi.id = any (kept))
      and oi.quantity > oi.cancelled_quantity
    order by oi.line_no
  loop
    if exists (select 1 from public.kitchen_ticket_lines l join public.kitchen_tickets kt on kt.id = l.ticket_id
               where l.order_item_id = ln.id and kt.status in ('acknowledged', 'preparing', 'ready')) then
      update public.order_items set cancelled_quantity = quantity, line_total_paise = 0, tax_paise = 0 where id = ln.id;
    else
      delete from public.order_items where id = ln.id;
    end if;
    changes := changes || jsonb_build_array(jsonb_build_object(
      'item', ln.product_name || ' — ' || ln.variant_name, 'from', ln.quantity - ln.cancelled_quantity, 'to', 0));
  end loop;
```

(e) Replace the last block before `return o;`

```sql
  if o.status = 'confirmed' and private.build_tickets(o.id) > 0 then -- 5A
    perform private.log_order_event(o.id, 'tickets_revised', null, jsonb_build_object('cause', 'items_changed'));
  end if;
```

with

```sql
  if o.status in ('confirmed', 'preparing') then -- 5C
    perform private.apply_ticket_changes(o.id, 'items_changed');
  end if;
```

Then append `public.reschedule_order` (full replacement of the definition at `20260930000300_kitchen_tickets.sql:951`):

```sql
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
  cap_msg text;
  cap_kind text;
begin
  if not private.has_role(array['admin']::public.staff_role[]) then
    perform private.fail('Only an admin can reschedule orders.', 'forbidden');
  end if;
  if reason is null then
    perform private.fail('Give a reason for the new pickup time.');
  end if;
  if override is not null and length(override) < 5 then
    perform private.fail('Give an override reason of at least 5 characters.');
  end if;
  if p_due_at is null or p_due_at < now() - interval '5 minutes' then
    perform private.fail('Choose a pickup time in the future.');
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if o.status = 'ready' then -- 5C
    perform private.fail('This order is packed. Reopen packing before changing its pickup time.', 'kitchen');
  end if;
  if o.status not in ('draft', 'pending_confirmation', 'confirmed', 'preparing') then
    perform private.fail('Only orders that are not yet packed can be rescheduled.');
  end if;

  slot := private.pickup_slot_problem(p_due_at);
  lead := private.lead_time_problem(o.id, p_due_at);
  select c.message, c.kind into cap_msg, cap_kind from private.capacity_problem(o.id, p_due_at) c;
  if (slot is not null or lead is not null or cap_msg is not null) and override is null then
    perform private.fail(coalesce(slot, lead, cap_msg) || ' An admin can override with a reason.',
      coalesce(case when slot is not null then 'slot' end, case when lead is not null then 'lead_time' end, cap_kind));
  end if;

  old_due := o.due_at;
  update public.orders
  set requested_due_at = p_due_at,
      confirmed_due_at = case when status in ('confirmed', 'preparing') then p_due_at else confirmed_due_at end,
      is_immediate = false,
      version = version + 1
  where id = o.id
  returning * into o;

  perform private.log_order_event(o.id, 'rescheduled', reason,
    jsonb_build_object('from', old_due, 'to', p_due_at) ||
    case when override is not null
      then jsonb_strip_nulls(jsonb_build_object('override', override, 'slot', slot, 'lead_time', lead, 'capacity', cap_msg))
      else '{}' end);
  if o.status in ('confirmed', 'preparing') then -- 5C
    perform private.apply_ticket_changes(o.id, 'rescheduled');
  end if;
  return o;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The kitchen acknowledges changes
-- ---------------------------------------------------------------------------

-- The assigned chef, or an admin with a reason. Nothing to acknowledge: a no-op (double taps).
create function public.acknowledge_ticket_changes(p_ticket_id uuid, p_reason text default null)
returns public.kitchen_tickets
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.kitchen_tickets := private.lock_ticket(p_ticket_id);
  actor text := private.ticket_actor(t.kitchen_id, p_reason);
  acknowledged jsonb;
begin
  if t.status = 'cancelled' then
    perform private.fail('This ticket was cancelled. Stop work on it.');
  end if;
  if not t.has_pending_changes then
    return t;
  end if;
  acknowledged := t.pending_changes;
  update public.kitchen_tickets
  set pending_changes = '[]', changes_acknowledged_at = now(), changes_acknowledged_by = auth.uid()
  where id = t.id
  returning * into t;
  perform private.log_ticket_event(t, 'ticket_changes_acknowledged', case when actor = 'admin' then p_reason end,
    jsonb_build_object('changes', acknowledged));
  return t;
end;
$$;

revoke execute on function public.acknowledge_ticket_changes(uuid, text) from public, anon;
grant execute on function public.acknowledge_ticket_changes(uuid, text) to authenticated;

-- 5A holding measure: no longer called.
drop function private.kitchen_guard(uuid);
```

- [ ] **Step 5: Run the checks to see them pass**

Run: `supabase/local/mcp-bundle.sh revisions_logic supabase/migrations/20261003000300_kitchen_revisions.sql > "$SCRATCH/rv.sql"`, then pass the file's contents to MCP `execute_sql`. Save the error text after the `RESULTS` line to `$SCRATCH/rv.out` and run `python supabase/local/check_results.py supabase/tests/revisions_logic.sql "$SCRATCH/rv.out"`.
Expected: every V1–V16, V23, V24 check matches; exit code 0.

- [ ] **Step 6: Commit**

```bash
git add supabase/local/mcp-bundle.sh supabase/tests/revisions_logic.sql supabase/migrations/20261003000300_kitchen_revisions.sql
git commit -m "5C: revise acknowledged kitchen tickets in place; kitchen acknowledges changes"
```

---

### Task 2: Packing, reschedule, bill and progress-view changes

**Files:**
- Modify: `supabase/migrations/20261003000300_kitchen_revisions.sql` (append)
- Modify: `supabase/tests/revisions_logic.sql` (replace the `-- TASK2-CHECKS` line)

**Interfaces:**
- Consumes: Task 1's columns and functions.
- Produces: `order_kitchen_progress.changes_pending integer` (added as the last column); `mark_packed` refusal with kind `kitchen`: `Not every kitchen has acknowledged the latest change: <kitchen names>.`; bills list only lines with an active quantity.

- [ ] **Step 1: Write the failing checks**

Replace the line `-- TASK2-CHECKS` in `supabase/tests/revisions_logic.sql` with:

```sql
-- Both kitchens finish A (TR1 is Ready although its cookie line is cancelled).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);
do $$
declare a uuid := (select v::uuid from ctx where k = 'A');
begin
  perform public.set_line_ready(pg_temp.tline(a, 'T Rv Cake'), 2);
  -- expect: ready r5 / T Rv Cake 2/2 ready, T Rv Cookie 0/0 cancelled / ready r2
  insert into r(check_name,outcome) values ('V17 removed lines do not hold a ticket back from Ready',
    pg_temp.tk(a, 'TR1') || ' / ' || split_part(pg_temp.tk(a, 'TR2'), ' / ', 1));
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009c1","role":"authenticated"}', true);
do $$
declare h text; a uuid := (select v::uuid from ctx where k = 'A');
begin
  begin perform public.mark_packed(a, pg_temp.ver(a));
    insert into r(check_name,outcome) values ('V18 packing waits for every kitchen to acknowledge', 'ALLOWED');
  -- expect: kitchen: Not every kitchen has acknowledged the latest change: T Rv Kitchen One, T Rv Kitchen Two.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V18 packing waits for every kitchen to acknowledge', h || ': ' || sqlerrm); end;
  -- expect: 2
  insert into r(check_name,outcome) values ('V19 the progress view counts unacknowledged tickets',
    (select changes_pending from public.order_kitchen_progress where order_id = a)::text);
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);
do $$ begin perform public.acknowledge_ticket_changes(pg_temp.ticket((select v::uuid from ctx where k = 'A'), 'TR1')); end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f2","role":"authenticated"}', true);
do $$ begin perform public.acknowledge_ticket_changes(pg_temp.ticket((select v::uuid from ctx where k = 'A'), 'TR2')); end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009c1","role":"authenticated"}', true);
do $$
declare o public.orders; a uuid := (select v::uuid from ctx where k = 'A');
begin
  o := public.mark_packed(a, pg_temp.ver(a));
  -- expect: ready
  insert into r(check_name,outcome) values ('V20 packed once every change is acknowledged', o.status::text);
end $$;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009a1","role":"authenticated"}', true);
do $$
declare h text; a uuid := (select v::uuid from ctx where k = 'A');
begin
  begin perform public.update_order_items(a, pg_temp.ver(a), jsonb_build_array(
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Cake'), 'quantity', 3),
          jsonb_build_object('line_id', pg_temp.line(a, 'T Rv Bread'), 'quantity', 1)), 'One more cake');
    insert into r(check_name,outcome) values ('V21 a packed order must be reopened before an edit', 'ALLOWED');
  -- expect: kitchen: This order is packed. Reopen packing before changing its items.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V21 a packed order must be reopened before an edit', h || ': ' || sqlerrm); end;
  begin perform public.reschedule_order(a, pg_temp.ver(a), pg_temp.day(4), 'Customer asked');
    insert into r(check_name,outcome) values ('V22 a packed order must be reopened before a reschedule', 'ALLOWED');
  -- expect: kitchen: This order is packed. Reopen packing before changing its pickup time.
  exception when others then get stacked diagnostics h = pg_exception_hint;
    insert into r(check_name,outcome) values ('V22 a packed order must be reopened before a reschedule', h || ': ' || sqlerrm); end;

  perform public.reopen_packing(a, pg_temp.ver(a), 'Customer moved the pickup');
  perform public.reschedule_order(a, pg_temp.ver(a), pg_temp.day(4), 'Customer asked');
  -- expect: ready, ready / 2 / 2 / preparing
  insert into r(check_name,outcome) values ('V25 rescheduling a preparing order adds a pickup change to each ticket',
    (select string_agg(status::text, ', ' order by reference) from public.kitchen_tickets where order_id = a and status <> 'cancelled')
    || ' / ' || (select count(*) from public.kitchen_tickets t where t.order_id = a
                 and exists (select 1 from jsonb_array_elements(t.pending_changes) e where e ->> 'kind' = 'pickup'))
    || ' / ' || (select count(*) from public.kitchen_tickets where order_id = a and due_at = pg_temp.day(4))
    || ' / ' || (select status::text from public.orders where id = a));
end $$;

-- Acknowledge, pack, pay, hand over: the bill leaves out the removed cookies.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f1","role":"authenticated"}', true);
do $$ begin perform public.acknowledge_ticket_changes(pg_temp.ticket((select v::uuid from ctx where k = 'A'), 'TR1')); end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009f2","role":"authenticated"}', true);
do $$ begin perform public.acknowledge_ticket_changes(pg_temp.ticket((select v::uuid from ctx where k = 'A'), 'TR2')); end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000009c1","role":"authenticated"}', true);
do $$
declare a uuid := (select v::uuid from ctx where k = 'A');
begin
  perform public.mark_packed(a, pg_temp.ver(a));
  perform public.record_payment(a, gen_random_uuid(), 'payment', 'upi', (select total_paise from public.orders where id = a));
  perform public.record_handover(a, pg_temp.ver(a));
  -- expect: T Rv Cake ×2, T Rv Bread ×1 / 108000
  insert into r(check_name,outcome) values ('V26 the bill leaves out removed items',
    (select string_agg((e ->> 'name') || ' ×' || (e ->> 'quantity'), ', ' order by (e ->> 'line_no')::integer)
     from public.bills b, jsonb_array_elements(b.lines) e where b.order_id = a)
    || ' / ' || (select total_paise from public.bills where order_id = a));
end $$;
```

- [ ] **Step 2: Run the checks to see them fail**

Run the bundle as in Task 1 Step 5.
Expected: V18 reports `ALLOWED` or a different message (packing does not yet check changes), V19 fails with `column "changes_pending" does not exist` (the whole batch stops — that is the failure), or V26 lists `T Rv Cookie ×0`.

- [ ] **Step 3: Append the migration (part 2)**

Append to `supabase/migrations/20261003000300_kitchen_revisions.sql`:

```sql
-- ---------------------------------------------------------------------------
-- 6. Packing waits for acknowledged changes
-- ---------------------------------------------------------------------------

create or replace function public.mark_packed(p_order_id uuid, p_expected_version integer, p_note text default null)
returns public.orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  waiting text;
  unacknowledged text;
begin
  if not private.has_role(array['admin', 'counter']::public.staff_role[]) then
    perform private.fail('Only admin and counter staff can pack orders.', 'forbidden');
  end if;
  select * into o from public.orders where id = p_order_id;
  if not found then
    perform private.fail('Order not found.', 'not_found');
  end if;
  -- Packing again changes nothing (a double tap or a retry after a lost answer).
  if o.status = 'ready' and o.packed_at is not null then
    return o;
  end if;
  o := private.lock_order(p_order_id, p_expected_version);
  if o.status not in ('confirmed', 'preparing') then
    perform private.fail(format('Only confirmed or preparing orders can be packed; this one is %s.', replace(o.status::text, '_', ' ')));
  end if;
  if length(v_note) > 300 then
    perform private.fail('Keep the packing note under 300 characters.');
  end if;

  -- 5C: the kitchen must have seen every change.
  select string_agg(k.name, ', ' order by k.name) into unacknowledged
  from public.kitchen_tickets t join public.kitchens k on k.id = t.kitchen_id
  where t.order_id = o.id and t.status <> 'cancelled' and t.has_pending_changes;
  if unacknowledged is not null then
    perform private.fail(format('Not every kitchen has acknowledged the latest change: %s.', unacknowledged), 'kitchen');
  end if;
  select string_agg(k.name || ' (' || t.status::text || ')', ', ' order by k.name) into waiting
  from public.kitchen_tickets t join public.kitchens k on k.id = t.kitchen_id
  where t.order_id = o.id and t.status not in ('ready', 'cancelled');
  if waiting is not null then
    perform private.fail(format('Not every kitchen has finished: %s.', waiting), 'kitchen');
  end if;
  if exists (select 1 from public.kitchen_issues i join public.kitchen_tickets t on t.id = i.ticket_id
             where t.order_id = o.id and i.resolved_at is null) then
    perform private.fail('Resolve the open kitchen issue before packing.', 'kitchen');
  end if;

  update public.orders
  set status = 'ready', packed_at = now(), packed_by = auth.uid(), packing_note = v_note, version = version + 1
  where id = o.id
  returning * into o;
  perform private.log_order_event(o.id, 'packed', null, jsonb_strip_nulls(jsonb_build_object('note', v_note)));
  return o;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Bills leave out removed lines
-- ---------------------------------------------------------------------------

create or replace function private.issue_bill_locked(o public.orders)
returns public.bills
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.bills;
  v_fy text := private.financial_year(now());
  v_seq integer;
  v_prefix text;
  v_tax bigint;
  v_cgst bigint;
  v_business jsonb;
begin
  select * into b from public.bills where order_id = o.id;
  if found then
    return b;
  end if;
  if o.status not in ('confirmed', 'preparing', 'ready', 'completed') then
    perform private.fail('Only confirmed orders can be billed.');
  end if;

  select bill_prefix, jsonb_build_object('name', business_name, 'address', address, 'phone', phone,
           'email', email, 'gstin', gstin, 'fssai_licence', fssai_licence)
  into v_prefix, v_business
  from public.business_settings where id;

  v_seq := private.next_document_number('bill', v_fy);
  v_tax := o.tax_paise;
  -- CGST/SGST split per GST rate so the bill total matches the printed rate summary exactly.
  select coalesce(sum(div(rate_tax, 2)), 0)::bigint into v_cgst
  from (select sum(tax_paise) as rate_tax from public.order_items where order_id = o.id group by tax_rate_bps) t;

  insert into public.bills (
    order_id, bill_number, financial_year, sequence_number, issued_by, business, customer_name, customer_phone,
    lines, subtotal_paise, discount_paise, total_paise, taxable_paise, cgst_paise, sgst_paise
  )
  select o.id, v_prefix || '/' || v_fy || '/' || lpad(v_seq::text, 5, '0'), v_fy, v_seq, auth.uid(), v_business,
    o.customer_name, o.customer_phone,
    coalesce(jsonb_agg(jsonb_build_object(
      'line_no', line_no, 'name', product_name, 'variant', variant_name, 'hsn', hsn_code,
      'is_veg', is_veg, 'is_eggless', is_eggless,
      'quantity', quantity - cancelled_quantity, 'unit_price_paise', unit_price_paise,
      'gross_paise', line_total_paise, 'discount_paise', discount_paise,
      'net_paise', line_total_paise - discount_paise, 'tax_rate_bps', tax_rate_bps,
      'tax_paise', tax_paise, 'taxable_paise', line_total_paise - discount_paise - tax_paise
    ) order by line_no), '[]'),
    o.subtotal_paise, o.discount_paise, o.total_paise, o.total_paise - v_tax, v_cgst, v_tax - v_cgst
  from public.order_items where order_id = o.id and quantity > cancelled_quantity -- 5C
  returning * into b;

  perform private.log_order_event(o.id, 'bill_issued', null, jsonb_build_object('bill_number', b.bill_number, 'total_paise', b.total_paise));
  return b;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Progress view: tickets with unacknowledged changes
-- ---------------------------------------------------------------------------

create or replace view public.order_kitchen_progress
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
  count(*) filter (where t.status = 'cancelled' and t.stop_work_acknowledged_at is null) as stop_work_pending,
  count(*) filter (where t.status <> 'cancelled' and t.has_pending_changes) as changes_pending -- 5C
from public.kitchen_tickets t
group by t.order_id;
```

Note: `issue_bill_locked` checks `o.status` against `('confirmed', 'preparing', 'ready', 'completed')` exactly as the current definition; confirm by diffing against `20260927000310_bill_gst_split_per_rate.sql` that the only change is the `where` clause.

- [ ] **Step 4: Run the checks to see them pass**

Run the bundle as in Task 1 Step 5.
Expected: all checks V1–V26 match; exit code 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261003000300_kitchen_revisions.sql supabase/tests/revisions_logic.sql
git commit -m "5C: packing waits for acknowledged changes; bills skip removed lines; progress view counts them"
```

---

### Task 3: Update the old checks, rerun every suite, apply the migration

**Files:**
- Modify: `supabase/tests/kitchen_logic.sql:380-403`
- Modify: `supabase/tests/edit_items_logic.sql:67,73,231-236`
- Modify: `web/src/lib/database.types.ts`

**Interfaces:**
- Produces (TypeScript): `KitchenTicketRow` gains `pending_changes: Json`, `has_pending_changes: boolean`, `changes_acknowledged_at: string | null`, `changes_acknowledged_by: string | null`; `order_kitchen_progress.Row.changes_pending: number | null`; `Functions.acknowledge_ticket_changes: RpcReturnsTicket & { Args: { p_reason?: string; p_ticket_id: string } }`.

- [ ] **Step 1: Rewrite kitchen_logic D6–D8**

In `supabase/tests/kitchen_logic.sql`, replace the block from `  begin perform public.update_order_items(e, 5, jsonb_build_array(jsonb_build_object('line_id', cake_line, 'quantity', 3)), 'One more cake');` through `  o := public.cancel_order(e, 5, 'Customer cancelled');` with:

```sql
  o := public.update_order_items(e, 5, jsonb_build_array(jsonb_build_object('line_id', cake_line, 'quantity', 3)), 'One more cake');
  -- expect: acknowledged / 1 / cancelled
  insert into r(check_name,outcome) values ('D6 an edit after acknowledgement revises the ticket (5C)',
    (select status || ' / ' || jsonb_array_length(pending_changes) from public.kitchen_tickets where order_id = e and reference like '%-TK1')
    || ' / ' || (select status::text from public.kitchen_tickets where order_id = e and reference like '%-TK2'));
  o := public.reschedule_order(e, o.version, pg_temp.day(5), 'Later again');
  -- expect: acknowledged / 2
  insert into r(check_name,outcome) values ('D7 a reschedule after acknowledgement adds a pickup change (5C)',
    (select status || ' / ' || jsonb_array_length(pending_changes) from public.kitchen_tickets where order_id = e and reference like '%-TK1'));

  o := public.cancel_order(e, o.version, 'Customer cancelled');
```

(D8's expectation is unchanged: TK2 was cancelled by D6's edit with its stop-work still pending, so two stop-work notices remain, and `min(cancel_reason)` is still `Customer cancelled`.)

- [ ] **Step 2: Rewrite edit_items_logic E18**

In `supabase/tests/edit_items_logic.sql`:
- line 67 comment: change `R preparing` to `R ready (packed)`;
- line 73: change `pg_temp.mk_order(990106, 'preparing', pg_temp.day3())` to `pg_temp.mk_order(990106, 'ready', pg_temp.day3())`;
- lines 233–236: rename the check to `'E18 packed order refused until reopened'` (both occurrences) and change the expectation to `-- expect: kitchen: This order is packed. Reopen packing before changing its items.`

- [ ] **Step 3: Run every SQL suite against the new migration**

For each of `kitchen_logic`, `edit_items_logic`, `packing_logic`, `orders_logic`, `billing_logic`, `capacity_logic`, `no_show_logic`, `revisions_logic`: build `supabase/local/mcp-bundle.sh <name> supabase/migrations/20261003000300_kitchen_revisions.sql`, run it through MCP `execute_sql`, save the RESULTS text and run `check_results.py`.
Expected: exit code 0 for each. (`orders_logic`, `billing_logic` and `capacity_logic` call `create_order`; inside the rolled-back batch they do not consume the live sequence.) `orders_logic`'s lead-time message depends on the time of day (HANDOVER section 5): if it alone differs, read it.

- [ ] **Step 4: Apply the migration to the live project**

Use the MCP `apply_migration` tool with name `kitchen_revisions` and the file's full contents. Then run the MCP `get_advisors` (security and performance).
Expected: success; advisor findings limited to those listed in HANDOVER section 4 (plus the new functions under `authenticated_security_definer_function_executable`).

- [ ] **Step 5: Update the TypeScript database types**

In `web/src/lib/database.types.ts`:
- in `type KitchenTicketRow`, add (alphabetical order as in the file):
  ```ts
  changes_acknowledged_at: string | null
  changes_acknowledged_by: string | null
  has_pending_changes: boolean
  pending_changes: Json
  ```
- in `order_kitchen_progress.Row`, add `changes_pending: number | null` after `all_ready`;
- in `Functions`, after `acknowledge_ticket`, add:
  ```ts
      acknowledge_ticket_changes: RpcReturnsTicket & {
        Args: { p_reason?: string; p_ticket_id: string }
      }
  ```

Run: `cd web && npm run typecheck`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add supabase/tests/kitchen_logic.sql supabase/tests/edit_items_logic.sql web/src/lib/database.types.ts
git commit -m "5C: update 5A checks to revisions; types for the new ticket columns and RPC"
```

---

### Task 4: Change list helpers and queue ordering

**Files:**
- Modify: `web/src/lib/kitchen.ts`
- Modify: `web/src/lib/kitchen-data.ts`
- Test: `web/src/lib/kitchen.test.ts`

**Interfaces:**
- Produces:
  - `export type TicketChange = { key: string; kind: "quantity" | "notes" | "pickup"; item: string; from: number | string | null; to: number | string | null }`
  - `export function parseTicketChanges(value: unknown): TicketChange[]` — drops malformed entries.
  - `export function describeChange(c: TicketChange, formatTime: (iso: string) => string): string`
  - `KitchenTicket` gains `pending_changes: TicketChange[]` and `changes_acknowledged_at: string | null`.
  - `groupQueue` puts tickets with `pending_changes.length > 0` first within each group (input type gains optional `pending_changes?: unknown[]`).

- [ ] **Step 1: Write the failing tests**

Append to `web/src/lib/kitchen.test.ts`:

```ts
import { describeChange, parseTicketChanges } from "./kitchen.ts";

const fmt = (iso: string) => `T(${iso.slice(11, 16)})`;

test("describes added, changed and removed items, notes and pickup moves", () => {
  const c = (kind: "quantity" | "notes" | "pickup", item: string, from: number | string | null, to: number | string | null) =>
    describeChange({ key: "k", kind, item, from, to }, fmt);
  assert.equal(c("quantity", "Chocolate cake — 1 kg", 2, 3), "Chocolate cake — 1 kg: 2 → 3");
  assert.equal(c("quantity", "Butter cookies — Each", 0, 12), "New: Butter cookies — Each × 12");
  assert.equal(c("quantity", "Plum cake — 500 g", 4, 0), "Plum cake — 500 g: removed");
  assert.equal(c("notes", "Chocolate cake — 1 kg", null, "Happy Birthday Asha"), "Chocolate cake — 1 kg: note “Happy Birthday Asha”");
  assert.equal(c("notes", "Chocolate cake — 1 kg", "Old", null), "Chocolate cake — 1 kg: note removed");
  assert.equal(c("pickup", "Pickup", "2026-10-04T11:30:00Z", "2026-10-04T13:30:00Z"), "Pickup: T(11:30) → T(13:30)");
});

test("parses change lists from the database and drops malformed entries", () => {
  const parsed = parseTicketChanges([
    { key: "qty:1", kind: "quantity", item: "Cake — 1 kg", from: 2, to: 3 },
    { key: "x", kind: "colour", item: "?", from: 1, to: 2 },
    "junk",
  ]);
  assert.deepEqual(parsed, [{ key: "qty:1", kind: "quantity", item: "Cake — 1 kg", from: 2, to: 3 }]);
  assert.deepEqual(parseTicketChanges(null), []);
});

test("tickets with unacknowledged changes come first in their day group", () => {
  const groups = groupQueue(
    [
      { id: "early", due_at: "2026-10-01T10:00:00Z", start_by: "2026-10-01T08:00:00Z", pending_changes: [] },
      { id: "changed", due_at: "2026-10-01T18:00:00Z", start_by: "2026-10-01T16:00:00Z", pending_changes: [{}] },
    ],
    opts,
  );
  assert.deepEqual(groups[0].tickets.map((t) => t.id), ["changed", "early"]);
});
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd web && npm test`
Expected: FAIL — `describeChange` and `parseTicketChanges` are not exported; the queue test puts `early` first.

- [ ] **Step 3: Implement**

In `web/src/lib/kitchen.ts`:

Add after the `KitchenIssue` type:

```ts
// One entry of a ticket's unacknowledged change list (kitchen_tickets.pending_changes). An added
// item is a quantity change from 0, a removed one a quantity change to 0.
export type TicketChange = {
  key: string;
  kind: "quantity" | "notes" | "pickup";
  item: string;
  from: number | string | null;
  to: number | string | null;
};

const CHANGE_KINDS = new Set(["quantity", "notes", "pickup"]);
const isValue = (v: unknown) => v === null || typeof v === "number" || typeof v === "string";

export function parseTicketChanges(value: unknown): TicketChange[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is TicketChange =>
      typeof e === "object" && e !== null &&
      typeof e.key === "string" && typeof e.item === "string" && CHANGE_KINDS.has(e.kind) &&
      isValue(e.from) && isValue(e.to),
  );
}

// The words the chef reads, e.g. "Chocolate cake — 1 kg: 2 → 3".
export function describeChange(c: TicketChange, formatTime: (iso: string) => string): string {
  if (c.kind === "pickup") return `Pickup: ${formatTime(String(c.from))} → ${formatTime(String(c.to))}`;
  if (c.kind === "notes") return c.to ? `${c.item}: note “${c.to}”` : `${c.item}: note removed`;
  if (c.from === 0) return `New: ${c.item} × ${c.to}`;
  if (c.to === 0) return `${c.item}: removed`;
  return `${c.item}: ${c.from} → ${c.to}`;
}
```

In `KitchenTicket`, add after `print_count: number;`:

```ts
  pending_changes: TicketChange[];
  changes_acknowledged_at: string | null;
```

Change `groupQueue`'s signature and sort:

```ts
export function groupQueue<T extends { due_at: string; start_by: string; pending_changes?: unknown[] }>(
```

```ts
  const changedFirst = (t: T) => ((t.pending_changes?.length ?? 0) > 0 ? 0 : 1);
  for (const g of groups) {
    g.tickets.sort(
      (a, b) =>
        changedFirst(a) - changedFirst(b) ||
        overdueFirst(a) - overdueFirst(b) ||
        Date.parse(a.start_by) - Date.parse(b.start_by) ||
        Date.parse(a.due_at) - Date.parse(b.due_at),
    );
  }
```

Update the comment above `groupQueue` to: `// Within a group: tickets with unacknowledged changes first, then overdue, then earliest start-by, then earliest pickup.`

In `web/src/lib/kitchen-data.ts`:
- in `TICKET_SELECT`, after `print_count, ` insert `pending_changes, changes_acknowledged_at, `;
- in `toKitchenTickets`, import `parseTicketChanges` from `@/lib/kitchen` (value import; this file is server-only, not used by tests) and map:

```ts
export function toKitchenTickets(rows: TicketRows | null): KitchenTicket[] {
  return (rows ?? []).map(({ kitchen_ticket_lines, kitchen_issues, pending_changes, ...ticket }) => ({
    ...ticket,
    pending_changes: parseTicketChanges(pending_changes),
    lines: [...kitchen_ticket_lines].sort((a, b) => a.line_no - b.line_no),
    issues: [...kitchen_issues].sort((a, b) => a.reported_at.localeCompare(b.reported_at)),
  }));
}
```

(`import { parseTicketChanges, type KitchenTicket } from "@/lib/kitchen";`)

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd web && npm test && npm run typecheck`
Expected: all tests pass (20); typecheck passes.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/kitchen.ts web/src/lib/kitchen-data.ts web/src/lib/kitchen.test.ts
git commit -m "5C: change list parsing and wording; changed tickets first in the chef queue"
```

---

### Task 5: Chef screen and printed ticket

**Files:**
- Modify: `web/src/app/kitchen/actions.ts`
- Modify: `web/src/components/kitchen/ticket-card.tsx`
- Modify: `web/src/app/kitchen/page.tsx:47`
- Modify: `web/src/app/print/kot/[id]/page.tsx`

**Interfaces:**
- Consumes: `describeChange`, `TicketChange`, `KitchenTicket.pending_changes` (Task 4); RPC `acknowledge_ticket_changes` (Task 3).
- Produces: `acknowledgeTicketChangesAction(ticketId: string, reason?: string): Promise<Result>`; `ChangedBanner` rendered inside `TicketCard` (also used by the order page and KOT page through `TicketCard`).

- [ ] **Step 1: Add the server action**

In `web/src/app/kitchen/actions.ts`, after `acknowledgeTicketAction`:

```ts
export async function acknowledgeTicketChangesAction(ticketId: string, reason?: string): Promise<Result> {
  await assertRole(["chef", "admin"]);
  if (!uuid.safeParse(ticketId).success) return { message: "Invalid ticket." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_ticket_changes", { p_ticket_id: ticketId, p_reason: reasonArg(reason) });
  if (error) return rpcError(error);
  afterTicketChange();
  return { ok: true };
}
```

- [ ] **Step 2: Banner and removed lines in the ticket card**

In `web/src/components/kitchen/ticket-card.tsx`:
- import `describeChange` from `@/lib/kitchen` and `acknowledgeTicketChangesAction` from `@/app/kitchen/actions`;
- inside `TicketCard`, after `const openIssues = …`, add:

```tsx
  const changes = open ? ticket.pending_changes : [];
  const liveLines = ticket.lines.filter((l) => l.status !== "cancelled");
```

- directly after the header's closing `</header>`, add:

```tsx
      {changes.length > 0 && (
        <div role="alert" className="mt-3 rounded-lg border-2 border-warn bg-warn-soft p-3">
          <p className="text-lg font-bold">Changed · revision {ticket.revision}</p>
          <ul className="mt-1 list-disc pl-5 text-base">
            {changes.map((c) => (
              <li key={c.key}>{describeChange(c, (iso) => formatDateTime(iso, tz))}</li>
            ))}
          </ul>
          {mode !== "view" && (
            <Button
              className="mt-3 px-5 py-3 text-base"
              disabled={pending || !canAct}
              onClick={() => run(() => acknowledgeTicketChangesAction(ticket.id, adminReason))}
            >
              {pending ? "Saving…" : "Acknowledge changes"}
            </Button>
          )}
        </div>
      )}
```

- the admin reason field must show for a Ready ticket with changes too: change `{mode === "admin" && working && <AdminReason …/>}` to `{mode === "admin" && (working || changes.length > 0) && <AdminReason id={ticket.id} value={reason} onChange={setReason} />}`;
- in the line list, render removed lines without controls. Replace the opening of the map body `<li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">` block with a branch at its top:

```tsx
        {ticket.lines.map((l) =>
          l.status === "cancelled" && open ? (
            <li key={l.id} className="py-3 text-lg text-muted">
              <span className="line-through">
                {l.product_name} — {l.variant_name}
              </span>{" "}
              <Badge tone="danger">Removed</Badge>
            </li>
          ) : (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              {/* existing line content unchanged */}
            </li>
          ),
        )}
```

  (keep the existing `<li>` children exactly as they are; only the wrapping changes and the closing `))}` becomes `),\n        )}`);
- in `IssueForm`, change `{ticket.lines.map((l) => (` in the item `<Select>` to `{ticket.lines.filter((l) => l.status !== "cancelled").map((l) => (`;
- `liveLines` is used by nothing else; if lint flags it as unused, remove it.

- [ ] **Step 3: Keep Ready tickets with changes on the Active tab**

In `web/src/app/kitchen/page.tsx`, replace

```ts
  let active = ticketsQuery(supabase).in("status", ["new", "acknowledged", "preparing"]);
```

with

```ts
  // Ready tickets stay on Active while the kitchen has not acknowledged a change to them (5C).
  let active = ticketsQuery(supabase)
    .neq("status", "cancelled")
    .or("status.in.(new,acknowledged,preparing),has_pending_changes.is.true");
```

- [ ] **Step 4: Printed ticket**

In `web/src/app/print/kot/[id]/page.tsx`:
- import `describeChange` from `@/lib/kitchen`;
- replace `{ticket.revision > 1 && \` · Revision ${ticket.revision}\`}` with nothing, and after the `{kitchen?.name} · …` paragraph add:

```tsx
        {ticket.revision > 1 && <p className="mt-1 border-2 border-black text-center font-bold">REVISED r{ticket.revision}</p>}
        {ticket.status !== "cancelled" && ticket.pending_changes.length > 0 && (
          <div className="mt-1 border border-black p-1">
            <p className="font-bold">CHANGES:</p>
            <ul>
              {ticket.pending_changes.map((c) => (
                <li key={c.key}>- {describeChange(c, (iso) => formatDateTime(iso, tz))}</li>
              ))}
            </ul>
          </div>
        )}
```

- in the lines list, wrap the line content: for `l.status === "cancelled" && ticket.status !== "cancelled"` render `<li key={l.id} className="border-b border-dashed border-black py-1 line-through">REMOVED: {l.product_name} — {l.variant_name}</li>` instead of the normal `<li>`.

- [ ] **Step 5: Verify**

Run: `cd web && npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/kitchen web/src/components/kitchen/ticket-card.tsx web/src/app/print/kot
git commit -m "5C: Changed banner with Acknowledge on the chef screen; removed lines; revised print"
```

---

### Task 6: Admin screens

**Files:**
- Modify: `web/src/app/admin/orders/[id]/page.tsx`
- Modify: `web/src/app/admin/orders/[id]/edit-items.tsx`
- Modify: `web/src/app/admin/orders/[id]/order-actions.tsx`
- Modify: `web/src/app/admin/orders/[id]/fulfilment-panel.tsx`
- Modify: `web/src/app/admin/kot/page.tsx`
- Modify: `web/src/components/order-badges.tsx`, `web/src/app/admin/orders/page.tsx:88`, `web/src/app/admin/calendar/page.tsx:84`

**Interfaces:**
- Consumes: `TicketCard` (Task 5) shows banners; `describeChange` (Task 4).
- Produces: `EditItems` prop `needsReason: boolean` (replaces `isConfirmed`); `OrderActions` loses `kitchenLocked`; `FulfilmentPanel` gains `unacknowledged: string[]`; `KitchenProgress` gains `changes_pending: number | null`.

- [ ] **Step 1: Order page logic**

In `web/src/app/admin/orders/[id]/page.tsx`:
- delete the two lines defining `kitchenLocked` (and its comment) and replace `canEditItems` with:

```ts
  // Items can change on draft and pending orders, and (admin, with a reason) on confirmed and
  // preparing ones: kitchens get a revision to acknowledge (5C). Packed orders are reopened first.
  const canEditItems =
    !bill && (["draft", "pending_confirmation"].includes(order.status) || (["confirmed", "preparing"].includes(order.status) && isAdmin));
  const unacknowledged = tickets
    .filter((t) => t.status !== "cancelled" && t.pending_changes.length > 0)
    .map((t) => kitchenName.get(t.kitchen_id) ?? "Kitchen");
```

- in the item list map, render removed lines struck through: at the start of the `.map((i) => (` body, use `const removed = i.quantity - i.cancelled_quantity === 0;` (convert the arrow to a block body returning the `<li>`), add `removed && "opacity-60"` to the `<li>` via `cx` (import `cx` from `@/components/ui` if not imported), and change the quantity paragraph to:

```tsx
            <p className={cx("font-medium", removed && "line-through")}>
              {removed ? i.quantity : i.quantity - i.cancelled_quantity} × {i.product_name} — {i.variant_name}
              {removed && <Badge tone="danger" className="ml-2">Removed</Badge>}
            </p>
```

  (if `Badge` has no `className` prop, wrap it: `<span className="ml-2"><Badge tone="danger">Removed</Badge></span>`);
- `EditItems` props: replace `isConfirmed={order.status === "confirmed"}` with `needsReason={["confirmed", "preparing"].includes(order.status)}`, and change `existing={(items ?? []).map(` to `existing={(items ?? []).filter((i) => i.quantity > i.cancelled_quantity).map(`;
- after the `EditItems`/`itemList` block, add a hint for packed orders:

```tsx
            {order.status === "ready" && isAdmin && !bill && (
              <p className="mt-2 text-sm text-muted">To change items or the pickup time, reopen packing first.</p>
            )}
```

- `OrderActions`: remove the `kitchenLocked={kitchenLocked}` prop;
- `FulfilmentPanel`: add `unacknowledged={unacknowledged}`;
- Kitchen card: delete the `{kitchenLocked && !closed && (…)}` paragraph;
- timeline: add to `eventLabel`: `ticket_changes_acknowledged: "Kitchen acknowledged changes",`; import `describeChange, parseTicketChanges` from `@/lib/kitchen`; after the `items_changed` block add:

```tsx
                    {e.event_type === "tickets_revised" && Array.isArray(data.tickets) && (
                      <ul className="text-xs">
                        {(data.tickets as { ticket?: string; kitchen?: string; changes?: unknown }[]).map((t, n) => (
                          <li key={n}>
                            <span className="font-mono">{t.ticket}</span>
                            {t.kitchen && ` · ${t.kitchen}`}:{" "}
                            {parseTicketChanges(t.changes).map((c) => describeChange(c, (iso) => formatDateTime(iso, tz))).join("; ")}
                          </li>
                        ))}
                      </ul>
                    )}
                    {e.event_type === "ticket_changes_acknowledged" && (
                      <p className="text-xs">
                        {parseTicketChanges(data.changes).map((c) => describeChange(c, (iso) => formatDateTime(iso, tz))).join("; ")}
                      </p>
                    )}
```

- [ ] **Step 2: EditItems reason prop**

In `web/src/app/admin/orders/[id]/edit-items.tsx`, rename the prop `isConfirmed` to `needsReason` in the destructuring, the props type and its three uses; change the hint text to `"Confirmed and preparing orders need a reason; it is shown in the timeline."`.

- [ ] **Step 3: OrderActions reschedule**

In `web/src/app/admin/orders/[id]/order-actions.tsx`: remove `kitchenLocked` from the destructuring and the props type, and change

```ts
  const reschedulable = (awaiting || status === "confirmed") && !kitchenLocked;
```

to

```ts
  // Preparing orders too: kitchens get a revision to acknowledge (5C). Packed orders are reopened first.
  const reschedulable = awaiting || status === "confirmed" || status === "preparing";
```

- [ ] **Step 4: Packing blocker**

In `web/src/app/admin/orders/[id]/fulfilment-panel.tsx`:
- add `unacknowledged` to the destructuring and `unacknowledged: string[];` to the props type;
- change `const packable = … && !openIssues;` to `const packable = (status === "confirmed" || status === "preparing") && waitingKitchens.length === 0 && !openIssues && unacknowledged.length === 0;`
- after the `{openIssues && …}` paragraph add:

```tsx
        {unacknowledged.length > 0 && (
          <p className="text-sm font-medium text-danger">
            Not acknowledged by the kitchen yet: {unacknowledged.join(", ")}. The kitchen acknowledges the latest change on its screen.
          </p>
        )}
```

- [ ] **Step 5: KOT page list**

In `web/src/app/admin/kot/page.tsx`:
- add a fifth query to the `Promise.all`: `ticketsQuery(supabase).eq("has_pending_changes", true).neq("status", "cancelled").order("revised_at")`, destructured as `{ data: changedRows }`;
- `const changed = toKitchenTickets(changedRows);`
- after the stop-work `section`, add:

```tsx
        {changed.length > 0 && (
          <section aria-label="Changes not yet acknowledged" className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">Awaiting acknowledgement of changes</h2>
            <div className="grid gap-4 xl:grid-cols-2">
              {changed.map((t) => (
                <TicketCard key={t.id} ticket={t} tz={tz} mode={mode} nowIso={nowIso} orderHref={`/admin/orders/${t.order_id}`} />
              ))}
            </div>
          </section>
        )}
```

- [ ] **Step 6: Badges in lists and calendar**

- `web/src/components/order-badges.tsx`: `export type KitchenProgress = { all_ready: boolean | null; open_issues: number | null; changes_pending?: number | null };` and inside `KitchenFlags` add `{(progress.changes_pending ?? 0) > 0 && <Badge tone="warn">Change unacknowledged</Badge>}`.
- `web/src/app/admin/orders/page.tsx:88` and `web/src/app/admin/calendar/page.tsx:84`: change `.select("order_id, all_ready, open_issues")` to `.select("order_id, all_ready, open_issues, changes_pending")`.
- order page `KitchenFlags` call: `progress={{ all_ready: kitchenAllReady, open_issues: kitchenIssues ? 1 : 0, changes_pending: unacknowledged.length }}`.

- [ ] **Step 7: Verify**

Run: `cd web && npm run typecheck && npm run lint && npm test && npm run build`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add web/src
git commit -m "5C: edit and reschedule preparing orders; packing blocker; KOT and badges for unacknowledged changes"
```

---

### Task 7: Docs, deploy, browser walk

**Files:**
- Modify: `HANDOVER.md` (sections 1, 5, 6, 7, 8, 11; new section 14)
- Modify: `TODO.md` (status line; Phase 5 items)

- [ ] **Step 1: Update the handover and to-do list**

`HANDOVER.md`:
- section 1 table: 5C row → `**Built** (2026-10-03) | Edits and reschedules after the kitchen acknowledged: tickets revised in place, Changed banner, Acknowledge changes, packing waits (section 14).`; "Owner decisions" bullet about refusing edits → replace with `**Changes after the kitchen acknowledged** (owner, 2026-10-03): the ticket keeps its progress and shows a change list the kitchen acknowledges; packing waits. Lowering below the ready count caps the count; nothing records the extra.`;
- section 5 table: add `supabase/tests/revisions_logic.sql | MCP bundle (supabase/local/mcp-bundle.sh) or run-tests.sh | 26/26 (2026-10-03). Orders from 990401.` and describe `mcp-bundle.sh` under the "Running SQL tests through the Supabase MCP tool" paragraph;
- section 6: add `5C: lowering below the ready count caps it, no waste record (owner) | revise_tickets` and `5C: a packed order is reopened before edits | update_order_items, reschedule_order`;
- section 7: remove "Edits after the kitchen acknowledges are refused";
- section 8: replace item 4 (5C) with the browser walk of the revision flow;
- section 11: note that `kitchen_guard` was dropped in 5C;
- add section `## 14. Kitchen revisions (Phase 5C, built 2026-10-03)` summarising: migration `20261003000300_kitchen_revisions.sql`; columns; `revise_tickets`/`apply_ticket_changes`/`merge_ticket_changes`; `acknowledge_ticket_changes`; `mark_packed` blocker; bill filter; screens (chef banner, order page, KOT list, badges, print).

`TODO.md`: status line mentions 5C built; tick the Phase 5 revision item(s) that exist in the file and point "Next" at the browser walk and 5D.

- [ ] **Step 2: Commit and push (deploys production through the Vercel Git integration)**

```bash
git add HANDOVER.md TODO.md
git commit -m "Docs: Phase 5C kitchen revisions built; tests, defaults, next steps"
git push
```

Confirm the deployment: `cd web && vercel ls | head -8` shows a new Production deployment `● Ready`, and `curl -s -o /dev/null -w "%{http_code}" https://bakery-admin-ten.vercel.app/login` prints `200`.

- [ ] **Step 3: Browser walk (needs the owner's go-ahead)**

The live database is the only one and has no products. This step creates real records (products, an order that takes number B-1001 and later numbers, timeline entries). **Ask the owner before doing it.** With approval, using the demo admin (admin acting as the kitchen with a reason):
1. Catalogue: add "Test cake 1 kg" (made to order, Kitchen 1) and "Test bread" (made to order, Kitchen 2).
2. New call order: 2 cakes + 3 bread, pickup tomorrow noon; confirm.
3. KOT: Kitchen 1 ticket → Start, mark 2 ready (reason "Walkthrough test"); Kitchen 2 ticket → Acknowledge.
4. Order page: Edit items → cakes 3, bread 1, add nothing; reason "Customer called". Expect: Kitchen card shows both tickets with a Changed banner ("2 → 3", "3 → 1"); badge "Change unacknowledged" on the Orders list; Packing card lists both kitchens as not acknowledged.
5. Reschedule +1 hour. Expect a "Pickup: … → …" line added to each banner.
6. Acknowledge changes on both tickets (reason), finish the counts, Mark packed → Ready.
7. Print a ticket: REVISED r3 and the change list (or none after acknowledgement).
8. Cancel the order afterwards (reason "Walkthrough test") so it never reaches billing; archive the two test products.
Record what was seen in HANDOVER section 14 and fix anything broken in a follow-up commit.
