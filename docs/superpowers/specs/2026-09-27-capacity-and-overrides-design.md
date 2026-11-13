# Phase 4C — Capacity caps and the reusable override prompt

Date: 2026-09-27. Status: approved design, awaiting spec review.
Covers Phase 4C pieces 1 and 2 (AC-32, and the reusable part of AC-36). Notification templates, calendar week/day views, customer blocking screens, and editing pending-order items are separate follow-up specs.

## 1. Decisions (from the owner)

| Question | Decision |
|---|---|
| What is capacity? | Both: daily caps per category **and** a total-orders limit per pickup window. |
| How are windows defined? | Owner-defined list of windows (start, end, limit) **per weekday**. |
| Festivals | Date overrides replace a day's whole window list, or one category's cap. |
| What a category cap counts | **Orders**: an order containing any item of the category uses one place, regardless of quantity. |
| Category caps vary by weekday? | Not answered; **assumed no** — one cap per category plus date overrides. |
| Cut-offs | **Dropped.** Product lead times already cover them. Record in PRD 5F and section 14 item 23. |
| Who can override a full window/day | **Admins only**, with a reason (same as other scheduling overrides). |

## 2. Data model (migration `20260927000400_capacity.sql`)

All tables: RLS enabled; revoke default API grants; `select` for any active staff, `insert/update/delete` for admins only; audit trigger attached, as in earlier migrations.

- `pickup_windows(id, weekday smallint 0–6 (0 = Sunday), starts_at time, ends_at time, max_orders integer null, created_at)`
  - `check (ends_at > starts_at)`, `check (max_orders is null or max_orders >= 0)`.
  - No two windows on the same weekday may overlap (exclusion constraint on `weekday` + time range, using `btree_gist`; if that extension is unavailable, enforce in a trigger).
  - `max_orders null` = no limit for that window.
- `order_items.category_id uuid null references categories on delete set null`: new snapshot column filled by `create_order` from the product at order time (order lines are snapshots; `product_id` can become null if a product is deleted). No backfill needed: the live database has no orders. Category caps count by this column.
- `category_daily_caps(category_id uuid primary key references categories, max_orders integer not null check >= 0)`. No row = no cap.
- `capacity_overrides(id, on_date date, kind text check in ('window','category'), category_id uuid null, starts_at time null, ends_at time null, max_orders integer null, note text not null, created_by, created_at)`
  - `kind='window'`: rows for a date **replace that date's whole window list**. A date with window-kind rows uses only those rows.
  - `kind='category'`: replaces that category's cap for the date; `max_orders = 0` means the category cannot be ordered that day; one row per (date, category).
  - A single-row "closed-style" override for a date with zero windows is not supported; use existing closures for that.

## 3. Rules

- **Counted orders:** every status except `draft`, `rejected` and `cancelled` (so `pending_confirmation`, `confirmed`, `preparing`, `ready`, `completed` all count — an order already made still used the day's capacity), and not counter sales (`is_immediate = false`), with `due_at` in the window (`[start, end)` in business time) or on the business-local date.
- **Windows for a date:** date overrides of kind `window` if any exist, else the weekday list.
- **Weekday with no windows:** no window restriction; only opening hours, closures and lead time apply. Nothing changes until windows are configured.
- **Time outside every window** (when the day has windows): refused with kind `slot` ("11:30 is outside the pickup windows for Tuesday"). Admin-overridable.
- **Full window:** refused with kind `capacity`, message "Pickup window 11:00–13:00 is full (6/6)."
- **Capped category:** refused with kind `capacity`, message "Custom Cakes: 8/8 orders on 12 Nov."
- **Self-exclusion:** the order being checked is excluded from counts, so rescheduling within a window or confirming never fails because of itself.
- **Confirm re-checks caps.** Pending orders already count, so this normally passes; it fails only when settings were lowered or the order moved.
- **Lowered limits** never alter existing orders; the window reports e.g. 7/6 and takes no new bookings.
- **Concurrency:** before counting, take `pg_advisory_xact_lock` keyed on the business-local due date, so two transactions cannot both take the last place.
- **Timezone:** all date/time arithmetic uses `business_settings.timezone` (Asia/Kolkata).
- **Override reason:** must be at least 5 characters after trimming (server-checked; currently only UI-checked). Overrides write the existing `override` timeline event; details gain a `capacity` key with the problem text.

## 4. Database functions

- `private.windows_for_date(d date)` → set of (starts_at, ends_at, max_orders).
- `private.capacity_problem(p_order_id uuid, p_due timestamptz, out message text, out kind text)` → both null when fine; otherwise the first problem with `kind` = `slot` (outside every window) or `capacity` (full window or capped category). Checks window membership, window count, and category caps for the categories in the order's lines. Takes the advisory lock.
- Integrate into `create_order` (after lines are inserted, beside the lead-time check), `confirm_locked`, and `reschedule_order`. Counter sales (`counter_sale`, immediate orders) skip it.
- `public.pickup_availability(p_date date)` → jsonb `{ windows: [{starts_at, ends_at, used, max}], categories: [{category_id, name, used, max}] }`. Callable by staff now; public (anon) access will be decided in Phase 6.

## 5. Web app

- **`<OverridePrompt>`** (new shared component in `web/src/components/`) replaces the three hand-written override blocks in `orders/new/order-entry.tsx` and `orders/[id]/order-actions.tsx` (confirm and reschedule). Props: the error (message + kind), whether the user is admin, and a `retry(reason)` callback. It shows the exact refusal, a reason field (≥ 5 chars), and "Save with override". Non-admins see the refusal and "Ask an admin to override." `capacity` joins `OVERRIDABLE_KINDS`.
- **Settings → Capacity** (admins; new section on the settings page, own form component):
  - Weekday windows editor (per weekday list: start, end, limit; add/remove; "Copy Monday to all days").
  - Category caps table (category name, max orders per day, blank = none).
  - Date overrides: date, note, then either replacement windows or replacement category caps; list of upcoming overrides with delete; past ones hidden.
  - Validation (zod + DB constraints): no overlap, end after start, limits ≥ 0, override date not in the past.
- **New order and reschedule:** once a date is chosen, show that day's windows with usage ("11:00–13:00 · 4/6 booked", full ones marked **Full**) and cap warnings for categories in the cart ("Custom Cakes: 7/8 on this day"), using `pickup_availability`. Choosing a full window proceeds to the override prompt on save.
- **Order timeline:** override events show the reason and the capacity text.
- Regenerate `web/src/lib/database.types.ts` after the migration.

## 6. Testing

- New `supabase/tests/capacity_logic.sql` (seeds its own data, rolls back): full window refused; admin override recorded with reason and capacity details; counter staff cannot override; category cap counts orders not units; cancelled/rejected excluded; counter sales excluded; reschedule within the same window succeeds; festival window override replaces the weekday list; weekday with no windows is unrestricted; time outside windows refused as `slot`; short override reason refused; `pickup_availability` counts correct; advisory lock taken (checked via `pg_locks` in the same transaction).
- Re-run `orders_logic.sql` and `billing_logic.sql`.
- `npm run typecheck`, `npm run lint`, `npm run build`.
- Manual browser pass of Settings → Capacity and the new-order/reschedule pickers. Test orders only; **no bills issued on the live project**. Reset `order_number_seq` to 1001 afterwards only if no real orders exist.
- Run Supabase security and performance advisors after the migration.

## 7. Docs to update when implemented

PRD 5F "Daily order caps and cut-offs" (cut-offs dropped; windows per weekday), PRD section 14 item 23, TODO Phase 4C checkboxes, HANDOVER migration list and tests table, PROJECT_RULES decision log.

## 8. Out of scope

Public website use of availability (Phase 6); notification templates; calendar week/day views; customer blocking screens; editing items on pending orders; per-weekday category caps.

## 9. Deviations during implementation (2026-09-28)

- The migration is split into `20260927000400_capacity.sql` (schema) and `20260927000410_capacity_enforcement.sql` (checks).
- Weekday and date window lists are saved through the admin-only RPCs `set_pickup_windows` and `set_date_windows`, so each save is atomic.
- Non-admins see the database message, which already says "An admin can override with a reason"; no extra line is added.
- `database.types.ts` was extended by hand rather than fully regenerated.
