# Phase 5A — Kitchen tickets (core loop)

Date: 2026-09-30. Status: approved design, awaiting spec review.
Covers the first of four Phase 5 pieces. 5B packing and handover, 5C revisions after release, and 5D chef PIN sign-in are separate specs.
PRD references: 5B (KOT), 5C (chef area), 6 (mixed-kitchen example), 7 (status model), 8 (changes), AC-02 to AC-05, AC-08, AC-13, AC-33.

## 1. Decisions

| Question | Decision |
|---|---|
| Phase 5 split | 5A tickets core loop → 5B packing and handover → 5C revisions after release → 5D PIN sign-in. |
| When a ticket reaches the kitchen | **On confirmation.** No scheduled state, no release job. The chef screen groups by pickup day to keep future work out of the way. |
| Order state when every ticket is done | **Stays Preparing** with an "All kitchen items ready" flag. Ready is set by packing in 5B (PRD 7). |
| How chefs mark progress | **Whole line with one tap, plus an optional partial count.** A line stays Preparing until its full quantity is ready. |
| Architecture | **Ticket tables + 10-second refresh.** No Supabase Realtime in 5A. |
| Changes to confirmed orders | Allowed (tickets rebuilt in place) while every ticket is still New. Refused once any ticket is acknowledged or started, until 5C. Cancelling is always allowed and raises a stop-work notice. |

## 2. Data model (migration `20260930000300_kitchen_tickets.sql`)

All tables: RLS enabled; default API grants revoked; `select` only; writes only through the functions in section 3; audit trigger attached; `updated_at` trigger where the table has one.

### Enums

- `ticket_status`: `new`, `acknowledged`, `preparing`, `ready`, `cancelled`.
- `ticket_line_status`: `pending`, `preparing`, `ready`, `cancelled`.

### `kitchen_tickets`

| Column | Notes |
|---|---|
| `id uuid pk` | |
| `order_id uuid not null → orders on delete cascade` | |
| `kitchen_id uuid not null → kitchens on delete restrict` | `unique (order_id, kitchen_id)`: one ticket per kitchen per order, reused across rebuilds. |
| `reference text not null unique` | Order reference + `-` + kitchen code, e.g. `B-1001-K1`. |
| `revision integer not null default 1` | +1 on every rebuild. |
| `source order_source not null` | Copied from the order. |
| `status ticket_status not null default 'new'` | |
| `due_at timestamptz not null` | The order's due time. |
| `start_by timestamptz not null` | `due_at` − the longest line `lead_time_minutes`. |
| `revised_at timestamptz` | Set on rebuild; drives the "Revised" badge. |
| `acknowledged_at`, `acknowledged_by` | |
| `started_at`, `started_by` | |
| `ready_at`, `ready_by` | Set when the last line becomes ready; cleared by a correction. |
| `cancelled_at`, `cancel_reason` | |
| `stop_work_acknowledged_at`, `stop_work_acknowledged_by` | A cancelled ticket shows a stop-work notice while this is null. |
| `print_count integer not null default 0` | |
| `created_at`, `updated_at` | |

Indexes: `(kitchen_id, status, due_at)`, `(order_id)`, and each `*_by` foreign key.

Tickets hold **no prices, no customer name, phone or notes, and no internal notes**. Anything the kitchen needs, such as cake wording, belongs in the item notes.

### `kitchen_ticket_lines`

| Column | Notes |
|---|---|
| `id uuid pk` | |
| `ticket_id uuid not null → kitchen_tickets on delete cascade` | |
| `order_item_id uuid unique → order_items on delete set null` | Nullable: when an edit deletes an order line, a stop-work ticket keeps its snapshot line so the chef still sees what to stop. |
| `line_no integer not null` | Copied from the order line. |
| `product_name`, `variant_name` | Snapshot. |
| `quantity integer not null` | Active quantity (`quantity − cancelled_quantity` of the order line). |
| `ready_quantity integer not null default 0` | `check (ready_quantity between 0 and quantity)`. |
| `is_veg`, `contains_egg`, `is_eggless`, `allergens text[]` | Snapshot; shown prominently (AC-33). |
| `notes text` | Item notes. |
| `lead_time_minutes integer not null` | Line start by = ticket `due_at` − this. |
| `status ticket_line_status not null default 'pending'` | |

### `kitchen_issues`

`id`, `ticket_id → kitchen_tickets`, `line_id → kitchen_ticket_lines null`, `kind text check in ('ingredient', 'equipment', 'quality', 'other')`, `note text not null check (length(trim(note)) between 3 and 500)`, `reported_by`, `reported_at`, `resolved_by`, `resolved_at`, `resolution text` (required when resolved, at most 500 characters).

### View `order_kitchen_progress` (`security_invoker`)

One row per order that has tickets: `order_id`, `ticket_count` (not cancelled), `ready_count`, `all_ready` (every non-cancelled ticket ready, and at least one), `open_issues`, `stop_work_pending`. Used by order lists, the calendar and the order page.

### Access

- `private.can_see_kitchen(kitchen_id)`: true for admin and counter; true for a chef assigned to that kitchen in `staff_kitchens`.
- Select policies on all three tables and the view use it (through the ticket for lines and issues).
- Chefs still have **no access** to `orders`, `order_items`, `payments`, `customers`, `order_events`, bills or credit notes.

### Backfill

The migration creates tickets for any existing confirmed or preparing orders that have none. The live database has no orders today, so this is a safety net.

## 3. Functions

All functions: `security definer`, `set search_path = ''`, role check first, errors through `private.fail(message, kind)`, execute revoked from `public`/`anon` and granted to `authenticated`.

### Who may act on a ticket (`private.ticket_actor(ticket, reason)`)

- **A chef assigned to the ticket's kitchen:** allowed; `reason` is ignored.
- **An admin:** allowed as an exception; `reason` is required (at least 5 characters) and recorded.
- **Everyone else, including counter staff:** refused with kind `forbidden`.
- The same check refuses any action on a cancelled ticket, except `acknowledge_stop_work`.

### Ticket building (`private.build_tickets(order)`)

- Groups the order's made-to-order lines with an active quantity above zero by `kitchen_id`.
- Existing ticket for a kitchen:
  - if its lines (product, variant, quantity, notes) and `due_at` are unchanged, leave it alone;
  - otherwise replace its lines, bump `revision`, set `revised_at`, and refresh `due_at` and `start_by`;
  - if it was cancelled, reopen it as `new` and clear the cancellation fields.
- New kitchen: insert a ticket.
- A kitchen that no longer has lines: its ticket is cancelled (`cancel_reason` "Removed from the order"), which raises a stop-work notice.
- Ready-stock lines never get tickets.
- Called by `private.confirm_locked`, which covers both `confirm_order` and `create_order(p_confirm => true)`. The first build does not count as a revision: the revision stays 1 and `revised_at` stays null.

### Chef actions

Chef actions take **no version number**: each states an end result, so a repeat or double tap changes nothing. Every change to the order's status bumps the order version.

| Function | Rule |
|---|---|
| `acknowledge_ticket(ticket, reason)` | `new` → `acknowledged`. A no-op in any later state. |
| `start_ticket(ticket, reason)` | `new`/`acknowledged` → `preparing`; sets acknowledged if missing; pending lines → `preparing`; order `confirmed` → `preparing`. A no-op if already preparing or ready. |
| `set_line_ready(line, ready_quantity, reason)` | Sets the count, 0..quantity. The line becomes `ready` at full quantity, `preparing` above zero or once the ticket has started, and `pending` otherwise. Starts the ticket if needed. The ticket becomes `ready` when every line is ready, and drops back to `preparing` when a count is lowered. Recalculates the order's move to Preparing. |
| `report_issue(ticket, line, kind, note)` | Chef or admin. No reason is needed for an admin, because reporting is not an exception. |
| `acknowledge_stop_work(ticket)` | Only on a cancelled ticket; sets the acknowledgement once. An admin may acknowledge with a reason. |
| `resolve_issue(issue, resolution)` | Admin only. |
| `record_ticket_print(ticket)` | Chef, admin or counter; increments `print_count` and returns it. |

**Timeline events.** These are written to `order_events` (`private.log_order_event`), with the kitchen name and ticket reference in `data`:
- `ticket_acknowledged`, `ticket_started`, `ticket_ready`;
- `ready_count_corrected` (a lowered count, with from and to);
- `kitchen_issue_reported`, `kitchen_issue_resolved`;
- `stop_work_acknowledged`;
- `tickets_revised`.

Line-level ready taps are not logged individually.

### Changes to existing order functions

- **`private.confirm_locked`:** calls `private.build_tickets` after the status update.
- **`update_order_items` and `reschedule_order` on a confirmed order:**
  - If any non-cancelled ticket for the order is past `new`, refuse with kind `kitchen`: "The kitchen has already acknowledged this order. Cancel it and create a new one, or wait for kitchen revisions."
  - Otherwise rebuild the tickets after the change and log `tickets_revised`.
  - Pending orders are unaffected.
- **`cancel_order`:** cancels every non-cancelled ticket (`cancel_reason` = the order's reason). This raises stop-work notices. Ready counts are kept in the record.
- **`kitchen` is not overridable.** It is not added to `OVERRIDABLE_KINDS`.

## 4. Screens

### Chef screen `/kitchen` (tablet-first; large touch targets)

- **Header:**
  - kitchen name, with a switch when the chef is assigned to more than one kitchen (default: all their kitchens);
  - chef name, sign out;
  - refresh status.
- **Refresh:**
  - A client component polls a small server action every 10 seconds while the tab is visible. The action returns a stamp: the latest `updated_at` and the count of visible tickets.
  - When the stamp changes, it calls `router.refresh()`.
  - The status shows "Updated N s ago".
  - After a failed poll it shows a red **Offline, showing data from HH:MM** banner, and actions show "Not saved, check the connection".
- **Stop-work notices:** pinned at the top in red until acknowledged. They show the reference, cancel reason and lines.
- **Active tab:**
  - Tickets `new`, `acknowledged` or `preparing`.
  - Grouped by pickup day in the business timezone: Today (including overdue from earlier days), Tomorrow, Later.
  - Within a group: overdue (`due_at` passed) first, then by `start_by`, then by `due_at`.
  - Filter chips: All / In-store / Online & Call.
- **Ticket card:**
  - reference, source badge, "Revised" badge (revision > 1);
  - pickup time, start by (red when passed);
  - lines with a large quantity, product and variant, veg mark and Eggless/Contains egg badge, allergens, notes;
  - actions: Start, a per-line **Ready** button and "Part ready" count control, Report issue (kind + note), Print.
- **Done tab:** tickets that became ready today, and cancelled tickets whose stop-work was acknowledged today. Read-only.

### Printed ticket `/print/kot/[id]`

- 80mm layout like `/print/bill/[id]`.
- Shows the reference, revision, kitchen, source, pickup and start-by times, and lines with marks, allergens and notes. **No prices.**
- The Print button calls `record_ticket_print`, then opens the page. The page shows **COPY** when `print_count > 1`.
- Chefs may open prints only for their own kitchens; admin and counter may open any.

### Admin and counter

- **`/admin/kot`** (replaces the placeholder):
  - an **Open issues** list, where admins resolve with a note;
  - a ticket table filterable by kitchen, source, pickup date (default today) and status, linking to the order;
  - admins can start, mark ready or acknowledge with a reason (exception).
- **Order page:** a **Kitchen** card listing each ticket with status, lines, ready counts, open issues, stop-work state and a Print link. Timeline labels for the new events.
- **Order lists and calendar:** **All kitchen items ready** and **Issue** badges from `order_kitchen_progress`.
- **Error message:** item editing and rescheduling show the `kitchen` refusal as a plain error.

## 5. Error handling

- New kinds:
  - `kitchen`: the order has acknowledged tickets;
  - `forbidden`: a chef not assigned to the kitchen, counter staff acting, or an admin exception without a reason.
- A failed chef action shows its message on the card and triggers an immediate refresh.
- Nothing is shown as saved until the server accepts it (PRD 8).

## 6. Testing

- **`supabase/tests/kitchen_logic.sql`:** rolled back; orders inserted directly from 990201; uses two test kitchens. Checks:
  - one ticket per kitchen on confirmation, and none for ready-stock lines;
  - ticket references, and no price or customer columns;
  - chef access to one kitchen versus both; no chef access to orders;
  - start, ready counts, corrections, ticket ready, the order moving to Preparing, and `all_ready`;
  - repeated actions change nothing;
  - admin exceptions need a reason; counter staff are refused;
  - issues reported and resolved;
  - cancel → stop-work → acknowledge;
  - edits and reschedules rebuild New tickets (revision, dropped kitchen cancelled, added kitchen created) and are refused once acknowledged;
  - print count.
- **Rerun** `orders_logic`, `billing_logic`, `capacity_logic`, `no_show_logic` and `edit_items_logic`. Confirm, cancel, edit and reschedule change; expected outcomes may need updating where tickets now appear.
- **Unit tests** (`npm test`) for the queue helper: day grouping in the business timezone and sort order.
- Typecheck, lint, production build.

## 7. Out of scope

- Packing, allocating ready-stock items, handover and completion (5B).
- Revisions to acknowledged work, preserving prepared quantities across edits, moving work to another kitchen (5C).
- PIN sign-in on tablets (5D).
- Daily production summary, sound alerts, thermal-printer integrations, Supabase Realtime.
