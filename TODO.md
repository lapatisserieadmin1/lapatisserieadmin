# La Patisserie — To-do List

Status (2026-10-13, live): **custom cakes now take theme, design, model, fondant, cupcakes/popsicles ticks, and set-up and delivery charges (each its own bill line); the calendar shows each cake's flavour, weight, fondant and theme** (HANDOVER section 20; migration `20261013000100` applied, deployed). On 2026-10-09 (live): KOT removed (no KOT or chef screens); Customers for counter staff; Customer orders; custom cake orders with photo, price and advance; product photos; collect from store or set up at the customer's place, green/red; Counter Sale removed (HANDOVER section 19). Still to do: click through the new screens on the live site. Before that, on 2026-10-05: Phases 3, 4A, 4B, 5A–5D and the daily sales report are built, reviewed and deployed from `main`; Phase 4C is done except customer notification templates (owner to choose a channel). Home shows kitchen workload and alerts. The owner's pink **La Patisserie** mock-up is being built in six pieces: **piece 1 (look and shell) is done; piece 2 (Orders page) is next** (see "Owner's mock-up" below). The live database holds demo data (remove before real customers). Real flows have not been clicked through yet; the owner wants that walkthrough after the build work. Owner decisions: no stock tracking (2026-10-02); La Patisserie brand, delivery later, admin-set chef PINs with no lock-out, admin-only reports (2026-10-03). See HANDOVER.md for setup, architecture and known gaps.
Checkboxes represent actual completion, not intentions.

## Start here — next developer

- [x] Ship the 2026-10-09 branch `no-kot-custom-cakes`: migrations applied to the live project, merged into `main`, deployed (2026-10-09). Counter Sale and the New customer order button removed the same day.
- [ ] Click through the new screens on the live site (HANDOVER section 19).
- [x] Shipped `custom-cake-extras` (2026-10-13; migration applied to live, merged, deployed): custom cakes gain theme, design, model, fondant, cupcakes/popsicles ticks, and set-up and delivery charges (each its own bill line at the custom cake GST rate); the calendar shows cake, weight, fondant and theme. Apply migration `20261013000100_custom_cake_extras.sql`, merge, deploy.
- [ ] Owner to confirm: custom cake GST 5% (Settings), set-up and delivery charges taxed at that same rate, counter staff may take custom cakes but only an admin re-prices a confirmed one (price or charges).

1. [ ] Read [HANDOVER.md](HANDOVER.md), then PRD sections 5F, 7, 10A, and 14A.
2. [x] First Git deployment of `main` checked (2026-10-03): it served 404s until the Root Directory was set to `web`; fixed. Check `vercel ls` after each push (HANDOVER section 2).
3. [x] `SUPABASE_SECRET_KEY` added to `web/.env.local` (2026-10-03). Still needed on Vercel for PIN sign-in. Rotate it before go-live (it was shared in a chat).
4. [x] Code is on GitHub: `sandymandycandy/bakery-admin` (branch `main`). Clone it; get `web/.env.local` values from the owner.
5. [ ] Click through every real flow in a browser (owner: after the build work). Done so far: headless-Chrome screenshots of the main screens (2026-10-04) and live smoke tests of PIN sign-in.
6. [ ] Create a staging Supabase project so end-to-end tests can create bills without touching the live bill sequence. (SQL checks already run on PGlite without one: `cd supabase/local/pglite && node run.mjs`.)
7. [ ] Enable Leaked Password Protection (Supabase → Auth → Password security).
8. [x] Merge Phase 5A into `main` and deploy (done 2026-10-03).
9. [ ] Demo logins on the live site: the owner allowed them; `DEMO_ADMIN_*` is set on Vercel (2026-10-03). **Delete `DEMO_*` on Vercel and redeploy before real data goes in.**
10. [x] Create the demo chef login and assign it to kitchens (2026-10-03: chef@auri.test, Kitchen 1 and Kitchen 2; password in web/.admin-password.txt).
11. [x] While no real orders exist, reset the order sequence (done 2026-10-03: the first real order will be B-1001). Run SQL tests locally from now on so it stays there.
12. [ ] Before real data: run `supabase/seed/remove_demo_data.sql` on the live project (demo data loaded 2026-10-03: orders B-1001…B-1015, bills 00001–00005). It restarts order and bill numbering.
13. [ ] Add `SUPABASE_SECRET_KEY` to Vercel production and redeploy (`vercel env add SUPABASE_SECRET_KEY production` from `web/`): chef PIN sign-in and staff-login management need it on the live site. Rotate the key before go-live.
14. [ ] Owner to confirm: the 5B packing/handover defaults (HANDOVER section 6) and the mock-up status colours (Ready and Completed both green; Completed grey instead?).

## Owner's mock-up — La Patisserie admin (agreed order, 2026-10-03)

The owner sent a pink "La Patisserie" orders-screen mock-up (WhatsApp image, 22 Sep 2026) and asked for everything in it. Agreed pieces, built in this order, each with its own spec, plan, tests and review:

- [x] 1. Look and shell: brand, pink theme, fonts, icon sidebar with count badges, top bar (search, bell, account menu), decoration everywhere, "coming soon" pages (2026-10-04; HANDOVER section 18; spec `docs/superpowers/specs/2026-10-03-la-patisserie-look-design.md`).
- [ ] 2. Orders page like the mock-up: status tabs with counts, search, date and order-type filters, rows with item photos, order detail beside the list with notes and the main action.
- [x] 3. Product photos: upload (Supabase Storage), shown in lists, the order panel and the catalogue (2026-10-09, on the branch; HANDOVER section 19).
- [x] 4. Custom cake details: flavour, size and weight, tiers, design or theme, cream, filling, toppings, message, eggless, reference photo, special instructions; sticky-note card; printed cake sheet. Built as custom cake orders (in-store / call / customer) with staff price and advance, and an Orders tab (2026-10-09, on the branch).
- [ ] 5. Notifications: the bell's list (orders waiting, late pickups; kitchen alerts went with KOT).
- [ ] 6. Delivery: delivery orders, address and charge, "Out for delivery", delivered handover (ask the owner for the rules first).
- [ ] Offers & Banners and Reviews: shown as "coming soon"; built with the public website (Phase 6).

## Phase 0 — Planning and business decisions

- [x] Inspect existing workspace material without changing the prototype.
- [x] Draft [PRD.md](PRD.md) with public, admin, chef, calendar, and KOT scope.
- [x] Define the two source lists and item-based routing between two kitchens.
- [x] Document statuses, revisions, operational exceptions, and acceptance scenarios.
- [x] Create [PROJECT_RULES.md](PROJECT_RULES.md).
- [x] Expand the plan with seven operational workflows, related rules, and AC-21 through AC-27.
- [x] Confirm business name: **La Patisserie** (owner, 2026-10-03, from the owner's mock-up; the prototype said "La Patisserie Madras"). The prototype's photos are reused in the admin decoration.
- [ ] Supply kitchen names and a product/variant-to-kitchen mapping table.
- [x] Confirm website ordering and call orders for the first release.
- [x] Retain Kitchen 1 and Kitchen 2 as planning placeholders; actual mapping remains open.
- [ ] Confirm pickup/delivery scope, timezone, currency, hours, and slots.
- [ ] Confirm acceptance permissions, payment/deposit policies, cancellation rules, and customer notification method.
- [ ] Confirm ready-stock handling, lead times, and production release rules.
- [ ] Confirm staff roles, kitchen devices, and printing needs.
- [ ] Set budget, expected volume, and target launch date.
- [ ] Confirm packing owner/checks, substitution consent, remake authority, and waste reasons.
- [ ] Define holding deadlines, late-pickup contact process, and uncollected-order outcomes.
- [ ] Decide launch timing for daily reconciliation and detailed bulk/custom specifications; document applicability of AC-26 and AC-27.
- [x] Split delivery into Release 1 (core loop plus admin overrides) and Release 1.1 (operational exception workflows) — v0.3 review.
- [x] Add Release 1 essentials to the PRD (section 5F), the recommended stack (10A), glossary (14A), and AC-28 to AC-36.
- [ ] Supply GSTIN, FSSAI licence, tax rates/HSN per category, and bill format; confirm with the accountant.
- [ ] Choose the Release 1 notification channel and pending-order alert time.
- [ ] Choose OTP provider (or captcha plus callback), submission limits, and deposit threshold.
- [ ] Supply veg/non-veg, eggless variants, and allergen data for every product.
- [ ] Set discount permissions/limits, daily/slot caps, ordering cut-offs, and the festival calendar.
- [x] Confirm kitchen tablets and PIN sign-in (owner, 2026-10-03: admin sets PINs, no auto-lock, no lock-out).
- [x] Confirm the recommended stack (Next.js + Supabase + Vercel); hosting budget still open.

Exit: material business decisions recorded in PRD; unresolved choices remain explicitly marked.

## Phase 1 — Workflow and design definition

Depends on: relevant Phase 0 decisions.

Note: coding started before this phase was completed (owner's request). Screens were designed directly in code with a neutral placeholder style; walk them through with the owner before launch.

- [ ] Walk through one in-store, one call, and one online order with the owner.
- [ ] Walk through a future order, a mixed-kitchen order, a reschedule, and a cancellation after preparation starts.
- [ ] Confirm state transitions, partial quantities, packing responsibility, and handover permissions.
- [ ] Walk through daily product totals, a substitution awaiting consent, damaged-item remake, and an expired collection hold.
- [ ] Plan production summary, packing checklist, operational holds, incident register, and collection follow-up screens within KOT/Orders.
- [ ] Research public-site and operational screen references; record which choices each reference supports.
- [ ] Agree brand assets/content and a visual direction before visual implementation.
- [ ] Plan public product, checkout, confirmation, and protected status screens.
- [x] Plan admin Home, Products, two Orders lists, order detail, and Calendar screens (built directly; KOT still to plan).
- [x] Plan Counter Sale and bill/credit-note print layouts (80mm and A4) — built. Reports and the admin-override dialog still to plan.
- [ ] Plan OTP verification in checkout, notification templates, and the capacity/closure settings screens.
- [ ] Plan kitchen sign-in, active tickets, upcoming schedule, ticket details, and alerts.
- [ ] Include loading, empty, error, permission, stale-data, and mobile states in designs.
- [ ] Review screen flows against PRD acceptance scenarios.

Exit: reviewable screen/workflow specification with decisions recorded; no code required for this phase.

## Phase 2 — Technical planning

Depends on: settled order rules and initial screen/workflow specification.

Note: items marked done below are specified by the implemented migrations in `supabase/migrations/` (the SQL is the specification).

- [x] Confirm the recommended stack (PRD 10A): Next.js 16 + Supabase + Vercel. Hosting budget still open.
- [x] Specify bill numbering (gap-free per financial year), credit notes, and tax calculation (migration 0300/0310).
- [x] Specify trusted-device registration and PIN sign-in security (`docs/superpowers/specs/2026-10-03-chef-pin-signin-design.md`).
- [x] Specify shared order data, staff access, kitchen assignment, and record relationships (migrations 0100/0200).
- [x] Specify ticket generation (Phase 5): `docs/superpowers/specs/2026-09-30-kitchen-tickets-design.md`. Transactional confirmation, duplicate prevention (idempotency keys), and conflict handling (order version) are done.
- [x] Specify release scheduling, restart recovery, and alert handling (Phase 5): owner chose release on confirmation, so there is no scheduler to recover. Timezone behaviour is done (business timezone in settings; `web/src/lib/time.ts`).
- [ ] Specify live updates/reconnect behavior and audit records.
- [ ] Specify protected order tracking and settle guest versus account access.
- [ ] Specify stock allocation (blocked on PRD decision 7). Payment and balance calculations are done (`order_summaries` view).
- [ ] Specify usable-ready versus gross prepared quantities, remake links, hold flags, and packing-check invalidation after revisions.
- [ ] Define backup/restore, deployment environments, monitoring, and rollback approach.
- [ ] Map each acceptance scenario to its test approach.

Exit: implementation plan with dependencies and remaining external services/hardware identified.

## Phase 3 — Foundation and catalogue implementation

Start only after the user requests coding. Depends on: Phase 2.

- [x] Set up the Supabase project (auri-bakery, ap-south-1) and the Next.js app in `web/`.
- [ ] Set up a staging environment (separate Supabase project).
- [x] Implement staff email sign-in, admin/counter/chef roles, kitchen assignments, and RLS enforcement.
- [x] Implement trusted kitchen devices and chef PIN switching (AC-34) (5D, 2026-10-03; HANDOVER section 16).
- [x] Configure two placeholder kitchens and business settings (name, contact, GSTIN, FSSAI).
- [x] Add opening hours and closures (Settings; enforced on every pickup time, 4A).
- [x] Add capacity caps and pickup windows (4C, 2026-09-28). Cut-offs dropped by owner decision.
- [x] Implement categories, products, variants (including eggless), veg/egg/allergen marks, GST rate/HSN, availability, lead times, and kitchen mapping.
- [x] Implement audit foundations (row-level audit trigger on catalogue, staff, kitchens, settings). Order snapshots come with orders.
- [x] Verify unauthorized access is denied and unmapped made-to-order variants are listed (SQL RLS checks plus 26 HTTP-level checks, 2026-09-27).
- [ ] Click through the admin forms in a browser (not yet done; the browser extension was not connected).

Exit: staff access and catalogue work reliably; AC-06 and relevant AC-09 checks pass.

## Phase 4 — Orders, calendar, and payments

Depends on: Phase 3.

- [x] Implement shared order records with IN_STORE, ONLINE, and CALL sources (4A).
- [x] Implement in-store/call entry, pending review, confirmation, rejection, and order details (4A).
- [x] Implement the two order lists and their search, filters, counts, and source badges (4A).
- [x] Implement item snapshots, GST-inclusive totals, deposits, balance, and manual refund records (4A).
- [ ] Implement ready-stock allocation where included (blocked: stock-count policy, PRD decision 7).
- [x] Implement Counter Sale quick checkout with split payments and change calculation (AC-28, 4B).
- [x] Implement manual order discounts (amount or %) with reason, attribution, and a counter-staff limit (4B).
- [x] Implement GST bills (gap-free per financial year, per-rate CGST/SGST), credit notes, and 80mm/A4 print (AC-29, 4B).
- [x] Implement due-date calendar (agenda + month) with source/kitchen/status filters (4A). Week/day views remain for 4C.
- [x] Implement window/day caps and admin overrides with reason (AC-32, staff side; `supabase/tests/capacity_logic.sql`). The website side uses `pickup_availability` in Phase 6.
- [x] Implement rescheduling, opening-hours/closure/lead-time validation, conflict detection, and cancellation history (4A).
- [x] Implement the admin-override action with mandatory reason (at least 5 characters) and timeline entry (AC-36, shared `OverridePrompt`). Kitchen acknowledgement of released-work changes comes with Phase 5.
- [ ] Implement notification templates, sent-records, and the pending-order alert (AC-31).
- [x] Verify AC-01, AC-07, AC-11, AC-17, AC-18, AC-19 (22 SQL checks in `supabase/tests/orders_logic.sql`, 29 end-to-end checks, 2026-09-27).
- [x] Verify AC-28 and AC-29 (billing SQL checks in `supabase/tests/billing_logic.sql`; HTTP checks of all rejection paths, 2026-09-27). Success paths were not run over HTTP to avoid consuming real bill numbers.
- [ ] Verify AC-32 and AC-36 in a browser. AC-10 (balance before handover) is covered at SQL level by `supabase/tests/packing_logic.sql` (H1–H7, 2026-10-03); its browser check is still to do.
- [ ] Set up a staging Supabase project so end-to-end tests can create real bills without touching the live bill sequence (see Start here).

### Phase 4C — done except notification templates

- [x] Pickup windows per weekday with limits, daily caps per category (counting orders), festival date overrides, admin override with reason (AC-32). Cut-offs dropped. **Browser click-through of Settings → Capacity and the new-order/reschedule panels still to do.**
- [x] Calendar week and day views (day view grouped by pickup window with window and category usage). **Browser click-through still to do** (no orders in the database yet).
- [x] Admin override prompt as a shared component with mandatory reason and timeline entry (AC-36).
- [ ] Notification templates: WhatsApp click-to-chat links for accepted/rejected/rescheduled/ready/cancelled, `notification_records` table, pending-order alert after N minutes (PRD 5F, AC-31).
- [x] Customer blocking and no-show recording (HANDOVER section 9; `supabase/tests/no_show_logic.sql` 26/26). Recording a no-show does not change the order's status. **Browser click-through still to do.**
- [x] Editing items on pending and confirmed orders (HANDOVER section 10; `supabase/tests/edit_items_logic.sql` 21/21). **Browser click-through still to do.** Phase 5 must turn edits to released work into acknowledged revisions.
- [x] Demo-login autofill on `/login` for admin and chef, controlled by `DEMO_*` env variables (owner allowed it in production).
- [x] First Vercel production deployment (`bakery-admin` project, manual `vercel deploy --prod` from `web/`). Git integration connected 2026-10-03: pushes to `main` deploy.

Exit: a staff-entered order remains consistent across lists, detail, calendar, and payment records.

## Phase 5 — KOT and chef workflow

**Removed at the owner's request on 2026-10-09** (branch `no-kot-custom-cakes`): no kitchen tickets, chef screen, chef PINs or KOT print; orders are packed when ready. Kept below as history; packing and handover (5B) stay.

Depends on: confirmed orders from Phase 4. Split into 5A (kitchen tickets, built), 5B (packing and handover), 5C (revisions after acknowledgement), 5D (chef PIN sign-in). See HANDOVER section 11.

- [x] Generate separate kitchen tickets from the relevant order items (5A; `supabase/tests/kitchen_logic.sql` 44/44).
- [x] Release on confirmation (owner decision 2026-09-30: no scheduled release); duplicate prevention via one ticket per kitchen per order.
- [x] Implement chef queues, source filters, kitchen switch, and ticket detail (5A, `/kitchen`).
- [x] Implement acknowledgement, preparation, partial quantities, readiness, and issue reporting (5A).
- [x] Derive aggregate readiness ("All kitchen items ready"; order stays Preparing until packing) (5A).
- [x] Implement basic packing confirmation with packer attribution and one-time handover recording (AC-22, basic part) (5B, 2026-10-03; `supabase/tests/packing_logic.sql` 22/22; HANDOVER section 13). No stock allocation (owner decision 2026-10-02). In `main`; defaults await the owner (HANDOVER section 6).
- [x] Fix the minor items from the 5A review: lock order, locked kitchen guard, change stamp, sign-out detection, KOT overdue tickets, and the small UI items (2026-10-03; HANDOVER section 12; `supabase/local/concurrency-kitchen.sh`).
- [x] Cancellation acknowledgements (stop-work notices) (5A).
- [x] Implement revisions to acknowledged work and preserved prepared quantities (5C, 2026-10-03; `supabase/tests/revisions_logic.sql` 26/26; HANDOVER section 14). Merged and deployed 2026-10-03; migrations live. Kitchen reassignment is not built (no flow moves items between kitchens).
- [x] Live updates and connectivity state: 10-second change stamp with Updated/Offline indicator (5A). Supabase Realtime deferred.
- [x] Implement KOT browser print/reprint (80mm) preserving ticket identity and revision; reprints say COPY (5A).
- [x] Show eggless/veg marks prominently on KOT lines (AC-33) (5A).
- [x] Chef PIN sign-in on registered tablets (AC-34) (5D, 2026-10-03; HANDOVER section 16; `pin_logic.sql` 19/19). Needs `SUPABASE_SECRET_KEY` on Vercel for the live site.
- [ ] ~~Browser click-through of the chef screen, KOT page~~ (removed); click through the packing and handover card.
- [ ] Verify AC-02 through AC-05, AC-08, AC-09, AC-12 through AC-14, AC-16, and AC-33.

Exit: two kitchen users can complete a mixed order without duplicated work or premature readiness.

## Phase 6 — Public website and customer flow

Depends on: approved content/design and stable order handling. Catalogue content can be prepared earlier.

- [ ] Implement the public home, products, details, contact, and policy pages.
- [ ] Replace unverified claims and placeholder business data with owner-supplied content.
- [ ] Compress and resize prototype photos (WebP/AVIF, responsive sizes) before reuse.
- [ ] Show veg/egg marks and FSSAI licence number on the site.
- [ ] Implement cart, slot selection, submission, confirmation, and protected status access.
- [ ] Implement phone OTP (or captcha plus callback), rate limits, number blocking, and deposit threshold (AC-30).
- [ ] Reuse the shared order/routing rules for public orders.
- [ ] Implement explicit pending acceptance, validation, submission recovery, and duplicate protection.
- [ ] Implement customer confirmation/status messaging through the chosen channel.
- [ ] Verify public flows, mobile usability, keyboard access, AC-07, AC-15, AC-17, and AC-30.
- [ ] Review the rendered website against the chosen visual references.

Exit: a customer can follow the chosen ordering process, and staff can fulfill the resulting order.

## Phase 7 — Admin overview and complete rehearsal

Depends on: Phases 4–6, adjusted for chosen public scope.

- [x] Home: due today, awaiting confirmation, overdue, balance due, next 7 days, ready for pickup with late collections, missing routing, setup checklist; kitchen workload per kitchen (open, not started, late to start, past pickup, items to make, changes unacknowledged) with links to each queue; kitchen alerts (unacknowledged changes, stop-work, open issues, late starts); preparing/ready counts; money collected today for admins; Open calendar / Open KOT (2026-10-03, `web/src/lib/home.ts`).
- [ ] Validate dashboard counts and dates against underlying order records.
- [x] Implement the daily sales report with CSV export (AC-35). (built 2026-10-03; HANDOVER section 15)
- [ ] Complete settings and staff-management screens.
- [ ] Run all Release 1 acceptance scenarios (PRD section 12), including concurrent edits and interrupted connections; run AC-26/AC-27 if selected for launch.
- [ ] Rehearse exceptions using admin overrides: unavailable item, damaged item, late pickup (AC-36).
- [ ] Rehearse a full shift with counter staff and one user in each kitchen on real devices.
- [ ] Verify print output if printing is in scope.
- [ ] Check typical-volume performance and the proposed kitchen-update target.
- [ ] Restore a backup in staging and verify recovered records (AC-20).
- [ ] Prepare operating guidance for order changes, kitchen issues, cancellations, and recovery.

Exit: owner/staff acceptance recorded; blocking defects resolved and known limits documented.

## Phase 8 — Launch preparation and rollout

- [ ] Load verified products, prices, kitchen mappings, hours, policies, and real staff accounts.
- [ ] Confirm domain/hosting and any paid integrations before committing spend.
- [ ] Configure production secrets, backups, monitoring, and staff recovery procedures.
- [ ] Record launch readiness, support ownership, and rollback instructions.
- [ ] Publish when requested and run a controlled end-to-end production order.
- [ ] Observe initial operating shifts and resolve production issues.
- [ ] Review admin-override logs from the first weeks to prioritize Release 1.1 workflows.

## Phase 9 — Release 1.1 operational exceptions

Depends on: Release 1 live and stable. Use override logs to confirm priorities.

- [ ] Implement per-kitchen daily production summary with variant/time grouping and contributing ticket links (AC-21).
- [ ] Implement the itemized packing checklist with revision-driven rechecking (AC-22, full).
- [ ] Implement substitution proposals, customer response evidence, affected-work holds, and approved order revisions (AC-23).
- [ ] Implement quality incidents, usable-quantity adjustments, approved remake tickets, after-sales replacement handover, and waste register (AC-24).
- [ ] Implement late/uncollected flags, manual contact history, hold deadlines, reviewed extensions, and disposition records (AC-25).
- [ ] Verify AC-21 through AC-25, including their interactions with kitchen routing, cancellation, packing, and payments.

## Later backlog — outside the default first release

### Conditional operational modules — timing to be decided

These modules are fully described in PRD section 5E. Move their tasks into the release plan if selected; basic payment records and manual quotes remain part of the first release regardless.

- [ ] Daily reconciliation: define register/shift scope, transaction intervals, opening float, cash movements, expected/count totals, difference review, and audited closing/reopening.
- [ ] Daily reconciliation: implement admin Daily Close after payment records exist; verify deposit timing, refund handling, duplicate interval protection, and AC-26.
- [ ] Bulk/custom specifications: define required fields, reference files, quote versions, customer acceptance, expiry, deposit conditions, and change deadlines.
- [ ] Bulk/custom specifications: implement versioned quote-to-order handling after order revisions exist; verify only accepted specifications release, file access is restricted, and AC-27 passes.

### Deferred integrations and larger features

- [ ] Online payment gateway and automated refunds.
- [ ] Delivery/driver operations and delivery marketplace integrations.
- [ ] Automated customer SMS, email, or WhatsApp notifications.
- [ ] Raw-material inventory, recipes, purchasing, and production batches.
- [ ] Loyalty, promotions, accounts, and advanced reporting.
- [ ] Multiple branches and multi-stage cross-kitchen items.
- [ ] Dedicated printer integration, full offline operation, and automatic capacity planning.

## Tracking conventions

- Use task states: Planned, In Progress, Blocked, Done when assigning work later.
- For a blocked task, record the missing decision/dependency and the next action.
- Add an owner and estimate after business scope and stack are settled; current phases are dependency-based, not a promised schedule.
- Mark implementation tasks complete only with evidence appropriate to the change.
- Update PRD first when a task changes agreed behavior; keep this checklist consistent with it.
