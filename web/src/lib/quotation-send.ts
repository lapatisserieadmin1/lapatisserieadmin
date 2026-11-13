import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { loadQuotation } from "@/lib/quotation-server";
import { quotationFileName, quotationView } from "@/lib/quotation";
import { renderQuotationPdf } from "@/lib/quotation-pdf";
import { renderQuotationPng } from "@/lib/quotation-png";
import { whatsappNumber } from "@/lib/whatsapp";
import { cloudLogCaption, sendFileOnWhatsApp, whatsappCloudConfig, type CloudFormat } from "@/lib/whatsapp-cloud";

type Client = SupabaseClient<Database>;
type Failure = { ok: false; status: 400 | 403 | 404 | 500; message: string };

export type QuotationFile = {
  ok: true;
  file: Buffer;
  path: string;
  fileName: string;
  contentType: string;
  reference: string;
};

// The customer's quotation file, fresh from the order as it is now, stored privately in the quotations
// bucket. Only the full version (with amounts) is ever made into a file: the database decides the version
// from the signed-in staff member, and a price-free one is refused here as well.
export async function makeQuotationFile(supabase: Client, orderId: string, format: CloudFormat): Promise<QuotationFile | Failure> {
  const result = await loadQuotation(supabase, orderId);
  if (!result.ok) return result;
  if (result.quotation.mode !== "full" || !result.quotation.amounts) {
    return { ok: false, status: 403, message: "Only the full Order in msg can be sent." };
  }

  let file: Buffer;
  try {
    const view = quotationView(result.quotation);
    file = format === "pdf" ? await renderQuotationPdf(view) : await renderQuotationPng(view);
  } catch (e) {
    console.error("quotation render failed", format, e);
    return { ok: false, status: 500, message: "Could not make the Order in msg file. Try again." };
  }

  const contentType = format === "pdf" ? "application/pdf" : "image/png";
  const path = `${orderId}/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.${format}`;
  const upload = await supabase.storage.from("quotations").upload(path, file, { contentType, upsert: false });
  if (upload.error) {
    console.error("quotation upload failed", upload.error.message);
    return { ok: false, status: 500, message: "Could not save the Order in msg file. Try again." };
  }
  const reference = result.quotation.order.reference;
  return { ok: true, file, path, fileName: quotationFileName(reference, format), contentType, reference };
}

export type CloudSendOutcome = { ok: true } | { ok: false; message: string };

// Sends the quotation to the customer's WhatsApp from the server and records it on the order, sent or failed.
export async function sendQuotationFromServer(supabase: Client, orderId: string, format: CloudFormat): Promise<CloudSendOutcome> {
  const cfg = whatsappCloudConfig();
  if (!cfg || !cfg.templates[format]) return { ok: false, message: "Automatic WhatsApp sending is not set up." };

  const { data: order, error } = await supabase.from("orders").select("customer_phone").eq("id", orderId).maybeSingle();
  if (error || !order) return { ok: false, message: "Order not found." };
  const to = whatsappNumber(order.customer_phone);
  if (!to) return { ok: false, message: "The order has no WhatsApp number for the customer." };

  const made = await makeQuotationFile(supabase, orderId, format);
  if (!made.ok) return { ok: false, message: made.message };

  const sent = await sendFileOnWhatsApp(cfg, { to, format, file: made.file, fileName: made.fileName, contentType: made.contentType, reference: made.reference });
  const { error: logError } = await supabase.rpc("record_quotation_send", {
    p_order_id: orderId,
    p_format: format,
    p_channel: "cloud_api",
    p_status: sent.ok ? "sent" : "failed",
    p_file_path: made.path,
    p_caption: `${cfg.testMode ? "TEST (local WhatsApp test phone) · " : ""}${cloudLogCaption(cfg, format, made.reference)}`,
    p_message_id: sent.ok ? sent.messageId : undefined,
  });
  if (logError) console.error("quotation send not recorded", logError.code, logError.message);
  if (!sent.ok) return sent;
  return logError ? { ok: false, message: "Sent on WhatsApp, but not recorded on the order." } : { ok: true };
}
