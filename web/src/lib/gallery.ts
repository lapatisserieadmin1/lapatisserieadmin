// Website gallery (owner, 2026-10-20). Pure: imported by unit tests, so keep any imports from "@/" type-only.
import { z } from "zod";
import { productPhotoPath } from "./product-photo.ts";

// Gallery photos live in the public product-photos bucket under gallery/.
export const GALLERY_PHOTO_FOLDER = "gallery";
export const GALLERY_MAX_UPLOAD = 20;

export function isGalleryPhotoUrl(url: string): boolean {
  return Boolean(productPhotoPath(url)?.startsWith(`${GALLERY_PHOTO_FOLDER}/`));
}

export const galleryPhotoSchema = z.object({
  caption: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v),
    z.string().max(60, "Keep the caption under 60 characters.").nullable(),
  ),
  sort_order: z.coerce.number().int("Order is a whole number.").min(0).max(9999),
  is_active: z.boolean(),
});
