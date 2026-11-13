# Bakery Project Rules

Status: Draft working rules for the planning baseline, 2026-09-27.

## 1. Scope and decision authority

1. Coding was authorized on 2026-09-27, starting with Phase 3 (foundation) on the recommended stack. The public website is deferred until the user asks for it. Deploying, purchasing services, contacting customers, and modifying the `la pater/` prototype still need explicit requests.
2. A later explicit request to code authorizes implementation within that request's scope. Do not repeatedly ask for permission for already authorized routine work.
3. User instructions take precedence. In the documents, distinguish confirmed requirements from proposed defaults and open decisions.
4. [PRD.md](PRD.md) describes expected product behavior. [TODO.md](TODO.md) tracks the work. This file records cross-cutting rules. Resolve conflicts explicitly rather than choosing whichever document is convenient.
5. Preserve existing files/assets. Verify business ownership, accuracy, and intended reuse of content before publishing it.
6. Keep decisions proportionate: ask about choices that change business behavior; use sound implementation judgment for routine details after implementation is authorized.
7. Do not add a feature to the first release merely because it appears in the later backlog.

## 2. Order rules

1. One customer order has one stable identity and one authoritative history across every screen.
2. Store source separately from fulfillment, payment, kitchen, and due date. Sources are IN_STORE, ONLINE, and CALL.
3. In-store displays IN_STORE. Online / Call displays ONLINE and CALL with distinct badges. Do not create duplicate orders to populate these views.
4. Every scheduled order has a clearly defined due time in the business timezone. Creation date and preparation time are separate fields.
5. Submitted online orders are pending until accepted under the configured policy. Drafts, pending orders, and rejected orders cannot release preparation work.
6. Snapshot ordered products, variants, price, customization, and kitchen assignment. Catalogue changes must not rewrite accepted order history.
7. Readiness depends on all active quantities and packing; completing one kitchen ticket is insufficient for a mixed order.
8. Payment and production status are independent. Payment does not imply readiness, and readiness does not imply payment.
9. Cancellation, payment refunds, and stop-work acknowledgement are separate recorded actions. Never report a refund as completed without a completed payment/refund record.
10. Changes to accepted orders need visible history. Released work needs explicit revision handling; no silent deletion or replacement.
11. Reject conflicting updates and duplicate submissions safely. Repeating a request must not repeat the business action.
12. Require recorded customer approval for a specific substitution proposal before changing active demand, price, or promised time. Hold affected outstanding work while approval is pending.
13. Assign packing and handover to authorized staff; record checks and actor/time. Relevant revisions invalidate affected packing checks. Block handover for unresolved quality, substitution, or expired-hold issues.
14. Late or uncollected does not mean Completed. Log contact attempts and bakery-defined holding deadlines; extensions, cancellation, disposition, and refunds are explicit separate actions.
15. Admin overrides require a recorded reason and an audit entry. They never bypass kitchen acknowledgement, prepared-quantity preservation, or the separation of payment, refund, and handover.
16. A bill is a tax document: numbered gap-free per financial year, never edited after issue, corrected only by a linked credit note. It is separate from the order reference and the KOT.
17. The system never decides tax classification, dietary claims, or allergen status; these come from owner-supplied data.
18. Counter quick sales follow the same order, payment, stock, bill, and audit rules as other orders; they only skip steps that do not apply (customer details, KOT).
19. Capacity caps and cut-offs are enforced on the website; staff may override them only with a recorded reason.
20. A notification counts as sent only when a staff member or service records it; opening a template is not delivery.

## 3. Kitchen and KOT rules

1. The first release has two configurable kitchens. Every made-to-order variant resolves to one assigned preparing kitchen.
2. Split production by order item, preserving one parent customer order. Tickets show only the items assigned to their kitchen.
3. Ready-stock lines do not generate unnecessary preparation tickets; they must still be allocated and packed.
4. Chefs may access and update only assigned kitchen work. Cross-kitchen access is explicit, never implied by knowing an order reference.
5. Upcoming work can be visible before release; it must be clearly distinguished from work ready to start.
6. Ticket creation, scheduled release, retry, and reprint cannot duplicate outstanding production quantities.
7. Quantity, note, deadline, routing, and cancellation changes after release must be visible and acknowledged by affected kitchens.
8. Preserve prepared quantities and record exceptional waste/rework. Do not rewrite completed work as if it never happened.
9. Changing a product's default kitchen affects future orders. Reassigning existing work requires an explicit controlled revision.
10. A KOT is a production document, not a payment receipt. Keep prices, payment details, and unnecessary personal information out of chef views.
11. Derive production summaries from current order lines and tickets. Keep variants, time windows, and special requirements distinct, and link totals back to individual work. Summaries cannot mass-complete orders.
12. Preserve gross prepared history but exclude unusable quantities from readiness. Record waste and authorized remakes against their original line; never count a remake twice as customer demand or silently charge for a bakery error.
13. Remake work has its own identity and approval. After-sales replacements preserve the original completed order and use a separate linked handover record.

## 4. Calendar and scheduling rules

1. The main calendar shows fulfillment deadlines. Production views show preparation start/release times with clear labels.
2. Include all order sources; source tabs must not hide future in-store commitments from the calendar.
3. Distinguish requests from confirmed commitments and preserve cancelled history through filters.
4. Use one configured business timezone consistently for slots, calendar boundaries, deadlines, and alerts.
5. Confirm lead times, closures, and kitchen availability before promising a slot. Do not assume unlimited capacity.
6. Rescheduling updates the order, calendar, and kitchen work together, with revision history and notification where needed.
7. Do not maintain a separate manually synchronized calendar copy of orders.

## 5. Security and data rules for later implementation

1. Enforce roles and record access on the server, not just by hiding buttons.
2. Give staff individual accounts. Support logout, recovery, session expiry, and immediate account disabling. PIN sign-in is allowed only on admin-registered kitchen devices, with hashed PINs, lock-out, and immediate revocation.
3. Protect public order access; an order reference alone must not disclose customer details.
4. Validate totals, quantities, state transitions, routing, and schedules using authoritative server data.
5. Store secrets outside source code and avoid putting credentials or customer-sensitive data in logs.
6. Audit sensitive changes with actor, time, before/after context, and reason when required.
7. Keep confirmation and production creation consistent; recover from interrupted operations without missing or duplicate work.
8. Display disconnected/unsaved state accurately. Do not claim a change is saved before it is accepted.
9. Maintain backups and prove restoration before launch.
10. Verify customer phone numbers (or apply the approved fallback) and rate-limit public submissions.

## 6. Design and usability rules

1. Final brand and visual decisions remain open during planning. Research references and select a clear direction before visual implementation.
2. Public pages help customers choose products and understand how to order. Admin pages help staff find and manage orders. Chef screens prioritize preparation actions and deadlines.
3. Preserve the requested admin destinations: Home, Products, Orders, KOT, with Calendar directly accessible.
4. Use explicit source, kitchen, due-time, and status labels; colour alone cannot communicate a state.
5. Support desktop admin use, mobile public use, and touch-friendly kitchen devices.
6. Include labelled fields, useful error messages, keyboard navigation, visible focus, loading/empty states, and connection feedback.
7. Keep technical implementation details out of customer and chef flows unless they help someone resolve a problem.
8. Confirmations within the future product should protect meaningful actions such as cancellation or reassignment; ordinary low-impact actions should remain efficient.

## 7. Delivery and verification rules

1. Keep changes scoped to the current task. Planning completion is not implementation completion.
2. Update requirements and acceptance scenarios when intended behavior changes.
3. Test risky business behavior: two-kitchen routing, authorization, scheduling, duplicates, payments, revisions, cancellation, and aggregate readiness.
4. Rehearse a mixed order with two separate chef users and an admin before launch.
5. Validate the real target devices and network rather than assuming a desktop demo proves kitchen usability.
6. Run meaningful checks appropriate to each change; avoid tests that merely restate low-impact implementation details.
7. Report what changed, what was verified, and any remaining limits. Never label a task tested, approved, or deployed without evidence.
8. Do not contact customers, send messages, purchase services, or publish the website without authorization covering that action.

## 8. Decision log

### Conditional operational modules

- Daily reconciliation and detailed bulk/custom-order handling are planned modules; their release timing needs a recorded business decision. Their acceptance scenarios apply whenever those modules ship.
- Reconcile payment transactions by collection time, method, and defined register/shift scope. Deposits are counted once; cash differences require review. Closing or reopening a report cannot silently rewrite payments or prior reports.
- Version custom specifications and quotes together. Only accepted specifications may feed a confirmed order's production, subject to agreed deposit conditions. Changes after acceptance need a newly accepted revision and kitchen acknowledgement where work was released.

### Recorded decisions

| Date | Decision | Status / basis |
|---|---|---|
| 2026-09-27 | Produce planning documents only | Explicit user request |
| 2026-09-27 | Public site, admin area, chef login, two kitchens, calendar, and two order lists | Explicit user requirements; “chief” interpreted as chef |
| 2026-09-27 | One shared order record with item-level kitchen routing | Proposed model supporting the user's requirements |
| 2026-09-27 | Website ordering and call orders included in first release | Confirmed by user follow-up |
| 2026-09-27 | Kitchen 1 / Kitchen 2 placeholder names | User replied “yes” to using placeholders; actual names and mappings not yet supplied |
| 2026-09-27 | Pickup, manual payment recording, admin acceptance | Proposed first-release defaults, pending confirmation |
| 2026-09-27 | Final brand remains open | Workspace and existing prototype use different names |
| 2026-09-27 | Add seven operational workflows to the planning documents | User requested “do it” after the proposed additions |
| 2026-09-27 | Production summaries, packing/handover, substitutions, remakes/wastage, and uncollected orders in first-release baseline | Accepted expansion; detailed business policies remain open |
| 2026-09-27 | Document daily reconciliation and detailed bulk/custom specifications with launch timing to confirm | Follows the proposed dependency on current bakery operations |
| 2026-09-27 | Split delivery: Release 1 core loop with basic packing and admin overrides; Release 1.1 production summary, full packing checklist, substitutions, remakes/wastage, uncollected orders | User approved v0.3 review ("yes"); supersedes the earlier first-release placement of these workflows |
| 2026-09-27 | Add notifications, spam protection, GST bills, counter quick sale, veg/eggless labelling, discounts, daily sales report, caps/cut-offs, kitchen PIN sign-in to Release 1 | User approved v0.3 review; detailed policies remain open (PRD section 14, items 18–25) |
| 2026-09-27 | Recommend Next.js + Supabase + Vercel | Proposed; pending budget and team-skill confirmation |
| 2026-09-27 | Stack confirmed and coding started (Phase 3 → 4B built); public website deferred | User: "proceed start coding", "leave the public page for now" |
| 2026-09-27 | Supabase project `auri-bakery` in ap-south-1 | User chose a new Mumbai project |
| 2026-09-27 | Prices GST-inclusive; intra-state CGST/SGST; bill prefix `AB`; gap-free bill numbers per financial year | Implementation defaults; confirm with the accountant |
| 2026-09-27 | Placeholder opening hours 9 AM–9 PM daily; counter discount limit 10% | Implementation defaults; editable in Settings |
| 2026-09-27 | Orders, payments, bills written only through role-checked database functions with idempotency keys and version checks | Implements rules 2.11, 5.1, 5.4, 5.7 |
| 2026-09-27 | Tests must not create bills on the live project; staging needed | Bills are permanent and consume the legal sequence |
| 2026-09-27 | Project handed over to another developer | User request; see HANDOVER.md |
| 2026-09-27 | Capacity: daily caps per category plus an order limit per pickup window; windows defined per weekday; festival date overrides | Owner answers in Phase 4C design |
| 2026-09-27 | Category caps count orders, not units; cut-offs dropped (lead times cover them) | Owner answers in Phase 4C design |
| 2026-09-27 | Only admins override full windows/caps, with a reason of at least 5 characters | Owner answer; matches existing scheduling overrides |
