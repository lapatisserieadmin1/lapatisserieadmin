import { groupByWindow, formatClock, type PickupAvailability } from "@/lib/capacity";
import { dateToZonedLocal, formatDayHeading } from "@/lib/time";
import { cx } from "@/components/ui";
import { OrderList, plural, type CalendarOrder } from "./order-row";

// One day, grouped by that date's pickup windows (weekday windows or a festival override),
// with bakery-wide window and category usage from pickup_availability.
export function DayView({ day, today, orders, closure, availability, filtered, tz, canDelete = false }: {
  day: string;
  today: string;
  orders: CalendarOrder[];
  closure: string | undefined;
  availability: PickupAvailability | null;
  filtered: boolean;
  tz: string;
  canDelete?: boolean;
}) {
  const windows = availability?.windows ?? [];
  const localTime = (o: CalendarOrder) => (o.due_at ? dateToZonedLocal(new Date(o.due_at), tz).slice(11, 16) : "");
  const { groups, outside } = groupByWindow(orders, localTime, windows);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="flex items-baseline gap-2 text-sm font-semibold">
          {formatDayHeading(day)}
          {day === today && <span className="text-xs font-medium text-brand-strong">Today</span>}
          {closure && <span className="text-xs font-medium text-danger">Closed: {closure}</span>}
          <span className="text-xs font-normal text-muted">{plural(orders.length, "order")}</span>
        </h2>
        {availability === null && <p className="text-sm text-danger">Pickup window usage could not be loaded.</p>}
        {(availability?.categories.length ?? 0) > 0 && (
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {availability!.categories.map((c) => (
              <span key={c.category_id} className={cx(c.used >= c.max && "font-semibold text-danger")}>
                {c.name}: {c.used}/{c.max}{c.used >= c.max ? " Full" : ""}
              </span>
            ))}
          </p>
        )}
        {filtered && windows.length > 0 && (
          <p className="text-xs text-muted">Window and category counts cover all orders for the day; the lists below follow your filters.</p>
        )}
      </div>

      {groups.map(({ window: w, orders: windowOrders }) => {
        const full = w.max !== null && w.used >= w.max;
        return (
          <section key={w.starts_at} aria-labelledby={`window-${w.starts_at}`}>
            <h3 id={`window-${w.starts_at}`} className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
              {formatClock(w.starts_at)}–{formatClock(w.ends_at)}
              <span className={cx("text-xs font-normal", full ? "font-semibold text-danger" : "text-muted")}>
                {w.max === null ? `${w.used} booked` : `${w.used}/${w.max} booked`}{full && " · Full"}
              </span>
            </h3>
            {windowOrders.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line bg-surface px-4 py-3 text-sm text-muted">Nothing due.</p>
            ) : (
              <OrderList orders={windowOrders} tz={tz} canDelete={canDelete} />
            )}
          </section>
        );
      })}

      {outside.length > 0 && (
        <section aria-labelledby="window-outside">
          <h3 id="window-outside" className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
            {windows.length > 0 ? "Outside pickup windows" : "No pickup windows set for this day"}
            <span className="text-xs font-normal text-muted">{plural(outside.length, "order")}</span>
          </h3>
          <OrderList orders={outside} tz={tz} canDelete={canDelete} />
        </section>
      )}

      {orders.length === 0 && windows.length === 0 && (
        <p className="rounded-lg border border-dashed border-line bg-surface px-4 py-3 text-sm text-muted">Nothing due.</p>
      )}
    </div>
  );
}
