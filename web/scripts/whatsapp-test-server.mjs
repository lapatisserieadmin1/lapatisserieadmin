// A local stand-in for Meta's WhatsApp Cloud API (owner, 2026-11-07), so the automatic Terms sending can be
// tried without a WhatsApp Business account and without messaging any customer. It accepts the file upload
// and the template message like Meta does, shows what the customer would get at http://localhost:4010, and
// then calls the app's webhook with "delivered" and "read", signed like Meta.
// Usage (from web/): npm run whatsapp:test, and in .env.local: WHATSAPP_TEST_MODE=true
import { createServer } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

const PORT = Number(process.env.WHATSAPP_TEST_PORT ?? 4010);
const APP = process.env.APP_URL ?? "http://localhost:3000";
const SECRET = process.env.WHATSAPP_APP_SECRET ?? "local-test-app-secret";
const OUTBOX = join(tmpdir(), "lapatisserie-whatsapp-test");
mkdirSync(OUTBOX, { recursive: true });

const media = new Map();
const messages = [];

const masked = (to) => (to.length > 6 ? `${to.slice(0, 2)}••••••${to.slice(-4)}` : to);
const json = (res, status, body) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

async function webhook(messageId, status) {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: messageId, status, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] });
  const sig = `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
  try {
    const r = await fetch(`${APP}/api/whatsapp/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig }, body });
    const m = messages.find((x) => x.id === messageId);
    if (m && r.ok) m.status = status;
    console.log(`  webhook ${status.padEnd(9)} → ${r.status}`);
  } catch (e) {
    console.log(`  webhook ${status} failed: ${e.message}`);
  }
}

function page() {
  const rows = messages.slice().reverse().map((m) => {
    const ticks = m.status === "read" ? '<span style="color:#34b7f1">✓✓ Read</span>' : m.status === "delivered" ? "✓✓ Delivered" : "✓ Sent";
    const file = m.format === "pdf"
      ? `<a href="/files/${encodeURIComponent(m.file)}" target="_blank">📄 ${esc(m.fileName)}</a>`
      : `<a href="/files/${encodeURIComponent(m.file)}" target="_blank"><img src="/files/${encodeURIComponent(m.file)}" alt="" style="max-width:220px;border-radius:8px;display:block"></a>`;
    return `<div class="msg"><div class="to">To ${esc(masked(m.to))} · template <b>${esc(m.template)}</b> · order ${esc(m.reference)}</div>${file}<div class="meta">${new Date(m.at).toLocaleTimeString("en-IN")} · ${ticks}</div></div>`;
  }).join("");
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>WhatsApp test phone</title>
<style>body{font-family:system-ui;background:#e5ddd5;margin:0}header{background:#075e54;color:#fff;padding:14px 18px;font-weight:600}
main{max-width:560px;margin:0 auto;padding:16px;display:flex;flex-direction:column;gap:10px}.msg{background:#dcf8c6;border-radius:10px;padding:10px 12px;align-self:flex-end;box-shadow:0 1px 1px #0002}
.to{font-size:12px;color:#555;margin-bottom:6px}.meta{font-size:12px;color:#666;text-align:right;margin-top:6px}a{color:#075e54}.empty{color:#555;text-align:center;margin-top:40px}</style>
<header>WhatsApp test phone (local, nothing goes to customers)</header><main>${rows || '<p class="empty">No messages yet. Confirm a cake order or press "Send Terms on WhatsApp now" in the admin.</p>'}</main>`;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.method === "GET" && url.pathname === "/") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(page()); }
  if (req.method === "GET" && url.pathname.startsWith("/files/")) {
    const name = basename(decodeURIComponent(url.pathname.slice(7)));
    const path = join(OUTBOX, name);
    if (!existsSync(path)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": name.endsWith(".pdf") ? "application/pdf" : "image/png" });
    return res.end(readFileSync(path));
  }
  if (req.method !== "POST") { res.writeHead(404); return res.end(); }
  if (!req.headers.authorization?.startsWith("Bearer ")) return json(res, 401, { error: { message: "Missing access token", code: 190 } });

  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);

  if (url.pathname.endsWith("/media")) {
    const form = await new Request(url, { method: "POST", headers: { "content-type": req.headers["content-type"] }, body }).formData();
    const file = form.get("file");
    if (!(file instanceof Blob)) return json(res, 400, { error: { message: "No file" } });
    const id = `media-${randomUUID()}`;
    const fileName = basename(file.name || "file");
    const saved = `${id}-${fileName}`;
    writeFileSync(join(OUTBOX, saved), Buffer.from(await file.arrayBuffer()));
    media.set(id, { saved, fileName });
    console.log(`media   ${fileName} (${file.size} bytes)`);
    return json(res, 200, { id });
  }
  if (url.pathname.endsWith("/messages")) {
    const msg = JSON.parse(body.toString("utf8"));
    const header = msg.template?.components?.find((c) => c.type === "header")?.parameters?.[0];
    const mediaId = header?.document?.id ?? header?.image?.id;
    const file = media.get(mediaId);
    if (!msg.to || !msg.template?.name || !file) return json(res, 400, { error: { message: "Template, number or media missing", code: 100 } });
    const reference = msg.template.components.find((c) => c.type === "body")?.parameters?.[0]?.text ?? "";
    const id = `wamid.test-${randomUUID()}`;
    messages.push({ id, to: msg.to, template: msg.template.name, reference, format: header.document ? "pdf" : "png", file: file.saved, fileName: file.fileName, at: Date.now(), status: "sent" });
    console.log(`message ${msg.template.name} → ${masked(msg.to)} · order ${reference}`);
    setTimeout(() => webhook(id, "delivered"), 1500);
    setTimeout(() => webhook(id, "read"), 4000);
    return json(res, 200, { messaging_product: "whatsapp", contacts: [{ input: msg.to, wa_id: msg.to }], messages: [{ id }] });
  }
  res.writeHead(404);
  res.end();
}).listen(PORT, () => {
  console.log(`WhatsApp test server on http://localhost:${PORT} (files in ${OUTBOX})`);
  console.log(`Sends delivery updates to ${APP}/api/whatsapp/webhook`);
});
