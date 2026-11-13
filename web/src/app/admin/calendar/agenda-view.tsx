import { addDays, formatDayHeading } from "@/lib/time";
import { EmptyState } from "@/components/ui";
import { OrderList, plural, type OrdersByDay } from "./order-row";

export function AgendaView({ from, days, today, byDay, closureByDay, tz, canDelete = false }: {
  from: string;
  days: number;
  today: string;
  byDay: OrdersByDay;
  closureByDay: Map<string, string>;
  tz: string;
  canDelete?: boolean;
}) {
  return (
    <div className="flex flex-col gap-5">
      {Array.from({ length: days }, (_, i) => addDays(from, i)).map((day) => {
        const dayOrders = byDay.get(day) ?? [];
        const closure = closureByDay.get(day);
        if (dayOrders.length === 0 && !closure && day !== today) return null;
        return (
          <section key={day} aria-labelledby={`day-${day}`}>
            <h2 id={`day-${day}`} className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
              {formatDayHeading(day)}
              {day === today && <span className="text-xs font-medium text-brand-strong">Today</span>}
              {closure && <span className="text-xs font-medium text-danger">Closed: {closure}</span>}
              <span className="text-xs font-normal text-muted">{plural(dayOrders.length, "order")}</span>
            </h2>
            {dayOrders.length === 0 ? (
              <p className="rounded-lg border border-dashed border-line bg-surface px-4 py-3 text-sm text-muted">Nothing due.</p>
            ) : (
              <OrderList orders={dayOrders} tz={tz} canDelete={canDelete} />
            )}
          </section>
        );
      })}
      {byDay.size === 0 && <EmptyState title={`No orders in the next ${days} days`}>Orders appear here by pickup time as soon as they are created.</EmptyState>}
    </div>
  );
}
