# Phase 5C — Kitchen revisions after acknowledgement

Date: 2026-10-03. Status: approved in conversation; spec awaiting review.
PRD references: section 7 (status model), section 8 (changes after release), AC-08, AC-12. Builds on the 5A spec (`2026-09-30-kitchen-tickets-design.md`) and 5B (`2026-10-03-packing-handover-design.md`).

## 1. Goal and decisions

Today an admin cannot change an order once any kitchen ticket is past New: `private.kitchen_guard` refuses with kind `kitchen`, and staff must cancel and recreate. 5C lets an admin change items and reschedule after the kitchen has acknowledged or started, while the kitchen sees exactly what changed and acknowledges it.

| Decision | Choice |
|---|---|
| Who | Admins only, with a reason (as for confirmed orders today). Counter staff unchanged. |
| Which orders | Confirmed and **Preparing**. **Ready** orders must be reopened first (existing `reopen_packing`). Billed orders stay locked (credit note). Draft and pending unchanged. |
| Lowering below the ready count | **Owner, 2026-10-03: allowed; the ready count is capped at the new quantity. No waste or counter-sale record.** |
| Kitchen acknowledgement | **Owner, 2026-10-03: the ticket keeps its status and ready counts and shows a "Changed" banner with the change list and an Acknowledge button. The chef can keep working. Packing is blocked until every change is acknowledged.** |
| Change summary storage | On the ticket (`pending_changes`), accumulated until acknowledged. History stays in `order_events`. No revisions table. |
| Reschedules | Same mechanism: a pickup-time change entry on each live ticket. Existing opening-hours, lead-time and capacity checks still apply. |
| Out of scope | Moving items between kitchens; waste/return records; edits on billed orders; stock counts (owner: none). |

## 2. Data model

### `kitchen_tickets` — new columns

| Column | Notes |
|---|---|
| `pending_changes jsonb not null default '[]'` | Changes not yet acknowledged. Each entry: `{"key": …, "kind": "quantity" \| "notes" \| "pickup", "item": "Chocolate cake — 1 kg", "from": …, "to": …}` (`from`/`to` are quantities, notes text, or timestamps for `pickup`). An added item is a quantity change from 0 and a removed one a quantity change to 0, so adding then removing an item before acknowledgement nets out. `key` is `qty:<order line>`, `notes:<order line>` or `pickup`. `check (jsonb_typeof(pending_changes) = 'array')`. |
| `changes_acknowledged_at timestamptz`, `changes_acknowledged_by uuid → staff_profiles` | Last acknowledgement. |

A ticket "has unacknowledged changes" when `jsonb_array_length(pending_changes) > 0`.

Merging: a second change before acknowledgement appends entries; an entry for the same item and kind replaces the earlier one's `to` and keeps the first `from` (so 2 → 3 then 3 → 5 shows 2 → 5). An entry whose merged `from` equals `to` is dropped.

### `kitchen_ticket_lines`

- No new columns. A removed item's line stays with `quantity = 0`, `ready_quantity = 0`, `status = 'cancelled'` (allowed by the existing `check (ready_quantity between 0 and quantity)`).
- `quantity` keeps meaning "active quantity" (order line `quantity − cancelled_quantity`).

### `order_items`

- After the kitchen has acknowledged, a line left out of an edit is **not deleted**: `cancelled_quantity = quantity`, `line_total_paise = 0`, `tax_paise = 0`. It drops out of totals (sums of `line_total_paise`), counts and capacity (`quantity > cancelled_quantity`), and bills: `private.issue_bill_locked` (latest in `20260927000310`) currently lists every order line, so 5C redefines it to skip lines where `quantity = cancelled_quantity`. Discount allocation already gives a zero-total line a zero share.
- A lowered quantity simply lowers `quantity` (as today), so prices stay right.
- Draft, pending, and confirmed-with-all-tickets-New orders keep today's behaviour (lines deleted).

### View `order_kitchen_progress`

Add `changes_pending integer`: number of live tickets with unacknowledged changes.

## 3. Functions

### `private.revise_tickets(order)` (new) — replaces the refusal

Called by `update_order_items` and `reschedule_order` after their changes, instead of `kitchen_guard` + `build_tickets`, for orders in `confirmed`/`preparing`.

Locks the order's tickets (order then ticket, as `kitchen_guard` does). Per kitchen with active made-to-order lines:

- **No ticket, or the ticket is cancelled:** existing `build_tickets` behaviour (new ticket, or reopen as New with revision + 1).
- **Ticket is New:** existing `build_tickets` behaviour (lines replaced, revision + 1, "Revised" badge, no acknowledgement needed: the chef has not seen it).
- **Ticket is acknowledged, preparing or ready:** revise in place:
  - For each order line of this kitchen, matched by `order_item_id`:
    - new line → insert a ticket line (`pending`, or `preparing` if the ticket has started); entry `added`;
    - quantity changed → set `quantity`; `ready_quantity := least(ready_quantity, quantity)`; entry `quantity`;
    - notes changed → update `notes`; entry `notes`;
    - line now inactive (cancelled) → `quantity = 0`, `ready_quantity = 0`, `status = 'cancelled'`; entry `removed`.
  - Line status recomputed (`ready` at full quantity, `preparing` above zero or once started, else `pending`).
  - `due_at` changed → update `due_at` and `start_by`; entry `pickup`.
  - If anything changed: `revision + 1`, `revised_at = now()`, merge entries into `pending_changes`, then `private.sync_ticket` (a Ready ticket that gained work drops to Preparing and clears `ready_at`; one whose remaining lines are now all ready becomes Ready).
- **Kitchen with no active lines left:** existing stop-work cancellation (ticket cancelled, lines cancelled, stop-work notice).

Returns the number of tickets changed; the caller logs `tickets_revised` with `{cause, tickets: [{reference, changes}]}`.

`build_tickets` stays for confirmation. `kitchen_guard` is no longer called by edits and reschedules; it is dropped if nothing else uses it.

### `update_order_items` (changed)

- Allowed statuses: draft, pending (admin or counter); confirmed and **preparing** (admin, reason required). Ready: refused, "Reopen packing first." Billed: refused as today.
- Lines left out: deleted when no ticket line for them sits on a ticket past New; otherwise cancelled as in section 2.
- Increases and new lines keep today's availability, lead-time and capacity checks.
- Calls `revise_tickets` for confirmed and preparing orders.

### `reschedule_order` (changed)

- Allowed on preparing orders as well (admin, reason). Ready: refused, "Reopen packing first."
- Calls `revise_tickets` instead of the guard.

### `acknowledge_ticket_changes(ticket, reason)` (new, public)

- `private.ticket_actor` rules: assigned chef; admin with a reason (≥ 5 characters); others refused.
- No pending changes → no-op (double taps change nothing).
- Otherwise clears `pending_changes`, sets `changes_acknowledged_at/by`, logs `ticket_changes_acknowledged` with the acknowledged entries.
- Allowed on a ticket in any status except cancelled.

### `mark_packed` (changed)

Refuses while any live ticket of the order has pending changes: "Kitchen 1 has not acknowledged the latest change." (kind `kitchen`, not overridable).

### `ticket_stamp`

Unchanged: every write above updates the ticket's `updated_at`, so the chef screen refreshes.

## 4. Screens

### Chef screen `/kitchen`

- A ticket with pending changes sorts first within its day group and shows a **"Changed"** banner (contrasting colour) listing each change in words: "Chocolate cake 1 kg: 2 → 3", "Plum cake 500 g: removed", "New: Butter cookies × 12", "Notes changed: …", "Pickup: 5:00 PM → 7:00 PM". One large **Acknowledge changes** button.
- Removed lines stay visible, struck through, labelled "Removed", with no ready controls.
- Change wording lives in a small pure function in `src/lib/kitchen.ts` with unit tests.

### Printed ticket `/print/kot/[id]`

Shows `REVISED r{n}` when revision > 1 and lists pending changes at the top. Removed lines printed struck through.

### Order page

- Kitchen card: "Change not yet acknowledged" per ticket with pending changes, with the list.
- **Edit items** and **Reschedule** shown to admins on Preparing orders and on Confirmed orders past New (they are hidden or refused today). Hidden on Ready with a hint to reopen packing.
- Cancelled (removed) lines are shown struck through in the Items card and excluded from the edit form.
- Packing card lists unacknowledged changes as a blocker.
- Timeline: "Kitchen tickets revised" with the change list; "Kitchen acknowledged changes".

### `/admin/kot`

New list "Awaiting acknowledgement of changes" next to the stop-work list; admins can acknowledge with a reason.

### Order lists and calendar

Kitchen badge "Change unacknowledged" from `order_kitchen_progress.changes_pending`.

## 5. Errors

- `kitchen` kind remains non-overridable; now used by `mark_packed` for pending changes and by the Ready refusal.
- Concurrency: edits keep the order version check; chef actions take no version. A chef acknowledging while an admin edits: the lock order (order, then tickets) serialises them; if the edit commits second, its new entries remain pending.

## 6. Testing

- New `supabase/tests/revisions_logic.sql` (orders from 990401), run with `supabase/local/run-tests.sh`:
  - add, increase, lower (below the ready count: capped), notes change and remove after acknowledgement; ready counts kept or capped; removed order line cancelled not deleted; totals exclude it;
  - a ready line or Ready ticket that grows drops to Preparing; lowering to the ready count makes it Ready;
  - two edits before acknowledgement merge (2 → 3 → 5 shows 2 → 5; 2 → 3 → 2 disappears);
  - reschedule after acknowledgement adds a pickup entry;
  - acknowledgement clears, repeats no-op; chef of another kitchen, counter, and admin without reason refused;
  - `mark_packed` blocked until acknowledged; edits and reschedules on Ready refused;
  - removing every item of a kitchen raises stop-work; New tickets still rebuilt as in 5A;
  - counter staff or a missing reason refused on preparing orders;
  - bills skip cancelled lines.
- Rerun `kitchen_logic`, `edit_items_logic`, `packing_logic`, `orders_logic`, `billing_logic`. Checks in `kitchen_logic`/`edit_items_logic` that expect "refused once acknowledged" are updated to the new behaviour.
- `npm test` (change wording), typecheck, lint, build.
- Browser click-through: confirm → chef acknowledges and starts → admin edits → chef sees the banner and acknowledges → pack → hand over.
