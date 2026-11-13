import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { KITCHEN_CODE_FOR, orderKindLabel, type OrderKind, type OrderStatus } from "@/lib/orders";
import type { PickupAvailability } from "@/lib/capacity";
import { addDays, formatDayHeading, zonedDayKey, zonedDayRange } from "@/lib/time";
import { Alert, PageHeader, Select, cx } from "@/components/ui";
import type { CalendarCake, OrdersByDay } from "./order-row";
import { AgendaView } from "./agenda-view";
import { DayView } from "./day-view";
import { MonthView } from "./month-view";
import { WeekView } from "./week-view";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Calendar" };

function str(v: string | string[] | undefined) {
  return typeof v === "string" ? v : "";
}

const isDayKey = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

const VIEWS = ["agenda", "day", "week", "month"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = { agenda: "Agenda", day: "Day", week: "Week", month: "Month" };
const AGENDA_DAYS = 14;

// Two calendars (owner, 2026-10-24): web orders (Kitchen 2) in rose, custom orders (Kitchen 1) in gold.
const KINDS: OrderKind[] = ["web", "custom"];
const KIND_STYLE: Record<OrderKind, { tab: string; frame: string; dot: string }> = {
  web: { tab: "border-brand bg-brand text-white", frame: "border-t-brand", dot: "bg-brand" },
  custom: { tab: "border-gold bg-gold text-white", frame: "border-t-gold", dot: "bg-gold" },
};

// Owner (2026-10-22): an order goes on the calendar only once it is confirmed. Website requests waiting for
// confirmation (and drafts) stay off it; a note links to them instead.
const BOOKED_STATUSES: OrderStatus[] = ["confirmed", "preparing", "ready", "completed"];
const CLOSED_STATUSES: OrderStatus[] = ["cancelled", "rejected"];

// Monday on or before a day ("YYYY-MM-DD").
const mondayOf = (day: string) => addDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
const shortDate = (day: string, withYear = false) =>
  new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) }).format(
    new Date(`${day}T00:00:00Z`),
  );

export default async function CalendarPage({ searchParams }: PageProps<"/admin/calendar">) {
  const staff = await requireRole(["admin", "counter"]);
  const params = await searchParams;
  const tz = await getBusinessTimezone();
  const today = zonedDayKey(new Date(), tz);

  const kind: OrderKind = str(params.kind) === "custom" ? "custom" : "web";
  const view: View = (VIEWS as readonly string[]).includes(str(params.view)) ? (str(params.view) as View) : "agenda";
  const from = isDayKey(str(params.from)) ? str(params.from) : today;
  const source = ["IN_STORE", "CALL", "ONLINE", "CUSTOMER"].includes(str(params.source))
    ? (str(params.source) as "IN_STORE" | "CALL" | "ONLINE" | "CUSTOMER")
    : "";
  const showClosed = str(params.closed) === "1";
  const fulfil = str(params.fulfil) === "collect" || str(params.fulfil) === "setup" ? (str(params.fulfil) as "collect" | "setup") : "";

  // Month view covers whole weeks (Mon–Sun) around the chosen month; week view is Mon–Sun.
  const monthStart = `${from.slice(0, 7)}-01`;
  const gridStart = mondayOf(monthStart);
  const weekStart = mondayOf(from);
  const [rangeStart, rangeDays]: [string, number] = {
    agenda: [from, AGENDA_DAYS] as [string, number],
    day: [from, 1] as [string, number],
    week: [weekStart, 7] as [string, number],
    month: [gridStart, 42] as [string, number],
  }[view];
  const { start, end } = zonedDayRange(rangeStart, tz, rangeDays);

  const supabase = await createClient();
  const { data: customKitchen } = await supabase.from("kitchens").select("id").eq("code", KITCHEN_CODE_FOR.custom).maybeSingle();
  let query = supabase
    .from("order_summaries")
    .select("id, reference, source, status, customer_name, customer_phone, due_at, item_count, fulfilment, setup_address")
    .gte("due_at", start.toISOString())
    .lt("due_at", end.toISOString())
    .order("due_at");
  // Every order is routed to a kitchen when it is created: Kitchen 1 for custom orders, Kitchen 2 otherwise.
  if (kind === "custom") query = customKitchen ? query.eq("kitchen_id", customKitchen.id) : query.eq("id", "00000000-0000-0000-0000-000000000000");
  else if (customKitchen) query = query.or(`kitchen_id.is.null,kitchen_id.neq.${customKitchen.id}`);
  query = query.in("status", showClosed ? [...BOOKED_STATUSES, ...CLOSED_STATUSES] : BOOKED_STATUSES);
  if (source) query = query.eq("source", source);
  if (fulfil) query = query.eq("fulfilment", fulfil);

  const [{ data: orders }, { data: closures }, availability, { count: waiting }] = await Promise.all([
    query,
    supabase.from("closures").select("closed_on, reason").gte("closed_on", rangeStart).lt("closed_on", addDays(rangeStart, rangeDays)),
    view === "day"
      ? supabase.rpc("pickup_availability", { p_date: from }).then(({ data, error }) => (error ? null : (data as unknown as PickupAvailability)))
      : null,
    supabase.from("orders").select("id", { count: "exact", head: true }).eq("status", "pending_confirmation"),
  ]);
  const closureByDay = new Map((closures ?? []).map((c) => [c.closed_on, c.reason]));

  // Custom cakes (2026-10-13): what cake, its weight, fondant and theme on each order.
  const orderIds = (orders ?? []).map((o) => o.id).filter((v): v is string => Boolean(v));
  const { data: cakes } = orderIds.length
    ? await supabase.from("custom_cakes").select("order_id, flavour, weight_kg, tiers, fondant, theme").in("order_id", orderIds)
    : { data: [] };
  const cakeByOrder = new Map<string, CalendarCake>((cakes ?? []).map((c) => [c.order_id, c]));

  const byDay: OrdersByDay = new Map();
  for (const o of orders ?? []) {
    if (!o.due_at) continue;
    // The online calendar never shows customised (custom cake) orders, whatever kitchen they are in.
    if (kind === "web" && o.id && cakeByOrder.has(o.id)) continue;
    const key = zonedDayKey(o.due_at, tz);
    byDay.set(key, [...(byDay.get(key) ?? []), { ...o, cake: o.id ? cakeByOrder.get(o.id) ?? null : null }]);
  }

  const link = (overrides: Record<string, string>) => {
    const next = new URLSearchParams({ kind, view, from, ...(source ? { source } : {}), ...(fulfil ? { fulfil } : {}), ...(showClosed ? { closed: "1" } : {}), ...overrides });
    return `/admin/calendar?${next.toString()}`;
  };
  const dayHref = (day: string) => link({ view: "day", from: day });

  const step = { agenda: AGENDA_DAYS, day: 1, week: 7, month: 0 }[view];
  const prevFrom = view === "month" ? addDays(monthStart, -1).slice(0, 7) + "-01" : addDays(from, -step);
  const nextFrom = view === "month" ? addDays(monthStart, 32).slice(0, 7) + "-01" : addDays(from, step);
  const rangeLabel = {
    agenda: `${formatDayHeading(from)} + ${AGENDA_DAYS} days`,
    day: formatDayHeading(from),
    week: `${shortDate(weekStart)} – ${shortDate(addDays(weekStart, 6), true)}`,
    month: new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${monthStart}T00:00:00Z`)),
  }[view];

  return (
    <>
      <LiveRefresh />
      <PageHeader
        title={`${orderKindLabel[kind]} calendar`}
        description={`${kind === "custom" ? "Customised orders, made in Kitchen 1" : "Website, in-store and call orders, made in Kitchen 2"}, by pickup or set-up time (${tz}). Green: Pickup/Cab. Red: set up at the customer's place. Orders appear here once they are confirmed.`}
      />

      <nav aria-label="Calendars" className="mb-4 flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <Link
            key={k}
            href={link({ kind: k })}
            aria-current={kind === k ? "page" : undefined}
            className={cx(
              "flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium",
              kind === k ? KIND_STYLE[k].tab : "border-line bg-surface hover:bg-brand-soft",
            )}
          >
            <span aria-hidden className={cx("size-2.5 rounded-full", kind === k ? "bg-white" : KIND_STYLE[k].dot)} />
            {orderKindLabel[k]}
          </Link>
        ))}
      </nav>

      {(waiting ?? 0) > 0 && (
        <div className="mb-4">
          <Alert title={`${waiting} ${waiting === 1 ? "order is" : "orders are"} waiting for confirmation`}>
            They go on the calendar (and to the kitchen) once you confirm them.{" "}
            <Link href="/admin/notifications" className="font-medium underline">Review them</Link>
          </Alert>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-1">
          {VIEWS.map((v) => (
            <Link key={v} href={link({ view: v })} aria-current={view === v ? "page" : undefined}
              className={cx("rounded-md px-3 py-1.5 text-sm font-medium", view === v ? "bg-brand-soft text-brand-strong" : "text-muted hover:text-ink")}>
              {VIEW_LABEL[v]}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Link href={link({ from: prevFrom })} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-brand-soft" aria-label="Previous">←</Link>
          <Link href={link({ from: today })} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-brand-soft">Today</Link>
          <Link href={link({ from: nextFrom })} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-brand-soft" aria-label="Next">→</Link>
          <span className="ml-2 text-sm font-medium">{rangeLabel}</span>
        </div>
      </div>

      <form className="mb-5 flex flex-wrap items-end gap-3">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="from" value={from} />
        <div>
          <label htmlFor="source" className="sr-only">Source</label>
          <Select id="source" name="source" defaultValue={source}>
            <option value="">All sources</option>
            <option value="IN_STORE">In-store</option>
            <option value="CALL">Call</option>
            <option value="CUSTOMER">Customer</option>
            <option value="ONLINE">Online</option>
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
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" name="closed" value="1" defaultChecked={showClosed} className="accent-brand" />
          Show cancelled and rejected
        </label>
        <button type="submit" className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-brand-soft">Apply</button>
      </form>

      <div className={cx("rounded-xl border-t-4 pt-3", KIND_STYLE[kind].frame)}>
      {view === "month" && (
        <MonthView gridStart={gridStart} month={from.slice(0, 7)} today={today} byDay={byDay} closureByDay={closureByDay} dayHref={dayHref} />
      )}
      {view === "week" && (
        <WeekView weekStart={weekStart} today={today} byDay={byDay} closureByDay={closureByDay} tz={tz} dayHref={dayHref} />
      )}
      {view === "day" && (
        <DayView day={from} today={today} orders={byDay.get(from) ?? []} closure={closureByDay.get(from)} availability={availability}
          filtered={Boolean(source || fulfil || showClosed)} tz={tz} canDelete={staff.role === "admin"} />
      )}
      {view === "agenda" && (
        <AgendaView from={from} days={AGENDA_DAYS} today={today} byDay={byDay} closureByDay={closureByDay} tz={tz} canDelete={staff.role === "admin"} />
      )}
      </div>
    </>
  );
}
