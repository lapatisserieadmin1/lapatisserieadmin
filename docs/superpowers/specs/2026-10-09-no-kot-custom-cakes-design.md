# Remove KOT, Customers for counter, customer orders, custom cake orders product photos, and collect or set up

Date: 2026-10-09. Status: design approved in conversation (owner); spec for review.
Covers mock-up pieces 3 (product photos) and 4 ("custom cake details") and reverses Phase 5 (kitchen tickets) at the owner's request.

## 1. Goal

- The bakery stops using kitchen tickets: no KOT page, chef screen, chef sign-in or printed KOT.
- Counter staff can look up customers.
- Staff can take a **customer order** and a **custom cake order** from the top of the Orders page. Custom cake orders get their own list.
- Products have photos.
- Every order says whether the customer **collects from the store** (green) or the bakery **sets up at the customer's place** (red). The colour shows wherever orders are listed.

## 2. Decisions (owner, 2026-10-09)

| Topic | Decision |
|---|---|
| KOT | **Remove completely**: KOT page, chef tablet screen, chef PIN sign-in, kitchen tickets, 80mm KOT print, KOT badge, kitchen alerts. |
| Sidebar | **Customers** takes KOT's place in the sidebar and is open to admin **and** counter staff. |
| Orders buttons | Keep "New in-store order" and "New call order"; add **New customer order** and **New custom cake order**. |
| Custom cake list | A **Custom cakes** tab on the Orders page. |
| Custom cake source | Chosen on the form: **In-store, Call or Customer**. |
| Custom cake details | Flavour, size/weight, tiers, theme/design, cream, filling, toppings, message on cake, eggless, special instructions, **reference photo**, **price typed by staff**, **advance payment**. |
| Product photos | Added mid-design ("also add product images"): one photo per product, uploaded by staff. |
| Collect or set up | Added 2026-10-09: while taking an order, choose **Collect from store** or **Set up at customer's place**. Set-up orders are highlighted **red** and collect orders **green** in the calendar and everywhere else orders appear. |
| Approach for KOT | Switch off and remove the screens. Ticket tables and their history stay in the database, unused. Nothing is dropped. |

Assumptions accepted with the design (owner said "yes" to the whole design):
1. Chef accounts can no longer sign in. Products no longer need a kitchen. "Staff & Kitchens" becomes **Staff**.
2. Only admins block or unblock a customer.
3. **Customer** is a new order source. It uses the call-order rules (name and phone required, pickup time) and appears in the **Online / Call / Customer** list.
4. GST on a custom cake uses one rate in Shop Settings (default 5%).

## 3. Kitchen tickets switched off

### Database (new migration)
- `private.build_tickets(uuid)` is replaced by a function that returns 0 and does nothing. Every caller (confirm, create with confirm, edit items, reschedule, revisions) therefore stops creating or revising tickets. The callers are not edited.
- `mark_packed` already allows confirmed orders with no live tickets. Its ticket and issue checks only look at live tickets, so orders confirmed before the switch that still have open tickets **would stay blocked**. The migration therefore cancels every live ticket (`status in ('new','acknowledged','preparing')`) **without stop-work**: `stop_work_acknowledged_at = now()`, and each cancelled ticket gets an order event "Kitchen tickets retired". It also resolves every open `kitchen_issues` row with the note "KOT retired".
- `reopen_packing` already returns the order to Confirmed when no live ticket exists. It needs no change.
- Orders already in `preparing` stay there. Packing accepts `preparing`.
- `has_pending_changes` is cleared on all tickets, so no "change unacknowledged" badge remains.
- Chef sign-in: `private.has_role` stays. The chef PIN functions get their `execute` grants revoked from `anon`/`authenticated`. The `/kitchen/pin` routes are deleted.
- `order_summaries.kitchen_ids` and other view columns stay for now. The UI simply stops reading them.

### Web (removed)
- Pages and routes: `app/admin/kot/**`, `app/kitchen/**` (including `pin`, `stamp`, `pin/end`), `app/print/kot/**`.
- Components: `components/kitchen/**`.
- Libraries: `lib/kitchen.ts`, `lib/kitchen-data.ts` and their tests. `lib/home.ts` keeps working after its kitchen-workload, late-start and kitchen-alert parts are removed. `lib/shell-counts.ts` loses the kitchen count.
- Order page: no ticket cards, no "waiting for the kitchen", no "not acknowledged", no kitchen badge per line, no "No kitchen" warning. The status text after confirmation reads "Pack the items when they are ready." Timeline labels for old ticket events stay, so history still reads correctly.
- Orders list and calendar: `KitchenFlags` and the "Change unacknowledged" badge are removed.
- Dashboard: the kitchen cards, the "Kitchen needs attention" alert, the missing-routing alert, the "Open KOT" button and the setup-checklist step about kitchens are removed.
- Bell (`attentionCount`): awaiting confirmation + late pickups.
- Products: the kitchen field leaves the form. Existing `kitchen_id` values stay, unused.
- Staff page: the kitchens section and chef PIN forms are removed. The menu label becomes "Staff". Creating staff offers admin and counter only.
- Proxy/auth: any redirect of the chef role to `/kitchen` is removed. A chef who signs in sees "This account no longer has access."

## 4. Customers for counter staff

- `lib/shell.ts`: the Customers item moves to KOT's position with `roles: BOTH`. The `kot` icon and the `kitchen` badge are removed.
- `app/admin/customers/**` uses `requireRole(["admin","counter"])`. The block/unblock form shows only to admins, and the server action still checks admin.
- Database: counter staff need `select` on `customers`. If RLS currently limits it to admin, the migration widens it to admin + counter. Writes stay in the existing functions (`block_customer` and others stay admin-only).

## 5. New order source: Customer

- Migration: `alter type public.order_source add value 'CUSTOMER'`. This is in its own migration, because a new enum value cannot be used in the same transaction.
- `create_order`: CUSTOMER follows the CALL rule (name and phone required), and the `orders` check constraint is widened the same way.
- Web: the `OrderSource` label is "Customer" and the badge icon 💬. `lib/orders.ts` and `order-badges.tsx` are updated.
- Orders page: the `online_call` list becomes **Online / Call / Customer**, with sources `ONLINE, CALL, CUSTOMER`. Calendar source filter: add Customer.
- **New customer order** button → `/admin/orders/new?source=CUSTOMER`. The order entry accepts `IN_STORE | CALL | CUSTOMER`, and the customer behaves like CALL (pickup time and customer details required, confirm unticked by default).
- Reports group by source wherever they already do. Customer shows as its own source.

## 6. Custom cake orders

### Data
New table `public.custom_cakes` (one row per custom cake line):

| Column | Type / rule |
|---|---|
| `id` | uuid pk |
| `order_item_id` | uuid not null unique → `order_items(id)` on delete cascade |
| `order_id` | uuid not null → `orders(id)` on delete cascade (for listing) |
| `flavour` | text not null, 1–80 |
| `weight_kg` | numeric(5,2) not null, 0.25–50 |
| `tiers` | smallint not null default 1, 1–10 |
| `theme` | text null, ≤ 200 (design or theme) |
| `cream` | text null, ≤ 80 |
| `filling` | text null, ≤ 80 |
| `toppings` | text null, ≤ 200 |
| `message` | text null, ≤ 120 (written on the cake) |
| `is_eggless` | boolean not null default false |
| `instructions` | text null, ≤ 1000 |
| `photo_path` | text null (object path in the `custom-cake-photos` bucket) |
| `created_at`, `updated_at` | timestamptz |

- Order line: `product_id`/`variant_id` null, `product_name` "Custom cake", `variant_name` e.g. "1.5 kg · 2 tiers", `prep_type` made_to_order, `kitchen_id` null, `is_veg` true, `is_eggless`/`contains_egg` from the form, `unit_price_paise` from the staff price, `tax_rate_bps` from settings, `hsn_code` from settings (nullable), quantity 1, `lead_time_minutes` 0 (staff pick the pickup time).
- `business_settings`: new `custom_cake_tax_rate_bps integer not null default 500 check (between 0 and 2800)` and `custom_cake_hsn_code text null`. Both are editable in Shop Settings by admins.
- RLS: admin and counter `select`. Writes only through functions.
- Audit trigger as for other tables.

### Functions
- `public.create_custom_cake_order(p_idempotency_key uuid, p_source order_source, p_customer_name, p_customer_phone, p_due_at, p_price_paise bigint, p_cake jsonb, p_customer_notes, p_internal_notes, p_confirm boolean, p_override_reason, p_advance_paise bigint default 0, p_advance_method payment_method default null, p_advance_reference text default null)`:
  - Admin or counter only. The source must be IN_STORE, CALL or CUSTOMER. Name, phone and pickup time are required for every custom cake order, whatever the source.
  - The price must be between ₹1 and ₹10,00,000. The cake fields are validated against the table limits.
  - It builds the order through the same internals as `create_order`: totals, tax, reference number, capacity/hours checks with override, customer upsert, confirm and events. The custom line is inserted directly. If `create_order` cannot take a custom line, a shared `private.insert_order(...)` is extracted rather than duplicating its logic.
  - It inserts the `custom_cakes` row. If `p_advance_paise > 0`, it records a payment through the same logic as `record_payment` (method required, amount ≤ total) in the same transaction.
  - It is idempotent on the key and logs the event `custom_cake_created`.
- `public.update_custom_cake(p_order_id, p_expected_version, p_cake jsonb, p_price_paise bigint)`: admin or counter. The order must not be packed, completed, cancelled or rejected. It updates the details. A price change re-prices the line and order totals, follows the existing edit-items rules (no change once a bill is issued) and logs `custom_cake_changed`.
- `public.set_custom_cake_photo(p_order_id, p_expected_version, p_photo_path text)` sets or clears the photo path. The path must start with the order id.

### Photo storage
- A private bucket `custom-cake-photos`, with JPEG/PNG/WebP up to 5 MB. Storage policies let admin and counter read and insert objects under `<order_id>/…`.
- Upload happens from a server action after the order is created. The order page shows the photo through a signed URL valid for 1 hour.
- If the upload fails, the order still exists and the order page offers "Add photo".

### Screens
- **Orders page header:** New in-store order · New call order · **New customer order** · **New custom cake order** (`/admin/orders/new-cake`).
- **New custom cake order form** (`app/admin/orders/new-cake/`), one page:
  - Source chips: In-store / Call / Customer.
  - Customer: name, phone (with the existing `CustomerWarning`), pickup date and time (with `PickupWindows`).
  - Cake: flavour, weight (kg), tiers, theme/design, cream, filling, toppings, message on cake, eggless toggle, special instructions, photo (file input with preview).
  - Price (₹). Advance: amount (₹) and method (cash/UPI/card/bank/other), plus a reference.
  - Notes (customer and internal), Confirm checkbox (default unticked), override prompt as in the order entry.
  - Submit → order page.
- **Orders → Custom cakes tab** (`?list=custom`): orders that have a `custom_cakes` row, from any source. Same columns and filters as the other lists, plus flavour and weight. The tab shows a count like the others.
- **Order page:** a **sticky-note card** (yellow `note` colours) with all the details, the photo, and Edit (inline form, until packed) and **Print cake sheet** buttons.
- **Print:** `/print/cake/[id]` prints an A5 or 80mm page with the order reference, pickup time, customer name, all the details and the photo, for whoever bakes it.
- The `custom-cakes` "Coming soon" item and its `SOON_PAGES` entry are removed, because the tab replaces them.

## 7. Product photos

- A public-read bucket `product-photos`, with JPEG/PNG/WebP up to 5 MB. Only admins insert, update or delete objects, through the storage policy. Photos of products on sale are not secret, and the future public website needs them.
- `products.image_url` (already exists) holds the public URL. A new admin-only function `public.set_product_image(p_product_id, p_image_url)` sets or clears it, and the URL must point at the project's `product-photos` bucket.
- Product form (new and edit): a photo field with a preview, plus **Remove photo**. Upload goes to `<product_id>/<random>.<ext>` from a server action. The old object is deleted when it is replaced.
- Shown in: the Products list (thumbnail), the product page, `CataloguePicker` in the order entry and Counter Sale (small thumbnail on each tile), and order lines on the order page (small thumbnail). Images use `next/image` with the Supabase host allowed in `next.config`.
- If there is no photo, a soft pink placeholder with the cake icon is shown.

## 8. Collect from store or set up at the customer's place

Assumptions (to confirm when the owner reviews the spec):
- The choice is on **every** order form: in-store, call, customer and custom cake. Counter Sale is always Collect, because the customer is at the counter.
- Default is **Collect from store**.
- Set-up needs the **address** (required, up to 300 characters) and can take a **landmark/contact note** (up to 300 characters). The order's pickup time becomes the **set-up time**.
- There is no set-up or delivery charge yet. If one is wanted, staff can add it as a line later. Delivery charges and areas stay for mock-up piece 6.

### Data
- `create type public.fulfilment_type as enum ('collect', 'setup')`.
- `orders`: `fulfilment fulfilment_type not null default 'collect'`, `setup_address text`, `setup_note text`. The check is: setup ⇒ address not null, and collect ⇒ address and note null. Existing orders become `collect`.
- `order_summaries` view: add `fulfilment` and `setup_address`.
- `create_order` and `create_custom_cake_order` take `p_fulfilment default 'collect'`, `p_setup_address`, `p_setup_note` and validate them. Counter-sale functions always pass collect.
- `public.set_fulfilment(p_order_id, p_expected_version, p_fulfilment, p_setup_address, p_setup_note)`: admin or counter, until the order is handed over, cancelled or rejected. It logs `fulfilment_changed` with the old and new values.

### Screens
- **Order forms:** two large toggle buttons, **🏪 Collect from store** (green) and **🚚 Set up at customer's place** (red). Choosing set-up shows the address and note fields, and the time label changes from "Pickup" to "Set-up time".
- **Shared badge:** `FulfilmentBadge` in `components/order-badges.tsx`. Collect is a green pill "Collect" (ok tokens) and set-up is a red pill "Set up" (danger tokens), always with the text label and not only the colour, for accessibility.
- **Calendar** (month, week, day and agenda): each order chip/row gets a coloured left border and background tint, green for collect and red for set-up, plus the badge. Calendar filter: All / Collect / Set up.
- **Orders lists (all tabs, including Custom cakes):** a coloured left border on each row plus the badge. The address shows under the customer for set-up orders. Filter: All / Collect / Set up.
- **Dashboard** due-today and next-7-days lists: badge and border.
- **Order page:** a large banner at the top. For set-up it is red: "Set up at customer's place" with the address and note, and Change (opens the fulfilment form). For collect it is green: "Collect from store".
- **Prints** (bill, cake sheet): "SET UP at: <address>" or "COLLECT from store", in plain text, readable on a mono printer.
- **Handover:** for set-up orders the button reads "Set up done" instead of "Handed over". It uses the same `record_handover` function, and only the label changes.

## 9. Error handling

- Database messages come from `private.fail` as today and are shown by the existing form status component.
- Custom cake form: client-side checks mirror the database limits. Idempotency key per form load, so double submits create one order.
- Photo type and size are checked client-side and by the bucket (both buckets).

## 10. Testing

- **PGlite (`supabase/local/pglite`) SQL tests**, new file `custom_cakes_logic`:
  - confirming creates no ticket;
  - live tickets are retired by the migration;
  - mark_packed works on confirmed and preparing orders after the switch;
  - CUSTOMER source needs name and phone;
  - custom cake order totals, tax at the settings rate and idempotency;
  - advance is recorded, balance is correct, advance > total is refused;
  - update_custom_cake is refused after packing and after a bill;
  - counter can read customers and custom_cakes, but cannot block a customer;
  - collect/setup: setup without an address is refused, collect clears the address, set_fulfilment is refused after handover and logs the change, and counter sale is always collect;
  - set_product_image is admin-only and refuses URLs outside the bucket.
- The existing SQL suites are re-run. Kitchen-ticket suites that no longer apply are removed or updated to the new rule.
- Unit tests: `lib/shell.test.ts` (menu: no KOT, Customers for counter, bell count), `lib/home` tests updated, `lib/orders` source labels.
- `npm run build`, lint and typecheck.
- A browser check (dev server with `--webpack`): Orders tabs and buttons, new customer order, new custom cake order with photo and advance, order page note card, cake print, Customers as counter staff, product photo upload and thumbnails, collect/set-up choice and red/green highlights in the calendar and lists, no KOT anywhere.

## 11. Out of scope

- Dropping the ticket tables, kitchens table or chef role values. They can be removed later if wanted.
- Customers placing custom cake requests themselves (public website).
- Stock or inventory of any kind (owner rule).
