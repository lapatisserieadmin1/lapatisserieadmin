// The customer's address and landmark (orders.setup_address / setup_note), kept for set-up and Pickup/Cab
// orders alike. A Google Maps search for them; the landmark helps when the address alone is vague.
export function mapsUrl(address: string | null | undefined, landmark?: string | null): string | null {
  const query = [address?.trim(), landmark?.trim()].filter(Boolean).join(", ");
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : null;
}
