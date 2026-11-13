# Bakery Website and Order Management — PRD

Version: 0.3 | Date: 2026-09-27 | Status: Planning draft

Changes in 0.3: split delivery into Release 1 (core order loop) and Release 1.1 (operational exceptions); added customer notification, spam protection, GST billing, counter quick sale, veg/eggless and FSSAI labelling, daily sales report, discounts, daily order caps, kitchen PIN switching, a recommended stack, a glossary, and AC-28 to AC-36.

This document describes the proposed product. No implementation is authorized by this planning task. Read alongside [TODO.md](TODO.md) and [PROJECT_RULES.md](PROJECT_RULES.md).

## 1. Purpose

Create a public bakery website and an internal order management system. Admins manage products, in-store orders, online/call orders, upcoming orders, and kitchen tickets. Chefs log in to see and prepare work assigned to their kitchen. The bakery has two kitchens, and each product determines where its preparation happens.

Success means an order is recorded once, routed correctly, visible on the right date, and handed over only when all required items are ready.

### Release 1 at a glance

- **Customers** browse products (with veg/eggless marks), add to cart, pick a pickup slot, verify their phone, and submit. They get a reference and a tracking link, and hear back when the bakery accepts or rejects.
- **Counter staff** ring up walk-in ready-stock sales in one screen, and enter call orders and future in-store orders.
- **Admins** accept orders, see everything on a calendar by due date, manage products, prices and kitchen mapping, record payments, print GST bills, and view a daily sales report.
- **Chefs** switch in by PIN on the kitchen tablet, see only their kitchen's tickets, and mark items ready. A mixed order is Ready only when both kitchens finish and the order is packed.
- **Exceptions** (substitutions, remakes, late pickups) are handled in Release 1 with an admin override that requires a reason. The structured workflows arrive in Release 1.1 (section 5D).

## 2. Confirmed requirements and planning assumptions

### Confirmed by the user

- Planning only: a full PRD, a to-do list, and project rules; no coding now.
- A public website and an admin area.
- Customers place orders directly on the website, and staff also accept call orders (confirmed in follow-up).
- Admin management of orders and upcoming orders through a calendar.
- A chef login, interpreted from the user's phrase “chief login.”
- Two kitchens with item-based routing to the appropriate kitchen.
- Two order lists: In-store, and Online / Call.
- Admin navigation that includes Home, Products, Orders, and KOT.
- Follow-up: expand the plan with production summaries, packing/handover, substitutions, remakes/wastage, uncollected orders, payment reconciliation, and detailed bulk/custom orders. Launch inclusion of reconciliation and bulk/custom orders depends on the bakery's operating process.
- Follow-up (v0.3 review, user approved): deliver in two steps. Release 1 is the core order loop with a basic packing check and admin overrides for exceptions. Release 1.1 adds the structured substitution, remake/wastage, uncollected-order, and full production-summary workflows. Add the missing basics listed in section 5F.

### Proposed defaults — pending business confirmation

| Topic | Working proposal |
|---|---|
| Business name | Use “Bakery” in planning. Workspace says “auri bakery”; existing prototype says “La Patisserie Madras.” Final name is open. |
| Kitchen names | Use Kitchen 1 and Kitchen 2 as placeholders following the user's “yes”; actual names and item mappings remain open. |
| Public ordering | Website ordering and staff-entered call orders are confirmed first-release scope. |
| Fulfillment | Pickup for the first release. Delivery requires a separate decision on area, fees, and responsibility. |
| Order acceptance | New submitted orders await admin confirmation. Drafts and unconfirmed orders do not release kitchen work. |
| Payments | Record payment method, deposits, balance, and refunds manually in the first release. Online ordering does not imply an online payment gateway. |
| Customer accounts | Guest ordering and protected order-status access; customer accounts can follow later. |
| Kitchen routing | One preparing kitchen per product variant. A single item requiring multiple kitchen stages is outside the first release. |
| Staff | Admin and Chef are required roles. A restricted Counter Staff role is proposed. |
| Scheduling | One business timezone, configured before launch; provisional Asia/Kolkata. |
| Architecture | One shared backend and order store serving public, admin, and chef interfaces. Recommended stack: Next.js (App Router) + Supabase (Postgres, Auth, Realtime, Storage, pg_cron) hosted on Vercel. Pending confirmation of budget and team skills; see section 10A. |
| Customer notification | Release 1: a WhatsApp click-to-chat message template that staff send, plus the protected status page. A staff callback is the fallback. Automated email/SMS/WhatsApp stays a separate integration decision. |
| Spam protection | Phone OTP (or captcha as a fallback) before online submission, per-phone/IP rate limits, and a configurable deposit threshold for high-value or custom orders. |
| Billing | A GST-compliant customer bill for every completed sale. Tax rates and GSTIN supplied by the owner. |

Assumptions describe a complete planning baseline; they are not claims that the owner has approved these policies.

## 3. Existing material

The workspace contains `la pater/index.html`, `style.css`, `script.js`, an images folder, and a ZIP archive. The HTML includes Home, Our Story, Products, Gallery, Visit Us, and a custom-order form. This is reference material, not evidence of a functioning order backend. Preserve it while planning. Brand claims, product names, photos, prices, and contact details need owner verification before reuse.

## 4. People and access

| Capability | Public customer | Admin | Counter Staff, proposed | Chef |
|---|---|---|---|---|
| Browse public products | Yes | Yes | Yes | Yes |
| Submit website order | Yes | Yes | No staff-specific need | No staff-specific need |
| View customer order status | Own order through protected access | All | Operational orders | Assigned kitchen work only |
| Create in-store/call order | No | Yes | Yes | No |
| Confirm orders and release tickets | No | Yes | If explicitly granted | No |
| Manage products, prices, kitchen mapping | No | Yes | No | No |
| View full calendar | No | Yes | Operational calendar | Own kitchen schedule |
| Start work / mark item ready | No | Exception with reason | No | Assigned items only |
| Record payments / handover | No | Yes | If granted | No |
| Approve discounts, cancellation, refund | No | Yes | Request only | No |
| Manage users, kitchens, settings | No | Yes | No | No |

Use individual staff accounts. A chef is assigned to Kitchen 1 or Kitchen 2; access to both requires an explicit admin assignment. Enforce permissions on the server as well as in navigation. Chefs see production notes, quantities, deadlines, and an order reference; financial data and unnecessary customer contact information are hidden.

## 5. First-release scope

### A. Public website

1. **Home:** bakery introduction, verified product photos, featured items, clear ordering action, location and opening hours.
2. **Products:** categories, availability, product search/filtering, price or variant price, and product details.
3. **Product details:** size/weight/flavour options where relevant, quantity, preparation notice, ingredients/allergen information supplied by the bakery, and allowed customization such as cake message.
4. **Cart and order submission:** selected variants, quantities, customer name/contact, pickup date/time, notes, itemized total, and policy acknowledgement.
5. **Confirmation and tracking:** order reference, requested slot, whether acceptance is pending, payment/balance information where appropriate, and customer-facing progress.
6. **About/contact:** verified business details, phone, location, hours, and ordering guidance.
7. **Policies:** owner-approved ordering, cancellation, pickup, privacy, and payment information.

Reject unavailable products and invalid slots before submission and recheck on the server. Do not promise acceptance while the order is awaiting review. For complex custom cakes, use an enquiry/manual quote workflow rather than inventing a price; only an accepted, fully specified order may create production work.

Website ordering is confirmed launch scope. Guest checkout and protected tracking are the proposed approach; the customer account policy remains open.

### B. Admin navigation

Primary: **Home | Products | Orders | Calendar | KOT**.

Secondary: **Counter Sale | Reports | Customers | Staff & Kitchens | Settings**. Customer records can initially be accessed through Orders rather than requiring a separate full CRM module.

#### Home

- Today's orders due, pending acceptance, preparing, ready for pickup, overdue, and payment balances due.
- Upcoming orders for the next seven days.
- Separate in-store and online/call counts.
- Kitchen 1 and Kitchen 2 workload summaries with links to their queues.
- Alerts for missing routing, unacknowledged ticket changes, overdue work, and orders awaiting review.
- Quick actions: New In-store Order, New Call Order, Open Calendar, Open KOT.
- Explicit date labels: “due today” and “created today” must not be confused. A paid-sales summary, if included, uses payment dates and excludes refunds consistently.

#### Products

- Add, edit, archive, and mark products available/unavailable.
- Manage categories, images, variants, prices, permitted customization, and preparation lead times.
- Assign a preparing kitchen to every made-to-order variant; category defaults may assist data entry but must resolve to an explicit variant mapping.
- Mark a product as made-to-order or ready-stock. Ready-stock items require availability/stock handling but no preparation KOT unless explicitly requested.
- Block order confirmation for made-to-order items without a valid kitchen mapping.
- Store a snapshot of purchased name, variant, price, tax treatment, notes, and kitchen assignment on each order line. Future catalogue edits must not rewrite old orders.

#### Orders: two lists, one source of truth

| List | Included sources | Typical creation |
|---|---|---|
| In-store | IN_STORE | Staff records a walk-in purchase or future pickup order |
| Online / Call | ONLINE and CALL, separately labelled | Customer submits online, or staff enters a phone order |

Source is independent of fulfillment method, payment method, due date, and kitchen. A call order collected at the counter remains a CALL order. Both views use the same order data and lifecycle.

Each list supports search by reference/customer/contact; filters for due date, creation date, status, payment, source, and kitchen; and sorting by due time. Show order reference, customer display name, source, due time, total, balance, progress, and affected kitchens.

Order details include items/variants/quantities, customization and production notes, customer contact, requested and confirmed fulfillment time, item-level kitchen progress, KOT links, payment history, and an audit timeline. Admins can create, confirm, revise, cancel, reschedule, record payments, and complete handover according to the rules below.

#### Calendar

- Month, week, day, and agenda views. Agenda is the compact/mobile alternative.
- Default events represent fulfillment due time, not order creation time.
- Include future in-store orders as well as online/call orders.
- Distinguish pending requests from confirmed commitments; cancelled orders are hidden by default and recoverable through a filter.
- Filter by source, status, and kitchen. An order spanning both kitchens appears once in the full calendar with two kitchen labels.
- Event summary: reference, time, customer display name, source, quantity summary, and status. Open order details to act.
- Provide a production view using planned preparation/release times; chefs see only their kitchen's work.
- Warn about overdue work, closed days, lead-time violations, and workload concerns.
- Rescheduling requires a reviewed save that rechecks preparation times and availability, records a reason, and updates affected kitchen tickets. Drag-and-drop rescheduling is optional later.
- Initial capacity controls: configured bookable slots plus admin review of workload. Automated capacity optimization is deferred; do not advertise guaranteed capacity enforcement without defined limits.

#### KOT — Kitchen Order Tickets

- Admin overview across both kitchens; filter by kitchen, source, production date, due time, and status.
- Ticket fields: unique ticket reference, parent order reference, revision, kitchen, source, release time, fulfillment deadline, items, variants, quantities, production/allergen notes, status, and activity timestamps.
- No product prices or customer payment details on chef tickets.
- Upcoming tickets are visible in the schedule; only released tickets enter the active queue.
- Digital tickets are required. Browser print/reprint is proposed; dedicated thermal-printer integrations are a separate scope decision.
- Reprints retain the ticket reference/revision and are labelled as copies; they must not create new work.

### C. Chef area

- Staff sign-in redirects chefs to their assigned kitchen.
- Main views: Active Tickets, Upcoming Schedule, Completed, and ticket details.
- Active tickets prioritize overdue work, then preparation start/due time; admin priority overrides require a visible reason.
- Show source badges and allow **In-store** versus **Online / Call** filtering, while preserving a combined time-prioritized queue.
- Chef actions: acknowledge ticket, start work, record ready quantity, mark assigned lines ready, and report an issue.
- A reported issue alerts admin without silently cancelling or completing the order.
- Display urgent revisions/cancellations until acknowledged. Sound can supplement, but never replace, a visible alert.
- Use readable, touch-friendly screens suitable for kitchen tablets; show connectivity and last-update status.

### D. Operational workflows — Release 1 and Release 1.1

**Release split.** Release 1 ships a basic packing and handover step. It is one packing confirmation per order, with the packer and time recorded and one-time handover (AC-22). Everything else in this section ships in Release 1.1: the itemized packing checklist with revision-driven rechecks, the daily production summary, substitutions, remakes/wastage, and late/uncollected workflows (AC-21, AC-23 to AC-25).

**Interim handling in Release 1.** Until Release 1.1, an admin resolves exceptions by editing the order through an ordinary revision or cancellation. Examples are an unavailable item, a damaged item needing a remake, or an uncollected order. Each resolution uses an **Admin override with a mandatory reason**, recorded in the audit timeline. Overrides never skip the core rules: kitchens still acknowledge released-work changes, prepared quantities are preserved, payment and refund remain separate records, and nothing becomes Completed without a handover. The Home screen shows Ready orders past their pickup time, so late pickups stay visible even before the full workflow exists.

#### Daily production summary

- Add a Production Summary view within KOT for admins and within each chef's assigned kitchen area.
- Group confirmed production demand by kitchen, production date, product, variant, and preparation/due-time window. Preserve distinct sizes, flavours, customization, and allergen-related notes; unlike requirements must not become one interchangeable quantity.
- Show required, usable-ready, remaining, cancelled, wasted, and remake quantities with their meaning clearly labelled. Remaining is current active demand not yet satisfied by usable prepared quantities; show remake work as a labelled portion of that remaining work, not an extra customer demand.
- Separate Scheduled from Released work and allow In-store / Online / Call filters. Exclude drafts, rejected orders, and cancelled demand from required totals; retain them only in appropriate history views.
- Each total opens the contributing order lines and tickets. Reschedules, cancellations, substitutions, remakes, and partial completion recalculate the summary from current records.
- Example: Kitchen 2 can see 20 identical croissants required by 10 AM across six orders, with 12 usable-ready and eight remaining, then open those six orders.
- This is a read-only demand summary. It does not create batch tickets or let staff mark multiple customer orders ready without line-level checks. Automatic batch production remains deferred.

#### Packing and handover checklist

- Admin or permitted Counter Staff owns final packing and handover; chefs mark preparation readiness for their own items.
- Show each active item, quantity, variant, originating kitchen, and usable-ready/allocated quantity. Include applicable checks for cake wording, requested candles/accessories, packaging, and agreed customization.
- Record the packer's identity, checklist completion time, and any exception. Required checks cannot be silently skipped; product-specific optional checks may be marked not applicable with a reason.
- A mixed order cannot become Ready until every active item is prepared/allocated and all required packing checks pass. Changes affecting contents or usable quantities invalidate the affected checks and require rechecking.
- Before collection, confirm the order reference and intended recipient using the agreed counter process; avoid collecting unnecessary identity documents. Record collecting person's name or relationship only if operationally required.
- Handover records staff member, time, and fulfillment outcome. Check balance/authorized credit exception before completion; repeated handover actions cannot complete or charge twice.
- Partial customer collection is outside the initial baseline. Keep the order together unless a later explicit partial-handover workflow is specified.

#### Unavailable items and substitutions

- Staff raises an availability issue against an order line, records the affected quantity, and proposes a specific replacement or removal, including new price, specification, kitchen, and promised time.
- Put affected outstanding production on hold while customer approval is pending; unaffected work may continue only if admin considers the overall order feasible. Show the issue in order details and kitchen alerts.
- Record customer Accepted/Declined/Pending response, approved proposal revision, time, communication channel, and staff recorder. Do not substitute automatically, especially when ingredients, dietary requirements, or allergen information differ.
- Only an accepted proposal becomes an order revision. Recheck availability, lead times, routing, total, balance/refund requirement, and due time. Retain the original line and its history without counting it as active demand twice.
- Stop and acknowledge released original work before releasing replacement work where quantities overlap. Handle already-prepared original items through a recorded waste or other authorized disposition.
- Declined or unanswered proposals remain unresolved until admin agrees another option or cancellation under the bakery's policy. They cannot silently become accepted, ready, or completed.

#### Remakes and wastage

- Chef or counter staff can report damaged, incorrect, spoiled, or otherwise unusable items against the order line and ticket. Record quantity, reason, reporter, time, and optional internal notes.
- Reporting an unusable item immediately flags affected fulfillment as blocked pending review. Admin authorizes remake quantities and final waste/disposition; the report alone does not order extra work.
- Preserve gross prepared history while excluding unusable quantities from usable-ready totals. For an uncollected order, reopen production and invalidate affected packing checks when a remake is authorized.
- Create an explicitly labelled REMAKE work record/ticket linked to the original order line and incident, with its own reference, kitchen, quantity, and deadline. Repeated approval/retry must not create duplicate remake work.
- Bakery-error remakes do not add customer charges. Any separately chargeable customer change requires explicit price approval and an ordinary order adjustment, not a hidden remake fee.
- If the original order was already Completed, preserve its fulfillment history and create linked after-sales replacement work with a separate handover record; do not reopen or count the original sale again.
- Provide a basic admin waste/remake register filterable by date, product, kitchen, and reason. Ingredient costing and full inventory accounting remain outside this feature.

#### Late and uncollected orders

- Flag a Ready order past its collection time as Awaiting Collection / Late without claiming it was handed over. Surface it on Home and in Orders.
- Record customer contact attempts with time, channel, staff member, and outcome. The first release supports manual contact logging; automated messages remain a separate integration decision.
- Record a bakery-defined hold-until time per applicable product/order. The system does not invent holding periods; staff policies must supply them before launch.
- A revised collection time requires admin review of holding suitability and an audit entry; it must not silently rerun preparation or erase the original promised time.
- Past the hold deadline, flag Hold Expired and block handover pending admin review. Nothing is automatically discarded, refunded, or marked Completed.
- Admin records the outcome: collected after an approved extension, remake/replacement, or Cancelled with reason Uncollected and a separate waste/disposition record. Outstanding payments and refunds follow the configured policy independently.

### E. Detailed modules with launch timing to confirm

These requirements are included in the plan. Decide whether they ship in the first release or a later phase after reviewing current bakery operations; basic payment records and manual custom quotes remain in the first-release baseline.

#### Daily payment reconciliation

- Provide an admin Daily Close view, optionally divided into cashier shifts. Define the business timezone, close interval, register scope, and assigned reviewer before implementation.
- Aggregate successful payment transactions by method and collection timestamp, regardless of the order's due date. Deposits collected today for future orders belong in today's collections; the same deposit must not be counted again at pickup.
- For cash, expected closing cash equals opening float plus cash receipts minus cash refunds and recorded cash removals, plus recorded cash additions. Compare it with counted cash and record the difference and explanation.
- Compare card/other electronic payment records with verified provider totals or statements. Record settlement timing and fees separately; do not treat an unsettled payment or a fee as unexplained missing cash.
- Track preparer, reviewer, expected/actual amounts, differences, notes, and close time. A reconciliation can be Draft, Submitted, or Closed; material differences require reviewer acknowledgement.
- Lock closed reports. Correct them through an audited reopening or adjustment, preserving the prior version. Prevent the same transaction being assigned to two overlapping closes within the same register scope.
- Reconciliation does not rewrite payments, customer balances, or order status. Accounting integrations, tax filings, and automated bank matching remain deferred.

#### Bulk and custom-order specifications

- Extend the manual enquiry/quote workflow with structured event date/time, servings, weight/size, flavour/filling, quantity, design description, reference images, exact cake wording, accessories, packaging, dietary requests, and production notes.
- Keep customer requests distinct from bakery-confirmed specifications. Staff must confirm feasibility; no dietary or allergen assurance is inferred from a free-text request.
- Version the quote and specification together. Record agreed price, deposit terms, quote expiry, fulfillment details, customer acceptance, and final change deadline.
- Track Enquiry, Quoted, Revision Requested, Accepted, Expired, and Declined quote states independently from the order lifecycle. Accepting a quote creates or links one pending order; admin confirmation and any agreed deposit condition still govern production release.
- Only the accepted specification revision goes to kitchen work. Later customer changes require feasibility/price/date review, a newly accepted revision, and acknowledgement of already-released work.
- Restrict reference-image access to relevant staff, constrain file type/size, and avoid public exposure of customer uploads. Public uploading is optional; staff can attach references received through the existing enquiry process.
- First-release routing still requires one preparing kitchen per line. Split clearly separate deliverables into explicit lines; do not imply support for multi-stage cross-kitchen production of one cake.

### F. Release 1 essentials added in v0.3

#### Customer notification

- Every accepted, rejected, rescheduled, ready, or cancelled order gives staff a one-click **WhatsApp message template** (a click-to-chat link filled with the reference, status, pickup time, and tracking link). It also updates the protected status page.
- Record that a notification was sent, with channel, staff member, and time. Opening the template does not count as delivery.
- Orders still pending acceptance after a configurable time (proposed: 30 minutes within opening hours) raise an admin alert, so customers are not left waiting silently.
- Automated sending (WhatsApp Business API, SMS, email) remains a later integration and must reuse the same notification records.

#### Spam and no-show protection

- Verify the customer's phone number by OTP before online submission. If OTP cost is not approved, use a captcha plus mandatory staff callback for first-time numbers.
- Rate-limit submissions per phone number and IP address. Staff can block a number with a recorded reason.
- A configurable deposit is required above an order value threshold and for custom cakes. Such orders cannot be confirmed for production until the deposit is recorded, unless an admin override records a reason.
- Record no-shows on the customer record. Staff see a no-show count when accepting a new order from that number.

#### Customer bills and GST

- Generate a customer bill for every completed sale (counter, call, online). It shows business name, address, GSTIN, FSSAI licence number, bill number, date, items, HSN/SAC codes where applicable, taxable value, CGST/SGST split, discounts, total, payments, and balance.
- Bill numbers are sequential per financial year without gaps and are never reused. Corrections use a credit note linked to the original bill; a bill is never edited after issue.
- The bill is separate from the KOT and the order reference. Print (80mm thermal via browser print, and A4) and a shareable PDF/link are supported.
- Tax rates per product category are configured by the owner and their accountant. The system does not decide tax classification.

#### Counter quick sale

- A single-screen counter checkout for walk-in customers buying ready-stock items. Staff add items, apply an allowed discount, take payment, and print the bill. The order is created as IN_STORE and recorded as Confirmed, Allocated, and Completed in one action.
- A quick sale needs no customer name or phone number. It creates no KOT and still records stock allocation, payment, bill, and audit.
- If any made-to-order item or a future pickup time is added, the screen switches to the normal in-store order flow.
- Target: a typical 2–3 item sale completes in under 30 seconds.

#### Veg, eggless, and food labelling

- Each product/variant records Veg or Non-veg (the green/brown mark), Eggless or Contains egg, and allergens supplied by the bakery. Eggless is modelled as a variant with its own kitchen mapping and lead time, never as a free-text note.
- Show the marks on product cards, product details, cart, KOT lines (prominently), and packing checks.
- Display the FSSAI licence number on the website footer and bills. Allergen/dietary claims come only from owner-supplied data.

#### Discounts

- Release 1 supports manual discounts per line or per order (amount or percentage), with a reason and staff attribution. Only roles with the discount permission can apply them, up to a configured limit. Larger discounts need admin approval.
- Discounts are snapshotted on the order and shown on the bill before tax as configured. A coupon/promotions engine remains deferred.

#### Daily sales report

- Admin report for a chosen date range: sales by product/variant, category, source (In-store / Online / Call), and payment method. It shows gross sales, discounts, tax, refunds, and net.
- Sales use bill/payment dates, not due dates, consistent with the Home-screen rule. Export to CSV.
- This is a simple operational report. Advanced analytics and accounting integrations remain deferred.

#### Daily order caps and pickup windows

- Pickup windows are defined per weekday (for example 9–11, 11–1), each with an optional order limit. A day with no windows accepts any time within opening hours.
- Daily caps per product category count **orders** that contain the category (for example, at most 8 orders with custom cakes per day).
- Cut-offs are not used: product lead times cover them (owner decision, 2026-09-27).
- Admins can replace a date's windows or change a category's cap for festival days (Christmas, New Year, Diwali, and similar), and mark closed days in advance.
- The website stops offering a full slot or day. Staff entering call/in-store orders see a warning and may override with a reason.

#### Kitchen tablet sign-in

- A kitchen tablet is registered once by an admin as a trusted device for one kitchen. On it, chefs switch user with a personal 4–6 digit PIN instead of email and password.
- Every action is attributed to the chef who is signed in. There is an auto-lock after inactivity and lock-out after repeated wrong PINs. An admin can revoke a device or reset a PIN immediately.
- PIN sign-in works only on registered devices; elsewhere, full credentials are required.

## 6. Order and kitchen workflows

### In-store

Staff selects products and source IN_STORE, enters customer information when needed for a future pickup, sets immediate or future fulfillment, and records payment independently. An authorized staff member confirms the order. Ready-stock lines are allocated for handover; made-to-order lines follow kitchen routing. Complete the order only after preparation/packing and the configured payment policy are satisfied.

### Call

Staff records source CALL, customer contact, item specifications, requested pickup slot, and any deposit. Admin confirms availability and the promise time. The order appears in Online / Call and the calendar, with routing identical to other sources.

### Online

Customer chooses products and an offered slot, submits once, and receives a pending reference. Admin accepts or rejects with a reason. Acceptance fixes the confirmed due time and creates scheduled/released kitchen work. Rejection is visible to the customer; any recorded payment requires a separate refund workflow.

### Mixed-kitchen example — illustrative mapping only

Order B-104 contains a cake assigned to Kitchen 1 and pastries assigned to Kitchen 2.

1. Keep one customer order, total, payment history, and calendar event.
2. Create a Kitchen 1 ticket containing only the cake and a Kitchen 2 ticket containing only the pastries.
3. Each chef progresses only their ticket lines.
4. If pastries are ready but the cake is not, admin sees partial readiness. The customer order is still Preparing.
5. When all non-cancelled items are ready/allocated and packing is complete, the order becomes Ready.
6. Authorized staff records collection and marks the order Completed.

### Upcoming orders and release timing

- Keep creation time, requested due time, confirmed due time, and preparation release time separate.
- Each made-to-order line has a preparation lead time. A kitchen ticket releases at the earliest start needed by its active lines; each line retains its own planned start.
- Admin reviews feasibility against opening hours, kitchen availability, and mixed-item timing before accepting.
- Confirmed future orders enter the calendar immediately; their kitchen tickets remain Scheduled until release.
- Immediate feasible orders can release on confirmation. Late orders need explicit admin handling; never silently promise an impossible slot.
- Scheduled release must recover after interruptions and occur once. Failed or overdue release is visible to admin.
- Changes to lead times or catalogue mappings affect future orders; changing an existing order's plan requires an explicit revision.

## 7. Status model

Keep order acceptance/fulfillment, production, and payment separate.

| Layer | States | Rule |
|---|---|---|
| Order | Draft, Pending Confirmation, Confirmed, Preparing, Ready, Completed, Rejected, Cancelled | Only confirmed orders generate production work. Any started item moves a confirmed order into Preparing. Ready requires every active line ready/allocated and packing complete. |
| KOT | Scheduled, New, Acknowledged, Preparing, Ready, Cancelled | Scheduled becomes New on release. Ticket readiness is derived from active line quantities. |
| Line production | Pending, Preparing, Ready, Cancelled | Track ordered, cancelled, and ready quantities; a partially ready line remains Preparing. Ready-stock allocation is tracked without a chef ticket. |
| Payment | Unpaid, Partially Paid, Paid; refund workflow: Requested, Partially Refunded, Refunded, Failed | Derive current balance from charges, successful payments, and completed refunds. Refund status does not erase original payment history. |

Operational flags are separate from lifecycle states: Substitution Pending, Quality Hold, Awaiting Collection / Late, and Hold Expired. They block affected production or handover as described above without falsely marking an order Cancelled or Completed. A hold does not erase existing preparation progress. Only usable quantities satisfy readiness; unresolved substitutions or quality holds prevent readiness/handover. After-sales replacements retain their own work/handover state while the original completed order stays Completed.

Allowed order path: Draft -> Pending Confirmation -> Confirmed -> Preparing -> Ready -> Completed. Authorized staff may confirm directly from Draft. Orders containing only ready-stock items can move from Confirmed to Ready after allocation and packing. Reject only before confirmation. Cancel uncompleted orders with reason and kitchen coordination; completed orders use a return/refund record instead of rewriting fulfillment history.

Admin may reopen Ready work for a correction with a reason and a revised ticket; the aggregate order returns to Preparing. Chefs cannot arbitrarily rewind completed orders. Cancelled lines are excluded from readiness calculations; if no active lines remain, cancel the order instead of marking it Ready.

Payment does not mark food ready. Kitchen readiness does not mark an order paid. Default proposal: require a zero balance before completion unless admin explicitly records an approved credit exception.

## 8. Changes, cancellation, and operational exceptions

- Before ticket release: revise the scheduled work and retain history.
- After release: additions, reductions, item-note changes, deadline changes, and cancellations create a visible ticket revision with an exact change summary. Require affected kitchen acknowledgement.
- Preserve completed quantities during edits. A new quantity cannot silently erase already prepared food; reductions below prepared quantity require admin resolution and a recorded waste/return outcome.
- Reassignment to another kitchen requires cancellation/acknowledgement of outstanding original work and release of replacement work. Prevent both kitchens from preparing the same outstanding quantity.
- Existing assigned work is never silently redirected when a product's default kitchen changes.
- Cancelled orders create stop-work notices for active tickets. Already-started work remains in history; payment refunds are separate actions.
- Detect concurrent edits. If two people change the same order, show the newer version and require review rather than overwriting it.
- Repeated submission, retry, scheduled release, or print action must not duplicate orders, payments, or production work.
- Show unsynced/offline state; do not show a kitchen status update as saved until the server accepts it. Full offline ordering is deferred.
- Track failed notification/print delivery separately from order state. A failed print must not lose the digital ticket.
- Ready-stock items use an explicit allocation policy. Release reserved stock on rejection/cancellation; settle reservation timing and expiry before implementation.

## 9. Conceptual data records

| Record | Main information |
|---|---|
| User / Role / Kitchen Assignment | Staff identity, active status, permissions, assigned kitchen(s) |
| Kitchen | Name, active status, operating schedule |
| Product / Variant / Category | Description, price, availability, preparation type, lead time, routing |
| Customer | Minimal name/contact data and linked order history |
| Order | Reference, source, customer, lifecycle, requested/confirmed due time, fulfillment, totals, revision |
| Order Item | Product snapshot, variant, quantities, kitchen snapshot, customization, preparation schedule |
| Kitchen Ticket / Ticket Line | Kitchen, order/item links, release, revision, status, quantities, acknowledgements |
| Payment / Refund | Amount, method, reference, status, timestamp, recorder, reason |
| Stock Allocation, if ready-stock sold | Product/variant, reserved quantity, order link, release/consumption state |
| Audit Event / Notification | Actor, change, reason, time, target record, delivery/acknowledgement status |
| Business Settings | Timezone, currency, hours, closures, slots, payment and order policies |
| Packing / Handover | Order revision, required checks, results, packer, collector details if needed, handover actor/time |
| Substitution Proposal | Original line, proposed replacement, quantity, price/time changes, version, customer response and approval evidence |
| Production Incident / Remake | Original line/ticket, unusable quantity, reason, disposition, approval, replacement work and handover links |
| Collection Follow-up | Promised time, hold deadline, contact attempts, extension decision, final outcome |
| Reconciliation, conditional module | Register/shift interval, opening float, included transactions, cash movements, expected/actual totals, reviewer, close revisions |
| Quote / Specification, conditional module | Customer enquiry, versioned requirements/references, price/deposit terms, expiry/change deadline, acceptance, linked order |
| Bill / Credit Note | Financial-year sequence number, order link, tax breakdown, GSTIN/FSSAI snapshot, issue time, issuer; credit notes link to the original bill |
| Discount | Line or order, amount/percentage, reason, applied by, approved by |
| Notification Record | Order, event, channel, template, staff member, sent time |
| Capacity Rule / Closure | Date or weekday, slot, category, limit, cut-off, festival override, closed flag |
| Trusted Device / Staff PIN | Registered kitchen, device status, hashed PIN, failed attempts, lock/revocation |
| Customer flags | Verified phone, no-show count, blocked status and reason |

Production summaries are calculated from authoritative order lines and production records; they are not a second editable demand ledger. Limit new operational actions by role: chefs report incidents and see their kitchen summaries; authorized counter staff pack, hand over, and log contacts/proposals; admins approve replacements, financial changes, hold extensions, and reconciliation closures.

An order has multiple items and may have multiple kitchen tickets. Every ticket line must trace to an order item. Changes and replacement tickets retain their links and revision history. Calendar views are derived from these records, not a second editable order store.

## 10. Quality and security requirements

- Server-side authorization on every admin/chef action and record; test cross-kitchen access directly.
- Staff sign-in, logout, session expiry, account disabling, and a controlled recovery process. No shared chef passwords.
- Public status access uses an unguessable access mechanism or verified identity; sequential order numbers alone are insufficient.
- Validate prices, quantities, totals, routing, and transitions on the server. Use precise monetary calculations and one configured currency in the first release.
- Persist confirmation and ticket creation consistently; retries recover without orphaned or duplicate tickets.
- Record who changed dates, routing, prices, payments, cancellations, and preparation states.
- Keep credentials out of project files, logs, and public pages. Collect only customer information needed for fulfillment.
- Configure retention and backups with the owner; verify a restore before launch.
- Provide loading, empty, validation-error, permission-denied, disconnected, and retry states.
- Proposed kitchen-update target: visible within five seconds on a healthy connection, with last-update time and reconnect recovery. Validate against actual hardware/network before committing.
- Responsive public ordering, usable desktop admin tables, and touch-friendly chef screens. Keyboard navigation, visible focus, readable labels, and status text accompany colour.
- Order submission remains safe on retries and slow mobile connections. Never erase user-entered order details after a recoverable error.
- Serve optimized images (WebP/AVIF, responsive sizes). The prototype photos are about 650–930 KB each and must be compressed before reuse.

### 10A. Recommended technical approach — pending confirmation

| Need | Recommended fit |
|---|---|
| Public site, admin, and chef screens in one codebase | Next.js App Router on Vercel |
| Shared order store, transactions, unique keys | Supabase Postgres |
| Kitchen isolation enforced by the database (AC-02, AC-09) | Postgres row-level security keyed on the user's kitchen assignment |
| Live KOT updates within ~5 seconds (AC-14) | Supabase Realtime, with a refetch on reconnect |
| One-time scheduled ticket release after restarts (AC-04) | pg_cron job plus an idempotent release function guarded by a unique constraint |
| Duplicate-safe submission (AC-07) | Client-generated idempotency key stored with a unique index |
| Staff and PIN sign-in | Supabase Auth for staff; a server-verified PIN exchange on registered devices |
| Reference images, bill PDFs | Supabase Storage with private buckets |
| KOT and bill printing | Browser print stylesheets for 80mm thermal and A4 |

Confirm hosting cost limits and who will maintain the system before Phase 2 closes. If the owner prefers another stack, the PRD requirements stay the same.

## 11. Screen-planning references and future visual work

No final visual style, wireframe, or design mockup is being selected in this phase.

| Planning decision | Evidence / source | How it applies |
|---|---|---|
| Home, Products, Orders, KOT navigation | User brief | Preserve these admin destinations; add Calendar as a direct destination. |
| Separate source lists and kitchen-specific queues | User brief | Keep source labels visible without duplicating orders. |
| Public content inventory | Existing `la pater/index.html` | Review story, products, gallery, and contact content for possible reuse; verify claims. |
| Forms, keyboard access, connection feedback | Refero bundled `references/craft-details.md`, sections Forms, Accessibility, Navigation & State | Require labels, useful inline errors, keyboard operation, and visible asynchronous status. |
| Calendar agenda alternative | Proposed response to mobile calendar density | Preserve access to upcoming work on small screens. |

During the design phase, research several relevant public bakery sites and operational order/calendar screens, then select references and record specific design decisions before implementation. Brand name, typography, colours, photography, and layout remain open. Research done here is limited to the existing content and bundled craft guidance; no live competitor or Refero screen research is claimed.

## 12. Acceptance scenarios

| ID | Scenario and expected outcome |
|---|---|
| AC-01 | An IN_STORE order appears in In-store only; ONLINE and CALL appear in Online / Call with distinct badges. Counts and totals use unique orders. |
| AC-02 | A confirmed two-kitchen order creates correctly separated tickets linked to one order; neither kitchen sees the other kitchen's restricted data. |
| AC-03 | One kitchen finishes first; the order stays Preparing and shows partial readiness until all items and packing are complete. |
| AC-04 | A future order appears on its fulfillment date immediately; scheduled kitchen work releases once at the planned preparation time, including after service restart. |
| AC-05 | Rescheduling updates the calendar and kitchen deadlines together, with audit history and acknowledgement for released work. |
| AC-06 | An unmapped made-to-order product cannot be confirmed; admin sees the exact product needing a kitchen assignment. |
| AC-07 | A repeated customer submit or staff retry returns the existing result instead of producing duplicate orders or tickets. |
| AC-08 | Cancelling released work visibly informs affected kitchens, preserves prepared quantities, and does not automatically claim a refund succeeded. |
| AC-09 | Chef changes to price, payment, staff, or another kitchen's records are denied on the server. |
| AC-10 | Deposits and remaining balances are independent of preparation; default handover blocks an unpaid balance unless an authorized exception is recorded. |
| AC-11 | Changing a product price or kitchen mapping leaves existing order snapshots and tickets unchanged. |
| AC-12 | Adding items after release produces an acknowledged revision; fulfilled quantities are preserved, and only the additional outstanding work is prepared. |
| AC-13 | Partial line completion cannot mark a ticket or order Ready; ready-stock-only orders require allocation/packing but no unnecessary KOT. |
| AC-14 | A disconnected chef screen indicates stale data, does not falsely confirm a save, and refreshes authoritative status after reconnecting. |
| AC-15 | Public status access cannot expose another customer's order by changing a sequential reference. |
| AC-16 | A kitchen reassignment cancels/acknowledges original outstanding work before replacement release; both kitchens cannot act on the same outstanding quantity. |
| AC-17 | Invalid/closed pickup slots are rejected; a mixed order is checked against all items' lead times and kitchen availability. |
| AC-18 | Two admins editing the same order cannot silently overwrite one another; the later save detects the conflict. |
| AC-19 | Calendar day boundaries use the configured business timezone; all source types appear on their correct due dates. |
| AC-20 | Backup restoration recovers orders, tickets, payments, assignments, and audit history in a staging rehearsal. |
| AC-21 | Six orders require 20 identical croissants with 12 usable-ready: the kitchen summary shows eight remaining and links to all contributing lines. Cancelling, rescheduling, and remaking items updates counts without double-counting customer demand or combining unlike variants. |
| AC-22 | One missing kitchen item or required packing check blocks Ready/handover. A changed item invalidates its checks. A successful collection records the staff member and time once; a retry creates no duplicate handover. |
| AC-23 | A substitution stays pending until the specific proposal is accepted. Acceptance rechecks routing, price, and due time, stops overlapping original work, and issues an acknowledged revision. Decline or no response never silently releases replacement work. |
| AC-24 | A damaged prepared item is excluded from usable-ready totals while preparation history is preserved. One authorized remake creates one labelled replacement ticket and no extra customer charge; an after-sales remake preserves the original Completed order. |
| AC-25 | A late pickup is visible without becoming Completed. Contact attempts and hold deadline are recorded; expiry blocks handover for review, and final collection/cancellation, waste, and refund outcomes remain separate. |
| AC-26 | If reconciliation is included: a deposit collected today for a future order appears once in today's collections. Cash movements/refunds reconcile against count; differences require review, and corrections to a closed report preserve history. |
| AC-27 | If detailed custom orders are included: only the accepted specification revision reaches production after order confirmation and any agreed deposit condition. An expired quote or unapproved change cannot release work, and repeated acceptance cannot create duplicate orders. |

| AC-28 | A walk-in buys two ready-stock items through Counter Sale: one IN_STORE order is completed with stock allocation, payment, and a bill, and no KOT is created. |
| AC-29 | Every completed sale produces exactly one bill with a gap-free financial-year number and correct CGST/SGST split; a correction issues a linked credit note and leaves the original bill unchanged. |
| AC-30 | An online submission without phone verification is rejected; repeated submissions from one number/IP beyond the limit are throttled; an order above the deposit threshold cannot release production until the deposit is recorded or an admin override is recorded. |
| AC-31 | Accepting or rejecting an online order offers a pre-filled notification and records who sent it; an order pending longer than the configured time raises an admin alert. |
| AC-32 | A full slot or capped day is not offered on the website; a staff override for a call order requires a reason and appears in the audit timeline. |
| AC-33 | Eggless and regular variants of the same product route to their own mapped kitchens and appear as distinct lines on KOTs, summaries, and packing. Veg/egg marks show on product, cart, and KOT. |
| AC-34 | A chef signs in by PIN only on a registered tablet for their kitchen; actions are attributed to that chef; a revoked device or reset PIN takes effect immediately. |
| AC-35 | The daily sales report totals match the underlying bills, payments, discounts, and refunds for the date range, grouped by bill date rather than due date. |
| AC-36 | In Release 1, an admin override (for example cancelling a damaged item and adding a replacement line) records a reason and still requires kitchen acknowledgement of released-work changes. |

Acceptance scenarios are future verification requirements, not tests executed during this planning phase.

Release 1 gates: AC-01 to AC-20, AC-22 (basic packing and one-time handover), and AC-28 to AC-36. Release 1.1 gates: AC-21, the itemized-checklist parts of AC-22, and AC-23 to AC-25. AC-26 and AC-27 become release gates when their modules are selected; record the decision rather than leaving their applicability ambiguous.

## 13. Deferred scope

- Online payment gateway and automated refunds unless explicitly selected for launch.
- Delivery routing, driver login, live tracking, and delivery marketplaces.
- Ingredient purchasing, recipes/BOM, raw-material inventory, and production batch planning.
- Loyalty, promotions engine, customer accounts, subscriptions, and advanced CRM.
- Multiple branches, inter-branch transfers, and multi-currency operation.
- Multi-stage production of the same item across several kitchens.
- Automatic capacity optimization, full offline mode, dedicated printer integrations, and automated WhatsApp/SMS/email services. (Configured daily caps and browser-printed thermal KOTs/bills are in Release 1.)
- Advanced analytics and accounting integrations.

## 14. Decisions needed before dependent implementation

1. Final business name and whether the existing prototype is the intended visual/content starting point.
2. Kitchen names, product/variant mapping, and whether any single item needs work from both kitchens.
3. Guest ordering or customer accounts; website checkout itself is confirmed.
4. Pickup only or delivery; store timezone, currency, business hours, closures, and pickup slots.
5. Who can accept orders, whether acceptance can ever be automatic, and customer confirmation method.
6. Payment methods, deposit requirement, cancellation/refund policy, discounts, tax configuration, and credit exceptions.
7. Ready-stock products and reservation/expiry policy; how stock counts are maintained.
8. Preparation lead times, production release rules, workload limits, and how last-minute orders are handled.
9. Required staff roles and whether chefs can access one or both kitchens.
10. Digital KOT only or printing; available kitchen devices, printer models if relevant, and network conditions.
11. Custom-cake specification/quote process and supported variants/customization.
12. Expected order volume, budget, target launch date, hosting constraints, and notification channels.
13. Packing owner, required accessory/customization checks, and recipient verification process.
14. Who may approve substitutions/remakes, how customer consent is recorded, and waste/disposition reasons.
15. Product holding policies, late-pickup contact process, extension authority, and uncollected-order financial treatment.
16. Whether payment reconciliation launches immediately; current cash registers/shifts, opening floats, cash movements, payment statements, and review responsibility.
17. Whether detailed bulk/custom specifications launch immediately; required fields, quote expiry, deposits, change deadlines, and reference-image handling.
18. GSTIN, FSSAI licence number, tax rates/HSN per category, bill format, and financial-year numbering (confirm with the accountant).
19. Notification channel for Release 1 (WhatsApp template, staff callback, or a paid automated service) and the pending-order alert time.
20. OTP provider and cost, or captcha-plus-callback; submission limits; deposit threshold.
21. Veg/non-veg and eggless status plus allergens for every product; which products have eggless variants.
22. Discount permissions and limits per role.
23. Daily/slot caps per category, ordering cut-offs, and the festival calendar. **Decided 2026-09-27:** per-weekday windows with limits, per-category daily caps counting orders, festival date overrides, no cut-offs, admin-only override. Actual numbers still to be entered in Settings.
24. Kitchen tablets (count, model) and whether PIN sign-in is acceptable to the owner.
25. Confirm the recommended stack and hosting budget (section 10A).

## 14A. Glossary

| Term | Meaning |
|---|---|
| Source | Where the order came from: IN_STORE, ONLINE, or CALL. Independent of payment and fulfilment. |
| Made-to-order / Ready-stock | Made-to-order items are prepared by a kitchen via a KOT; ready-stock items are taken from shelf stock. |
| Release | The moment a Scheduled kitchen ticket becomes New and enters the chef's active queue. |
| Active line / quantity | Ordered quantity not cancelled or replaced. Only active quantities count toward demand and readiness. |
| Allocated | Ready-stock quantity reserved for a specific order. |
| Gross prepared | Everything a kitchen made for a line, including items later found unusable. |
| Usable-ready | Prepared or allocated quantity fit for handover; excludes damaged, spoiled, or incorrect items. |
| Ready (order) | Every active line is usable-ready/allocated and packing is confirmed. |
| Handover | Recorded collection by the customer; the step that marks an order Completed. |
| Hold / flag | An operational block (Substitution Pending, Quality Hold, Awaiting Collection, Hold Expired) that sits alongside the lifecycle state. |
| Revision | A recorded change to a confirmed order or released ticket, which kitchens acknowledge. |
| Admin override | An admin action outside the normal path, allowed only with a recorded reason. |
| Quick sale | A single-screen counter sale of ready-stock items completed immediately. |
| Bill | The customer's GST tax document; distinct from the order reference and the KOT. |

## 15. Launch success measures

Zero lost/duplicated orders or wrong-kitchen assignments in acceptance testing; every confirmed order visible on its due date; mixed-kitchen readiness correct; staff able to run an end-to-end shift rehearsal. After launch, measure late orders, missed acknowledgements, order-entry time, and kitchen-update delay to set realistic improvement targets.
