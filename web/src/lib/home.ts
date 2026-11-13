// Home screen figures. Pure: imported by unit tests, so keep any imports from "@/" type-only.

// Money received minus money refunded (payment dates, the same rule as the sales report).
export function netCollected(payments: { kind: string; amount_paise: number }[]): number {
  return payments.reduce((sum, p) => sum + (p.kind === "refund" ? -p.amount_paise : p.amount_paise), 0);
}
