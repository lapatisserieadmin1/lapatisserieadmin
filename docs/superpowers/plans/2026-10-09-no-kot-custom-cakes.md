# Remove KOT, customer orders, custom cakes, product photos, collect/set-up — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the spec `docs/superpowers/specs/2026-10-09-no-kot-custom-cakes-design.md`. That means: switch off kitchen tickets and remove every KOT/chef screen, open Customers to counter staff, add the Customer order source, custom cake orders with a photo and an advance, product photos, and collect/set-up with green/red highlights.

**Architecture:** Three new migrations. (1) Enum values. (2) Rules: the ticket switch-off, new order columns, a rewritten `create_order`, custom cakes, `set_fulfilment`, and the recreated `order_summaries`. (3) Storage buckets and photo functions. Database rules are checked by new PGlite SQL check files. The web app drops the kitchen code, and the new screens follow the existing order-entry, orders-list and order-page patterns. `database.types.ts` is edited by hand, because the remote project does not have the migrations until deploy.

**Tech Stack:** Next.js 16 (App Router, server actions), Supabase (Postgres + Storage), Tailwind v4, zod, PGlite checks (`supabase/local/pglite/run.mjs`), `node --test` unit tests.

**Spec:** `docs/superpowers/specs/2026-10-09-no-kot-custom-cakes-design.md`

## Global Constraints

- No stock, inventory or allocation anywhere (owner rule).
- Database writes only through `security definer` functions with `set search_path = ''`, `private.fail(message, kind)` for refusals, `private.lock_order(id, version)` for optimistic locking, and `private.log_order_event` for the timeline.
- Never drop the ticket, kitchen or chef data. The old history stays readable.
- Money is in paise (bigint). Prices include GST, and tax = round(total × bps / (10000 + bps)).
- Colours: collect = `ok` tokens (green) and set-up = `danger` tokens (red), always with a text label.
- The dev server runs `npx next dev --webpack` (Turbopack 500s from Claude's shell).
- SQL checks run on PGlite first (`cd supabase/local/pglite && node run.mjs`). Never on the live project from tests.
- Commit messages end with the Co-Authored-By line from the session.

## Review Focus

1. **Orders confirmed before the switch with open tickets.** They must still pack. The migration retires live tickets, and a check in `no_kot_logic` covers it.
2. **A custom cake line on an order whose items are edited.** Its quantity cannot grow (no variant), and removing it must not leave a dangling `custom_cakes` row. Covered by a check in `custom_cakes_logic`: increasing qty is refused, and removing the line deletes or cancels it cleanly.
3. **Set-up order without an address coming from any path** (create, custom cake, set_fulfilment). It is refused. Covered by checks in `fulfilment_logic`.
4. **An advance larger than the custom cake price.** Refused, and nothing is created. Covered by a check in `custom_cakes_logic`.
5. **A counter user creating a CUSTOMER order with confirm ticked.** Refused like a call order, because only an admin confirms non-in-store orders. Covered by a check in `fulfilment_logic`.

---

### Task 1: Enum values (migration 1)

**Files:**
- Create: `supabase/migrations/20261009000100_customer_source_fulfilment_type.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 2026-10-09: new order source (orders a customer sends in: WhatsApp, message) and the fulfilment type.
-- Own migration: a new enum value cannot be used in the transaction that adds it.
alter type public.order_source add value if not exists 'CUSTOMER';
create type public.fulfilment_type as enum ('collect', 'setup');
```

- [ ] **Step 2: Run all SQL checks.** They must still pass: `cd supabase/local/pglite && node run.mjs`.
- [ ] **Step 3: Commit.**

### Task 2: Kitchen tickets switched off, fulfilment, Customer source, custom cakes (migration 2) + SQL checks

**Files:**
- Create: `supabase/migrations/20261009000200_no_kot_custom_cakes.sql`
- Create: `supabase/tests/no_kot_logic.sql`, `supabase/tests/fulfilment_logic.sql`, `supabase/tests/custom_cakes_logic.sql`
- Delete: `supabase/tests/kitchen_logic.sql`, `supabase/tests/revisions_logic.sql`, `supabase/tests/pin_logic.sql` (they test what is removed)
- Modify: `supabase/tests/orders_logic.sql` (the "unmapped item blocks confirmation" check now expects `confirmed`), and `packing_logic.sql`/`edit_items_logic.sql` wherever they expect tickets

**Interfaces produced (used by Tasks 5–7):**
- `orders.fulfilment fulfilment_type not null default 'collect'`, `orders.setup_address text`, `orders.setup_note text`. `order_summaries` carries them through `o.*`.
- `business_settings.custom_cake_tax_rate_bps integer not null default 500`, `business_settings.custom_cake_hsn_code text`.
- `public.custom_cakes` (columns as in spec §6).
- `public.create_order(p_idempotency_key uuid, p_source order_source, p_items jsonb, p_customer_name text, p_customer_phone text, p_due_at timestamptz, p_customer_notes text, p_internal_notes text, p_confirm boolean, p_override_reason text, p_fulfilment fulfilment_type default 'collect', p_setup_address text default null, p_setup_note text default null) returns orders`
- `public.create_custom_cake_order(p_idempotency_key uuid, p_source order_source, p_customer_name text, p_customer_phone text, p_due_at timestamptz, p_price_paise bigint, p_cake jsonb, p_customer_notes text, p_internal_notes text, p_confirm boolean, p_override_reason text, p_fulfilment fulfilment_type, p_setup_address text, p_setup_note text, p_advance_paise bigint, p_advance_method payment_method, p_advance_reference text) returns orders`
- `p_cake` keys: `flavour, weight_kg, tiers, theme, cream, filling, toppings, message, is_eggless, instructions`.
- `public.update_custom_cake(p_order_id uuid, p_expected_version integer, p_cake jsonb, p_price_paise bigint) returns orders`
- `public.set_fulfilment(p_order_id uuid, p_expected_version integer, p_fulfilment fulfilment_type, p_setup_address text, p_setup_note text) returns orders`

- [ ] **Step 1: Write the failing checks.** The three new check files follow the `packing_logic.sql` pattern: begin, temp `r`/`ctx`, staff rows, `set local role authenticated` plus `request.jwt.claims` per actor, and `-- expect:` lines. Checks:
  - **no_kot_logic:**
    - an order with a made-to-order item and no kitchen confirms (expect `confirmed`), with 0 `kitchen_tickets` rows;
    - a ticket inserted as `new` before re-running the retire statement ends `cancelled` with `stop_work_acknowledged_at` set;
    - `mark_packed` on a confirmed order → `ready`;
    - `verify_kitchen_pin` as authenticated → `permission denied`.
  - **fulfilment_logic:**
    - `create_order(... p_fulfilment => 'setup')` without an address → "Set-up orders need the customer's address.";
    - with an address → `setup`;
    - collect with an address → address stored null;
    - a CUSTOMER order without a phone → "Customer orders need the customer's name and phone number.";
    - a counter user creating a CUSTOMER order with confirm → "Only an admin can confirm call, customer and online orders.";
    - `set_fulfilment` to setup → logs `fulfilment_changed`;
    - `set_fulfilment` on a completed order → refused;
    - `counter_sale` orders → `collect`.
  - **custom_cakes_logic:**
    - a custom cake order of ₹1500 at 5% → total 150000, tax 7143, line `Custom cake`, `custom_cakes` row present;
    - an advance of ₹500 cash → balance 100000;
    - an advance above the total → "The advance is more than the price." with no order created;
    - the same idempotency key → same order id;
    - flavour missing → "Enter the flavour.";
    - weight 0 → "Weight must be between 0.25 and 50 kg.";
    - `update_custom_cake` price ₹1800 → total 180000;
    - `update_custom_cake` after `mark_packed` → refused;
    - `update_order_items` raising the custom line's qty → "not available";
    - `custom_cake_tax_rate_bps` changed to 1800 → a new order uses 1800;
    - a counter user can read `custom_cakes`.
- [ ] **Step 2: Run** `node run.mjs no_kot_logic fulfilment_logic custom_cakes_logic`. Expect failures: functions and columns are missing.
- [ ] **Step 3: Write migration 2.** Sections:
  1. `create or replace function private.build_tickets(p_order_id uuid) returns integer … begin return 0; end`.
  2. `private.confirm_locked`: copy it from `20260930000300_kitchen_tickets.sql`, drop the kitchen mapping update and unmapped block and the `build_tickets` call, and change the counter message to "Only an admin can confirm call, customer and online orders."
  3. `public.update_order_items`: copy it from `20261003000400_kitchen_revisions_fixes.sql` and delete the "Assign a preparing kitchen" block only.
  4. Retire live tickets: update `kitchen_tickets` to `status = 'cancelled'`, `cancelled_at = coalesce(cancelled_at, now())`, `stop_work_acknowledged_at = coalesce(stop_work_acknowledged_at, now())`, `has_pending_changes = false` where status is not ready or cancelled. Also update `has_pending_changes = false` everywhere. Log `kitchen_tickets_retired` per affected order. Resolve open `kitchen_issues` with `resolution_note = 'KOT retired'`. Use the actual column names from `20260930000300`.
  5. Revoke execute on the chef PIN and device functions (`verify_kitchen_pin`, `record_kitchen_pin_session`, `kitchen_pin_session_status`, `kitchen_pin_session_valid`, `kitchen_device_chefs`, `register_kitchen_device`, `set_staff_pin`) from anon and authenticated.
  6. Orders columns plus the check `(fulfilment = 'setup' and setup_address is not null) or (fulfilment = 'collect' and setup_address is null and setup_note is null)`, with length checks ≤ 300. Replace the `CALL` check constraint with `source not in ('CALL','CUSTOMER') or (...)`.
  7. `business_settings` columns.
  8. The `custom_cakes` table, index on `order_id`, RLS select for admin and counter (same policy style as `order_items`), updated_at and audit triggers.
  9. `drop function public.create_order(<old signature>)`, then create it with the new signature, based on `20260927000410`:
     - the CUSTOMER rule follows CALL;
     - immediate pickups are refused for non-IN_STORE;
     - fulfilment is validated (setup needs an address, and setup cannot be immediate);
     - items may be `{"custom_cake": {...}, "price_paise": n}`, giving a custom line with null product/variant, `prep_type 'made_to_order'`, `lead_time_minutes 0`, tax from settings, plus a `custom_cakes` row.
     Grants as before.
  10. `create_custom_cake_order`: validates the cake fields and requires name, phone and pickup, then calls `public.create_order` with one custom item. If the advance is > 0, it checks advance ≤ `o.total_paise` and inserts the payment the way `record_payment` does (call `public.record_payment(o.id, gen_random_uuid(), 'payment', method, amount, reference, 'Advance')`) and logs `custom_cake_created`. It is idempotent through `create_order`, but the advance runs only when no payment exists for an order newly made by that key.
  11. `update_custom_cake`, `set_fulfilment`.
  12. `counter_sale`: unchanged, because the column default is collect.
  13. Recreate `order_summaries` exactly as in `20261003000500` (so `o.*` picks up the new columns), with grants.
- [ ] **Step 4: Update the old checks.** Delete `kitchen_logic.sql`, `revisions_logic.sql` and `pin_logic.sql`, and fix the expectations in `orders_logic.sql`, `packing_logic.sql` and `edit_items_logic.sql`. Run `node run.mjs`. Everything must pass.
- [ ] **Step 5: Commit.**

### Task 3: Storage buckets and photo functions (migration 3)

**Files:**
- Modify: `supabase/local/shim.sql`: add a minimal `storage` schema with `buckets(id text pk, name text, public boolean, file_size_limit bigint, allowed_mime_types text[])`, `objects(id uuid pk, bucket_id text, name text, owner uuid, created_at timestamptz)` with RLS enabled, and `storage.foldername(name text) returns text[]`.
- Create: `supabase/migrations/20261009000300_photos.sql`
- Create: `supabase/tests/photos_logic.sql`

**Interfaces produced:**
- Buckets: `product-photos` (public, 5 MB, jpeg/png/webp) and `custom-cake-photos` (private, same limits).
- `public.set_product_image(p_product_id uuid, p_image_url text) returns void`: admin only. Null clears it. Otherwise the URL must contain `/storage/v1/object/public/product-photos/`.
- `public.set_custom_cake_photo(p_order_id uuid, p_photo_path text) returns void`: admin or counter. The path must start with `<order_id>/`. Refused once the order is completed, cancelled or rejected.
- Storage policies:
  - product-photos: insert/update/delete for `private.is_admin()`;
  - custom-cake-photos: select/insert/delete for `private.has_role(array['admin','counter'])`.

- [ ] **Step 1: Write the checks in `photos_logic.sql`.**
  - A counter user calling `set_product_image` → forbidden.
  - An admin with a foreign URL → "Upload the photo to product photos first."
  - An admin with a valid URL → stored.
  - `set_custom_cake_photo` with a wrong prefix → refused.
  - A valid path → stored.
- [ ] **Step 2: Run.** The checks fail.
- [ ] **Step 3: Write the migration** (insert buckets with `on conflict do nothing`, policies, functions, grants). **Step 4: Run all checks.** They pass. **Step 5: Commit.**

### Task 4: Remove KOT, chef and kitchen screens from the web app; Customers for counter

**Files:**
- Delete: `web/src/app/admin/kot/`, `web/src/app/kitchen/`, `web/src/app/print/kot/`, `web/src/components/kitchen/`, `web/src/lib/kitchen.ts`, `kitchen.test.ts`, `kitchen-data.ts`, `kitchen-device.ts`, `pin-cookie.ts`, `pin-cookie.test.ts`
- Modify:
  - `web/src/lib/shell.ts` + `shell.test.ts`:
    - Customers takes KOT's slot with `roles: BOTH`;
    - remove the `kot` icon and the `kitchen` badge;
    - remove the `custom-cakes` soon item and its page entry;
    - `attentionCount({pending, latePickups})`;
    - Staff & Kitchens → "Staff".
  - `web/src/lib/shell-counts.ts`: drop the kitchen queries.
  - `web/src/components/shell/admin-shell.tsx`: drop the kot icon and kitchen badge.
  - `web/src/lib/home.ts` + `home.test.ts`: drop `kitchenWorkload`.
  - `web/src/app/admin/page.tsx`: drop the kitchen cards, kitchen alert, missing-routing alert, Open KOT and the kitchen setup step.
  - `web/src/app/admin/orders/[id]/page.tsx`, `fulfilment-panel.tsx`: no tickets; status text "Pack the items when they are ready."
  - `web/src/app/admin/orders/page.tsx`, `web/src/app/admin/calendar/*`: drop `KitchenFlags` and the kitchen filter.
  - `web/src/components/order-badges.tsx`: drop `KitchenFlags`.
  - `web/src/app/admin/staff/*`: drop the kitchens and PIN sections; the role choice is admin/counter.
  - `web/src/app/admin/products/variant-forms.tsx` + `actions.ts`: drop the kitchen select.
  - `web/src/app/admin/customers/**`: `requireRole(["admin","counter"])`, with block controls for admins only.
  - `web/src/lib/auth.ts`: `homePathFor` sends a chef to `/login?error=no-access`.
  - `web/src/app/login/*`: show "This account no longer has access."
  - `web/src/proxy.ts`: drop `/kitchen` and the PIN public paths.
  - `web/src/app/admin/settings/page.tsx`: drop kitchen bits if present.
- [ ] **Step 1: Update `shell.test.ts`** to the new menu: no KOT; Customers for counter right after Calendar; bell = pending + late. Run `npm test`. It fails.
- [ ] **Step 2: Make the changes above.** Use `grep -rn "kitchen\|Kitchen\|ticket\|kot" web/src` until only the timeline labels for historic events in `orders/[id]/page.tsx` remain.
- [ ] **Step 3:** `npm test`, `npm run typecheck`, `npm run lint`. All pass. **Step 4: Commit.**

### Task 5: Customer source and collect/set-up in the web app

**Files:**
- Modify: `web/src/lib/database.types.ts`: `order_source` adds `"CUSTOMER"`; the `fulfilment_type` enum; the new orders and order_summaries columns; the business_settings columns; the `custom_cakes` table; the new function signatures.
- Modify: `web/src/lib/orders.ts` (+ `orders.test.ts`):
  - `sourceLabel.CUSTOMER = "Customer"`;
  - `fulfilmentLabel = { collect: "Collect", setup: "Set up" }`;
  - `fulfilmentRowClass(f)` → `"border-l-4 border-l-ok bg-ok-soft/40"` | `"border-l-4 border-l-danger bg-danger-soft/40"`.
- Modify: `web/src/components/order-badges.tsx`: `SourceBadge` CUSTOMER (💬, emerald), and a new `FulfilmentBadge({ fulfilment })`.
- Create: `web/src/components/fulfilment-fields.tsx`: the two toggle buttons plus the address and note fields (client), used by the order entry and the custom cake form.
- Modify:
  - `web/src/app/admin/orders/new/page.tsx` and `order-entry.tsx`: source `IN_STORE|CALL|CUSTOMER`, fulfilment fields, and the "Set-up time" label;
  - `web/src/app/admin/orders/actions.ts`: zod schema plus the new rpc params;
  - `set_fulfilment` action.
- Modify: `web/src/app/admin/orders/page.tsx`:
  - the header buttons, in this order: New in-store, New call, New customer order, New custom cake order;
  - the `online_call` list label "Online / Call / Customer" with source CUSTOMER;
  - a `custom` list (`?list=custom`, filtered by order ids from `custom_cakes`);
  - the fulfilment filter `?fulfil=collect|setup`;
  - row class plus badge, with the address under the customer.
- Modify: `web/src/app/admin/calendar/*` (order-row, month, week, day, agenda, page): a row class plus badge, and a fulfilment filter.
- Modify: `web/src/app/admin/page.tsx`: lists use the badge and border.
- Modify: `web/src/app/admin/orders/[id]/page.tsx`: the fulfilment banner with a Change form (`fulfilment-form.tsx`, new).
- Modify: `fulfilment-panel.tsx`: the handover button label is "Set up done" for setup.
- Modify: `web/src/app/print/bill/[id]/page.tsx`: the COLLECT / SET UP line.
- [ ] **Step 1: Unit tests.** Add tests for `fulfilmentLabel`, `fulfilmentRowClass` and `sourceLabel.CUSTOMER` in `orders.test.ts`, then run them. They fail.
- [ ] **Step 2: Implement.** **Step 3:** test, typecheck, lint. **Step 4: Commit.**

### Task 6: Custom cake orders in the web app

**Files:**
- Create: `web/src/app/admin/orders/new-cake/page.tsx` (server: settings, timezone, default due), `cake-form.tsx` (client), `web/src/lib/custom-cake.ts` (zod schema `customCakeSchema`, `cakeVariantName(weight_kg, tiers)` → `"1.5 kg · 2 tiers"`, `rupeesToPaise`), `web/src/lib/custom-cake.test.ts`
- Modify: `web/src/app/admin/orders/actions.ts`: `createCustomCakeOrder(formData)` calls the rpc, then uploads the photo to `custom-cake-photos/<order_id>/<uuid>.<ext>` and calls `set_custom_cake_photo`. It returns `{ ok, orderId, photoError? }`. Also `updateCustomCake` and `setCustomCakePhoto` (for Add/Replace photo).
- Create: `web/src/app/admin/orders/[id]/cake-card.tsx`: the sticky-note card using the `note`/`note-line` tokens, a signed photo URL (passed from the page), the edit form toggle, and the print link.
- Modify: `web/src/app/admin/orders/[id]/page.tsx`: load `custom_cakes` and a signed URL (`createSignedUrl(path, 3600)`), and render the card.
- Create: `web/src/app/print/cake/[id]/page.tsx`: A5 print sheet.
- Modify: `web/src/app/admin/settings/settings-form.tsx` + `actions.ts` + `page.tsx`: custom cake GST % and HSN.
- Modify: `web/src/app/admin/soon/[slug]/page.tsx`: nothing (the custom-cakes slug was removed in Task 4, and an unknown slug gives 404).
- [ ] **Step 1: Unit tests for `custom-cake.ts`:**
  - `cakeVariantName(1.5, 2)` → `"1.5 kg · 2 tiers"`;
  - `cakeVariantName(1, 1)` → `"1 kg"`;
  - `rupeesToPaise("1,500.50")` → `150050`;
  - the schema rejects weight 0.
  Run them. They fail.
- [ ] **Step 2: Implement.** **Step 3:** test, typecheck, lint. **Step 4: Commit.**

### Task 7: Product photos in the web app

**Files:**
- Modify: `web/next.config.ts`: `images.remotePatterns` for `${NEXT_PUBLIC_SUPABASE_URL}` host, path `/storage/v1/object/public/product-photos/**`.
- Create: `web/src/components/product-thumb.tsx`: `next/image` or a pink placeholder with a cake icon.
- Modify: `web/src/app/admin/products/product-form.tsx`, `[id]/page.tsx`, `actions.ts`: a photo input with preview, plus upload/replace/remove (`setProductPhoto`, `removeProductPhoto` actions; the old object is deleted).
- Modify: `web/src/app/admin/products/page.tsx`, `web/src/components/catalogue-picker.tsx`, `web/src/lib/catalogue.ts` (select `image_url`), and the order page lines: show the thumbnails.
- [ ] **Step 1: Implement.** **Step 2:** typecheck, lint, test. **Step 3: Commit.**

### Task 8: Full verification and docs

- [ ] `node run.mjs` (all SQL checks), `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- [ ] Browser check on `npx next dev --webpack`, against a local copy if possible. Otherwise do the screen checks on the deployed preview after the owner approves applying migrations.
- [ ] Update `HANDOVER.md`, `TODO.md` and `README.md` (KOT removed, the new features, the owner steps to apply migrations 20261009000100–0300 and deploy).
- [ ] Commit.
