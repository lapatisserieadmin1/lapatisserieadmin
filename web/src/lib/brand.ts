// La Patisserie Madras brand (owner, 2026-10-28). Pure: imported by unit tests and server renderers.
export const SHOP_NAME = "La Patisserie Madras";

// The one address shown on the bill and the "Order in msg" file and text; bills print it line by line.
export const SHOP_ADDRESS_LINES = [
  "Bharath Nagar Extn, 7, Water Canal Rd,",
  "Near Alliance Orchid Springs Apartment,",
  "Korattur, Chennai,",
  "Tamil Nadu 600099",
] as const;
export const SHOP_ADDRESS =
  "Bharath Nagar Extn, 7, Water Canal Rd, near Alliance Orchid Springs Apartment, Korattur, Chennai, Tamil Nadu 600099";
// Colours from the logo and the icing-drip image, for renderers that cannot read CSS variables.
export const BRAND_COLOURS = { ink: "#111111", pink: "#E8838A", teal: "#26C6BC", chocolate: "#4A2418", cream: "#F7F3EE" } as const;

export const LOGO_SRC = "/brand/logo-round.png";
// "La Patisserie" and "MADRAS" traced from the logo without its circle; the PNG is for renderers without SVG.
export const WORDMARK_SRC = "/brand/wordmark.svg";

export const SHOP_UPI = "9884882516";

// The customer's Terms and Conditions (owner, 2026-10-28): sent on WhatsApp as an image or PDF from the
// order page and the calendar, and printed on every bill.
export type TermsSection = { title: string; bullets?: string[]; paragraphs?: string[] };
export const ORDER_TERMS: TermsSection[] = [
  {
    title: "Payment Terms",
    bullets: [
      "Dates and time slots are reserved only after payment is received.",
      "Kindly mention your event date and the baby's name in the GPay payment note to help identify.",
      "Making the payment promptly will help us avoid any delay in dispatching the cake.",
      "100% advance payment is required before the event / delivery. Please note that the cake can only be sent once the pending payment has been received.",
      "No cash payments accepted. Only GPay.",
    ],
  },
  {
    title: "Delivery Arrangement",
    paragraphs: [
      "Cab/Rapido bike has to be arranged by the customer for pickup from our location. The delivery charges will be borne by the customer.",
      "We kindly request that the admin not be approached for cab bookings, as this may lead to confusion in the arrangements.",
    ],
  },
  {
    title: "Cake Disclaimer: Food Colours",
    paragraphs: [
      "We use only permitted food-grade colours that are safe for consumption. Some cake designs require deep or vibrant shades such as black, red, navy blue, emerald green, etc., which may require a higher quantity of food colouring. Dark and vibrant colours may temporarily stain the tongue, lips, teeth or hands after consumption. This is normal and harmless.",
      "Slight variations in colour may occur due to lighting, photography, screen settings, and the nature of edible colours. Colour intensity may also vary slightly from the reference image while maintaining the overall design and aesthetic.",
      "If you prefer minimal or no artificial food colouring, please inform us while placing your order so we can recommend suitable alternatives.",
    ],
  },
  {
    title: "Cake Disclaimer: Cake Supports & Decorations",
    paragraphs: [
      "Certain cake designs, especially fondant and tiered cakes, may contain internal supports such as toothpicks/skewers used to secure fondant decorations and food-safe dowels used to support the cake structure and keep tiers stable and straight. Please carefully check the cake and remove all non-edible decorations and internal supports before cutting and serving.",
      "By confirming your order, you acknowledge and accept the use of food-grade colours and the necessary structural supports required to achieve and safely maintain your selected cake design.",
    ],
  },
  {
    title: "Payment Confirmation",
    paragraphs: [
      "Kindly complete the payment using the details below to confirm your order.",
      `UPI / GPay: ${SHOP_UPI}`,
      `Name: ${SHOP_NAME}`,
    ],
  },
];

// The short version printed on cake sheets.
export const CAKE_SHEET_TERMS = [
  "Dates and time slots are reserved only after payment is received.",
  "100% advance payment before the event / delivery.",
  "GPay only. No cash.",
  "Mention the event date and the baby's name in the GPay note.",
];
