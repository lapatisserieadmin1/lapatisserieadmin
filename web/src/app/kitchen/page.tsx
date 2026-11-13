import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { addDays, formatDayHeading, formatTime, zonedDayKey } from "@/lib/time";
import { fulfilmentLabel } from "@/lib/orders";
import {
  CALENDAR_DAYS,
  KITCHEN_TABS,
  cakeRows,
  groupChefWork,
  itemTotals,
  kitchenDay,
  kitchenMonth,
  kitchenTab,
  monthGridStart,
  shiftMonth,
  summariseByDay,
  tabRange,
  type ChefLine,
  type ChefOrder,
  type DaySummary,
} from "@/lib/kitchen";
import { ProductThumb } from "@/components/product-thumb";
import { Alert, Badge, EmptyState, LogoMark, ScriptText, cx } from "@/components/ui";
import { kitchenListLabel } from "@/lib/orders";
import { AutoRefresh } from "./auto-refresh";

export const metadata: Metadata = { title: "Kitchen" };

// The chef screen (owner, 2026-10-20): what to make, per kitchen, with everything about the order except
// money. Everything comes from public.chef_work; chefs cannot read orders or prices directly.

function str(v: string | string[] | undefined) {
  return typeof v === "string" ? v : "";
}

function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "shrink-0 whitespace-nowrap rounded-full border px-3 py-2 text-sm font-medium sm:px-4 sm:text-base",
        active ? "border-brand bg-brand-soft text-brand-strong" : "border-line bg-surface hover:border-brand",
      )}
    >
      {children}
    </Link>
  );
}

function OrderStatusBadge({ status }: { status: ChefOrder["status"] }) {
  if (status === "cancelled") return <Badge tone="danger">Cancelled — stop</Badge>;
  if (status === "ready") return <Badge tone="ok">Packed ✓</Badge>;
  if (status === "preparing") return <Badge tone="warn">Preparing</Badge>;
  return <Badge tone="info">To make</Badge>;
}

function FulfilmentTag({ fulfilment }: { fulfilment: ChefOrder["fulfilment"] }) {
  const setup = fulfilment === "setup";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-sm font-semibold",
        setup ? "border-danger/40 bg-danger-soft text-danger" : "border-ok/40 bg-ok-soft text-ok",
      )}
    >
      <span aria-hidden>{setup ? "🚚" : "🏪"}</span>
      {fulfilmentLabel[fulfilment]}
    </span>
  );
}

function CakeNote({ line, photoUrls }: { line: ChefLine; photoUrls: string[] }) {
  const rows = cakeRows(line.cake ?? {});
  return (
    <div className="rounded-sm border border-note-line bg-note p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-lg font-semibold">🎂 Custom cake · {line.size}</p>
        {line.cake?.is_eggless && <Badge tone="ok">Eggless</Badge>}
      </div>
      <div className={cx("mt-3 flex flex-col gap-4", photoUrls.length === 1 && "sm:flex-row")}>
        {photoUrls.length === 1 && (
          <a href={photoUrls[0]} target="_blank" rel="noreferrer" className="shrink-0" title="Open the reference photo">
            {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL */}
            <img src={photoUrls[0]} alt="Reference photo" className="h-56 w-full rounded-lg border border-note-line bg-surface object-cover sm:h-40 sm:w-40" />
          </a>
        )}
        {/* Several photos: a row that scrolls sideways; tap one to open it full size. */}
        {photoUrls.length > 1 && (
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {photoUrls.map((url, i) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" className="shrink-0" title={`Open reference photo ${i + 1}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived URL */}
                <img src={url} alt={`Reference photo ${i + 1}`} className="size-32 rounded-lg border border-note-line bg-surface object-cover sm:size-36" />
              </a>
            ))}
          </div>
        )}
        <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-base">
          {rows.map((r) => (
            <div key={r.label} className="contents">
              <dt className="text-muted">{r.label}</dt>
              <dd className="min-w-0 break-words font-medium whitespace-pre-line">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {line.notes && <p className="mt-3 text-base"><span className="text-muted">Note:</span> {line.notes}</p>}
    </div>
  );
}

const SOURCE_LABEL: Record<ChefOrder["source"], string> = { IN_STORE: "At the counter", CALL: "Phone call", ONLINE: "Website", CUSTOMER: "Customer app" };

// Who the order is for and anything they asked: everything except money.
function OrderDetails({ order }: { order: ChefOrder }) {
  const rows: { label: string; value: ReactNode }[] = [];
  if (order.customerName) rows.push({ label: "Customer", value: order.customerName });
  if (order.customerPhone) {
    rows.push({
      label: "Phone",
      value: <a href={`tel:${order.customerPhone}`} className="font-semibold text-brand-strong underline-offset-2 hover:underline">{order.customerPhone}</a>,
    });
  }
  rows.push({ label: "Ordered by", value: SOURCE_LABEL[order.source] });
  if (order.fulfilment === "setup" && order.setupAddress) rows.push({ label: "Set up at", value: order.setupAddress });
  if (order.fulfilment === "setup" && order.setupNote) rows.push({ label: "Landmark", value: order.setupNote });
  if (order.customerNotes) rows.push({ label: "Order note", value: order.customerNotes });
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl bg-canvas px-3 py-2.5 text-base">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-muted">{r.label}</dt>
          <dd className="min-w-0 break-words font-medium whitespace-pre-line">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function OrderCard({ order, tz, showDay, photos, multiKitchen }: {
  order: ChefOrder;
  tz: string;
  showDay: boolean;
  photos: Map<string, string>;
  multiKitchen: boolean;
}) {
  const closed = order.status === "cancelled";
  const packed = order.status === "ready";
  return (
    <article
      className={cx(
        "flex min-w-0 flex-col gap-4 rounded-2xl border bg-surface p-4 shadow-[0_8px_30px_-20px_rgba(176,58,94,0.35)] sm:p-5",
        closed ? "border-danger/40 opacity-80" : packed ? "border-ok/40 opacity-75" : "border-line",
        order.fulfilment === "setup" && !closed && "border-l-4 border-l-danger",
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-2xl font-semibold tabular-nums sm:text-3xl">
            {order.isImmediate ? "Now" : formatTime(order.dueAt, tz)}
          </p>
          {showDay && <p className="text-base font-medium text-ink">{formatDayHeading(zonedDayKey(order.dueAt, tz))}</p>}
          <p className="mt-0.5 text-base text-muted">Order {order.reference}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FulfilmentTag fulfilment={order.fulfilment} />
          <OrderStatusBadge status={order.status} />
        </div>
      </header>

      <OrderDetails order={order} />

      {order.internalNotes && (
        <div className="rounded-xl border border-warn/40 bg-warn-soft px-3 py-2.5 text-base">
          <p className="text-sm font-semibold uppercase tracking-wide text-warn">📝 Staff instructions</p>
          <p className="mt-1 break-words font-medium whitespace-pre-line">{order.internalNotes}</p>
        </div>
      )}

      {closed ? (
        <Alert tone="danger" title="This order was cancelled">Stop work on it. Ask the counter what to do with anything already made.</Alert>
      ) : (
        <Link
          href={`/kitchen/quotation/${order.id}`}
          className="self-start rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium text-brand-strong hover:bg-brand-soft"
        >
          Open Order in msg (no prices) →
        </Link>
      )}

      <ul className="flex flex-col gap-3">
        {order.lines.map((l) =>
          l.cake ? (
            <li key={l.id}>
              <CakeNote line={l} photoUrls={(l.cake.photo_paths ?? []).flatMap((p) => (photos.has(p) ? [photos.get(p)!] : []))} />
            </li>
          ) : (
            <li key={l.id} className={cx("flex items-start gap-3", closed && "line-through decoration-danger/60")}>
              <ProductThumb url={l.imageUrl} name={l.name} size="md" />
              <div className="min-w-0 flex-1">
                <p className="break-words text-base leading-snug sm:text-lg">
                  <span className="font-bold tabular-nums">{l.quantity} ×</span> <span className="font-semibold">{l.name}</span>{" "}
                  <span className="text-muted">· {l.size}</span>
                </p>
                {(l.isEggless || (multiKitchen && l.kitchenName)) && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {l.isEggless && <Badge tone="ok">Eggless</Badge>}
                    {multiKitchen && l.kitchenName && <Badge>{l.kitchenName}</Badge>}
                  </div>
                )}
                {l.notes && <p className="mt-1 text-base"><span className="text-muted">Note:</span> {l.notes}</p>}
              </div>
            </li>
          ),
        )}
      </ul>
    </article>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function MonthGrid({ month, today, byDay, dayHref, monthHref }: {
  month: string;
  today: string;
  byDay: Map<string, DaySummary>;
  dayHref: (day: string) => string;
  monthHref: (month: string) => string;
}) {
  const start = monthGridStart(month);
  const title = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${month}-01T00:00:00Z`));
  const navClass = "rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium hover:bg-brand-soft sm:px-4 sm:text-base";
  return (
    <section aria-label="Calendar" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Link href={monthHref(shiftMonth(month, -1))} className={navClass} aria-label="Previous month">
          ← <span className="hidden sm:inline">Previous</span>
        </Link>
        <h2 className="text-lg font-semibold sm:text-xl">{title}</h2>
        <Link href={monthHref(shiftMonth(month, 1))} className={navClass} aria-label="Next month">
          <span className="hidden sm:inline">Next</span> →
        </Link>
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-line bg-line">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-canvas py-2 text-center text-xs font-semibold uppercase text-muted sm:text-sm">
            <span className="sm:hidden">{d.slice(0, 1)}</span>
            <span className="hidden sm:inline">{d}</span>
          </div>
        ))}
        {Array.from({ length: CALENDAR_DAYS }, (_, i) => addDays(start, i)).map((day) => {
          const sum = byDay.get(day);
          const faded = !day.startsWith(month) || day < today;
          return (
            <Link
              key={day}
              href={dayHref(day)}
              aria-label={`${formatDayHeading(day)}: ${sum ? `${sum.orders} order${sum.orders === 1 ? "" : "s"}` : "nothing to make"}`}
              className={cx(
                "flex min-h-16 min-w-0 flex-col gap-1 bg-surface p-1.5 hover:bg-brand-soft/50 sm:min-h-28 sm:p-2",
                faded && "bg-canvas/70 text-muted",
                day === today && "ring-2 ring-inset ring-brand",
              )}
            >
              <span className={cx("text-sm font-semibold sm:text-base", day === today && "text-brand-strong")}>{Number(day.slice(8))}</span>
              {sum && (
                <>
                  {/* Phones: the order count, and a cake when there is a custom cake. */}
                  <span className="flex flex-wrap items-center gap-0.5 text-xs font-bold sm:hidden">
                    <span className="rounded-full bg-brand px-1.5 text-white">{sum.orders}</span>
                    {sum.cakes > 0 && <span aria-hidden>🎂</span>}
                  </span>
                  <span className="hidden flex-col gap-1 text-sm sm:flex">
                    <span className="font-semibold text-ink">{sum.orders} order{sum.orders === 1 ? "" : "s"}</span>
                    {sum.cakes > 0 && <span className="rounded bg-note px-1 text-xs font-semibold text-ink">🎂 {sum.cakes} custom cake{sum.cakes === 1 ? "" : "s"}</span>}
                    {sum.setups > 0 && <span className="rounded bg-danger-soft px-1 text-xs font-semibold text-danger">🚚 {sum.setups} set up</span>}
                  </span>
                </>
              )}
            </Link>
          );
        })}
      </div>
      <p className="text-sm text-muted">Tap a day to see what to make. Counts leave out packed and cancelled orders.</p>
    </section>
  );
}

export default async function KitchenPage({ searchParams }: PageProps<"/kitchen">) {
  const staff = await requireRole(["chef", "admin", "counter"]);
  const params = await searchParams;
  const tab = kitchenTab(str(params.tab));
  const tz = await getBusinessTimezone();
  const now = new Date();
  const todayKey = zonedDayKey(now, tz);
  const day = kitchenDay(str(params.d), todayKey);
  const month = kitchenMonth(str(params.m), todayKey);
  const range = tabRange(tab, todayKey, { day, month });

  const supabase = await createClient();
  const [{ data: rows, error }, { data: kitchenRows }, { data: mine }] = await Promise.all([
    supabase.rpc("chef_work", { p_from: range.from, p_to: range.to }),
    supabase.from("kitchens").select("id, name, code").eq("is_active", true).order("sort_order"),
    supabase.from("staff_kitchens").select("kitchen_id").eq("user_id", staff.userId),
  ]);
  // Chefs switch between their own kitchens; admins and counter staff (checking the screen) between all.
  const myIds = new Set((mine ?? []).map((m) => m.kitchen_id));
  const kitchens = (kitchenRows ?? []).filter((k) => staff.role !== "chef" || myIds.has(k.id));
  const kitchenId = kitchens.some((k) => k.id === str(params.k)) ? str(params.k) : null;
  const orders = groupChefWork(rows ?? [], kitchenId);
  const totals = itemTotals(orders);
  const open = orders.filter((o) => o.status !== "cancelled" && o.status !== "ready").length;

  // Reference photos of custom cakes: short-lived signed links (storage lets a chef open only cakes on this screen).
  const photoPaths = tab === "calendar" ? [] : [...new Set(orders.flatMap((o) => o.lines.flatMap((l) => l.cake?.photo_paths ?? [])))];
  const photos = new Map<string, string>();
  if (photoPaths.length) {
    const { data: signed } = await supabase.storage.from("custom-cake-photos").createSignedUrls(photoPaths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) photos.set(s.path, s.signedUrl);
  }

  // Keeps the kitchen filter, and the picked day or month while on that tab.
  const link = (overrides: Record<string, string>) => {
    const q = new URLSearchParams({
      tab,
      ...(kitchenId ? { k: kitchenId } : {}),
      ...(tab === "day" ? { d: day } : {}),
      ...(tab === "calendar" ? { m: month } : {}),
      ...overrides,
    });
    if (!q.get("k")) q.delete("k");
    if (q.get("tab") !== "day") q.delete("d");
    if (q.get("tab") !== "calendar") q.delete("m");
    return `/kitchen?${q}`;
  };
  const byDay = tab === "calendar" ? summariseByDay(orders, (o) => zonedDayKey(o.dueAt, tz)) : null;
  const heading = staff.role === "chef"
    ? (kitchens.length ? kitchens.map((k) => `${k.name} · ${kitchenListLabel(k.code)}`).join(" + ") : "No kitchen ticked")
    : "Chef screen (all kitchens)";

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            <LogoMark className="size-11 shrink-0 sm:size-12" />
            <div className="min-w-0">
              <p className="font-caps text-sm uppercase leading-none tracking-[0.15em] sm:text-base">La Patisserie Madras <span className="text-xs normal-case tracking-normal text-muted">· Kitchen</span></p>
              <h1 className="mt-1 truncate text-lg font-semibold sm:text-xl">{heading}</h1>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:order-last sm:gap-3">
            {staff.role !== "chef" && (
              <Link href="/admin" className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium hover:bg-brand-soft sm:px-4 sm:py-2.5 sm:text-base">
                Admin
              </Link>
            )}
            <span className="hidden text-base lg:inline">{staff.fullName}</span>
            <form action={signOut}>
              <button type="submit" className="rounded-xl border border-line bg-surface px-3 py-2 text-sm font-medium hover:bg-brand-soft sm:px-4 sm:py-2.5 sm:text-base">
                Sign out
              </button>
            </form>
          </div>
          <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:flex-1 sm:justify-center">
            <span className="text-sm text-muted lg:hidden">{staff.fullName}</span>
            <AutoRefresh loadedAt={now.toISOString()} tz={tz} />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 py-4 sm:gap-5 sm:px-6 sm:py-5">
        {staff.role === "chef" && kitchens.length === 0 && (
          <Alert tone="warn" title="No kitchen ticked for you">
            You see no orders until an admin ticks your kitchen on the Staff page.
          </Alert>
        )}
        {error && <Alert tone="danger" title="Could not load the kitchen list">{error.message}</Alert>}

        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4">
          <nav aria-label="Days" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
            {KITCHEN_TABS.map((t) => (
              <Chip key={t.key} href={link({ tab: t.key })} active={tab === t.key || (tab === "day" && t.key === "calendar")}>{t.label}</Chip>
            ))}
          </nav>
          {kitchens.length > 1 && (
            <nav aria-label="Kitchens" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0 lg:border-l lg:border-line lg:pl-4">
              <Chip href={link({ k: "" })} active={!kitchenId}>All kitchens</Chip>
              {kitchens.map((k) => (
                <Chip key={k.id} href={link({ k: k.id })} active={kitchenId === k.id}>{k.name}</Chip>
              ))}
            </nav>
          )}
        </div>

        {byDay ? (
          <MonthGrid
            month={month}
            today={todayKey}
            byDay={byDay}
            dayHref={(d) => link({ tab: "day", d })}
            monthHref={(m) => link({ tab: "calendar", m })}
          />
        ) : (
          <>
        <div className="flex flex-wrap items-center gap-3">
          {tab === "day" && (
            <Link href={link({ tab: "calendar", m: day.slice(0, 7) })} className="rounded-xl border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-brand-soft">
              ← Calendar
            </Link>
          )}
          <p className="text-base text-muted">
            {tab === "later" ? "Next two weeks" : formatDayHeading(range.from)} · {open} order{open === 1 ? "" : "s"} to make
          </p>
        </div>

        {totals.length > 0 && (
          <section aria-label="Totals" className="rounded-2xl border border-brand/20 bg-brand-soft/50 p-4">
            <h2 className="mb-2 text-base font-semibold">Total to make</h2>
            <ul className="grid gap-x-6 gap-y-1 text-base sm:flex sm:flex-wrap">
              {totals.map((t) => (
                <li key={`${t.name}-${t.size}`}>
                  <span className="font-bold tabular-nums">{t.quantity} ×</span> {t.name} <span className="text-muted">· {t.size}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {orders.length === 0 ? (
          <EmptyState title="Nothing to make here">Orders appear as soon as the counter confirms them.</EmptyState>
        ) : (
          <div className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {orders.map((o) => (
              <OrderCard key={o.id} order={o} tz={tz} showDay={tab === "later"} photos={photos} multiKitchen={kitchens.length > 1 && !kitchenId} />
            ))}
          </div>
        )}
          </>
        )}
      </main>
      <footer className="px-5 pb-6 text-center">
        <ScriptText className="text-2xl sm:text-3xl">Handle with care, it&apos;s someone&apos;s happiness ♥</ScriptText>
      </footer>
    </div>
  );
}
