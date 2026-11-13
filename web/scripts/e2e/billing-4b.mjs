// Needs: running app on :3100, QA users from supabase/tests/qa_users.sql, QA_PW env var. Usage (from web/): QA_PW=... npm run e2e:billing
// Phase 4B HTTP checks that never commit bills, payments, or credit notes.
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
const tomorrow = new Date(Date.now() + 5.5 * 3600e3 + 86400e3).toISOString().slice(0, 10);

const admin = await login("qa-admin@auri.test");
const counter = await login("qa-counter@auri.test");
const k1 = (await admin.sb.from("kitchens").select("id").eq("code", "K1").single()).data.id;
const cat = (await admin.sb.from("categories").insert({ name: "E2E4B " + Date.now() }).select().single()).data;
const puff = (await admin.sb.from("products").insert({ category_id: cat.id, name: "E2E Paneer Puff", prep_type: "ready_stock", tax_rate_bps: 1800 }).select().single()).data;
const puffV = (await admin.sb.from("product_variants").insert({ product_id: puff.id, name: "Each", price_paise: 3000 }).select().single()).data;
const cake = (await admin.sb.from("products").insert({ category_id: cat.id, name: "E2E Truffle Cake", tax_rate_bps: 500 }).select().single()).data;
const cakeV = (await admin.sb.from("product_variants").insert({ product_id: cake.id, name: "1 kg", price_paise: 100000, kitchen_id: k1, lead_time_minutes: 60 }).select().single()).data;

let p = await page("/admin/counter", counter.cookie);
check("counter sale page lists ready-stock only", p.status === 200 && p.body.includes("E2E Paneer Puff") && !p.body.includes("E2E Truffle Cake"), `status ${p.status}`);

const sale = { idempotencyKey: crypto.randomUUID(), items: [{ variantId: puffV.id, quantity: 10 }], payments: [{ method: "cash", amountPaise: 24000 }] };
let r = await act("counterSaleAction", "/admin/counter", { ...sale, discount: { kind: "percent", value: 2000, reason: "friend" } }, counter.cookie);
check("counter sale: 20% discount refused for counter staff", r.ok !== true && /up to 10% off/.test(r.message ?? ""), r.message);
r = await act("counterSaleAction", "/admin/counter", { ...sale, idempotencyKey: crypto.randomUUID(), payments: [{ method: "cash", amountPaise: 100 }] }, counter.cookie);
check("counter sale: payment must equal total", r.ok !== true && /must equal the total/.test(r.message ?? ""), r.message);
r = await act("counterSaleAction", "/admin/counter", { idempotencyKey: crypto.randomUUID(), items: [{ variantId: cakeV.id, quantity: 1 }], payments: [{ method: "cash", amountPaise: 100000 }] }, counter.cookie);
check("counter sale: made-to-order refused", r.ok !== true && /Made-to-order/.test(r.message ?? ""), r.message);
r = await act("counterSaleAction", "/admin/counter", { idempotencyKey: "not-a-uuid", items: [], payments: [] }, counter.cookie);
check("counter sale: malformed input rejected", r.ok !== true, r.message);
const { count: ordersAfterFailures } = await admin.sb.from("orders").select("id", { count: "exact", head: true });
const { count: billsAfterFailures } = await admin.sb.from("bills").select("id", { count: "exact", head: true });
check("failed sales left no orders or bills", ordersAfterFailures === 0 && billsAfterFailures === 0, `orders=${ordersAfterFailures} bills=${billsAfterFailures}`);

// Call order (no payments, no bill) to exercise discount rules.
r = await act("createOrderAction", "/admin/orders/new", { idempotencyKey: crypto.randomUUID(), source: "CALL", items: [{ variantId: cakeV.id, quantity: 1 }], customerName: "E2E Kavya", customerPhone: "9876500000", dueLocal: `${tomorrow}T12:00`, confirm: true }, admin.cookie);
const orderId = r.orderId;
check("confirmed call order created", r.ok === true, JSON.stringify(r));
let o = (await admin.sb.from("orders").select("version").eq("id", orderId).single()).data;
r = await act("applyDiscountAction", `/admin/orders/${orderId}`, { orderId, version: o.version, kind: "percent", value: "25", reason: "Big party" }, counter.cookie);
check("counter over-limit discount refused", r.ok !== true && /up to 10% off/.test(r.message ?? ""), r.message);
r = await act("applyDiscountAction", `/admin/orders/${orderId}`, { orderId, version: o.version, kind: "percent", value: "5", reason: "" }, admin.cookie);
check("discount needs a reason", r.ok !== true && /reason/.test(r.message ?? ""), r.message);
r = await act("applyDiscountAction", `/admin/orders/${orderId}`, { orderId, version: o.version, kind: "amount", value: "150", reason: "Loyal customer" }, admin.cookie);
o = (await admin.sb.from("orders").select("*").eq("id", orderId).single()).data;
check("admin ₹150 discount recalculates total and GST", r.ok === true && o.total_paise === 85000 && o.tax_paise === 4048 && o.discount_by, `total ${o.total_paise} tax ${o.tax_paise}`);
r = await act("applyDiscountAction", `/admin/orders/${orderId}`, { orderId, version: o.version - 1, kind: "amount", value: "10", reason: "stale" }, admin.cookie);
check("stale discount edit → conflict", r.kind === "conflict", r.message);

p = await page(`/admin/orders/${orderId}`, admin.cookie);
check("order page shows discount, bill panel, issue-bill button", p.status === 200 && p.body.includes("Loyal customer") && p.body.includes("GST bill") && p.body.includes("Issue GST bill"), `status ${p.status}`);
p = await page(`/admin/orders/${orderId}`, counter.cookie);
check("counter can open discount (Add discount shown)", p.body.includes("Add discount"));

r = await act("issueCreditNoteAction", `/admin/orders/${orderId}`, { orderId, billId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), amount: "10", reason: "counter try" }, counter.cookie);
check("counter cannot issue credit notes (server check)", r.ok !== true, r.message ?? JSON.stringify(r).slice(0, 120));
r = await act("issueBillAction", `/admin/orders/${orderId}`, "not-a-uuid", admin.cookie);
check("issue bill validates id", r.ok !== true && /Invalid order/.test(r.message ?? ""), r.message);

p = await page("/print/bill/00000000-0000-0000-0000-000000000000", admin.cookie);
check("unknown bill → 404", p.status === 404, `status ${p.status}`);
p = await fetch(APP + "/print/bill/00000000-0000-0000-0000-000000000000", { redirect: "manual" });
check("print pages require sign-in", p.status === 307 && (p.headers.get("location") ?? "").includes("/login"), `${p.status}`);
p = await page("/admin/settings", admin.cookie);
check("settings shows bill prefix + discount limit", p.body.includes("Bill number prefix") && p.body.includes("Counter staff discount limit"));

o = (await admin.sb.from("orders").select("version").eq("id", orderId).single()).data;
r = await act("cancelOrderAction", `/admin/orders/${orderId}`, { orderId, version: o.version, reason: "E2E cleanup" }, admin.cookie);
check("unbilled order cancels normally", r.ok === true, JSON.stringify(r));

console.log(JSON.stringify({ orderId, categoryId: cat.id }));
console.log(results.join("\n"));
console.log(`\n${results.filter((x) => x.startsWith("PASS")).length}/${results.length} passed`);
