import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { parseQuotation, type Quotation } from "@/lib/quotation";

export type QuotationResult = { ok: true; quotation: Quotation } | { ok: false; status: 403 | 404 | 500; message: string };

// Reads the quotation as the signed-in staff member: the database decides full or price-free.
export async function loadQuotation(supabase: SupabaseClient<Database>, orderId: string): Promise<QuotationResult> {
  const { data, error } = await supabase.rpc("order_quotation", { p_order_id: orderId });
  if (error) {
    if (error.code === "P0001" && error.hint === "forbidden") return { ok: false, status: 403, message: error.message };
    if (error.code === "P0001" && error.hint === "not_found") return { ok: false, status: 404, message: error.message };
    if (error.code === "42501") return { ok: false, status: 403, message: "You do not have access to the Order in msg." };
    console.error("order_quotation failed", error.code, error.message);
    return { ok: false, status: 500, message: "Could not load the Order in msg." };
  }
  try {
    return { ok: true, quotation: parseQuotation(data) };
  } catch (e) {
    console.error("order_quotation returned an unexpected shape", e);
    return { ok: false, status: 500, message: "Could not read the Order in msg." };
  }
}
