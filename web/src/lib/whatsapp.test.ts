import { test } from "node:test";
import assert from "node:assert/strict";
import { availableMessages, messageText, quotationCaption, whatsappLink, whatsappNumber, type MessageKind, type MessageOrder } from "./whatsapp.ts";

const order: MessageOrder = {
  reference: "B-1023",
  status: "confirmed",
  fulfilment: "collect",
  setupAddress: null,
  dueAt: "2026-10-24T10:30:00Z",
  totalPaise: 150000,
  balancePaise: 50000,
  items: [{ name: "Black Forest Cake — 1 kg", quantity: 1 }, { name: "Butter Croissant — Each", quantity: 6 }],
};
const ctx = { shop: "La Patisserie", timeZone: "Asia/Kolkata", reviewUrl: "https://example.com/#testimonials" };
const KINDS: MessageKind[] = ["received", "confirmed", "ready", "balance", "thanks"];

test("phone numbers become WhatsApp numbers with the country code", () => {
  assert.equal(whatsappNumber("98400 00001"), "919840000001");
  assert.equal(whatsappNumber("+91 98400-00001"), "919840000001");
  assert.equal(whatsappNumber("09840000001"), "919840000001");
  assert.equal(whatsappNumber("+447700900123"), "447700900123");
  assert.equal(whatsappNumber("12345"), null);
  assert.equal(whatsappNumber(null), null);
});

test("the messages offered follow the order's stage", () => {
  assert.deepEqual(availableMessages({ status: "pending_confirmation", balancePaise: 0 }), ["received"]);
  assert.deepEqual(availableMessages({ status: "confirmed", balancePaise: 100 }), ["confirmed", "balance"]);
  assert.deepEqual(availableMessages({ status: "ready", balancePaise: 0 }), ["ready"]);
  assert.deepEqual(availableMessages({ status: "completed", balancePaise: 0 }), ["thanks"]);
  assert.deepEqual(availableMessages({ status: "cancelled", balancePaise: 100 }), []);
});

test("every message greets Sir / Madam", () => {
  for (const kind of KINDS) assert.match(messageText(kind, order, ctx), /^Hello Sir \/ Madam!/, kind);
});

test("the confirmation lists items, pickup time, total and balance in rupees", () => {
  const text = messageText("confirmed", order, ctx);
  assert.match(text, /^Hello Sir \/ Madam! ✅ Your order B-1023 is confirmed\./);
  assert.match(text, /• 6 × Butter Croissant — Each/);
  assert.match(text, /Pickup at La Patisserie: Sat, 24 Oct, 4:00 pm/i);
  assert.match(text, /Total: ₹1,500\nBalance to pay: ₹500/);
});

test("set-up orders mention the address; thanks links to reviews; links are encoded", () => {
  const setup = { ...order, status: "ready" as const, fulfilment: "setup" as const, setupAddress: "5 Lake View Road", balancePaise: 0 };
  assert.match(messageText("ready", setup, ctx), /We will be at 5 Lake View Road on .* to set it up\.\n\nFully paid ✅/);
  assert.match(messageText("thanks", order, ctx), /https:\/\/example\.com\/#testimonials$/);
  assert.equal(whatsappLink("919840000001", "Hi & bye"), "https://wa.me/919840000001?text=Hi%20%26%20bye");
});

test("a sticky note chosen for WhatsApp is added at the end", () => {
  assert.match(messageText("balance", { ...order, note: " Gate code 4321 " }, ctx), /\n\nNote: Gate code 4321$/);
  assert.doesNotMatch(messageText("balance", { ...order, note: "  " }, ctx), /Note:/);
});

test("the quotation caption: greeting, one line, shop sign-off, note if chosen; never a name", () => {
  assert.equal(
    quotationCaption({ reference: "B-1042" }, "La Patisserie"),
    "Hello Sir / Madam!\nPlease find attached the order in msg for your order B-1042.\n\n— La Patisserie",
  );
  assert.match(quotationCaption({ reference: "B-1042", note: "Bring the stand back" }, "La Patisserie"), /\n\nNote: Bring the stand back$/);
});

test("the quotation caption carries the bill: each charge, total, advance and balance", () => {
  const bill = {
    lines: [{ label: "Custom cake", paise: 250000 }, { label: "Set-up charges", paise: 50000 }, { label: "Delivery charges", paise: 20000 }],
    discountPaise: 0, totalPaise: 320000, advancePaise: 100000, balancePaise: 220000,
  };
  assert.equal(
    quotationCaption({ reference: "B-1042", bill }, "La Patisserie"),
    "Hello Sir / Madam!\nPlease find attached the order in msg for your order B-1042.\n\n" +
      "Custom cake: ₹2,500\nSet-up charges: ₹500\nDelivery charges: ₹200\n*Total: ₹3,200*\nAdvance paid: ₹1,000\n*Balance to pay: ₹2,200*\n\n— La Patisserie",
  );
  assert.match(quotationCaption({ reference: "B-1", bill: { ...bill, advancePaise: 320000, balancePaise: 0 } }, "S"), /Advance paid: ₹3,200\nFully paid ✅/);
});

