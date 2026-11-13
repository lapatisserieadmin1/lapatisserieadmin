// Cake orders get the Terms and Conditions on WhatsApp automatically when they are confirmed (owner,
// 2026-11-07): an order with a custom cake, or with any item (not removed) from a cake category.
// Pure: imported by unit tests.
export function isCakeOrder(o: { hasCustomCake: boolean; itemCategories: (string | null | undefined)[] }): boolean {
  return o.hasCustomCake || o.itemCategories.some((name) => Boolean(name && /cake/i.test(name)));
}
