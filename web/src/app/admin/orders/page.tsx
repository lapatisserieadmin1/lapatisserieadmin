import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { formatPaise } from "@/lib/money";
import { ORDER_LISTS, OPEN_STATUSES, fulfilmentRowClass, statusLabel, type ListKey, type OrderSource, type OrderStatus, searchEverywhere } from "@/lib/orders";
import { formatDateTime, zonedDayKey, zonedDayRange } from "@/lib/time";
import { Alert, ButtonLink, EmptyState, Input, PageHeader, Select, cx } from "@/components/ui";
import { ContactBadge, FulfilmentBadge, SourceBadge, StatusBadge } from "@/components/order-badges";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Orders" };

type Tab = ListKey | "custom";
type When = "today" | "upcoming" | "overdue" | "past" | "all";

const ALL_SOURCES: OrderSource[] = ["IN_STORE", "ONLINE", "CALL", "CUSTOMER"];
const NO_ID = "00000000-0000-0000-0000-000000000000";
// The two source lists plus Custom cakes: orders with a custom cake line, from any source.
const TABS: Record<Tab, { label: string; sources: OrderSource[] }> = {
  ...ORDER_LISTS,
  custom: { label: "Custom cakes", sources: ALL_SOURCES },
};

function str(v: string | string[] | undefined) {
  return typeof v === "string" ? v : "";
}

export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  await requireRole(["admin", "counter"]);
  const params = await searchParams;
  const list: Tab = str(params.list) === "online_call" || str(params.list) === "custom" ? (str(params.list) as Tab) : "in_store";
  const fulfil = str(params.fulfil) === "collect" || str(params.fulfil) === "setup" ? (str(params.fulfil) as "collect" | "setup") : "";
  const when: When = (["today", "upcoming", "overdue", "past", "all"] as const).find((w) => w === str(params.when)) ?? "today";
  const statusParam = str(params.status);
  const status: "open" | "all" | OrderStatus =
    statusParam === "all" ? "all" : (Object.keys(statusLabel) as OrderStatus[]).find((s) => s === statusParam) ?? "open";
  const q = str(params.q).trim().replace(/[^\p{L}\p{N}\s+-]/gu, "").slice(0, 60);
  const everywhere = searchEverywhere(q, str(params.scope));

  const tz = await getBusinessTimezone();
  const today = zonedDayKey(new Date(), tz);
  const { start: todayStart, end: todayEnd } = zonedDayRange(today, tz);
  const now = new Date().toISOString();

  const supabase = await createClient();
  // Custom cake orders: the Custom cakes tab and its count filter on these ids.
  const { data: cakeRows } = await supabase.from("custom_cakes").select("order_id, flavour, weight_kg");
  const cakeByOrder = new Map((cakeRows ?? []).map((c) => [c.order_id, c]));
  const cakeIds = cakeByOrder.size ? [...cakeByOrder.keys()] : [NO_ID];

  let query = supabase
    .from("order_summaries")
    .select("id, reference, source, status, customer_name, customer_phone, due_at, is_immediate, total_paise, balance_paise, item_count, fulfilment, setup_address")
    .in("source", everywhere ? ALL_SOURCES : TABS[list].sources)
    .limit(200);
  if (!everywhere && list === "custom") query = query.in("id", cakeIds);
  if (!everywhere && fulfil) query = query.eq("fulfilment", fulfil);

  if (everywhere) {
    // Top-bar search: every list and status, any date.
  } else if (status === "open") query = query.in("status", OPEN_STATUSES);
  else if (status !== "all") query = query.eq("status", status);

  if (!everywhere && when === "today") query = query.gte("due_at", todayStart.toISOString()).lt("due_at", todayEnd.toISOString());
  if (!everywhere && when === "upcoming") query = query.gte("due_at", todayEnd.toISOString());
  if (!everywhere && when === "overdue") query = query.lt("due_at", now).in("status", OPEN_STATUSES);
  if (!everywhere && when === "past") query = query.lt("due_at", todayStart.toISOString());

  if (q) {
    const compact = q.replace(/\s/g, "");
    const ref = /^b-?(\d+)$/i.exec(compact);
    const digits = /^\+?(\d{3,})$/.exec(compact)?.[1];
    if (ref) query = query.eq("order_number", Number(ref[1]));
    // Bare digits could be an order number or part of a phone number; match either.
    else if (digits) query = query.or(`order_number.eq.${Number(digits)},customer_phone.ilike.*${digits}*`);
    else query = query.ilike("customer_name", `%${q}%`);
  }

  query = when === "past" ? query.order("due_at", { ascending: false }) : query.order("due_at", { ascending: true });

  const [{ data: orders, error }, counts] = await Promise.all([
    query,
    Promise.all(
      (Object.keys(TABS) as Tab[]).map(async (key) => {
        let countQuery = supabase
          .from("orders")
          .select("id", { count: "exact", head: true })
          .in("source", TABS[key].sources)
          .in("status", OPEN_STATUSES)
          .gte("due_at", todayStart.toISOString())
          .lt("due_at", todayEnd.toISOString());
        if (key === "custom") countQuery = countQuery.in("id", cakeIds);
        const { count } = await countQuery;
        return [key, count ?? 0] as const;
      }),
    ),
  ]);
  const dueToday = Object.fromEntries(counts) as Record<Tab, number>;

  const link = (overrides: Record<string, string>) => {
    const next = new URLSearchParams({ list, when, status, ...(q ? { q } : {}), ...(fulfil ? { fulfil } : {}), ...overrides });
    return `/admin/orders?${next.toString()}`;
  };

  return (
    <>
      <LiveRefresh />
      <PageHeader
        title="Orders"
        description={`Due times shown in ${tz}. Green rows are collected from the store; red rows are set up at the customer's place.`}
        actions={
          <>
            <ButtonLink href="/admin/orders/new?source=IN_STORE">In-store order</ButtonLink>
            <ButtonLink href="/admin/orders/new-cake" variant="secondary">Customised order</ButtonLink>
          </>
        }
      />
      {everywhere && (
        <p className="mb-4 rounded-2xl border border-brand/20 bg-brand-soft px-4 py-2.5 text-sm text-brand-strong">
          Showing every order matching “{q}”, from every list, any date and status.
        </p>
      )}

      <nav aria-label="Order lists" className="mb-4 grid grid-cols-3 border-b border-line sm:flex sm:gap-1">
        {(Object.keys(TABS) as Tab[]).map((key) => (
          <Link
            key={key}
            href={link({ list: key })}
            aria-current={list === key ? "page" : undefined}
            className={cx(
              "-mb-px flex flex-col items-center justify-end gap-1 border-b-2 px-1 py-2.5 text-center text-sm font-medium sm:flex-row sm:gap-2 sm:px-4 sm:text-left",
              list === key ? "border-brand text-brand-strong" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {TABS[key].label}
            <span className="whitespace-nowrap rounded-full bg-canvas px-2 py-0.5 text-xs text-muted" title="Open orders due today">
              {dueToday[key]} today
            </span>
          </Link>
        ))}
      </nav>

      <form className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <input type="hidden" name="list" value={list} />
        <div className="min-w-56 flex-1">
          <label htmlFor="q" className="sr-only">Search orders</label>
          <Input id="q" name="q" type="search" defaultValue={q} placeholder="Reference (B-1042), name, or phone" />
        </div>
        <div>
          <label htmlFor="when" className="sr-only">Due</label>
          <Select id="when" name="when" defaultValue={when}>
            <option value="today">Due today</option>
            <option value="upcoming">Upcoming</option>
            <option value="overdue">Overdue</option>
            <option value="past">Past</option>
            <option value="all">Any date</option>
          </Select>
        </div>
        <div>
          <label htmlFor="fulfil" className="sr-only">Pickup/Cab or set up</label>
          <Select id="fulfil" name="fulfil" defaultValue={fulfil}>
            <option value="">Pickup/Cab and set up</option>
            <option value="collect">Pickup/Cab only</option>
            <option value="setup">Set up only</option>
          </Select>
        </div>
        <div>
          <label htmlFor="status" className="sr-only">Status</label>
          <Select id="status" name="status" defaultValue={status}>
            <option value="open">Open orders</option>
            <option value="all">All statuses</option>
            {(Object.keys(statusLabel) as OrderStatus[]).map((s) => (
              <option key={s} value={s}>{statusLabel[s]}</option>
            ))}
          </Select>
        </div>
        <button type="submit" className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-brand-soft">
          Filter
        </button>
      </form>

      {error ? (
        <Alert tone="danger" title="Could not load orders">{error.message}</Alert>
      ) : !orders || orders.length === 0 ? (
        <EmptyState title="No orders match">
          {when === "today" ? "Nothing due today in this list. Try Upcoming or Any date." : "Try a different filter."}
        </EmptyState>
      ) : (
        <>
        {/* Phones: one card per order. */}
        <ul className="flex flex-col gap-3 md:hidden">
          {orders.map((o) => {
            const overdue = o.due_at && o.due_at < now && o.status && OPEN_STATUSES.includes(o.status);
            const cake = o.id ? cakeByOrder.get(o.id) : undefined;
            const balance = o.balance_paise ?? 0;
            return (
              <li key={o.id} className={cx("relative rounded-xl border border-line bg-surface p-4 hover:border-brand", fulfilmentRowClass(o.fulfilment))}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {/* The reference's link covers the whole card; the phone badge sits above it. */}
                      <Link href={`/admin/orders/${o.id}`} className="font-mono font-medium after:absolute after:inset-0">{o.reference}</Link>
                      <p className="truncate">{o.customer_name ?? <span className="text-muted">Walk-in</span>}</p>
                    </div>
                    {o.status && <StatusBadge status={o.status} />}
                  </div>
                  <p className={cx("mt-2 text-sm", overdue && "font-medium text-danger")}>
                    {o.due_at ? formatDateTime(o.due_at, tz) : "—"}
                    {o.is_immediate && <span className="text-muted"> · Walk-in</span>}
                    {overdue && " · Overdue"}
                  </p>
                  {cake && <p className="mt-1 text-sm">🎂 {cake.flavour}, {Number(cake.weight_kg)} kg</p>}
                  {o.setup_address && (
                    <p className={cx("mt-1 text-xs font-medium", o.fulfilment === "setup" ? "text-danger" : "text-ok")}>{o.fulfilment === "setup" ? "Set up at" : "Cab to"}: {o.setup_address}</p>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {o.source && <ContactBadge source={o.source} phone={o.customer_phone} />}
                    {o.fulfilment && <FulfilmentBadge fulfilment={o.fulfilment} />}
                    <span className="ml-auto text-sm">
                      {o.item_count} item{o.item_count === 1 ? "" : "s"} · {formatPaise(o.total_paise ?? 0)}
                      {" · "}
                      <span className={cx("font-medium", balance > 0 && "text-warn", balance < 0 && "text-danger", balance === 0 && "text-ok")}>
                        {balance === 0 ? "Paid" : balance < 0 ? `Refund ${formatPaise(-balance)}` : `Due ${formatPaise(balance)}`}
                      </span>
                    </span>
                  </div>
              </li>
            );
          })}
          {orders.length === 200 && <li className="text-xs text-muted">Showing the first 200. Narrow the filters to see more.</li>}
        </ul>
        <div className="hidden overflow-x-auto rounded-xl border border-line bg-surface md:block">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Order</th>
                <th scope="col" className="px-4 py-3 font-medium">Customer</th>
                <th scope="col" className="px-4 py-3 font-medium">Due</th>
                <th scope="col" className="px-4 py-3 font-medium">Items</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Balance</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.map((o) => {
                const overdue = o.due_at && o.due_at < now && o.status && OPEN_STATUSES.includes(o.status);
                return (
                  <tr key={o.id} className={cx("hover:bg-canvas/60", fulfilmentRowClass(o.fulfilment))}>
                    <td className="px-4 py-3">
                      <Link href={`/admin/orders/${o.id}`} className="font-mono font-medium text-ink hover:text-brand-strong hover:underline">
                        {o.reference}
                      </Link>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {o.source && <SourceBadge source={o.source} />}
                        {o.fulfilment && <FulfilmentBadge fulfilment={o.fulfilment} />}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{o.customer_name ?? <span className="text-muted">Walk-in</span>}</div>
                      {o.customer_phone && <div className="text-xs text-muted">{o.customer_phone}</div>}
                      {o.setup_address && (
                        <div className={cx("mt-1 text-xs font-medium", o.fulfilment === "setup" ? "text-danger" : "text-ok")}>{o.fulfilment === "setup" ? "Set up at" : "Cab to"}: {o.setup_address}</div>
                      )}
                    </td>
                    <td className={cx("px-4 py-3 whitespace-nowrap", overdue && "font-medium text-danger")}>
                      {o.due_at ? formatDateTime(o.due_at, tz) : "—"}
                      {o.is_immediate && <div className="text-xs text-muted">Walk-in</div>}
                      {overdue && <div className="text-xs">Overdue</div>}
                    </td>
                    <td className="px-4 py-3">
                      {o.item_count}
                      {o.id && cakeByOrder.has(o.id) && (
                        <div className="text-xs text-muted">
                          🎂 {cakeByOrder.get(o.id)!.flavour}, {Number(cakeByOrder.get(o.id)!.weight_kg)} kg
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">{formatPaise(o.total_paise ?? 0)}</td>
                    <td className={cx("px-4 py-3 text-right whitespace-nowrap", (o.balance_paise ?? 0) > 0 && "font-medium text-warn", (o.balance_paise ?? 0) < 0 && "font-medium text-danger")}>
                      {(o.balance_paise ?? 0) === 0 ? <span className="text-ok">Paid</span> : (o.balance_paise ?? 0) < 0 ? `Refund ${formatPaise(-(o.balance_paise ?? 0))}` : formatPaise(o.balance_paise ?? 0)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {o.status && <StatusBadge status={o.status} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {orders.length === 200 && <p className="border-t border-line px-4 py-2 text-xs text-muted">Showing the first 200. Narrow the filters to see more.</p>}
        </div>
        </>
      )}
    </>
  );
}
