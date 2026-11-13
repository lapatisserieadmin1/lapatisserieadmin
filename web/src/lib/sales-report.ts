// Reports (owner, 2026-10-28): one row per order with its date, the customer's number, the kilos and the
// price, and a total row. Pure: imported by unit tests, so keep any imports from "@/" type-only.

// "1 kg", "1 kg Eggless", "500 g", "250 g box" → kilos; sizes without a weight ("Each", "Box of 6") → null.
export function variantKg(name: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(kg|g)\b/i.exec(name);
  if (!m) return null;
  const n = Number(m[1]);
  return m[2].toLowerCase() === "kg" ? n : n / 1000;
}

export type ReportItem = { variant_name: string; quantity: number; cancelled_quantity: number };

// A custom cake's weight is its kilos; otherwise the weighed sizes are added up. null when nothing is weighed.
export function orderKg(items: ReportItem[], cakeKg: number | null): number | null {
  if (cakeKg !== null) return round(cakeKg);
  let kg: number | null = null;
  for (const i of items) {
    const each = variantKg(i.variant_name);
    const qty = i.quantity - i.cancelled_quantity;
    if (each !== null && qty > 0) kg = (kg ?? 0) + each * qty;
  }
  return kg === null ? null : round(kg);
}

export type ReportRow = { id: string; date: string; phone: string | null; kg: number | null; pricePaise: number };

export function reportTotals(rows: ReportRow[]): { kg: number; pricePaise: number } {
  return {
    kg: round(rows.reduce((s, r) => s + (r.kg ?? 0), 0)),
    pricePaise: rows.reduce((s, r) => s + r.pricePaise, 0),
  };
}

function round(kg: number): number {
  return Math.round(kg * 1000) / 1000;
}

export function formatKg(kg: number | null): string {
  return kg === null ? "—" : `${Number(kg.toFixed(3))} kg`;
}
