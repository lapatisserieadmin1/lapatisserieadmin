// End-to-end walk through the daily workflows with the four staff logins (2026-10-24): website order →
// confirm, call order → payment → pack → handover → bill, custom cake → quotation file → send log →
// sticky note, and both kitchen screens (own orders only, never prices). It commits test orders
// (customer phones 90000 999xx), so run it against a demo or staging project.
// Needs: `npm run build && npm start -- -p 3100`; passwords in .admin-password.txt (or E2E_PASSWORDS_FILE).
// Usage (from web/): npm run e2e:workflow
import { createServerClient } from "@supabase/ssr";
import { readFileSync } from "node:fs";

const m = JSON.parse(readFileSync("./.next/server/server-reference-manifest.json", "utf8"));
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, APP = process.env.APP_URL ?? "http://localhost:3100";
const passwords = readFileSync(process.env.E2E_PASSWORDS_FILE ?? ".admin-password.txt", "utf8");
const passwordFor = (email) => passwords.split("\n").find((l) => l.includes(email))?.trim().split(/\s+/).pop();
const actionId = (name) => Object.entries(m.node).find(([, v]) => v.exportedName === name)[0];
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
process.on("uncaughtException", (e) => { console.log(results.join("\n")); console.error("\nStopped:", e); process.exit(1); });

async function login(email) {
  const jar = new Map();
  const sb = createServerClient(URL_, KEY, { cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (cs) => cs.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
  }});
  const { error } = await sb.auth.signInWithPassword({ email, password: passwordFor(email) });
  if (error) throw new Error(`${email}: ${error.message}`);
  return { sb, cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; ") };
}
async function page(path, cookie = "") {
  const r = await fetch(APP + path, { headers: { cookie }, redirect: "manual" });
  return { status: r.status, location: r.headers.get("location"), body: r.status === 200 ? await r.text() : "" };
}
async function act(name, path, arg, cookie) {
  const r = await fetch(APP + path, { method: "POST", headers: { cookie, "Next-Action": actionId(name), "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" }, body: JSON.stringify(Array.isArray(arg) ? arg : [arg]) });
  const text = await r.text();
  const line = text.split("\n").find((l) => l.startsWith("1:"));
  try { return JSON.parse(line.slice(2)); } catch { return { raw: text.slice(0, 300), status: r.status }; }
}
async function quotationFile(orderId, format, cookie) {
  const r = await fetch(`${APP}/api/orders/${orderId}/quotation`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ format }) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
// Rupee amounts appear as "₹" in every staff page that shows money.
const hasPrice = (html) => html.includes("₹");
const istDay = (offset) => new Date(Date.now() + 5.5 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
const tomorrow = istDay(1), later = istDay(2);
const tag = String(Date.now()).slice(-5);

const admin = await login("admin@auri.test");
const counter = await login("counter@auri.test");
const chef1 = await login("kitchen1@auri.test");
const chef2 = await login("kitchen2@auri.test");

const variant = async (product, name) => (await admin.sb.from("product_variants").select("id, products!inner(name)").ilike("products.name", product).ilike("name", name).is("archived_at", null).limit(1).single()).data?.id;
const blackForest = await variant("Black Forest%", "500%");
const vegPuff = await variant("Veg Puff%", "%");
check("catalogue variants found", Boolean(blackForest && vegPuff), `${blackForest} ${vegPuff}`);

// --- Admin pages ---------------------------------------------------------------------------------
for (const path of ["/admin", "/admin/orders", "/admin/calendar", "/admin/calendar?kind=custom", "/admin/products", "/admin/staff", "/admin/customers", "/admin/reports", "/admin/settings", "/admin/sales-report", "/admin/reviews", "/admin/gallery", "/admin/notifications", "/admin/orders/new?source=CALL", "/admin/orders/new-cake"]) {
  const p = await page(path, admin.cookie);
  check(`admin page ${path}`, p.status === 200, `status ${p.status} ${p.location ?? ""}`);
}

// --- Website order → confirm --------------------------------------------------------------------
let r = await fetch(`${APP}/api/site/order`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
  idempotencyKey: crypto.randomUUID(), name: `E2E Web ${tag}`, phone: "9000099902", date: later, time: "16:00", orderType: "birthday",
  message: "Write Happy Birthday Meera", items: [{ variantId: blackForest, quantity: 1 }], fulfilment: "collect",
}) }).then((x) => x.json());
check("website order accepted", r.ok === true && /^B-\d+/.test(r.reference ?? ""), JSON.stringify(r));
let web = (await admin.sb.from("orders").select("id, reference, status, version, source, kitchen_id, customer_notes").eq("reference", r.reference).single()).data;
check("website order is Online, waiting for confirmation, message kept", web?.source === "ONLINE" && web.status === "pending_confirmation" && /Happy Birthday Meera/.test(web.customer_notes ?? ""), JSON.stringify(web));
r = await act("confirmOrderAction", `/admin/orders/${web.id}`, { orderId: web.id, version: web.version }, admin.cookie);
check("admin confirms website order", r.ok === true, JSON.stringify(r));
web = (await admin.sb.from("orders").select("id, reference, status, version").eq("id", web.id).single()).data;
check("website order confirmed", web.status === "confirmed", web.status);

// --- Call order → payment → pack → handover → bill ----------------------------------------------
r = await act("createOrderAction", "/admin/orders/new", { idempotencyKey: crypto.randomUUID(), source: "CALL", items: [{ variantId: blackForest, quantity: 1, notes: "Less cream" }, { variantId: vegPuff, quantity: 4 }],
  customerName: `E2E Call ${tag}`, customerPhone: "9000099903", dueLocal: `${tomorrow}T12:00`, confirm: true, fulfilment: "collect", setupAddress: "7 Lake View Road, T Nagar", setupNote: "Opposite the temple" }, admin.cookie);
check("admin creates confirmed call order", r.ok === true, JSON.stringify(r));
const callId = r.orderId;
let call = (await admin.sb.from("order_summaries").select("*").eq("id", callId).single()).data;
const callPage = await page(`/admin/orders/${callId}`, counter.cookie);
check("Pickup/Cab order keeps the customer's address and landmark, with a map link",
  callPage.status === 200 && callPage.body.includes("7 Lake View Road, T Nagar") && callPage.body.includes("Landmark: Opposite the temple") && callPage.body.includes("google.com/maps/search"), `status ${callPage.status}`);
check("a menu cake (Black Forest) makes it a cake order that gets the Terms automatically", (callPage.body.includes("when this cake order is confirmed") || callPage.body.includes("WhatsApp as a file (PDF or image), or download them")), `status ${callPage.status}`);
check("call order totals", call?.total_paise > 0 && call.balance_paise === call.total_paise, `total ${call?.total_paise} balance ${call?.balance_paise}`);
r = await act("recordPaymentAction", `/admin/orders/${callId}`, { orderId: callId, idempotencyKey: crypto.randomUUID(), kind: "payment", method: "upi", amount: "200", reference: "UPI-E2E" }, counter.cookie);
check("counter records advance", r.ok === true, JSON.stringify(r));
call = (await admin.sb.from("order_summaries").select("*").eq("id", callId).single()).data;
r = await act("markPackedAction", `/admin/orders/${callId}`, { orderId: callId, version: call.version }, counter.cookie);
check("counter marks packed", r.ok === true, JSON.stringify(r));
call = (await admin.sb.from("order_summaries").select("*").eq("id", callId).single()).data;
check("packed order is ready", call.status === "ready", call.status);
r = await act("recordHandoverAction", `/admin/orders/${callId}`, { orderId: callId, version: call.version, collectedBy: "Customer" }, counter.cookie);
check("handover with balance due is refused", r.ok !== true, r.message);
r = await act("recordPaymentAction", `/admin/orders/${callId}`, { orderId: callId, idempotencyKey: crypto.randomUUID(), kind: "payment", method: "cash", amount: String(call.balance_paise / 100) }, counter.cookie);
check("counter takes the balance", r.ok === true, JSON.stringify(r));
call = (await admin.sb.from("order_summaries").select("*").eq("id", callId).single()).data;
r = await act("recordHandoverAction", `/admin/orders/${callId}`, { orderId: callId, version: call.version, collectedBy: "Customer" }, counter.cookie);
check("counter hands over", r.ok === true, JSON.stringify(r));
call = (await admin.sb.from("order_summaries").select("*").eq("id", callId).single()).data;
check("order completed and paid", call.status === "completed" && call.balance_paise === 0, `${call.status} balance ${call.balance_paise}`);
let bill = (await admin.sb.from("bills").select("id").eq("order_id", callId).maybeSingle()).data;
if (!bill) {
  r = await act("issueBillAction", `/admin/orders/${callId}`, callId, counter.cookie);
  check("counter issues bill", r.ok === true, JSON.stringify(r));
  bill = (await admin.sb.from("bills").select("id").eq("order_id", callId).maybeSingle()).data;
}
let p = await page(`/print/bill/${bill?.id}`, counter.cookie);
check("bill prints with shop details and no GST", p.status === 200 && p.body.includes(call.reference) && p.body.includes("Korattur") && p.body.includes("La Patisserie") && !/GST|TAX INVOICE/.test(p.body), `status ${p.status}`);
check("bill prints the Terms and Conditions", ["TERMS AND CONDITIONS", "Delivery Arrangement", "Cake Supports &amp; Decorations", "UPI / GPay: 9884882516"].every((t) => p.body.includes(t)), `status ${p.status}`);

// --- Custom cake → quotation → send log → sticky note -------------------------------------------
r = await act("createCustomCakeOrderAction", "/admin/orders/new-cake", { idempotencyKey: crypto.randomUUID(), source: "CALL", customerName: `E2E Cake ${tag}`, customerPhone: "9000099904",
  dueLocal: `${tomorrow}T17:00`, price: "2500", advance: "1000", advanceMethod: "upi", confirm: true, fulfilment: "setup", setupAddress: "12 Anna Nagar, Chennai", internalNotes: "Use the gold cake stand",
  cake: { flavour: "Rasmalai", weightKg: "1.5", tiers: "1", theme: "Floral", message: "Happy Birthday Anu", isEggless: true, cupcakeCount: "6", popsicleCount: "0", setupCharge: "500", deliveryCharge: "200", hasAddon: true, addonDetails: "Gold balloons", addonCharge: "300" } }, admin.cookie);
check("admin creates confirmed custom cake order", r.ok === true, JSON.stringify(r));
const cakeId = r.orderId;
const cake = (await admin.sb.from("order_summaries").select("*").eq("id", cakeId).single()).data;
if (process.env.WHATSAPP_TEST_MODE === "true") {
  // Needs the WhatsApp stand-in (npm run whatsapp:test) and the dev server it reports delivery to.
  let sends = [];
  for (let i = 0; i < 20 && !(sends.length === 2 && sends.every((s) => s.delivery_status === "read")); i++) {
    await new Promise((ok) => setTimeout(ok, 1000));
    sends = (await admin.sb.from("terms_sends").select("format, status, test_mode, delivery_status").eq("order_id", cakeId)).data ?? [];
  }
  check("confirming a cake order sends the Terms PDF and image through the Cloud API (test mode), marked as tests",
    sends.length === 2 && sends.every((s) => s.status === "sent" && s.test_mode) && new Set(sends.map((s) => s.format)).size === 2, JSON.stringify(sends));
  check("WhatsApp's delivered and read reach the order through the signed webhook", sends.every((s) => s.delivery_status === "read"), JSON.stringify(sends));
  const unsigned = await fetch(`${APP}/api/whatsapp/webhook`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entry: [] }) });
  const forged = await fetch(`${APP}/api/whatsapp/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": "sha256=" + "0".repeat(64) }, body: "{}" });
  check("webhook refuses unsigned and wrongly signed calls", unsigned.status === 403 && forged.status === 403, `${unsigned.status}/${forged.status}`);

  const sheet = await page(`/print/cake/${cakeId}`, counter.cookie);
  check("cake sheet offers one tap: bill and Terms to the customer's WhatsApp, image or PDF",
    sheet.status === 200 && sheet.body.includes("Send the bill and Terms to the customer") && sheet.body.includes("+91 90000 99904"), `status ${sheet.status}`);
  const both = await act("sendBillAndTermsAction", `/print/cake/${cakeId}`, { orderId: cakeId, format: "png" }, counter.cookie);
  const billSends = (await admin.sb.from("quotation_sends").select("format, channel, status").eq("order_id", cakeId).eq("channel", "cloud_api")).data ?? [];
  const pngTerms = (await admin.sb.from("terms_sends").select("format").eq("order_id", cakeId).eq("format", "png")).data ?? [];
  check("one tap sends the bill image and the Terms image to the customer's number",
    both.ok === true && billSends.some((s) => s.format === "png" && s.status === "sent") && pngTerms.length === 2, `${JSON.stringify(both)} bill ${JSON.stringify(billSends)} terms png ${pngTerms.length}`);
}
check("custom cake total = price + set-up + delivery + add-on, advance paid", cake?.total_paise === 350000 && cake.balance_paise === 250000, `total ${cake?.total_paise} balance ${cake?.balance_paise}`);
p = await page(`/admin/orders/${cakeId}`, counter.cookie);
check("order page offers the bill and Terms to the customer's WhatsApp in one tap, with or without WhatsApp Business",
  p.body.includes("Send the bill and Terms to the customer") && p.body.includes("+91 90000 99904"), `status ${p.status}`);
check("order page shows cupcakes and add-on, without the message and Order in msg cards", p.status === 200 && /Cupcakes.{0,80}>6</.test(p.body) && p.body.includes("Gold balloons") && !p.body.includes("Message the customer") && !p.body.includes("Open Order in msg"), `status ${p.status}`);
check("order page: Terms sent automatically for the cake, plus PDF/PNG download and send to the customer's chat",
  !p.body.includes("not set up yet") && /Send Terms on WhatsApp|Opens the chat of the customer who placed the order/.test(p.body) && p.body.includes(`/api/terms?format=pdf&amp;ref=${cake.reference}`) &&
  p.body.includes(`/api/terms?format=png&amp;ref=${cake.reference}`) && p.body.includes("Food Colours"), `status ${p.status}`);
p = await page("/admin/orders/new-cake", counter.cookie);
check("cake form: Internal notes come right after Special instructions, not in Pickup/Set-up",
  p.status === 200 && p.body.indexOf("Internal notes (staff only)") > p.body.indexOf("Special instructions") && p.body.indexOf("Internal notes (staff only)") < p.body.indexOf("Price and advance"), `status ${p.status}`);
{
  const pub = await fetch(`${APP}/terms/${cake.reference}`, { redirect: "manual" });
  const bad = await fetch(`${APP}/terms/..%2Fetc`, { redirect: "manual" });
  check("the Terms link sent on WhatsApp opens the PDF without signing in; odd references are refused",
    pub.status === 200 && pub.headers.get("content-type") === "application/pdf" && (await pub.arrayBuffer()).byteLength > 1000 && bad.status === 404, `status ${pub.status} ${bad.status}`);
}
p = await page(`/admin/orders/${cakeId}`, counter.cookie);
for (const format of ["png", "pdf"]) {
  const t = await fetch(`${APP}/api/terms?format=${format}&ref=${cake.reference}`, { headers: { cookie: counter.cookie } });
  const bytes = (await t.arrayBuffer()).byteLength;
  check(`terms ${format.toUpperCase()} file is made`, t.status === 200 && t.headers.get("content-type") === (format === "pdf" ? "application/pdf" : "image/png") && bytes > 20000 && (t.headers.get("content-disposition") ?? "").includes(cake.reference), `${t.status} ${bytes} bytes`);
}
let q = await quotationFile(cakeId, "pdf", counter.cookie);
check("counter makes Order in msg PDF", q.status === 200 && q.body.fileName === `LaPatisserieMadras-Order-in-msg-${cake.reference}.pdf`, JSON.stringify(q.body).slice(0, 200));
if (q.body.url) {
  const bytes = Buffer.from(await (await fetch(q.body.url)).arrayBuffer());
  check("signed link returns a PDF", bytes.subarray(0, 4).toString() === "%PDF", `${bytes.length} bytes`);
  r = await act("recordQuotationSendAction", `/admin/orders/${cakeId}`, { orderId: cakeId, format: "pdf", channel: "download_and_chat", path: q.body.path, caption: `Order in msg ${cake.reference}` }, counter.cookie);
  check("quotation send recorded", r.ok === true, JSON.stringify(r));
}
q = await quotationFile(cakeId, "png", admin.cookie);
if (q.body.url) {
  const bytes = Buffer.from(await (await fetch(q.body.url)).arrayBuffer());
  check("quotation image is a PNG", q.status === 200 && bytes.subarray(1, 4).toString() === "PNG", `${bytes.length} bytes`);
} else check("quotation image is a PNG", false, JSON.stringify(q.body).slice(0, 200));
r = await act("sendQuotationNowAction", `/admin/orders/${cakeId}`, { orderId: cakeId, format: "pdf" }, counter.cookie);
check("one-tap send explains when WhatsApp Business is not set up", r.ok === true || /not set up/.test(r.message ?? ""), JSON.stringify(r));
r = await act("setStickyNoteAction", `/admin/orders/${cakeId}`, { orderId: cakeId, note: "Gold leaf on top", inWhatsApp: true }, counter.cookie);
check("sticky note saved", r.ok === true, JSON.stringify(r));
p = await page(`/admin/orders/${cakeId}`, admin.cookie);
check("order page shows sticky note", p.body.includes("Gold leaf on top"), `status ${p.status}`);
p = await page(`/print/quotation/${cakeId}`, admin.cookie);
check("customer quotation shows price and note, never the staff instructions", p.status === 200 && hasPrice(p.body) && p.body.includes("Gold leaf on top") && !p.body.includes("Use the gold cake stand"), `status ${p.status}`);
p = await page(`/admin/calendar?kind=custom&from=${tomorrow}`, admin.cookie);
check("custom calendar lists the cake, not the call order", p.body.includes(cake.reference) && !p.body.includes(call.reference), `status ${p.status}`);
p = await page(`/admin/calendar?from=${tomorrow}`, admin.cookie);
check("online calendar lists the call order, not the cake", p.body.includes(call.reference) && !p.body.includes(cake.reference), `status ${p.status}`);
check("calendar has no manual Terms button", p.status === 200 && !p.body.includes(">Terms and Conditions<"), `status ${p.status}`);

// --- Kitchens -------------------------------------------------------------------------------------
const kitchenOf = async (id) => (await admin.sb.from("orders").select("kitchens(code)").eq("id", id).single()).data?.kitchens?.code;
const routes = { web: await kitchenOf(web.id), call: await kitchenOf(callId), cake: await kitchenOf(cakeId) };
check("orders routed to a kitchen", Object.values(routes).every(Boolean), JSON.stringify(routes));
for (const [chef, code] of [[chef1, "K1"], [chef2, "K2"]]) {
  const t = await page("/kitchen?tab=tomorrow", chef.cookie);
  const l = await page("/kitchen?tab=later", chef.cookie);
  const html = t.body + l.body;
  check(`${code} kitchen screen loads without prices`, t.status === 200 && l.status === 200 && !hasPrice(html), `${t.status}/${l.status}`);
  check(`${code} sees its own custom cake only`, html.includes(cake.reference) === (routes.cake === code), `cake → ${routes.cake}`);
  check(`${code} sees its own website order only`, html.includes(web.reference) === (routes.web === code), `web → ${routes.web}`);
  check(`${code} kitchen sees the staff instructions on its own cake`, html.includes("Use the gold cake stand") === (routes.cake === code), `cake → ${routes.cake}`);
  const kq = await page(`/kitchen/quotation/${cakeId}`, chef.cookie);
  if (routes.cake === code) check(`${code} kitchen Order in msg has the add-on and staff instructions but no prices`, kq.status === 200 && kq.body.includes("Rasmalai") && kq.body.includes("Gold balloons") && kq.body.includes("Use the gold cake stand") && !hasPrice(kq.body), `status ${kq.status}`);
  else check(`${code} cannot open another kitchen's quotation`, kq.status !== 200 || !kq.body.includes("Rasmalai"), `status ${kq.status}`);
  const api = await quotationFile(cakeId, "pdf", chef.cookie);
  check(`${code} chef gets 403 from quotation file`, api.status === 403, `status ${api.status}`);
  const terms = await fetch(`${APP}/api/terms?format=png`, { headers: { cookie: chef.cookie } });
  check(`${code} chef gets 403 from terms file`, terms.status === 403, `status ${terms.status}`);
  const a = await page("/admin/orders", chef.cookie);
  check(`${code} chef kept out of admin`, a.status !== 200, `${a.status} ${a.location ?? ""}`);
}

// --- Website review → approve ---------------------------------------------------------------------
const reviewer = `E2E Reviewer ${tag}`;
r = await fetch(`${APP}/api/site/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: reviewer, rating: 5, comment: "Lovely cake, test review." }) }).then((x) => x.json());
check("website review accepted", r.ok === true, JSON.stringify(r));
const review = (await admin.sb.from("reviews").select("id, status").eq("customer_name", reviewer).single()).data;
check("new review waits for approval", review?.status === "pending", JSON.stringify(review));
const content = async () => JSON.stringify(await fetch(`${APP}/api/site/content`).then((x) => x.json()));
check("pending review not on website", !(await content()).includes(reviewer));
await act("setReviewStatus", "/admin/reviews", [review.id, "approved"], admin.cookie).catch(() => null);
check("admin approves review", (await admin.sb.from("reviews").select("status").eq("id", review.id).single()).data?.status === "approved");
await act("deleteReview", "/admin/reviews", review.id, admin.cookie).catch(() => null);
check("admin deletes test review", !(await admin.sb.from("reviews").select("id").eq("id", review.id).maybeSingle()).data);

// --- Role limits ----------------------------------------------------------------------------------
p = await page("/admin/staff", counter.cookie);
check("counter kept out of staff page", p.status !== 200 || (p.body.includes("NEXT_REDIRECT") && !p.body.includes("kitchen1@auri.test")), `${p.status} ${p.location ?? ""}`);
r = await act("cancelOrderAction", `/admin/orders/${web.id}`, { orderId: web.id, version: web.version, reason: "E2E test" }, counter.cookie);
check("counter cannot cancel", r.ok !== true);
p = await page("/admin/staff", admin.cookie);
check("staff page has no Add staff member form", p.status === 200 && !p.body.includes("Add staff member") && p.body.includes("Staff ("), `status ${p.status}`);

// --- WhatsApp quotation text carries the bill; cake sheet sends a PNG ----------------------------
p = await page(`/print/quotation/${cakeId}`, admin.cookie);
check("Order in msg text lists set-up, delivery, add-on, total, advance and balance",
  ["Set-up charges: ₹500", "Delivery charges: ₹200", "Add-on: ₹300", "Total: ₹3,500", "Advance paid: ₹1,000", "Balance to pay: ₹2,500"].every((t) => p.body.includes(t)), `status ${p.status}`);
p = await page(`/print/cake/${cakeId}`, counter.cookie);
check("cake sheet shows the bill, add-on and T&C, and sends the bill file with no text, image first",
  p.status === 200 && p.body.includes("Send the bill to the customer on WhatsApp") && !p.body.includes("Message sent with the Order in msg") && p.body.includes("Balance to pay") && p.body.includes("Gold balloons") && p.body.includes("Terms") && /checked=""[^>]*value="png"|value="png"[^>]*checked/.test(p.body), `status ${p.status}`);
check("cake sheet sends the Terms too, with PDF/PNG downloads", p.body.includes("Terms and Conditions for the customer") && /Send Terms on WhatsApp|Opens the chat of the customer who placed the order/.test(p.body) && p.body.includes(`/api/terms?format=pdf&amp;ref=${cake.reference}`), `status ${p.status}`);

// --- Dashboard and Reports -------------------------------------------------------------------------
p = await page("/admin", admin.cookie);
check("dashboard has the renamed tiles and no order buttons", ["Due today (Online orders)", "Due today (Customised order)"].every((t) => p.body.includes(t)) && !["Online Orders", "New call order", "new-cake"].some((t) => p.body.includes(t)) && !/GST/.test(p.body), `status ${p.status}`);
p = await page("/admin/orders", admin.cookie);
check("orders page has In-store order and Customised order, no call order", p.body.includes("In-store order") && p.body.includes("Customised order") && !p.body.includes("New call order"), `status ${p.status}`);
p = await page(`/admin/sales-report?range=custom&from=${tomorrow}&to=${tomorrow}`, admin.cookie);
check("reports list the sold cake with kg and a total", p.status === 200 && p.body.includes("9000099904") && p.body.includes("1.5") && p.body.includes("Total"), `status ${p.status}`);
p = await page("/admin/sales-report", counter.cookie);
check("counter kept out of reports", p.status !== 200 || p.body.includes("NEXT_REDIRECT"), `${p.status} ${p.location ?? ""}`);

// --- Delete from the calendar ----------------------------------------------------------------------
p = await page(`/admin/calendar?from=${later}`, admin.cookie);
check("admin calendar rows have Delete", p.body.includes(`Delete order ${web.reference}`), `status ${p.status}`);
p = await page(`/admin/calendar?from=${later}`, counter.cookie);
check("counter calendar has no Delete", p.status === 200 && !p.body.includes("Delete order"), `status ${p.status}`);
r = await act("deleteOrderAction", "/admin/calendar", { orderId: web.id, reason: "E2E test" }, counter.cookie);
check("counter cannot delete orders", r.ok !== true);
r = await act("deleteOrderAction", "/admin/calendar", { orderId: web.id, reason: "E2E test order, not real" }, admin.cookie);
const webGone = !(await admin.sb.from("orders").select("id").eq("id", web.id).maybeSingle()).data;
check("admin deletes an order with no payments: it is gone", r.ok === true && r.outcome === "deleted" && webGone, JSON.stringify(r));
r = await act("deleteOrderAction", "/admin/calendar?kind=custom", { orderId: cakeId, reason: "E2E test order, not real" }, admin.cookie);
const cakeGone = !(await admin.sb.from("orders").select("id").eq("id", cakeId).maybeSingle()).data;
const cakePayments = (await admin.sb.from("payments").select("id").eq("order_id", cakeId)).data ?? [];
check("an order with an advance is deleted outright, payments too", r.ok === true && r.outcome === "deleted" && cakeGone && cakePayments.length === 0, JSON.stringify(r));
r = await act("deleteOrderAction", "/admin/calendar", { orderId: callId, reason: "E2E test order, not real" }, admin.cookie);
const callGone = !(await admin.sb.from("orders").select("id").eq("id", callId).maybeSingle()).data;
const callBills = (await admin.sb.from("bills").select("id").eq("order_id", callId)).data ?? [];
check("a completed, billed and paid order is deleted outright, bill too", r.ok === true && r.outcome === "deleted" && callGone && callBills.length === 0, JSON.stringify(r));
console.log(results.join("\n"));
const failed = results.filter((x) => x.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
