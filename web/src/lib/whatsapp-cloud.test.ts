import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudFormats, cloudLogCaption, templateMessage, sendFileOnWhatsApp, whatsappCloudConfig } from "./whatsapp-cloud.ts";

const env = { WHATSAPP_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "12345" };

test("automatic sending is off until the token and phone number id are set", () => {
  assert.equal(whatsappCloudConfig({}), null);
  assert.equal(whatsappCloudConfig({ WHATSAPP_TOKEN: "tok" }), null);
  assert.equal(whatsappCloudConfig({ WHATSAPP_TOKEN: " ", WHATSAPP_PHONE_NUMBER_ID: "1" }), null);
  assert.deepEqual(cloudFormats(null), []);

  const cfg = whatsappCloudConfig(env)!;
  assert.equal(cfg.templates.pdf, "quotation_pdf");
  assert.equal(cfg.templates.png, "quotation_png");
  assert.equal(cfg.language, "en");
  assert.equal(cfg.autoSendOnConfirm, false);
  assert.deepEqual(cloudFormats(cfg), ["pdf", "png"]);

  const all = whatsappCloudConfig({ ...env, WHATSAPP_QUOTATION_TEMPLATE_PNG: "bill_image", WHATSAPP_AUTO_SEND_ON_CONFIRM: "TRUE" })!;
  assert.equal(all.templates.png, "bill_image");
  assert.equal(all.autoSendOnConfirm, true);
});

test("the template carries the file and the order number, never the customer's name", () => {
  const cfg = whatsappCloudConfig({ ...env, WHATSAPP_QUOTATION_TEMPLATE_PNG: "quotation_png" })!;
  const pdf = templateMessage(cfg, { to: "919840000001", format: "pdf", mediaId: "m1", fileName: "LaPatisserie-Quotation-AB-1.pdf", reference: "AB-1" });
  assert.equal(pdf.to, "919840000001");
  assert.equal(pdf.template.name, "quotation_pdf");
  assert.deepEqual(pdf.template.components, [
    { type: "header", parameters: [{ type: "document", document: { id: "m1", filename: "LaPatisserie-Quotation-AB-1.pdf" } }] },
    { type: "body", parameters: [{ type: "text", text: "AB-1" }] },
  ]);
  const png = templateMessage(cfg, { to: "919840000001", format: "png", mediaId: "m2", fileName: "x.png", reference: "AB-1" });
  assert.equal(png.template.name, "quotation_png");
  assert.deepEqual(png.template.components[0], { type: "header", parameters: [{ type: "image", image: { id: "m2" } }] });
  assert.equal(cloudLogCaption(cfg, "pdf", "AB-1"), 'WhatsApp template "quotation_pdf" · order AB-1');
});

test("the Terms go as their own PDF and image templates, with the order number", () => {
  const cfg = whatsappCloudConfig(env)!;
  assert.deepEqual(cloudFormats(cfg, "terms"), ["pdf", "png"]);
  const custom = whatsappCloudConfig({ ...env, WHATSAPP_TERMS_TEMPLATE_PDF: "tc_doc", WHATSAPP_TERMS_TEMPLATE_PNG: "tc_img" })!;
  const pdf = templateMessage(custom, { to: "919840000001", format: "pdf", mediaId: "m1", fileName: "Terms-AB-1.pdf", reference: "AB-1", document: "terms" });
  assert.equal(pdf.template.name, "tc_doc");
  assert.deepEqual(pdf.template.components[1], { type: "body", parameters: [{ type: "text", text: "AB-1" }] });
  const png = templateMessage(custom, { to: "919840000001", format: "png", mediaId: "m2", fileName: "x.png", reference: "AB-1", document: "terms" });
  assert.equal(png.template.name, "tc_img");
  assert.deepEqual(png.template.components[0], { type: "header", parameters: [{ type: "image", image: { id: "m2" } }] });
});

function fakeFetch(replies: { status: number; body: unknown }[]) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const r = replies.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const message = { to: "919840000001", format: "pdf" as const, file: Buffer.from("%PDF"), fileName: "q.pdf", contentType: "application/pdf", reference: "AB-1" };

test("the file is uploaded to WhatsApp first, then the template is sent with it", async () => {
  const cfg = whatsappCloudConfig(env)!;
  const { impl, calls } = fakeFetch([
    { status: 200, body: { id: "media-1" } },
    { status: 200, body: { messages: [{ id: "wamid.1" }] } },
  ]);
  assert.deepEqual(await sendFileOnWhatsApp(cfg, message, impl), { ok: true, messageId: "wamid.1" });
  assert.equal(calls[0].url, "https://graph.facebook.com/v21.0/12345/media");
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, "Bearer tok");
  assert.ok(calls[0].init?.body instanceof FormData);
  assert.equal(calls[1].url, "https://graph.facebook.com/v21.0/12345/messages");
  const sent = JSON.parse(String(calls[1].init?.body));
  assert.equal(sent.template.components[0].parameters[0].document.id, "media-1");
});

test("WhatsApp's refusals become plain messages for staff", async () => {
  const cfg = whatsappCloudConfig(env)!;
  const expired = fakeFetch([{ status: 401, body: { error: { code: 190, message: "Session has expired" } } }]);
  const r1 = await sendFileOnWhatsApp(cfg, message, expired.impl);
  assert.equal(r1.ok, false);
  assert.match(!r1.ok ? r1.message : "", /access token/);
  assert.equal(expired.calls.length, 1);

  const noTemplate = fakeFetch([
    { status: 200, body: { id: "media-1" } },
    { status: 404, body: { error: { code: 132001, message: "Template name does not exist" } } },
  ]);
  const r2 = await sendFileOnWhatsApp(cfg, message, noTemplate.impl);
  assert.match(!r2.ok ? r2.message : "", /template/);

  const offline = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  const r3 = await sendFileOnWhatsApp(cfg, message, offline);
  assert.match(!r3.ok ? r3.message : "", /Could not reach WhatsApp/);

  const r4 = await sendFileOnWhatsApp({ ...cfg, templates: { ...cfg.templates, png: null } }, { ...message, format: "png" }, offline);
  assert.match(!r4.ok ? r4.message : "", /not set up/);
});

test("test mode: only the local stand-in, never on Vercel, never auto-sent quotations", () => {
  const t = whatsappCloudConfig({ WHATSAPP_TEST_MODE: "true", WHATSAPP_AUTO_SEND_ON_CONFIRM: "true" })!;
  assert.equal(t.testMode, true);
  assert.equal(t.graphBase, "http://localhost:4010");
  assert.equal(t.autoSendOnConfirm, false);
  assert.deepEqual(cloudFormats(t, "terms"), ["pdf", "png"]);
  assert.deepEqual(cloudFormats(t, "quotation"), ["pdf", "png"]);
  assert.equal(whatsappCloudConfig({ WHATSAPP_TEST_MODE: "true", VERCEL: "1" }), null);
  assert.equal(whatsappCloudConfig({ WHATSAPP_TEST_MODE: "true", WHATSAPP_TEST_GRAPH_URL: "https://graph.facebook.com" }), null);
  assert.equal(whatsappCloudConfig({ WHATSAPP_TEST_MODE: "true", WHATSAPP_TEST_GRAPH_URL: "http://evil.example" }), null);
  const real = whatsappCloudConfig({ WHATSAPP_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "1" })!;
  assert.equal(real.testMode, false);
  assert.equal(real.graphBase, "https://graph.facebook.com");
});
