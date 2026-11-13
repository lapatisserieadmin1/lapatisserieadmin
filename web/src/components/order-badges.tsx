import { Badge } from "@/components/ui";
import { fulfilmentLabel, sourceLabel, statusLabel, statusTone, type Fulfilment, type OrderSource, type OrderStatus } from "@/lib/orders";

export function StatusBadge({ status }: { status: OrderStatus }) {
  return <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>;
}

// Call, Customer and Online share a list, so their badges must look different, not just read differently (AC-01).
const sourceStyles: Record<OrderSource, string> = {
  IN_STORE: "border-line bg-canvas text-ink",
  CALL: "border-sky-300 bg-sky-50 text-sky-800",
  ONLINE: "border-violet-300 bg-violet-50 text-violet-800",
  CUSTOMER: "border-amber-300 bg-amber-50 text-amber-800",
};
const sourceIcons: Record<OrderSource, string> = { IN_STORE: "🏪", CALL: "📞", ONLINE: "🌐", CUSTOMER: "💬" };

export function SourceBadge({ source }: { source: OrderSource }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${sourceStyles[source]}`}>
      <span aria-hidden>{sourceIcons[source]}</span>
      {sourceLabel[source]}
    </span>
  );
}

// Collect from the store is green, set up at the customer's place is red (owner, 2026-10-09).
export function FulfilmentBadge({ fulfilment }: { fulfilment: Fulfilment }) {
  const setup = fulfilment === "setup";
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold ${
        setup ? "border-danger/40 bg-danger-soft text-danger" : "border-ok/40 bg-ok-soft text-ok"
      }`}
    >
      <span aria-hidden>{setup ? "🚚" : "🏪"}</span>
      {fulfilmentLabel[fulfilment]}
    </span>
  );
}

// Call, Customer and Online orders show the customer's number in the source's colours; tapping it rings
// them (owner, 2026-10-15). In-store orders, and orders without a number, keep the source badge. In a row
// whose own link is stretched over it (after:absolute after:inset-0), this badge sits above it (z-10).
export function ContactBadge({ source, phone }: { source: OrderSource; phone: string | null }) {
  if (!phone || source === "IN_STORE") return <SourceBadge source={source} />;
  return (
    <a
      href={`tel:${phone}`}
      title={`${sourceLabel[source]} order · tap to call`}
      aria-label={`Call ${phone} (${sourceLabel[source]} order)`}
      className={`relative z-10 inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium tabular-nums hover:underline ${sourceStyles[source]}`}
    >
      <span aria-hidden>📞</span>
      {phone}
    </a>
  );
}
