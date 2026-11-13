import { test } from "node:test";
import assert from "node:assert/strict";
import { productPhotoPath } from "./product-photo.ts";

test("the storage path of a product photo comes from its public URL", () => {
  assert.equal(
    productPhotoPath("https://abc.supabase.co/storage/v1/object/public/product-photos/p1/x.jpg"),
    "p1/x.jpg",
  );
  assert.equal(productPhotoPath("https://example.com/cake.jpg"), null);
  assert.equal(productPhotoPath(null), null);
});
