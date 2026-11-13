import type { PostgrestError } from "@supabase/supabase-js";
import type { Enums } from "@/lib/database.types";

export type OrderStatus = Enums<"order_status">;
export type OrderSource = Enums<"order_source">;
export type PaymentMethod = Enums<"payment_method">;
export type Fulfilment = Enums<"fulfilment_type">;

export const statusLabel: Record<OrderStatus, string> = {
  draft: "Draft",
  pending_confirmation: "Pending confirmation",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  completed: "Completed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

// Colours follow the owner's mock-up: pending pink, confirmed blue, preparing yellow, done green.
export const statusTone: Record<OrderStatus, "neutral" | "brand" | "info" | "ok" | "warn" | "danger"> = {
  draft: "neutral",
  pending_confirmation: "brand",
  confirmed: "info",
  preparing: "warn",
  ready: "ok",
  completed: "ok",
  rejected: "danger",
  cancelled: "danger",
};

// The top-bar search (scope=all) looks in both lists and every status; the search box on the
// orders page stays within the list and filters shown.
export function searchEverywhere(q: string, scope: string): boolean {
  return q.length > 0 && scope === "all";
}

export const sourceLabel: Record<OrderSource, string> = {
  IN_STORE: "In-store",
  ONLINE: "Online",
  CALL: "Call",
  CUSTOMER: "Customer",
};

// The two source lists on the Orders page (a third tab, Custom cakes, lists orders by their lines).
export type ListKey = "in_store" | "online_call";
export const ORDER_LISTS: Record<ListKey, { label: string; sources: OrderSource[] }> = {
  in_store: { label: "In-store", sources: ["IN_STORE"] },
  online_call: { label: "Online / Call / Customer", sources: ["ONLINE", "CALL", "CUSTOMER"] },
};

export function listKeyForSource(source: OrderSource): ListKey {
  return source === "IN_STORE" ? "in_store" : "online_call";
}

// Kitchen routing (owner, 2026-10-24; the database sets orders.kitchen_id): custom cake orders are made
// in Kitchen 1, every other order ("web orders": website and catalogue orders) in Kitchen 2.
export type OrderKind = "web" | "custom";
export const KITCHEN_CODE_FOR: Record<OrderKind, string> = { custom: "K1", web: "K2" };
export const orderKindLabel: Record<OrderKind, string> = { web: "Online orders", custom: "Customised orders" };

export function kitchenListLabel(code: string | null | undefined): string {
  return code === KITCHEN_CODE_FOR.custom ? orderKindLabel.custom : code === KITCHEN_CODE_FOR.web ? orderKindLabel.web : "Orders";
}

// Pickup/Cab from the store (green; "Collect" until 2026-10-28) or set up at the customer's place (red), owner 2026-10-09. The colour
// always comes with the words, never on its own.
export const fulfilmentLabel: Record<Fulfilment, string> = {
  collect: "Pickup/Cab",
  setup: "Set up",
};

export function fulfilmentRowClass(f: Fulfilment | null | undefined): string {
  if (f === "setup") return "border-l-4 border-l-danger bg-danger-soft/40";
  if (f === "collect") return "border-l-4 border-l-ok bg-ok-soft/30";
  return "";
}

export const paymentMethodLabel: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank_transfer: "Bank transfer",
  other: "Other",
};

export const OPEN_STATUSES: OrderStatus[] = ["draft", "pending_confirmation", "confirmed", "preparing", "ready"];

export type RpcFailure = { ok?: false; message?: string; kind?: string };

// Order functions raise staff-facing messages with a category in `hint` (see migration 0200).
export function rpcError(error: PostgrestError): RpcFailure {
  if (error.code === "P0001") {
    return { message: error.message, kind: error.hint ?? "validation" };
  }
  if (error.code === "42501") return { message: "You do not have permission to do this.", kind: "forbidden" };
  return { message: `Something went wrong: ${error.message}`, kind: "error" };
}

// Refusals an admin may override with a recorded reason (AC-32, AC-36). "balance": handing over
// with money still due, as an admin credit exception (AC-10).
export const OVERRIDABLE_KINDS = new Set(["slot", "lead_time", "blocked", "capacity", "balance"]);

// Matches the database check in create_order, confirm_order and reschedule_order.
export const OVERRIDE_REASON_MIN = 5;
