import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { formatPaise } from "@/lib/money";
import { ORDER_LISTS, listKeyForSource, paymentMethodLabel, sourceLabel } from "@/lib/orders";
import { dateToZonedLocal, formatDateOnly, formatDateTime, zonedDayKey } from "@/lib/time";
import { Alert, Badge, Card, PageHeader, cx } from "@/components/ui";
import { SourceBadge, StatusBadge } from "@/components/order-badges";
import { NoShowPanel, OrderActions, PaymentForm } from "./order-actions";
import { FulfilmentPanel } from "./fulfilment-panel";
import { FulfilmentBanner } from "./fulfilment-banner";
import { CakeCard } from "./cake-card";
import { ProductThumb } from "@/components/product-thumb";
import { BillPanel, DiscountForm } from "./billing-panel";
import { EditItems } from "./edit-items";
import { loadCatalogue } from "@/lib/catalogue";
import { MESSAGE_LABEL, whatsappNumber, type MessageKind } from "@/lib/whatsapp";
import { OrderTerms } from "@/components/order-terms";
import { TermsPanel } from "@/components/terms-panel";
import { CustomerWhatsAppSend } from "@/components/customer-whatsapp-send";
import { isCakeOrder } from "@/lib/cake-order";
import { whatsappCloudConfig } from "@/lib/whatsapp-cloud";
import { StickyNote } from "./sticky-note";

export const metadata: Metadata = { title: "Order" };

const eventLabel: Record<string, string> = {
  created: "Order created",
  confirmed: "Confirmed",
  rejected: "Rejected",
  cancelled: "Cancelled",
  rescheduled: "Pickup time changed",
  override: "Admin override",
  payment_recorded: "Payment recorded",
  refund_recorded: "Refund recorded",
  discount_applied: "Discount applied",
  discount_removed: "Discount removed",
  items_changed: "Items changed",
  bill_issued: "Bill issued",
  credit_note_issued: "Credit note issued",
  completed: "Completed",
  ticket_acknowledged: "Kitchen acknowledged",
  ticket_started: "Kitchen started",
  ticket_ready: "Kitchen ticket ready",
  ready_count_corrected: "Ready count corrected",
  kitchen_issue_reported: "Kitchen issue reported",
  kitchen_issue_resolved: "Kitchen issue resolved",
  stop_work_acknowledged: "Stop-work acknowledged",
  tickets_revised: "Kitchen tickets revised",
  ticket_changes_acknowledged: "Kitchen acknowledged changes",
  no_show_recorded: "No-show recorded",
  no_show_undone: "No-show undone",
  packed: "Packed",
  packing_reopened: "Packing reopened",
  handed_over: "Handed over",
  kitchen_tickets_retired: "Kitchen tickets retired",
  fulfilment_changed: "Pickup/Cab / set-up changed",
  item_kitchen_changed: "Kitchen changed",
  custom_cake_created: "Custom cake ordered",
  custom_cake_changed: "Custom cake changed",
  custom_cake_photo: "Cake photos changed",
  customer_message: "WhatsApp message opened",
  sticky_note_changed: "Sticky note changed",
  quotation_sent: "Order in msg sent",
  terms_sent: "Terms and Conditions sent on WhatsApp",
};

const QUOTATION_CHANNEL: Record<string, string> = {
  share_sheet: "shared from a phone",
  download_and_chat: "downloaded and WhatsApp opened",
  cloud_api: "sent by WhatsApp",
};

// WhatsApp's own ticks, from Meta's delivery webhook.
function DeliveryTicks({ status }: { status: string | null }) {
  if (status === "read") return <span className="font-semibold text-[#34b7f1]">✓✓ Read</span>;
  if (status === "delivered") return <span className="font-semibold">✓✓ Delivered</span>;
  if (status === "failed") return <span className="font-semibold">Not delivered</span>;
  return <span>✓ Sent</span>;
}

// PRD 5F: only orders the customer should have collected can count as a no-show.
const NO_SHOW_STATUSES = ["confirmed", "preparing", "ready", "cancelled"];

export default async function OrderPage({ params, searchParams }: PageProps<"/admin/orders/[id]">) {
  const staff = await requireRole(["admin", "counter"]);
  const isAdmin = staff.role === "admin";
  const { id } = await params;
  const { created, photo } = await searchParams;
  if (!z.uuid().safeParse(id).success) notFound();
  const tz = await getBusinessTimezone();
  const today = zonedDayKey(new Date(), tz);

  const supabase = await createClient();
  const [{ data: order }, { data: items }, { data: payments }, { data: events }, { data: staffRows }, { data: bill }, { data: settings }, { data: noShow }] =
    await Promise.all([
      supabase.from("order_summaries").select("*").eq("id", id).maybeSingle(),
      supabase.from("order_items").select("*").eq("order_id", id).order("line_no"),
      supabase.from("payments").select("*").eq("order_id", id).order("paid_at").order("recorded_at"),
      supabase.from("order_events").select("*").eq("order_id", id).order("occurred_at"),
      supabase.from("staff_profiles").select("user_id, full_name"),
      supabase.from("bills").select("id, bill_number, total_paise, issued_at, credit_notes(id, credit_note_number, total_paise, reason, issued_at)").eq("order_id", id).maybeSingle(),
      supabase.from("business_settings").select("counter_discount_limit_bps, business_name").single(),
      // order_summaries predates the no-show and packing columns, so read them (and the customer's flags) from orders.
      supabase
        .from("orders")
        .select("no_show_at, no_show_by, packed_at, packed_by, packing_note, handed_over_by, collected_by, credit_reason, customers(id, is_blocked, no_show_count)")
        .eq("id", id)
        .maybeSingle(),
    ]);
  if (!order || !order.id || !order.status || !order.source) notFound();

  const staffName = new Map((staffRows ?? []).map((s) => [s.user_id, s.full_name]));
  const who = (userId: string | null) => (userId ? staffName.get(userId) ?? "Staff" : "System");
  const balance = order.balance_paise ?? 0;
  const termsTo = whatsappNumber(order.customer_phone);
  const refundable = (order.paid_paise ?? 0) - (order.refunded_paise ?? 0);
  const closed = ["completed", "rejected", "cancelled"].includes(order.status);
  const customer = noShow?.customers ?? null;
  const canRecordNoShow =
    Boolean(customer) && !noShow?.no_show_at && NO_SHOW_STATUSES.includes(order.status) &&
    order.due_at !== null && new Date(order.due_at) <= new Date();
  // Items can change on draft and pending orders, and (admin, with a reason) on confirmed and
  // preparing ones. Packed orders are reopened first.
  const canEditItems =
    !bill && (["draft", "pending_confirmation"].includes(order.status) || (["confirmed", "preparing"].includes(order.status) && isAdmin));
  const catalogue = canEditItems ? await loadCatalogue(supabase) : [];

  // Product photos for the item list.
  const productIds = [...new Set((items ?? []).map((i) => i.product_id).filter((v): v is string => Boolean(v)))];
  const { data: productPhotos } = productIds.length
    ? await supabase.from("products").select("id, image_url").in("id", productIds)
    : { data: [] };
  const photoByProduct = new Map((productPhotos ?? []).map((p) => [p.id, p.image_url]));

  // The order's kitchen (2026-10-24): custom orders Kitchen 1, web orders Kitchen 2, set by the database.
  const { data: kitchen } = order.kitchen_id
    ? await supabase.from("kitchens").select("name").eq("id", order.kitchen_id).maybeSingle()
    : { data: null };

  // Custom cake (2026-10-09): its details, and short-lived links to the private reference photos (up to 5).
  const { data: cake } = await supabase.from("custom_cakes").select("*").eq("order_id", id).maybeSingle();
  const cakeLine = cake ? (items ?? []).find((i) => i.id === cake.order_item_id) : undefined;
  const cakePaths = cake?.photo_paths ?? [];
  const signedCake = cakePaths.length
    ? new Map(((await supabase.storage.from("custom-cake-photos").createSignedUrls(cakePaths, 3600)).data ?? []).map((s) => [s.path, s.signedUrl]))
    : new Map<string | null, string>();
  const cakePhotos = cakePaths.map((path) => ({ path, url: signedCake.get(path) ?? null }));

  // Terms and Conditions go to cake orders' customers automatically on confirming (owner, 2026-11-07).
  const itemCategoryIds = [...new Set((items ?? []).filter((i) => i.quantity > i.cancelled_quantity).map((i) => i.category_id).filter((v): v is string => Boolean(v)))];
  const [{ data: itemCategories }, { data: termsSends }] = await Promise.all([
    itemCategoryIds.length ? supabase.from("categories").select("name").in("id", itemCategoryIds) : Promise.resolve({ data: [] as { name: string }[] }),
    supabase.from("terms_sends").select("id, format, status, problem, sent_at, delivery_status, delivery_problem, test_mode").eq("order_id", id).order("sent_at", { ascending: false }).limit(6),
  ]);
  const cakeOrder = isCakeOrder({ hasCustomCake: Boolean(cake), itemCategories: (itemCategories ?? []).map((c) => c.name) });
  const autoSending = Boolean(whatsappCloudConfig());

  const itemList = (
    <ul className="divide-y divide-line">
      {(items ?? []).map((i) => {
        // An item removed after the kitchen acknowledged it (before 2026-10-09) stays, fully cancelled.
        const removed = i.quantity === i.cancelled_quantity;
        return (
          <li key={i.id} className={cx("flex flex-wrap items-start justify-between gap-3 py-3", removed && "opacity-60")}>
            <div className="flex min-w-0 gap-3">
            <ProductThumb url={i.product_id ? photoByProduct.get(i.product_id) : null} name={i.product_name} size="sm" />
            <div className="min-w-0">
              <p className={cx("font-medium", removed && "line-through")}>
                {removed ? i.quantity : i.quantity - i.cancelled_quantity} × {i.product_name} — {i.variant_name}
              </p>
              {removed && <Badge tone="danger" className="mt-1">Removed</Badge>}
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                {i.is_eggless ? <Badge tone="ok">Eggless</Badge> : i.contains_egg && <Badge>Contains egg</Badge>}
                {i.prep_type === "ready_stock" ? <Badge>Ready stock</Badge> : <Badge tone="brand">Made to order</Badge>}
              </div>
              {i.notes && <p className="mt-1 text-sm">“{i.notes}”</p>}
            </div>
            </div>
            <div className="text-right">
              <p className="font-medium">{formatPaise(i.line_total_paise)}</p>
              <p className="text-xs text-muted">{formatPaise(i.unit_price_paise)} each</p>
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <PageHeader
        title={`Order ${order.reference}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/admin/orders?list=${listKeyForSource(order.source)}`} className="text-brand-strong hover:underline">
              {ORDER_LISTS[listKeyForSource(order.source)].label}
            </Link>
            <span>/</span>
            <SourceBadge source={order.source} />
            <StatusBadge status={order.status} />
            {kitchen && <Badge tone="info">{kitchen.name} · {cake ? "Customised orders" : "Online orders"}</Badge>}
          </span>
        }
      />

      <div className="flex flex-col gap-6">
        <StickyNote key={`sn-${order.version}-${order.sticky_note ?? ""}`} orderId={order.id} note={order.sticky_note} inWhatsApp={Boolean(order.sticky_note_in_whatsapp)} />
        <FulfilmentBanner
          key={`fb-${order.version}`}
          orderId={order.id}
          version={order.version ?? 0}
          fulfilment={order.fulfilment ?? "collect"}
          address={order.setup_address}
          note={order.setup_note}
          canChange={!closed}
        />
        {created === "1" && (
          <Alert tone="ok" title={order.status === "confirmed" ? "Order created and confirmed" : "Order created"}>
            {order.status === "pending_confirmation"
              ? "It is waiting for confirmation."
              : "Pack the items when they are ready."}
          </Alert>
        )}
        {photo === "failed" && (
          <Alert tone="warn" title="A reference photo was not saved">
            The order was created. Add the missing photos again on the custom cake card below.
          </Alert>
        )}
        {cake && (
          <CakeCard
            key={`cake-${order.version}`}
            orderId={order.id}
            version={order.version ?? 0}
            cake={cake}
            pricePaise={cakeLine?.unit_price_paise ?? 0}
            photos={cakePhotos}
            canEdit={["draft", "pending_confirmation", "confirmed", "preparing"].includes(order.status)}
            canChangePhoto={!closed}
          />
        )}
        {order.closed_reason && (
          <Alert tone="danger" title={order.status === "rejected" ? "Rejected" : "Cancelled"}>
            {order.closed_reason} — {who(order.closed_by)}, {order.closed_at && formatDateTime(order.closed_at, tz)}
          </Alert>
        )}
        {balance < 0 && (
          <Alert tone="warn" title={`Refund due: ${formatPaise(-balance)}`}>
            The customer has paid more than this order now costs. Record the refund once it has actually been paid out.
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <h2 className="mb-3 text-lg font-semibold">Items</h2>
            {canEditItems ? (
              <EditItems
                key={`e-${order.version}`}
                orderId={order.id}
                version={order.version ?? 0}
                isAdmin={isAdmin}
                needsReason={["confirmed", "preparing"].includes(order.status)}
                discountPaise={order.discount_paise ?? 0}
                catalogue={catalogue}
                existing={(items ?? []).filter((i) => i.quantity > i.cancelled_quantity).map((i) => ({
                  id: i.id,
                  productName: i.product_name,
                  variantName: i.variant_name,
                  unitPricePaise: i.unit_price_paise,
                  quantity: i.quantity,
                  notes: i.notes ?? "",
                  isEggless: i.is_eggless,
                }))}
              >
                {itemList}
              </EditItems>
            ) : (
              itemList
            )}
            {order.status === "ready" && isAdmin && !bill && (
              <p className="mt-2 text-sm text-muted">To change items or the pickup time, reopen packing first.</p>
            )}
            <dl className="mt-3 flex flex-col gap-1 border-t border-line pt-3 text-sm">
              {(order.discount_paise ?? 0) > 0 && (
                <>
                  <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{formatPaise(order.subtotal_paise ?? 0)}</dd></div>
                  <div className="flex justify-between text-ok">
                    <dt>Discount{order.discount_reason && ` · ${order.discount_reason}`}{order.discount_by && ` (${who(order.discount_by)})`}</dt>
                    <dd>−{formatPaise(order.discount_paise ?? 0)}</dd>
                  </div>
                </>
              )}
              <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd>{formatPaise(order.total_paise ?? 0)}</dd></div>
              {(order.credited_paise ?? 0) > 0 && (
                <div className="flex justify-between text-danger"><dt>Credited</dt><dd>−{formatPaise(order.credited_paise ?? 0)}</dd></div>
              )}
            </dl>
            {!closed && !bill && (
              <div className="mt-3">
                <DiscountForm
                  key={`d-${order.version}`}
                  orderId={order.id}
                  version={order.version ?? 0}
                  currentDiscountPaise={order.discount_paise ?? 0}
                  isAdmin={isAdmin}
                  limitBps={settings?.counter_discount_limit_bps ?? 1000}
                />
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">{order.fulfilment === "setup" ? "Set-up" : "Pickup"}</h2>
            <dl className="flex flex-col gap-3 text-sm">
              <div>
                <dt className="text-muted">Due</dt>
                <dd className="font-medium">
                  {order.due_at ? formatDateTime(order.due_at, tz) : "—"}
                  {order.is_immediate && " (walk-in)"}
                </dd>
                {!order.confirmed_due_at && !closed && <dd className="text-xs text-warn">Requested, not yet confirmed</dd>}
              </div>
              <div>
                <dt className="text-muted">Customer</dt>
                <dd className="flex flex-wrap items-center gap-2 font-medium">
                  {customer ? (
                    <Link href={`/admin/customers/${customer.id}`} className="hover:text-brand-strong hover:underline">{order.customer_name ?? "Customer"}</Link>
                  ) : (
                    order.customer_name ?? "Walk-in"
                  )}
                  {customer?.is_blocked && <Badge tone="danger">Blocked</Badge>}
                  {customer && customer.no_show_count > 0 && (
                    <Badge tone="warn">{customer.no_show_count} no-show{customer.no_show_count === 1 ? "" : "s"}</Badge>
                  )}
                </dd>
                {order.customer_phone && (
                  <dd><a href={`tel:${order.customer_phone}`} className="text-brand-strong hover:underline">{order.customer_phone}</a></dd>
                )}
              </div>
              <div>
                <dt className="text-muted">Source</dt>
                <dd>{sourceLabel[order.source]} · taken by {who(order.created_by)}</dd>
              </div>
              {order.customer_notes && (
                <div><dt className="text-muted">Customer notes</dt><dd>{order.customer_notes}</dd></div>
              )}
              {order.internal_notes && (
                <div><dt className="text-muted">Internal notes</dt><dd>{order.internal_notes}</dd></div>
              )}
            </dl>
            <div className="mt-4">
              <NoShowPanel
                key={`n-${order.version}`}
                orderId={order.id}
                version={order.version ?? 0}
                isAdmin={isAdmin}
                canRecord={canRecordNoShow}
                recorded={noShow?.no_show_at ? { label: `${formatDateTime(noShow.no_show_at, tz)} · ${who(noShow.no_show_by)}` } : null}
              />
            </div>
            <div className="mt-5 border-t border-line pt-4">
              <OrderActions
                key={order.version}
                orderId={order.id}
                version={order.version ?? 0}
                status={order.status}
                isAdmin={isAdmin}
                canConfirm={isAdmin || order.source === "IN_STORE"}
                dueLocal={order.due_at ? dateToZonedLocal(new Date(order.due_at), tz) : ""}
                categoryIds={[...new Set((items ?? []).filter((i) => i.quantity > i.cancelled_quantity).map((i) => i.category_id).filter((id): id is string => Boolean(id)))]}
              />
            </div>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {["confirmed", "preparing", "ready", "completed"].includes(order.status) && (
            <Card className="lg:col-span-2">
              <h2 className="mb-3 text-lg font-semibold">Packing &amp; handover</h2>
              <FulfilmentPanel
                key={`f-${order.version}`}
                orderId={order.id}
                version={order.version ?? 0}
                status={order.status}
                isAdmin={isAdmin}
                balancePaise={balance}
                isSetup={order.fulfilment === "setup"}
                packed={noShow?.packed_at ? { label: `${formatDateTime(noShow.packed_at, tz)} · ${who(noShow.packed_by)}`, note: noShow.packing_note } : null}
                handedOver={
                  noShow?.handed_over_by && order.completed_at
                    ? { label: `${formatDateTime(order.completed_at, tz)} · ${who(noShow.handed_over_by)}`, collectedBy: noShow.collected_by, creditReason: noShow.credit_reason }
                    : null
                }
              />
            </Card>
          )}
          <Card id="payments">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold">Payments</h2>
              <p className="text-sm">
                Paid {formatPaise((order.paid_paise ?? 0) - (order.refunded_paise ?? 0))} ·{" "}
                <span className={balance > 0 ? "font-semibold text-warn" : balance < 0 ? "font-semibold text-danger" : "font-semibold text-ok"}>
                  {balance > 0 ? `Balance ${formatPaise(balance)}` : balance < 0 ? `Refund due ${formatPaise(-balance)}` : "Fully paid"}
                </span>
              </p>
            </div>
            {payments && payments.length > 0 ? (
              <ul className="mb-4 divide-y divide-line text-sm">
                {payments.map((p) => (
                  <li key={p.id} className="flex justify-between gap-3 py-2">
                    <div>
                      <span className={p.kind === "refund" ? "font-medium text-danger" : "font-medium"}>
                        {p.kind === "refund" ? "Refund" : "Payment"} · {paymentMethodLabel[p.method]}
                      </span>
                      {p.reference && <span className="text-muted"> · {p.reference}</span>}
                      <div className="text-xs text-muted">
                        Paid {formatDateOnly(p.paid_at, tz)} · entered {formatDateTime(p.recorded_at, tz)} by {who(p.recorded_by)}{p.note && ` · ${p.note}`}
                      </div>
                    </div>
                    <span className={p.kind === "refund" ? "text-danger" : ""}>
                      {p.kind === "refund" ? "−" : ""}{formatPaise(p.amount_paise)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-sm text-muted">No payments recorded.</p>
            )}
            <PaymentForm
              key={`${order.version}`}
              orderId={order.id}
              balancePaise={balance}
              refundablePaise={refundable}
              isAdmin={isAdmin}
              acceptsPayments={!["rejected", "cancelled"].includes(order.status)}
              today={today}
            />
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">Bill</h2>
            <BillPanel
              key={`b-${order.version}`}
              orderId={order.id}
              canBill={["confirmed", "preparing", "ready", "completed"].includes(order.status)}
              isAdmin={isAdmin}
              bill={bill ? { id: bill.id, number: bill.bill_number, totalPaise: bill.total_paise, issuedAt: formatDateTime(bill.issued_at, tz) } : null}
              credits={(bill?.credit_notes ?? []).map((c) => ({ id: c.id, number: c.credit_note_number, totalPaise: c.total_paise, reason: c.reason, issuedLabel: formatDateTime(c.issued_at, tz) }))}
            />
          </Card>

          <Card className="border-2 border-[#1f9d55]/40 lg:col-span-2">
            <h2 className="mb-1 text-lg font-semibold">Send the bill and Terms to the customer&rsquo;s WhatsApp</h2>
            <p className="mb-3 text-sm text-muted">Pick image or PDF, then one tap. Both go together as files.</p>
            <CustomerWhatsAppSend
              orderId={order.id}
              reference={order.reference ?? ""}
              phone={termsTo}
              cloud={autoSending}
              testMode={whatsappCloudConfig()?.testMode ?? false}
            />
          </Card>

          <Card className="lg:col-span-2">
            <h2 className="mb-1 text-lg font-semibold">Terms and Conditions</h2>
            <p className="mb-3 text-sm text-muted">
              {!autoSending
                ? "Send the Terms to the customer's WhatsApp as a file (PDF or image), or download them."
                : cakeOrder
                  ? "Sent automatically to the customer's WhatsApp, as a PDF and an image, when this cake order is confirmed."
                  : "Sent automatically only for cake orders."}
            </p>
            <div className="mb-3 flex flex-col gap-3">
              {(termsSends ?? []).length > 0 ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {(termsSends ?? []).map((t) => (
                    <li key={t.id} className={t.status === "sent" && t.delivery_status !== "failed" ? "text-ok" : "text-danger"}>
                      {t.format === "pdf" ? "PDF" : "Image"} {t.status === "sent" ? "sent on WhatsApp" : "not sent"} · {formatDateTime(t.sent_at, tz)}
                      {t.status === "sent" && <> · <DeliveryTicks status={t.delivery_status} /></>}
                      {t.test_mode && <span className="ml-2 rounded bg-warn-soft px-1.5 text-xs font-semibold text-warn">Test</span>}
                      {(t.delivery_problem ?? t.problem) && <span className="block text-xs text-muted">{t.delivery_problem ?? t.problem}</span>}
                    </li>
                  ))}
                </ul>
              ) : autoSending && cakeOrder && ["draft", "pending_confirmation"].includes(order.status) ? (
                <p className="text-sm text-muted">Will be sent automatically when the order is confirmed.</p>
              ) : null}
              <TermsPanel orderId={order.id} reference={order.reference ?? ""} phone={termsTo} cloud={autoSending} testMode={whatsappCloudConfig()?.testMode ?? false} />
            </div>
            <details className="group rounded-xl border border-line bg-canvas/50 px-4 py-3 text-sm">
              <summary className="cursor-pointer font-medium text-brand-strong">
                <span className="group-open:hidden">Show the terms</span>
                <span className="hidden group-open:inline">Hide the terms</span>
              </summary>
              <OrderTerms className="mt-3" />
            </details>
            <p className="mt-2 text-xs text-muted">Generated for order {order.reference}, and printed on the bill.</p>
          </Card>

          <Card className="lg:col-span-2">
            <h2 className="mb-3 text-lg font-semibold">Timeline</h2>
            <ol className="flex flex-col gap-3 border-l-2 border-line pl-4 text-sm">
              {(events ?? []).map((e) => {
                const data = (e.data ?? {}) as Record<string, unknown>;
                return (
                  <li key={e.id}>
                    <p className="font-medium">{eventLabel[e.event_type] ?? e.event_type}</p>
                    <p className="text-xs text-muted">{formatDateTime(e.occurred_at, tz)} · {who(e.actor_id)}</p>
                    {e.event_type === "rescheduled" && typeof data.from === "string" && typeof data.to === "string" && (
                      <p className="text-xs">{formatDateTime(data.from, tz)} → {formatDateTime(data.to, tz)}</p>
                    )}
                    {e.event_type === "items_changed" && Array.isArray(data.changes) && (
                      <ul className="text-xs">
                        {(data.changes as { item: string; from: number; to: number; notes?: string }[]).map((c, n) => (
                          <li key={n}>
                            {c.item}: {c.from === 0 ? `added ${c.to}` : c.to === 0 ? `removed ${c.from}` : c.from === c.to ? "notes changed" : `${c.from} → ${c.to}`}
                            {c.notes !== undefined && c.from !== c.to && " (notes changed)"}
                          </li>
                        ))}
                        {typeof data.total_from === "number" && typeof data.total_to === "number" && (
                          <li>Total {formatPaise(data.total_from)} → {formatPaise(data.total_to)}</li>
                        )}
                      </ul>
                    )}
                    {typeof data.no_show_count === "number" && (
                      <p className="text-xs">Customer now has {data.no_show_count} no-show{data.no_show_count === 1 ? "" : "s"}</p>
                    )}
                    {typeof data.ticket === "string" && (
                      <p className="font-mono text-xs">
                        {data.ticket}
                        {typeof data.kitchen === "string" && ` · ${data.kitchen}`}
                      </p>
                    )}
                    {e.event_type === "packed" && typeof data.note === "string" && <p className="text-xs">Note: {data.note}</p>}
                    {e.event_type === "quotation_sent" && typeof data.format === "string" && (
                      <p className="text-xs">
                        {data.format === "pdf" ? "PDF" : "Image (PNG)"}
                        {typeof data.channel === "string" && ` · ${QUOTATION_CHANNEL[data.channel] ?? data.channel}`}
                      </p>
                    )}
                    {e.event_type === "sticky_note_changed" && (
                      <p className="text-xs">{data.cleared ? "Removed" : data.in_whatsapp ? "Added to WhatsApp messages" : "Not added to WhatsApp messages"}</p>
                    )}
                    {e.event_type === "customer_message" && typeof data.kind === "string" && data.kind in MESSAGE_LABEL && (
                      <p className="text-xs">{MESSAGE_LABEL[data.kind as MessageKind]}</p>
                    )}
                    {e.event_type === "fulfilment_changed" && typeof data.to === "string" && (
                      <p className="text-xs">
                        {data.to === "setup" ? `Set up at ${typeof data.setup_address === "string" ? data.setup_address : "the customer's place"}` : "Pickup/Cab"}
                      </p>
                    )}
                    {e.event_type === "handed_over" && typeof data.collected_by === "string" && (
                      <p className="text-xs">Collected by {data.collected_by}</p>
                    )}
                    {e.event_type === "handed_over" && typeof data.balance_paise === "number" && (
                      <p className="text-xs">On credit: {formatPaise(data.balance_paise)} due</p>
                    )}
                    {e.event_type === "ready_count_corrected" && typeof data.line === "string" && (
                      <p className="text-xs">{data.line}: {String(data.from)} → {String(data.to)} ready</p>
                    )}
                    {typeof data.kind === "string" && typeof data.note === "string" && (
                      <p className="text-xs">{data.kind}: {data.note}</p>
                    )}
                    {typeof data.amount_paise === "number" && <p className="text-xs">{formatPaise(data.amount_paise)}</p>}
                    {typeof data.bill_number === "string" && <p className="font-mono text-xs">{data.bill_number}</p>}
                    {typeof data.credit_note_number === "string" && <p className="font-mono text-xs">{data.credit_note_number}</p>}
                    {(["slot", "lead_time", "capacity"] as const).map((k) =>
                      typeof data[k] === "string" ? <p key={k} className="text-xs">Overrode: {data[k] as string}</p> : null,
                    )}
                    {e.event_type === "rescheduled" && typeof data.override === "string" && (
                      <p className="text-xs">Override reason: {data.override}</p>
                    )}
                    {e.reason && <p className="text-xs">Reason: {e.reason}</p>}
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
