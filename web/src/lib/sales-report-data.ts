import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { zonedDayKey, zonedDayRange } from "./time";
import { orderKg, type ReportItem, type ReportRow } from "./sales-report";

const SOLD = ["confirmed", "preparing", "ready", "completed"] as const;
const PAGE_SIZE = 1000;
const ID_BATCH_SIZE = 250;

type AdminClient = SupabaseClient<Database>;

export async function loadSalesReportRows(
  supabase: AdminClient,
  from: string,
  to: string,
  timeZone: string,
): Promise<{ rows: ReportRow[]; error: string | null }> {
  const start = zonedDayRange(from, timeZone).start;
  const end = zonedDayRange(to, timeZone).end;
  const orders = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("order_summaries")
      .select("id, due_at, customer_phone, total_paise")
      .in("status", [...SOLD])
      .gte("due_at", start.toISOString())
      .lt("due_at", end.toISOString())
      .order("due_at")
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) return { rows: [], error: error.message };
    const batch = data ?? [];
    orders.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }

  const itemRows: (ReportItem & { order_id: string })[] = [];
  const cakes: { order_id: string; weight_kg: number }[] = [];
  for (let offset = 0; offset < orders.length; offset += ID_BATCH_SIZE) {
    const ids = orders.slice(offset, offset + ID_BATCH_SIZE).flatMap((order) => order.id ? [order.id] : []);
    if (ids.length === 0) continue;
    const [itemsResult, cakesResult] = await Promise.all([
      supabase.from("order_items").select("order_id, variant_name, quantity, cancelled_quantity").in("order_id", ids),
      supabase.from("custom_cakes").select("order_id, weight_kg").in("order_id", ids),
    ]);
    if (itemsResult.error) return { rows: [], error: itemsResult.error.message };
    if (cakesResult.error) return { rows: [], error: cakesResult.error.message };
    for (const item of itemsResult.data ?? []) {
      if (item.order_id) itemRows.push({ ...item, order_id: item.order_id });
    }
    for (const cake of cakesResult.data ?? []) {
      if (cake.order_id) cakes.push({ ...cake, order_id: cake.order_id });
    }
  }

  const itemsByOrder = new Map<string, ReportItem[]>();
  for (const item of itemRows) {
    itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) ?? []), item]);
  }
  const cakeKg = new Map(cakes.map((cake) => [cake.order_id, Number(cake.weight_kg)]));
  const rows = orders.flatMap((order) =>
    order.id && order.due_at
      ? [{
          id: order.id,
          date: zonedDayKey(order.due_at, timeZone),
          phone: order.customer_phone,
          kg: orderKg(itemsByOrder.get(order.id) ?? [], cakeKg.get(order.id) ?? null),
          pricePaise: order.total_paise ?? 0,
        }]
      : [],
  );
  return { rows, error: null };
}
