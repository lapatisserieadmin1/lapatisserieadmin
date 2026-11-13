import { test } from "node:test";
import assert from "node:assert/strict";
import { galleryPhotoSchema, isGalleryPhotoUrl } from "./gallery.ts";

test("only photos uploaded to the gallery folder are accepted", () => {
  assert.ok(isGalleryPhotoUrl("https://x.supabase.co/storage/v1/object/public/product-photos/gallery/a.jpg"));
  assert.ok(!isGalleryPhotoUrl("https://x.supabase.co/storage/v1/object/public/product-photos/offers/a.jpg"));
  assert.ok(!isGalleryPhotoUrl("https://evil.example.com/gallery/a.jpg"));
});

test("caption is optional and trimmed; order is a whole number", () => {
  assert.deepEqual(galleryPhotoSchema.parse({ caption: "  ", sort_order: "3", is_active: true }), { caption: null, sort_order: 3, is_active: true });
  assert.equal(galleryPhotoSchema.parse({ caption: " Wedding cake ", sort_order: "0", is_active: false }).caption, "Wedding cake");
  assert.ok(!galleryPhotoSchema.safeParse({ caption: "x".repeat(61), sort_order: "0", is_active: true }).success);
  assert.ok(!galleryPhotoSchema.safeParse({ caption: null, sort_order: "1.5", is_active: true }).success);
});
