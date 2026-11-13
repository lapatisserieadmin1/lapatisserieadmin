"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { zonedDayKey, zonedDayStart, zonedLocalToDate } from "@/lib/time";
import { parseRupeesToPaise } from "@/lib/money";
import { rpcError, type RpcFailure } from "@/lib/orders";
import type { PickupAvailability } from "@/lib/capacity";
import { MAX_CAKE_PHOTOS, cakeDetailsSchema, cakeToJson } from "@/lib/custom-cake";
import { cloudFormats, whatsappCloudConfig } from "@/lib/whatsapp-cloud";

type Result<T = object> = ({ ok: true } & T) | ({ ok?: false } & RpcFailure);

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform((v) => v.trim() || undefined)
    .optional();

const fulfilmentSchema = {
  fulfilment: z.enum(["collect", "setup"]),
  setupAddress: optionalText(300),
  setupNote: optionalText(300),
};

const createSchema = z.object({
  idempotencyKey: z.uuid(),
  source: z.enum(["IN_STORE", "CALL", "CUSTOMER"]),
  items: z
    .array(
      z.object({
        variantId: z.uuid(),
        quantity: z.number().int().min(1, "Quantity must be at least 1.").max(999),
        notes: optionalText(500),
      }),
    )
    .min(1, "Add at least one item.")
    .max(50),
  customerName: optionalText(80),
  customerPhone: optionalText(20),
  dueLocal: z.string().nullable(),
  customerNotes: optionalText(1000),
  internalNotes: optionalText(1000),
  confirm: z.boolean(),
  overrideReason: optionalText(300),
  ...fulfilmentSchema,
});

export type CreateOrderInput = z.input<typeof createSchema>;

export async function createOrderAction(input: CreateOrderInput): Promise<Result<{ orderId: string }>> {
  await assertRole(["admin", "counter"]);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the order and try again." };
  const data = parsed.data;

  let dueAt: string | undefined;
  if (data.dueLocal) {
    const due = zonedLocalToDate(data.dueLocal, await getBusinessTimezone());
    if (!due) return { message: "Enter a valid pickup date and time." };
    dueAt = due.toISOString();
  }

  const supabase = await createClient();
  const { data: order, error } = await supabase.rpc("create_order", {
    p_idempotency_key: data.idempotencyKey,
    p_source: data.source,
    p_items: data.items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity, notes: i.notes ?? null })),
    p_customer_name: data.customerName,
    p_customer_phone: data.customerPhone,
    p_due_at: dueAt,
    p_customer_notes: data.customerNotes,
    p_internal_notes: data.internalNotes,
    p_confirm: data.confirm,
    p_override_reason: data.overrideReason,
    p_fulfilment: data.fulfilment,
    p_setup_address: data.setupAddress,
    p_setup_note: data.setupNote,
  });
  if (error) return rpcError(error);

  revalidatePath("/admin", "layout");
  if (order.status === "confirmed") await autoSendQuotation(order.id);
  return { ok: true, orderId: order.id };
}

const transitionSchema = z.object({
  orderId: z.uuid(),
  version: z.number().int(),
  reason: optionalText(300),
  overrideReason: optionalText(300),
});

async function afterChange(orderId: string) {
  revalidatePath("/admin", "layout");
  revalidatePath(`/admin/orders/${orderId}`);
}

// After a confirmed order's response, so confirming stays quick: with WHATSAPP_AUTO_SEND_ON_CONFIRM=true its
// quotation PDF goes to the customer on WhatsApp, and a cake order always gets the Terms and Conditions as a
// PDF and an image (owner, 2026-11-07). Each outcome, sent or failed, is logged on the order; an order
// without a phone number is skipped. Nothing happens until WhatsApp sending is set up.
async function autoSendQuotation(orderId: string) {
  const cfg = whatsappCloudConfig();
  if (!cfg) return;
  const supabase = await createClient();
  after(async () => {
    if (cfg.autoSendOnConfirm) {
      const { sendQuotationFromServer } = await import("@/lib/quotation-send");
      const r = await sendQuotationFromServer(supabase, orderId, "pdf");
      if (!r.ok) console.warn("automatic quotation not sent", orderId, r.message);
    }
    const { sendTermsFromServer } = await import("@/lib/terms-send");
    const t = await sendTermsFromServer(supabase, orderId, { automatic: true });
    if (!t.ok) console.warn("automatic terms not sent", orderId, t.message);
  });
}

// Staff send the Terms again from the order page, e.g. after a failed send or for an order that is not a cake.
export async function sendTermsAction(input: { orderId: string }): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = z.object({ orderId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { message: "Invalid request." };
  const supabase = await createClient();
  const { sendTermsFromServer } = await import("@/lib/terms-send");
  const r = await sendTermsFromServer(supabase, parsed.data.orderId, { automatic: false });
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  return r.ok ? { ok: true } : { message: r.message };
}

export async function confirmOrderAction(input: z.input<typeof transitionSchema>): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return { message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("confirm_order", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
    p_override_reason: parsed.data.overrideReason,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  await autoSendQuotation(parsed.data.orderId);
  return { ok: true };
}

export async function rejectOrderAction(input: z.input<typeof transitionSchema>): Promise<Result> {
  await assertRole(["admin"]);
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success || !parsed.data.reason) return { message: "Give a reason for rejecting the order." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reject_order", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}

export async function cancelOrderAction(input: z.input<typeof transitionSchema>): Promise<Result> {
  await assertRole(["admin"]);
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success || !parsed.data.reason) return { message: "Give a reason for cancelling the order." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_order", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}

// Delete from the calendar (owner, 2026-10-24): any order goes, with its payments, bill and credit notes
// (2026-10-28). The audit log keeps a copy.
const deleteSchema = z.object({ orderId: z.uuid(), reason: z.string().trim().min(3, "Give a reason for deleting the order.").max(300) });

export async function deleteOrderAction(input: z.input<typeof deleteSchema>): Promise<Result<{ outcome: "deleted" | "cancelled" }>> {
  await assertRole(["admin"]);
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Give a reason for deleting the order." };
  const { orderId, reason } = parsed.data;
  const supabase = await createClient();
  const [{ data: order }, { data: cake }] = await Promise.all([
    supabase.from("orders").select("version").eq("id", orderId).maybeSingle(),
    supabase.from("custom_cakes").select("photo_paths").eq("order_id", orderId).maybeSingle(),
  ]);
  if (!order) return { message: "This order was already deleted. Reload the calendar." };

  const { error } = await supabase.rpc("delete_order", { p_order_id: orderId, p_expected_version: order.version, p_reason: reason });
  if (error) return rpcError(error);

  const { data: files } = await supabase.storage.from("quotations").list(orderId);
  if (files?.length) await supabase.storage.from("quotations").remove(files.map((f) => `${orderId}/${f.name}`));
  if (cake?.photo_paths.length) await supabase.storage.from("custom-cake-photos").remove(cake.photo_paths);
  revalidatePath("/admin", "layout");
  return { ok: true, outcome: "deleted" };
}

export async function rescheduleOrderAction(
  input: z.input<typeof transitionSchema> & { dueLocal: string },
): Promise<Result> {
  await assertRole(["admin"]);
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return { message: "Invalid request." };
  if (!parsed.data.reason) return { message: "Give a reason for the new pickup time." };
  const due = zonedLocalToDate(input.dueLocal, await getBusinessTimezone());
  if (!due) return { message: "Enter a valid pickup date and time." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("reschedule_order", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
    p_due_at: due.toISOString(),
    p_reason: parsed.data.reason,
    p_override_reason: parsed.data.overrideReason,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}

const editItemsSchema = z.object({
  orderId: z.uuid(),
  version: z.number().int(),
  lines: z
    .array(
      z.union([
        z.object({ lineId: z.uuid(), quantity: z.number().int().min(1).max(999), notes: z.string().max(500) }),
        z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(999), notes: z.string().max(500) }),
      ]),
    )
    .min(1, "An order needs at least one item. Cancel the order instead.")
    .max(50),
  reason: optionalText(300),
  overrideReason: optionalText(300),
});

// Replaces the order's lines: kept lines keep their price, new lines take today's (see update_order_items).
export async function updateOrderItemsAction(input: z.input<typeof editItemsSchema>): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = editItemsSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the items." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_order_items", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
    p_lines: parsed.data.lines.map((l) =>
      "lineId" in l
        ? { line_id: l.lineId, quantity: l.quantity, notes: l.notes }
        : { variant_id: l.variantId, quantity: l.quantity, notes: l.notes },
    ),
    p_reason: parsed.data.reason,
    p_override_reason: parsed.data.overrideReason,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// No-shows and customer flags (Phase 4C)
// ---------------------------------------------------------------------------

// Recording a no-show does not change the order's status (owner's decision, 2026-09-29).
export async function recordNoShowAction(input: { orderId: string; version: number }): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success) return { message: "Invalid request." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_no_show", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  revalidatePath("/admin/customers", "layout");
  return { ok: true };
}

export async function undoNoShowAction(input: z.input<typeof transitionSchema>): Promise<Result> {
  await assertRole(["admin"]);
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success || !parsed.data.reason) return { message: "Give a reason for undoing the no-show." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("undo_no_show", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  revalidatePath("/admin/customers", "layout");
  return { ok: true };
}

export type CustomerFlags = { id: string; name: string; isBlocked: boolean; blockedReason: string | null; noShowCount: number };

// Flags for the customer with this phone, for the warning on the new-order form. Null when
// there is no such customer or nothing to warn about.
export async function customerFlagsAction(phone: string): Promise<CustomerFlags | null> {
  await assertRole(["admin", "counter"]);
  // Same normalisation as create_order.
  const normalised = phone.replace(/[\s()-]/g, "");
  if (!/^\+?[0-9]{10,15}$/.test(normalised)) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from("customers")
    .select("id, full_name, is_blocked, blocked_reason, no_show_count")
    .eq("phone", normalised)
    .maybeSingle();
  if (!data || (!data.is_blocked && data.no_show_count === 0)) return null;
  return { id: data.id, name: data.full_name, isBlocked: data.is_blocked, blockedReason: data.blocked_reason, noShowCount: data.no_show_count };
}

// Window and category usage for one business-local day ("YYYY-MM-DD"). Null when it cannot be loaded.
export async function pickupAvailabilityAction(dayKey: string, excludeOrderId?: string): Promise<PickupAvailability | null> {
  await assertRole(["admin", "counter"]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null;
  if (excludeOrderId !== undefined && !z.uuid().safeParse(excludeOrderId).success) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pickup_availability", { p_date: dayKey, p_exclude_order: excludeOrderId });
  if (error) return null;
  return data as unknown as PickupAvailability;
}

const paymentSchema = z.object({
  orderId: z.uuid(),
  idempotencyKey: z.uuid(),
  kind: z.enum(["payment", "refund"]),
  method: z.enum(["cash", "upi", "card", "bank_transfer", "other"]),
  amount: z.string(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid payment date."),
  reference: optionalText(100),
  note: optionalText(500),
});

export async function recordPaymentAction(input: z.input<typeof paymentSchema>): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = paymentSchema.safeParse(input);
  if (!parsed.success) return { message: "Check the payment details." };
  const amount = parseRupeesToPaise(parsed.data.amount);
  if (!amount) return { message: "Enter an amount in rupees, e.g. 500 or 499.50." };

  const timezone = await getBusinessTimezone();
  const paidAt = zonedDayStart(parsed.data.paidOn, timezone);
  if (!paidAt) return { message: "Choose a valid payment date." };
  if (parsed.data.paidOn > zonedDayKey(new Date(), timezone)) {
    return { message: "The payment date cannot be in the future." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("record_payment", {
    p_order_id: parsed.data.orderId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_kind: parsed.data.kind,
    p_method: parsed.data.method,
    p_amount_paise: amount,
    p_reference: parsed.data.reference,
    p_note: parsed.data.note,
    p_paid_at: paidAt.toISOString(),
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Discounts, bills, credit notes (Phase 4B)
// ---------------------------------------------------------------------------

const discountSchema = z.object({
  orderId: z.uuid(),
  version: z.number().int(),
  kind: z.enum(["amount", "percent"]),
  value: z.string(),
  reason: optionalText(300),
});

// "10" percent -> 1000 bps; "150.50" rupees -> 15050 paise. Null when invalid.
function parseDiscountValue(kind: "amount" | "percent", value: string): number | null {
  if (value.trim() === "") return 0;
  if (kind === "amount") return parseRupeesToPaise(value);
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const bps = Math.round(Number(value) * 100);
  return bps <= 10000 ? bps : null;
}

export async function applyDiscountAction(input: z.input<typeof discountSchema>): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = discountSchema.safeParse(input);
  if (!parsed.success) return { message: "Check the discount." };
  const value = parseDiscountValue(parsed.data.kind, parsed.data.value);
  if (value === null) return { message: parsed.data.kind === "percent" ? "Enter a percentage from 0 to 100." : "Enter an amount in rupees." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("apply_discount", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
    p_kind: parsed.data.kind,
    p_value: value,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}

export async function issueBillAction(orderId: string): Promise<Result<{ billId: string }>> {
  await assertRole(["admin", "counter"]);
  if (!z.uuid().safeParse(orderId).success) return { message: "Invalid order." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_bill", { p_order_id: orderId });
  if (error) return rpcError(error);
  await afterChange(orderId);
  return { ok: true, billId: data.id };
}

const creditSchema = z.object({
  orderId: z.uuid(),
  billId: z.uuid(),
  idempotencyKey: z.uuid(),
  amount: z.string(),
  reason: z.string().trim().min(3, "Give a reason for the credit note.").max(300),
});

export async function issueCreditNoteAction(input: z.input<typeof creditSchema>): Promise<Result> {
  await assertRole(["admin"]);
  const parsed = creditSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the credit note." };
  const amount = parseRupeesToPaise(parsed.data.amount);
  if (!amount) return { message: "Enter an amount in rupees." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("issue_credit_note", {
    p_bill_id: parsed.data.billId,
    p_idempotency_key: parsed.data.idempotencyKey,
    p_amount_paise: amount,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Packing and handover (Phase 5B)
// ---------------------------------------------------------------------------

const packSchema = z.object({ orderId: z.uuid(), version: z.number().int(), note: optionalText(300) });

export async function markPackedAction(input: z.input<typeof packSchema>): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = packSchema.safeParse(input);
  if (!parsed.success) return { message: "Keep the packing note under 300 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_packed", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
    p_note: parsed.data.note,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}

export async function reopenPackingAction(input: z.input<typeof transitionSchema>): Promise<Result> {
  await assertRole(["admin"]);
  const parsed = transitionSchema.safeParse(input);
  if (!parsed.success || !parsed.data.reason) return { message: "Give a reason for reopening." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reopen_packing", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
    p_reason: parsed.data.reason,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}

const handoverSchema = z.object({
  orderId: z.uuid(),
  version: z.number().int(),
  collectedBy: optionalText(80),
  // An admin's reason for handing over with a balance due (the "balance" refusal's override).
  creditReason: optionalText(300),
});

export async function recordHandoverAction(input: z.input<typeof handoverSchema>): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = handoverSchema.safeParse(input);
  if (!parsed.success) return { message: "Keep the collector's name under 80 characters." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_handover", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
    p_collected_by: parsed.data.collectedBy,
    p_credit_reason: parsed.data.creditReason,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Collect from store or set up at the customer's place (2026-10-09)
// ---------------------------------------------------------------------------

const setFulfilmentSchema = z.object({ orderId: z.uuid(), version: z.number().int(), ...fulfilmentSchema });

export async function setFulfilmentAction(input: z.input<typeof setFulfilmentSchema>): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = setFulfilmentSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the address and try again." };
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_fulfilment", {
    p_order_id: d.orderId,
    p_expected_version: d.version,
    p_fulfilment: d.fulfilment,
    p_setup_address: d.setupAddress,
    p_setup_note: d.setupNote,
  });
  if (error) return rpcError(error);
  await afterChange(d.orderId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Custom cake orders (2026-10-09). The photo is uploaded from the browser straight to Storage
// (too large for a server action) and then attached with setCustomCakePhotosAction.
// ---------------------------------------------------------------------------

const rupees = (label: string) =>
  z.string().transform((v, ctx) => {
    const paise = parseRupeesToPaise(v.trim() || "0");
    if (paise === null) {
      ctx.addIssue({ code: "custom", message: `Enter the ${label} in rupees, e.g. 1500 or 1500.50.` });
      return z.NEVER;
    }
    return paise;
  });

const customCakeSchema = z.object({
  idempotencyKey: z.uuid(),
  source: z.enum(["IN_STORE", "CALL", "CUSTOMER"]),
  customerName: z.string().trim().min(1, "Enter the customer's name.").max(80),
  customerPhone: z.string().trim().min(1, "Enter the customer's phone number.").max(20),
  dueLocal: z.string().min(1, "Choose the pickup date and time."),
  price: rupees("price"),
  cake: cakeDetailsSchema,
  advance: rupees("advance"),
  advanceMethod: z.enum(["cash", "upi", "card", "bank_transfer", "other"]).optional(),
  advanceReference: optionalText(100),
  advancePaidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a valid advance payment date.").optional(),
  customerNotes: optionalText(1000),
  internalNotes: optionalText(1000),
  confirm: z.boolean(),
  overrideReason: optionalText(300),
  ...fulfilmentSchema,
});

export type CustomCakeOrderInput = z.input<typeof customCakeSchema>;

export async function createCustomCakeOrderAction(input: CustomCakeOrderInput): Promise<Result<{ orderId: string }>> {
  await assertRole(["admin", "counter"]);
  const parsed = customCakeSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the order and try again." };
  const d = parsed.data;
  if (d.advance > 0 && !d.advanceMethod) return { message: "Choose how the advance was paid." };

  const timezone = await getBusinessTimezone();
  const due = zonedLocalToDate(d.dueLocal, timezone);
  if (!due) return { message: "Enter a valid pickup date and time." };
  const advancePaidAt = d.advance > 0 ? zonedDayStart(d.advancePaidOn ?? "", timezone) : null;
  if (d.advance > 0 && !advancePaidAt) return { message: "Choose a valid advance payment date." };
  if (d.advancePaidOn && d.advancePaidOn > zonedDayKey(new Date(), timezone)) {
    return { message: "The advance payment date cannot be in the future." };
  }

  const supabase = await createClient();
  const { data: order, error } = await supabase.rpc("create_custom_cake_order_with_advance_date", {
    p_idempotency_key: d.idempotencyKey,
    p_source: d.source,
    p_customer_name: d.customerName,
    p_customer_phone: d.customerPhone,
    p_due_at: due.toISOString(),
    p_price_paise: d.price,
    p_cake: cakeToJson(d.cake),
    p_customer_notes: d.customerNotes,
    p_internal_notes: d.internalNotes,
    p_confirm: d.confirm,
    p_override_reason: d.overrideReason,
    p_fulfilment: d.fulfilment,
    p_setup_address: d.setupAddress,
    p_setup_note: d.setupNote,
    p_advance_paise: d.advance,
    p_advance_method: d.advance > 0 ? d.advanceMethod : undefined,
    p_advance_reference: d.advanceReference,
    p_advance_paid_at: advancePaidAt?.toISOString(),
  });
  if (error) return rpcError(error);

  revalidatePath("/admin", "layout");
  if (order.status === "confirmed") await autoSendQuotation(order.id);
  return { ok: true, orderId: order.id };
}

const updateCakeSchema = z.object({
  orderId: z.uuid(),
  version: z.number().int(),
  price: rupees("price"),
  cake: cakeDetailsSchema,
});

export async function updateCustomCakeAction(input: z.input<typeof updateCakeSchema>): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = updateCakeSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the cake details." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_custom_cake", {
    p_order_id: parsed.data.orderId,
    p_expected_version: parsed.data.version,
    p_cake: cakeToJson(parsed.data.cake),
    p_price_paise: parsed.data.price,
  });
  if (error) return rpcError(error);
  await afterChange(parsed.data.orderId);
  return { ok: true };
}

const cakePhotosSchema = z.object({
  orderId: z.uuid(),
  paths: z.array(z.string().min(1).max(300)).max(MAX_CAKE_PHOTOS, `A custom cake can have up to ${MAX_CAKE_PHOTOS} reference photos.`),
});

// Sets the cake's reference photos (the whole list, in order); files dropped from it are deleted from Storage.
export async function setCustomCakePhotosAction(input: z.input<typeof cakePhotosSchema>): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = cakePhotosSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Invalid photos." };
  const { orderId, paths } = parsed.data;
  const supabase = await createClient();
  const { data: before } = await supabase.from("custom_cakes").select("photo_paths").eq("order_id", orderId).maybeSingle();
  const { error } = await supabase.rpc("set_custom_cake_photos", { p_order_id: orderId, p_photo_paths: paths });
  if (error) return rpcError(error);
  const dropped = (before?.photo_paths ?? []).filter((p) => !paths.includes(p));
  if (dropped.length) await supabase.storage.from("custom-cake-photos").remove(dropped);
  await afterChange(orderId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// WhatsApp messages (2026-10-19): staff open a ready-made message in WhatsApp; the timeline records it.
// ---------------------------------------------------------------------------

const messageSchema = z.object({
  orderId: z.uuid(),
  kind: z.enum(["received", "confirmed", "ready", "balance", "thanks"]),
});

export async function recordCustomerMessageAction(input: z.input<typeof messageSchema>): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) return { message: "Unknown message." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_customer_message", { p_order_id: parsed.data.orderId, p_kind: parsed.data.kind });
  if (error) return rpcError(error);
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  return { ok: true };
}

// Sticky note pinned on the order (2026-10-24). An empty note clears it.
const stickySchema = z.object({
  orderId: z.uuid(),
  note: z.string().max(500, "Keep the sticky note under 500 characters."),
  inWhatsApp: z.boolean(),
});

export async function setStickyNoteAction(input: z.input<typeof stickySchema>): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = stickySchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the note." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_sticky_note", {
    p_order_id: parsed.data.orderId,
    p_note: parsed.data.note,
    p_in_whatsapp: parsed.data.inWhatsApp,
  });
  if (error) return rpcError(error);
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  return { ok: true };
}

// A quotation file shared from this device (2026-10-24). The database checks the file belongs to the order.
const quotationSendSchema = z.object({
  orderId: z.uuid(),
  format: z.enum(["pdf", "png"]),
  channel: z.enum(["share_sheet", "download_and_chat"]),
  path: z.string().min(1).max(300),
  caption: z.string().max(2000),
});

export async function recordQuotationSendAction(input: z.input<typeof quotationSendSchema>): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = quotationSendSchema.safeParse(input);
  if (!parsed.success) return { message: "The Order in msg could not be recorded." };
  const { orderId, format, channel, path, caption } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_quotation_send", {
    p_order_id: orderId,
    p_format: format,
    p_channel: channel,
    p_status: channel === "share_sheet" ? "shared" : "downloaded",
    p_file_path: path,
    p_caption: caption,
  });
  if (error) return rpcError(error);
  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true };
}

// One tap: the server makes the file and sends it on WhatsApp Business itself (2026-10-24).
const quotationCloudSchema = z.object({ orderId: z.uuid(), format: z.enum(["pdf", "png"]) });

// One tap sends the bill and the Terms and Conditions, in the format the admin picked, straight to the
// WhatsApp of the number the customer gave on the order (owner, 2026-11-07).
export async function sendBillAndTermsAction(input: z.input<typeof quotationCloudSchema>): Promise<Result & { sent?: string[] }> {
  await assertRole(["admin", "counter"]);
  const parsed = quotationCloudSchema.safeParse(input);
  if (!parsed.success) return { message: "Invalid request." };
  const { orderId, format } = parsed.data;
  if (!cloudFormats(whatsappCloudConfig()).includes(format)) return { message: "Automatic WhatsApp sending is not set up." };
  const supabase = await createClient();
  const [{ sendQuotationFromServer }, { sendTermsFromServer }] = await Promise.all([import("@/lib/quotation-send"), import("@/lib/terms-send")]);
  const bill = await sendQuotationFromServer(supabase, orderId, format);
  const terms = await sendTermsFromServer(supabase, orderId, { automatic: false, formats: [format] });
  revalidatePath(`/admin/orders/${orderId}`);
  const sent = [...(bill.ok ? ["bill"] : []), ...(terms.ok ? ["Terms"] : [])];
  if (bill.ok && terms.ok) return { ok: true, sent };
  const problem = !bill.ok ? `Bill not sent: ${bill.message}` : !terms.ok ? `Terms not sent: ${terms.message}` : "";
  return { message: sent.length ? `${sent.join(" and ")} sent. ${problem}` : problem, sent };
}

export async function sendQuotationNowAction(input: z.input<typeof quotationCloudSchema>): Promise<Result> {
  await assertRole(["admin", "counter"]);
  const parsed = quotationCloudSchema.safeParse(input);
  if (!parsed.success) return { message: "Invalid request." };
  const { orderId, format } = parsed.data;
  if (!cloudFormats(whatsappCloudConfig()).includes(format)) return { message: "Automatic WhatsApp sending is not set up." };
  const { sendQuotationFromServer } = await import("@/lib/quotation-send");
  const r = await sendQuotationFromServer(await createClient(), orderId, format);
  revalidatePath(`/admin/orders/${orderId}`);
  return r.ok ? { ok: true } : { message: r.message };
}