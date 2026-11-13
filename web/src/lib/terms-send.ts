import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { isCakeOrder } from "@/lib/cake-order";
import { renderTermsPdf, renderTermsPng, termsFileName } from "@/lib/terms-file";
import { whatsappNumber } from "@/lib/whatsapp";
import { cloudFormats, sendFileOnWhatsApp, whatsappCloudConfig, type CloudFormat } from "@/lib/whatsapp-cloud";

type Client = SupabaseClient<Database>;

export type TermsSendOutcome = { ok: true; skipped?: string } | { ok: false; message: string };

async function cakeOrder(supabase: Client, orderId: string): Promise<boolean> {
  const [{ count }, { data: items }] = await Promise.all([
    supabase.from("custom_cakes").select("id", { count: "exact", head: true }).eq("order_id", orderId),
    supabase.from("order_items").select("category_id, quantity, cancelled_quantity").eq("order_id", orderId),
  ]);
  const categoryIds = [...new Set((items ?? []).filter((i) => i.quantity > i.cancelled_quantity).map((i) => i.category_id).filter((v): v is string => Boolean(v)))];
  const { data: categories } = categoryIds.length
    ? await supabase.from("categories").select("name").in("id", categoryIds)
    : { data: [] };
  return isCakeOrder({ hasCustomCake: (count ?? 0) > 0, itemCategories: (categories ?? []).map((c) => c.name) });
}

// Sends the Terms and Conditions, as a PDF and as an image, to the customer's WhatsApp from the server and
// records each attempt on the order (owner, 2026-11-07). On confirming, only cake orders get them, once;
// staff can send them again from the order page.
export async function sendTermsFromServer(
  supabase: Client,
  orderId: string,
  opts: { automatic: boolean; formats?: CloudFormat[] },
): Promise<TermsSendOutcome> {
  const cfg = whatsappCloudConfig();
  if (!cfg) return { ok: false, message: "Automatic WhatsApp sending is not set up." };

  const { data: order, error } = await supabase.from("orders").select("reference, customer_phone").eq("id", orderId).maybeSingle();
  if (error || !order || !order.reference) return { ok: false, message: "Order not found." };
  const reference = order.reference;
  const to = whatsappNumber(order.customer_phone);
  if (!to) return { ok: false, message: "The order has no WhatsApp number for the customer." };

  if (opts.automatic) {
    if (!(await cakeOrder(supabase, orderId))) return { ok: true, skipped: "Not a cake order." };
    const { count } = await supabase.from("terms_sends").select("id", { count: "exact", head: true }).eq("order_id", orderId).eq("status", "sent").eq("test_mode", cfg.testMode);
    if ((count ?? 0) > 0) return { ok: true, skipped: "Already sent." };
  }

  const problems: string[] = [];
  for (const format of cloudFormats(cfg, "terms").filter((f) => !opts.formats || opts.formats.includes(f))) {
    let sent: { ok: true; messageId: string } | { ok: false; message: string };
    try {
      const file = format === "pdf" ? await renderTermsPdf(reference) : await renderTermsPng(reference);
      sent = await sendFileOnWhatsApp(cfg, {
        to,
        format,
        file,
        fileName: termsFileName(reference, format),
        contentType: format === "pdf" ? "application/pdf" : "image/png",
        reference,
        document: "terms",
      });
    } catch (e) {
      console.error("terms render failed", format, e);
      sent = { ok: false, message: "Could not make the Terms file." };
    }
    const { error: logError } = await supabase.rpc("record_terms_send", {
      p_order_id: orderId,
      p_format: format,
      p_status: sent.ok ? "sent" : "failed",
      p_message_id: sent.ok ? sent.messageId : null,
      p_problem: sent.ok ? null : sent.message.slice(0, 500),
      p_test: cfg.testMode,
    });
    if (logError) console.error("terms send not recorded", logError.code, logError.message);
    if (!sent.ok) problems.push(sent.message);
  }
  return problems.length ? { ok: false, message: problems[0] } : { ok: true };
}
