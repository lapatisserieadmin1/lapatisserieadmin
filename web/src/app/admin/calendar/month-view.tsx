import Link from "next/link";
import { addDays } from "@/lib/time";
import { cx } from "@/components/ui";
import { plural, type OrdersByDay } from "./order-row";

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function MonthView({ gridStart, month, today, byDay, closureByDay, dayHref }: {
  gridStart: string;
  month: string; // "YYYY-MM"
  today: string;
  byDay: OrdersByDay;
  closureByDay: Map<string, string>;
  dayHref: (day: string) => string;
}) {
  return (
    <div className="md:overflow-x-auto">
      <p className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>Each day: total orders, then</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-danger" />Set-up</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-ok" />Pickup/Cab</span>
      </p>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-line bg-line text-sm md:min-w-[700px]">
        {WEEKDAYS.map((d) => (
          <div key={d} className="bg-canvas px-1 py-1.5 text-center text-xs font-medium uppercase text-muted md:px-2 md:text-left md:tracking-wider">
            <span className="md:hidden">{d.slice(0, 1)}</span>
            <span className="hidden md:inline">{d}</span>
          </div>
        ))}
        {Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).map((day) => {
          const dayOrders = byDay.get(day) ?? [];
          const pending = dayOrders.filter((o) => o.status === "pending_confirmation").length;
          const setups = dayOrders.filter((o) => o.fulfilment === "setup").length;
          const pickups = dayOrders.length - setups;
          const inMonth = day.startsWith(month);
          return (
            <Link key={day} href={dayHref(day)}
              className={cx("flex min-h-16 flex-col gap-1 bg-surface p-1 hover:bg-brand-soft/50 md:min-h-24 md:p-2", !inMonth && "bg-canvas/60 text-muted", day === today && "ring-2 ring-inset ring-brand")}>
              <span className="text-xs font-medium">{Number(day.slice(8))}</span>
              {dayOrders.length > 0 && (
                <span
                  className="flex flex-col gap-0.5 text-xs md:gap-1"
                  aria-label={`${plural(dayOrders.length, "order")}: ${setups} set-up, ${pickups} Pickup/Cab`}
                >
                  <span className="font-semibold md:text-sm">
                    {dayOrders.length}<span className="hidden md:inline"> total</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium" aria-hidden>
                    {setups > 0 && <span className="inline-flex items-center gap-1 text-danger" title="Set-up"><span className="size-2 rounded-full bg-danger" />{setups}</span>}
                    {pickups > 0 && <span className="inline-flex items-center gap-1 text-ok" title="Pickup/Cab"><span className="size-2 rounded-full bg-ok" />{pickups}</span>}
                  </span>
                </span>
              )}
              {closureByDay.has(day) && <span className="text-xs text-danger"><span className="md:hidden">✕</span><span className="hidden md:inline">Closed</span></span>}
              {pending > 0 && <span className="hidden text-xs text-warn md:inline">{pending} pending</span>}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
