# Phase 5B: packing and handover — design

Date: 2026-10-03. Status: built with the defaults below while the owner was away; **owner to confirm the defaults marked (default)**.

Sources: PRD section 5D "Packing and handover checklist" (Release 1 part), section 7 status model, AC-10, AC-13, AC-22 (basic). Owner decisions that apply: no stock or inventory tracking (2026-10-02).

## Scope (Release 1)

- **One packing confirmation per order** moves it to **Ready**, recording who packed it, when, and an optional note.
- **One handover** moves a Ready order to **Completed**, recording who handed it over, when, and optionally who collected it.
- Itemized packing checklists, recipient verification, substitutions, remakes and late/uncollected workflows stay in Release 1.1 (AC-21, AC-23 to AC-25).

## Rules

### Packing (`mark_packed`)

- Admin and counter staff (PRD 5D: "Admin or permitted Counter Staff owns final packing and handover"). Chefs cannot. (default: every counter account may pack.)
- Only **Confirmed** or **Preparing** orders. A Ready order packed again returns it unchanged (a retry does nothing).
- Every live kitchen ticket must be **Ready**, and no kitchen issue may be open. Admins who need to override a kitchen do it on the ticket itself (existing exception with a reason), so packing has no override.
- Ready-stock lines need no kitchen; packing confirms they were picked (no stock counts, owner decision). A ready-stock-only order goes Confirmed → Ready directly (PRD section 7).
- Takes the order version, like every other order change, so a concurrent edit fails with "conflict".

### Reopening (`reopen_packing`)

- Admin only, reason of at least 5 characters (PRD section 7: "Admin may reopen Ready work for a correction with a reason"). Ready → Preparing (or Confirmed when the order has no kitchen tickets). The packing record is cleared; the timeline keeps it.

### Handover (`record_handover`)

- Admin and counter staff, Ready orders only. A Completed order handed over again returns it unchanged (AC-22: "a retry creates no duplicate handover").
- **Balance check (AC-10).** With a balance due, counter staff are refused ("record the payment first"). An admin can hand over on credit with a reason (at least 5 characters); the reason and the balance at handover are recorded. (default: only admins grant credit.) A refund due does not block handover; the order page keeps showing it.
- **Bill.** A Completed sale always has a GST bill (PRD 5F "Generate a customer bill for every completed sale"). If none was issued, handover issues it in the same transaction (same rules and numbering as Issue bill).
- Optional "collected by" name (up to 80 characters), recorded only when staff choose to (PRD: record the collector only if operationally required).

### Order status after this phase

`confirmed → preparing` (kitchen starts) `→ ready` (packed) `→ completed` (handed over). Cancelling a Ready order stays possible (admin, reason); a Completed order cannot be cancelled, edited, rescheduled or reopened.

## Data

Columns on `orders` (the order is the single packing unit in Release 1): `packed_at`, `packed_by`, `packing_note`, `handed_over_by`, `collected_by`, `credit_reason`. `completed_at` already exists. Timeline events: `packed`, `packing_reopened`, `handed_over`.

`order_summaries` was created with `o.*`, so the new columns are read from `orders`.

## Screens

- Order page: a **Packing & handover** card. Before packing it lists what is still missing (kitchens not ready, open issues); then "Mark packed"; once Ready it shows who packed it and the handover form with the balance; admins see "Reopen" and, when money is due, "Hand over on credit".
- Home: "Ready for pickup" and "Late pickups" (Ready, past pickup time), so late collections stay visible (PRD 5D interim handling).

## Tests

`supabase/tests/packing_logic.sql` (orders from 990301).
