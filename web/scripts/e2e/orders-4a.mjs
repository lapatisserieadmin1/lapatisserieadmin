// Phase 4A end-to-end checks through real server actions. Run against STAGING: it commits test orders.
// Needs: `npm run build && npm start -- -p 3100`, QA users from supabase/tests/qa_users.sql, QA_PW env var.
// Usage (from web/): QA_PW=... npm run e2e:orders
import { createServerClient } from "@supabase/ssr";
import { readFileSync } from "node:fs";
const m = JSON.parse(readFileSync("./.next/server/server-reference-manifest.json", "utf8"));
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, APP = process.env.APP_URL ?? "http://localhost:3100";
const actionId = (name) => Object.entries(m.node).find(([, v]) => v.exportedName === name)[0];
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);

async function login(email) {
  const jar = new Map();
  const sb = createServerClient(URL_, KEY, { cookies: {
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    setAll: (cs) => cs.forEach(({ name, value }) => value ? jar.set(name, value) : jar.delete(name)),
  }});
  const { error } = await sb.auth.signInWithPassword({ email, password: process.env.QA_PW });
  if (error) throw error;
  return { sb, cookie: [...jar].map(([n, v]) => `${n}=${v}`).join("; ") };
}
async function page(path, cookie) {
  const r = await fetch(APP + path, { headers: { cookie }, redirect: "manual" });
  return { status: r.status, location: r.headers.get("location"), body: r.status === 200 ? await r.text() : "" };
}
async function act(name, path, arg, cookie) {
  const r = await fetch(APP + path, { method: "POST", headers: { cookie, "Next-Action": actionId(name), "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" }, body: JSON.stringify([arg]) });
  const text = await r.text();
  const line = text.split("\n").find((l) => l.startsWith("1:"));
  try { return JSON.parse(line.slice(2)); } catch { return { raw: text.slice(0, 300), status: r.status }; }
}
const istDay = (offset) => new Date(Date.now() + 5.5 * 3600e3 + offset * 86400e3).toISOString().slice(0, 10);
const tomorrow = istDay(1);

const admin = await login("qa-admin@auri.test");
const counter = await login("qa-counter@auri.test");

const k1 = (await admin.sb.from("kitchens").select("id").eq("code", "K1").single()).data.id;
const cat = (await admin.sb.from("categories").insert({ name: "E2E Cakes " + Date.now() }).select().single()).data;
const cake = (await admin.sb.from("products").insert({ category_id: cat.id, name: "E2E Black Forest", tax_rate_bps: 500 }).select().single()).data;
const cakeV = (await admin.sb.from("product_variants").insert({ product_id: cake.id, name: "1 kg", price_paise: 90000, kitchen_id: k1, lead_time_minutes: 240 }).select().single()).data;
const puff = (await admin.sb.from("products").insert({ category_id: cat.id, name: "E2E Veg Puff", prep_type: "ready_stock", tax_rate_bps: 1800 }).select().single()).data;
const puffV = (await admin.sb.from("product_variants").insert({ product_id: puff.id, name: "Each", price_paise: 3000 }).select().single()).data;

let p = await page("/admin/orders/new?source=CALL", admin.cookie);
check("new call order page lists catalogue", p.status === 200 && p.body.includes("E2E Black Forest") && p.body.includes("New call order"), `status ${p.status}`);

const key = crypto.randomUUID();
const input = { idempotencyKey: key, source: "CALL", items: [{ variantId: cakeV.id, quantity: 1, notes: "Happy Anniversary" }, { variantId: puffV.id, quantity: 6 }],
  customerName: "E2E Priya", customerPhone: "98765 43210", dueLocal: `${tomorrow}T11:00`, customerNotes: "", internalNotes: "", confirm: false };
let r = await act("createOrderAction", "/admin/orders/new", input, admin.cookie);
check("createOrderAction creates call order", r.ok === true && typeof r.orderId === "string", JSON.stringify(r));
const orderId = r.orderId;
let o = (await admin.sb.from("order_summaries").select("*").eq("id", orderId).single()).data;
check("pickup stored as 11:00 IST (05:30 UTC)", new Date(o.due_at).toISOString() === `${tomorrow}T05:30:00.000Z`, o.due_at);
check("total and GST computed", o.total_paise === 108000 && o.tax_paise === 4286 + 2746, `total ${o.total_paise} tax ${o.tax_paise}`);
r = await act("createOrderAction", "/admin/orders/new", input, admin.cookie);
check("double submit returns same order (AC-07)", r.orderId === orderId);

r = await act("createOrderAction", "/admin/orders/new", { ...input, idempotencyKey: crypto.randomUUID(), dueLocal: `${tomorrow}T23:00` }, admin.cookie);
check("late-night pickup refused with overridable kind", r.ok !== true && r.kind === "slot", r.message);
r = await act("createOrderAction", "/admin/orders/new", { ...input, idempotencyKey: crypto.randomUUID(), dueLocal: "not-a-date" }, admin.cookie);
check("malformed pickup time rejected", r.ok !== true && /valid pickup/.test(r.message ?? ""), r.message);

r = await act("confirmOrderAction", `/admin/orders/${orderId}`, { orderId, version: o.version }, counter.cookie);
check("counter cannot confirm call order", r.ok !== true && /Only an admin/.test(r.message ?? ""), r.message);
r = await act("confirmOrderAction", `/admin/orders/${orderId}`, { orderId, version: o.version - 1 }, admin.cookie);
check("stale version → conflict (AC-18)", r.kind === "conflict", r.message);
r = await act("confirmOrderAction", `/admin/orders/${orderId}`, { orderId, version: o.version }, admin.cookie);
check("admin confirms", r.ok === true, JSON.stringify(r));

o = (await admin.sb.from("orders").select("*").eq("id", orderId).single()).data;
r = await act("rescheduleOrderAction", `/admin/orders/${orderId}`, { orderId, version: o.version, dueLocal: `${tomorrow}T15:30`, reason: "Customer asked for afternoon" }, admin.cookie);
o = (await admin.sb.from("orders").select("*").eq("id", orderId).single()).data;
check("reschedule moves confirmed pickup to 15:30 IST", r.ok === true && new Date(o.due_at).toISOString() === `${tomorrow}T10:00:00.000Z`, JSON.stringify(r) + " " + o.due_at);
r = await act("rescheduleOrderAction", `/admin/orders/${orderId}`, { orderId, version: o.version, dueLocal: `${tomorrow}T16:00`, reason: "xyz" }, counter.cookie);
check("counter cannot reschedule", r.ok !== true, r.message);

r = await act("recordPaymentAction", `/admin/orders/${orderId}`, { orderId, idempotencyKey: crypto.randomUUID(), kind: "payment", method: "cash", amount: "abc" }, admin.cookie);
check("payment amount validated", r.ok !== true && /Enter an amount/.test(r.message ?? ""), r.message);
r = await act("recordPaymentAction", `/admin/orders/${orderId}`, { orderId, idempotencyKey: crypto.randomUUID(), kind: "payment", method: "cash", amount: "5000" }, admin.cookie);
check("overpayment refused", r.ok !== true && /more than the balance/.test(r.message ?? ""), r.message);

r = await act("createOrderAction", "/admin/orders/new", { idempotencyKey: crypto.randomUUID(), source: "IN_STORE", items: [{ variantId: puffV.id, quantity: 2 }], dueLocal: null, confirm: true }, counter.cookie);
check("counter walk-in created and confirmed", r.ok === true, JSON.stringify(r));
const walkinId = r.orderId;
const walkin = (await counter.sb.from("orders").select("status, is_immediate, reference").eq("id", walkinId).single()).data;
check("walk-in is immediate + confirmed", walkin?.status === "confirmed" && walkin.is_immediate, JSON.stringify(walkin));

p = await page("/admin/orders?list=online_call&when=all&status=all", admin.cookie);
check("Online / Call list shows call order, not walk-in (AC-01)", p.body.includes(o.reference) && p.body.includes("E2E Priya") && !p.body.includes(walkin.reference), `status ${p.status}`);
p = await page("/admin/orders?list=in_store&when=all&status=all", admin.cookie);
check("In-store list shows walk-in only (AC-01)", p.body.includes(walkin.reference) && !p.body.includes(o.reference), `status ${p.status}`);
p = await page(`/admin/orders?list=online_call&when=all&status=all&q=${o.reference}`, admin.cookie);
check("search by reference", p.body.includes("E2E Priya"));
p = await page(`/admin/orders?list=online_call&when=all&status=all&q=43210`, admin.cookie);
check("search by phone", p.body.includes("E2E Priya"));
p = await page(`/admin/orders/${orderId}`, admin.cookie);
check("order detail: notes, kitchen, timeline", p.status === 200 && p.body.includes("Happy Anniversary") && p.body.includes("Kitchen 1") && p.body.includes("Pickup time changed") && p.body.includes("Customer asked for afternoon"), `status ${p.status}`);
p = await page(`/admin/calendar?from=${tomorrow}`, admin.cookie);
check("calendar agenda shows order at 3:30 on pickup day (AC-19)", p.body.includes(o.reference) && p.body.includes("3:30"), `status ${p.status}`);
p = await page(`/admin/calendar?view=month&from=${tomorrow}`, admin.cookie);
check("calendar month view renders", p.status === 200 && /1(<!-- -->)? order/.test(p.body), `status ${p.status}`);
p = await page("/admin", admin.cookie);
check("home dashboard shows order in next 7 days", p.status === 200 && p.body.includes("Next 7 days") && p.body.includes(o.reference), `status ${p.status}`);
p = await page("/admin/customers?q=Priya", admin.cookie);
check("customer created from call order", p.body.includes("E2E Priya") && p.body.includes("9876543210"));
p = await page("/admin/customers", counter.cookie);
check("counter blocked from customers page", p.status === 307, `${p.status} ${p.location}`);
p = await page("/admin/settings", admin.cookie);
check("settings shows opening hours + closures", p.body.includes("Opening hours") && p.body.includes("Closures"));
p = await page(`/admin/orders/${orderId}`, counter.cookie);
check("counter can view order detail", p.status === 200 && p.body.includes(o.reference));

o = (await admin.sb.from("orders").select("version").eq("id", orderId).single()).data;
r = await act("cancelOrderAction", `/admin/orders/${orderId}`, { orderId, version: o.version, reason: "E2E test cleanup" }, admin.cookie);
check("cancel with reason", r.ok === true, JSON.stringify(r));

console.log(JSON.stringify({ orderId, walkinId, categoryId: cat.id }));
console.log(results.join("\n"));
console.log(`\n${results.filter((x) => x.startsWith("PASS")).length}/${results.length} passed`);
