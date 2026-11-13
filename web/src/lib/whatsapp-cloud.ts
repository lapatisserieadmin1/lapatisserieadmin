// Quotations (owner, 2026-10-24) and the Terms and Conditions (2026-11-07) sent by the server through the
// WhatsApp Business (Cloud) API. Off until WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID are set.
// WhatsApp only lets a business start a chat (or write after 24 hours of silence) with a template Meta has
// approved, so the customer gets the template's words with the file, not the editable caption.
// Each template needs a DOCUMENT header (an IMAGE header for the PNG one) and one body variable, {{1}}, the
// order number. Never the customer's name. Pure apart from fetch: imported by unit tests.

export type CloudFormat = "pdf" | "png";
export type CloudDocument = "quotation" | "terms";

export type CloudConfig = {
  token: string;
  phoneNumberId: string;
  graphVersion: string;
  language: string;
  templates: Record<CloudFormat, string | null>;
  termsTemplates: Record<CloudFormat, string | null>;
  autoSendOnConfirm: boolean;
  graphBase: string;
  testMode: boolean;
};

type Env = Record<string, string | undefined>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// Local test mode (WHATSAPP_TEST_MODE=true, owner 2026-11-07): the whole Terms flow runs against the local
// stand-in for WhatsApp (npm run whatsapp:test), so nothing reaches a customer. Only a localhost address is
// accepted and never on Vercel; its sends are marked as tests.
function testGraphBase(env: Env): string | null {
  if (env.WHATSAPP_TEST_MODE?.trim().toLowerCase() !== "true" || env.VERCEL) return null;
  const raw = env.WHATSAPP_TEST_GRAPH_URL?.trim() || "http://localhost:4010";
  try {
    const url = new URL(raw);
    return url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname) ? url.origin : null;
  } catch {
    return null;
  }
}

export function whatsappCloudConfig(env: Env = process.env): CloudConfig | null {
  const testBase = testGraphBase(env);
  const token = env.WHATSAPP_TOKEN?.trim() || (testBase ? "local-test-token" : "");
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim() || (testBase ? "local-test-number" : "");
  if (!token || !phoneNumberId) return null;
  return {
    token,
    phoneNumberId,
    graphVersion: env.WHATSAPP_GRAPH_VERSION?.trim() || "v21.0",
    language: env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || "en",
    templates: {
      pdf: env.WHATSAPP_QUOTATION_TEMPLATE_PDF?.trim() || "quotation_pdf",
      png: env.WHATSAPP_QUOTATION_TEMPLATE_PNG?.trim() || "quotation_png",
    },
    termsTemplates: {
      pdf: env.WHATSAPP_TERMS_TEMPLATE_PDF?.trim() || "terms_pdf",
      png: env.WHATSAPP_TERMS_TEMPLATE_PNG?.trim() || "terms_image",
    },
    autoSendOnConfirm: !testBase && env.WHATSAPP_AUTO_SEND_ON_CONFIRM?.trim().toLowerCase() === "true",
    graphBase: testBase ?? "https://graph.facebook.com",
    testMode: Boolean(testBase),
  };
}

export function templateName(cfg: CloudConfig, format: CloudFormat, document: CloudDocument = "quotation"): string | null {
  return (document === "terms" ? cfg.termsTemplates : cfg.templates)[format];
}

export function cloudFormats(cfg: CloudConfig | null, document: CloudDocument = "quotation"): CloudFormat[] {
  if (!cfg) return [];
  return (["pdf", "png"] as const).filter((f) => templateName(cfg, f, document));
}

// What the send log shows as the message: the template's name and its one variable.
export function cloudLogCaption(cfg: CloudConfig, format: CloudFormat, reference: string): string {
  return `WhatsApp template "${cfg.templates[format]}" · order ${reference}`;
}

export function templateMessage(
  cfg: CloudConfig,
  m: { to: string; format: CloudFormat; mediaId: string; fileName: string; reference: string; document?: CloudDocument },
) {
  const header =
    m.format === "pdf"
      ? { type: "document", document: { id: m.mediaId, filename: m.fileName } }
      : { type: "image", image: { id: m.mediaId } };
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: m.to,
    type: "template",
    template: {
      name: templateName(cfg, m.format, m.document),
      language: { code: cfg.language },
      components: [
        { type: "header", parameters: [header] },
        { type: "body", parameters: [{ type: "text", text: m.reference }] },
      ],
    },
  };
}

export type CloudSendResult = { ok: true; messageId: string } | { ok: false; message: string };

type GraphError = { error?: { message?: string; code?: number; error_data?: { details?: string } } };

// Meta's reasons are about the account, template or number, never the order; shown to staff as they are.
function graphProblem(body: GraphError, fallback: string): string {
  const e = body.error;
  if (!e) return fallback;
  if (e.code === 190) return "The WhatsApp access token has expired or is wrong. Ask the admin to update WHATSAPP_TOKEN.";
  if (e.code === 132001) return "WhatsApp cannot find the message template. Check its name and language, and that Meta approved it.";
  if (e.code === 131026) return "This customer's number cannot receive WhatsApp messages.";
  const detail = e.error_data?.details || e.message;
  return detail ? `WhatsApp refused it: ${detail}` : fallback;
}

// Uploads the file to WhatsApp (so no link to our storage leaves the server), then sends the template.
export async function sendFileOnWhatsApp(
  cfg: CloudConfig,
  m: { to: string; format: CloudFormat; file: Buffer; fileName: string; contentType: string; reference: string; document?: CloudDocument },
  fetchImpl: typeof fetch = fetch,
): Promise<CloudSendResult> {
  if (!templateName(cfg, m.format, m.document)) return { ok: false, message: "Automatic sending is not set up for this format." };
  const base = `${cfg.graphBase}/${cfg.graphVersion}/${cfg.phoneNumberId}`;
  const auth = { Authorization: `Bearer ${cfg.token}` };
  try {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", m.contentType);
    form.append("file", new Blob([new Uint8Array(m.file)], { type: m.contentType }), m.fileName);
    const up = await fetchImpl(`${base}/media`, { method: "POST", headers: auth, body: form });
    const upBody = (await up.json().catch(() => ({}))) as GraphError & { id?: string };
    if (!up.ok || !upBody.id) return { ok: false, message: graphProblem(upBody, "WhatsApp did not accept the file.") };

    const res = await fetchImpl(`${base}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(templateMessage(cfg, { ...m, mediaId: upBody.id })),
    });
    const body = (await res.json().catch(() => ({}))) as GraphError & { messages?: { id?: string }[] };
    const messageId = body.messages?.[0]?.id;
    if (!res.ok || !messageId) return { ok: false, message: graphProblem(body, "WhatsApp did not send the message.") };
    return { ok: true, messageId };
  } catch {
    return { ok: false, message: "Could not reach WhatsApp. Check the connection and try again." };
  }
}
