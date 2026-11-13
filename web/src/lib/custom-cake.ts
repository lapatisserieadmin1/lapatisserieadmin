// Custom cake details (owner, 2026-10-09). Pure: imported by unit tests, so keep any imports from "@/" type-only.
import { z } from "zod";
import { parseRupeesToPaise } from "./money.ts";

const optional = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label}: at most ${max} characters.`)
    .transform((v) => v.trim() || undefined)
    .optional();

// A charge typed in rupees ("" is none), kept as paise.
const charge = (label: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      const paise = parseRupeesToPaise(v?.trim() || "0");
      if (paise === null || paise > 100_000_000) {
        ctx.addIssue({ code: "custom", message: `${label}: enter rupees between 0 and 10,00,000, e.g. 500.` });
        return z.NEVER;
      }
      return paise;
    });

// How many cupcakes or popsicles come with the cake ("" or 0 = none), owner 2026-10-24.
const count = (label: string) =>
  z.coerce
    .number({ error: `${label}: enter a whole number.` })
    .int(`${label}: enter a whole number.`)
    .min(0, `${label}: enter 0 to 999.`)
    .max(999, `${label}: enter 0 to 999.`)
    .optional()
    .default(0);

// Mirrors private.clean_cake in the database; the database has the final say. Filling and toppings left
// the form on 2026-10-24: values saved before stay on the cake and are still shown.
export const cakeDetailsSchema = z.object({
  flavour: z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, "Enter the flavour.").max(80, "Keep the flavour under 80 characters.")),
  weightKg: z.coerce
    .number({ error: "Enter the weight in kg." })
    .min(0.25, "Weight must be between 0.25 and 50 kg.")
    .max(50, "Weight must be between 0.25 and 50 kg."),
  tiers: z.coerce.number().int("Tiers must be a whole number.").min(1, "Tiers must be between 1 and 10.").max(10, "Tiers must be between 1 and 10."),
  theme: optional(200, "Theme"),
  design: optional(200, "Colour"),
  model: optional(200, "Model"),
  fondant: optional(80, "Fondant"),
  cream: optional(80, "Cream"),
  message: optional(120, "Message"),
  isEggless: z.boolean(),
  instructions: optional(1000, "Instructions"),
  cupcakeCount: count("Cupcakes"),
  popsicleCount: count("Popsicles"),
  setupCharge: charge("Set-up charges"),
  deliveryCharge: charge("Delivery charges"),
  // The "Add on" tick (2026-10-28): unticked, the details and amount are not saved.
  hasAddon: z.boolean().optional(),
  addonDetails: optional(500, "Add-on details"),
  addonCharge: charge("Add-on amount"),
});

export type CakeDetailsInput = z.input<typeof cakeDetailsSchema>;
export type CakeDetails = z.output<typeof cakeDetailsSchema>;

// The jsonb the database functions take (custom_cakes column names).
export function cakeToJson(c: CakeDetails) {
  return {
    flavour: c.flavour,
    weight_kg: c.weightKg,
    tiers: c.tiers,
    theme: c.theme ?? null,
    design: c.design ?? null,
    model: c.model ?? null,
    fondant: c.fondant ?? null,
    cream: c.cream ?? null,
    message: c.message ?? null,
    is_eggless: c.isEggless,
    instructions: c.instructions ?? null,
    cupcake_count: c.cupcakeCount,
    popsicle_count: c.popsicleCount,
    setup_charge_paise: c.setupCharge,
    delivery_charge_paise: c.deliveryCharge,
    addon_details: c.hasAddon === false ? null : (c.addonDetails ?? null),
    addon_charge_paise: c.hasAddon === false ? 0 : c.addonCharge,
  };
}

// "1.5 kg · 2 tiers": the order line's variant name, as private.cake_size_name writes it.
export function cakeSizeName(weightKg: number, tiers: number): string {
  const kg = Number(weightKg.toFixed(2)).toString();
  return `${kg} kg${tiers > 1 ? ` · ${tiers} tiers` : ""}`;
}

type Extras = { cupcake_count?: number | null; popsicle_count?: number | null; has_cupcakes: boolean; has_popsicles: boolean };

// Cupcakes and popsicles with a cake. Counts since 2026-10-24; a cake saved before has only the tick (1).
export function cakeExtraCounts(c: Extras): { cupcakes: number; popsicles: number } {
  return {
    cupcakes: typeof c.cupcake_count === "number" ? c.cupcake_count : c.has_cupcakes ? 1 : 0,
    popsicles: typeof c.popsicle_count === "number" ? c.popsicle_count : c.has_popsicles ? 1 : 0,
  };
}

// "12 cupcakes, 1 popsicle", or "" for none.
export function cakeExtras(c: Extras): string {
  const { cupcakes, popsicles } = cakeExtraCounts(c);
  const part = (n: number, word: string) => (n > 0 ? `${n} ${word}${n === 1 ? "" : "s"}` : null);
  return [part(cupcakes, "cupcake"), part(popsicles, "popsicle")].filter(Boolean).join(", ");
}

export const CAKE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
export const CAKE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function cakePhotoProblem(file: { type: string; size: number }): string | null {
  if (!(CAKE_PHOTO_TYPES as readonly string[]).includes(file.type)) return "Use a JPEG, PNG or WebP photo.";
  if (file.size > CAKE_PHOTO_MAX_BYTES) return "The photo is larger than 5 MB.";
  return null;
}

// Reference photos per custom cake (owner, 2026-10-21; was 1). The database checks it too.
export const MAX_CAKE_PHOTOS = 5;

export function photoExtension(type: string): string {
  return type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
}
