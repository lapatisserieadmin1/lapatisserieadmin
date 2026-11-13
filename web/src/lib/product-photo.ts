// Product photos live in the public "product-photos" bucket; products.image_url keeps the public URL.
// Pure: imported by unit tests.
const MARKER = "/storage/v1/object/public/product-photos/";

// The object path inside the bucket, or null for a URL that is not one of ours.
export function productPhotoPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const at = url.indexOf(MARKER);
  return at === -1 ? null : decodeURIComponent(url.slice(at + MARKER.length));
}
