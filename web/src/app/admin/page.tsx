import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { formatPaise } from "@/lib/money";
import { OPEN_STATUSES, fulfilmentRowClass } from "@/lib/orders";
import { addDays, formatDateTime, zonedDayKey, zonedDayRange } from "@/lib/time";
import { Alert, Badge, Card, PageHeader, cx } from "@/components/ui";
import { ContactBadge, FulfilmentBadge, StatusBadge } from "@/components/order-badges";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Home" };

function Stat({ label, value, href, tone, teal }: { label: string; value: number | string; href: string; tone?: "warn" | "danger"; teal?: boolean }) {
  return (
    <Link
      href={href}
      className={cx(
        "rounded-2xl border border-line border-t-4 bg-surface p-4 shadow-[0_10px_30px_-18px_rgba(184,67,95,0.35)] transition hover:-translate-y-0.5",
        teal ? "border-t-accent hover:border-accent/50" : "border-t-rose hover:border-brand/40",
      )}
    >
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-3xl font-semibold ${tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : ""}`}>{value}</p>
    </Link>
  );
}

export default async function AdminHome() {
  const staff = await requireRole(["admin", "counter"]);
  const isAdmin = staff.role === "admin";
  const tz = await getBusinessTimezone();
  const today = zonedDayKey(new Date(), tz);
  const { start, end } = zonedDayRange(today, tz);
  const weekEnd = zonedDayRange(addDays(today, 1), tz, 7).end;
  const nowIso = new Date().toISOString();
  const supabase = await createClient();

  const [dueToday, pending, cakes, upcoming, products, readyOrders, paymentsToday, duePayments] = await Promise.all([
    supabase.from("order_summaries").select("id, source, status, balance_paise").in("status", OPEN_STATUSES)
      .gte("due_at", start.toISOString()).lt("due_at", end.toISOString()),
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending_confirmation"),
    // Customised orders are the ones with a custom cake (as on the Orders page).
    supabase.from("custom_cakes").select("order_id"),
    supabase.from("order_summaries").select("id, reference, source, status, customer_name, customer_phone, due_at, fulfilment").in("status", OPEN_STATUSES)
      .gte("due_at", end.toISOString()).lt("due_at", weekEnd.toISOString()).order("due_at").limit(10),
    supabase.from("products").select("id", { count: "exact", head: true }).is("archived_at", null),
    supabase.from("order_summaries").select("id, reference, source, customer_name, customer_phone, due_at, balance_paise, fulfilment")
      .eq("status", "ready").order("due_at").limit(20),
    supabase.from("payments").select("kind, amount_paise")
      .gte("paid_at", start.toISOString()).lt("paid_at", end.toISOString()),
    supabase.from("order_summaries").select("id, reference, customer_name, due_at, balance_paise")
      .in("status", OPEN_STATUSES).gt("balance_paise", 0).gte("due_at", start.toISOString()).order("due_at").limit(20),
  ]);

  const todays = dueToday.data ?? [];
  const collectedToday = (paymentsToday.data ?? []).reduce(
    (sum, p) => sum + (p.kind === "payment" ? p.amount_paise : -p.amount_paise),
    0,
  );
  const paymentsDue = duePayments.data ?? [];
  const cakeIds = new Set((cakes.data ?? []).map((c) => c.order_id));
  const customisedToday = todays.filter((o) => o.id && cakeIds.has(o.id)).length;
  const balanceDue = todays.reduce((s, o) => s + Math.max(0, o.balance_paise ?? 0), 0);
  // Packed and waiting for the customer; past the pickup time they are late collections (PRD 5D).
  const ready = readyOrders.data ?? [];
  const isLate = (due: string | null) => Boolean(due && Date.parse(due) < Date.parse(nowIso));
  const late = ready.filter((o) => isLate(o.due_at)).length;

  const setup = [
    { done: (products.count ?? 0) > 0, label: "Add categories and products", href: "/admin/products" },
  ];
  const setupOpen = isAdmin && setup.some((s) => !s.done);

  return (
    <>
      <LiveRefresh />
      <PageHeader
        title={`Hello, ${staff.fullName.split(" ")[0]}`}
        description={`Today is ${formatDateTime(new Date(), tz).split(",")[0]}.`}
      />

      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="Due today (Online orders)" value={todays.length - customisedToday} href="/admin/orders?when=today" />
          <Stat label="Awaiting confirmation" value={pending.count ?? 0} href="/admin/orders?list=online_call&when=all&status=pending_confirmation" tone={(pending.count ?? 0) > 0 ? "warn" : undefined} teal />
          <Stat label="Due today (Customised order)" value={customisedToday} href="/admin/orders?list=custom&when=today" />
          <Stat label="Balance due today" value={formatPaise(balanceDue)} href="/admin/orders?when=today" teal />
          <Stat
            label="Collected today"
            value={paymentsToday.error ? "Unavailable" : formatPaise(collectedToday)}
            href="/admin/orders?when=today"
            teal
          />
        </div>

        {paymentsToday.error && <Alert tone="danger" title="Could not load today's collections">{paymentsToday.error.message}</Alert>}

        <Card>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Payments due today &amp; coming up</h2>
            <Link href="/admin/orders?when=all" className="text-sm text-brand-strong hover:underline">All orders</Link>
          </div>
          {duePayments.error ? (
            <p className="text-sm text-danger">Could not load outstanding payments: {duePayments.error.message}</p>
          ) : paymentsDue.length === 0 ? (
            <p className="text-sm text-muted">No outstanding payments due today or later.</p>
          ) : (
            <ul className="divide-y divide-line">
              {paymentsDue.map((o) => (
                <li key={o.id} className="relative flex flex-wrap items-center gap-3 px-2 py-2.5 hover:text-brand-strong">
                  <span className="w-40 text-sm">
                    {o.due_at && (zonedDayKey(o.due_at, tz) === today ? "Today · " : "")}
                    {o.due_at && formatDateTime(o.due_at, tz)}
                  </span>
                  <Link href={`/admin/orders/${o.id}#payments`} className="font-mono text-sm after:absolute after:inset-0">
                    {o.reference}
                  </Link>
                  <span className="flex-1 text-sm">{o.customer_name ?? "Walk-in"}</span>
                  <Badge tone="warn">Balance {formatPaise(o.balance_paise ?? 0)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {ready.length > 0 && (
          <Card>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">
                Ready for pickup <span className="text-muted">({ready.length})</span>
              </h2>
              {late > 0 && <Badge tone="danger">{late} late</Badge>}
            </div>
            <ul className="divide-y divide-line">
              {ready.map((o) => {
                const overdue = isLate(o.due_at);
                return (
                  <li key={o.id} className={cx("relative flex flex-wrap items-center gap-3 px-2 py-2.5 hover:text-brand-strong", fulfilmentRowClass(o.fulfilment))}>
                      <span className={`w-40 text-sm ${overdue ? "font-semibold text-danger" : ""}`}>{o.due_at && formatDateTime(o.due_at, tz)}</span>
                      <Link href={`/admin/orders/${o.id}`} className="font-mono text-sm after:absolute after:inset-0">{o.reference}</Link>
                      <span className="flex-1 text-sm">{o.customer_name ?? "Walk-in"}</span>
                      {o.fulfilment && <FulfilmentBadge fulfilment={o.fulfilment} />}
                      {o.source && <ContactBadge source={o.source} phone={o.customer_phone} />}
                      {(o.balance_paise ?? 0) > 0 && <Badge tone="warn">Due {formatPaise(o.balance_paise ?? 0)}</Badge>}
                      {overdue && <Badge tone="danger">Late</Badge>}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <Card>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Next 7 days</h2>
            <Link href="/admin/calendar" className="text-sm text-brand-strong hover:underline">Open calendar</Link>
          </div>
          {(upcoming.data ?? []).length === 0 ? (
            <p className="text-sm text-muted">No upcoming pickups.</p>
          ) : (
            <ul className="divide-y divide-line">
              {(upcoming.data ?? []).map((o) => (
                <li key={o.id} className={cx("relative flex flex-wrap items-center gap-3 px-2 py-2.5 hover:text-brand-strong", fulfilmentRowClass(o.fulfilment))}>
                    <span className="w-40 text-sm">{o.due_at && formatDateTime(o.due_at, tz)}</span>
                    <Link href={`/admin/orders/${o.id}`} className="font-mono text-sm after:absolute after:inset-0">{o.reference}</Link>
                    <span className="flex-1 text-sm">{o.customer_name ?? "Walk-in"}</span>
                    {o.fulfilment && <FulfilmentBadge fulfilment={o.fulfilment} />}
                    {o.source && <ContactBadge source={o.source} phone={o.customer_phone} />}
                    {o.status && <StatusBadge status={o.status} />}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {setupOpen && (
          <Card>
            <h2 className="text-lg font-semibold">Setup checklist</h2>
            <ul className="mt-4 flex flex-col gap-3">
              {setup.map((item) => (
                <li key={item.label} className="flex items-center justify-between gap-3">
                  <Link href={item.href} className="text-sm hover:text-brand-strong hover:underline">{item.label}</Link>
                  {item.done ? <Badge tone="ok">Done</Badge> : <Badge tone="warn">To do</Badge>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
