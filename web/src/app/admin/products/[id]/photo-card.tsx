"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, cx } from "@/components/ui";
import { ProductThumb } from "@/components/product-thumb";
import { uploadPhoto } from "@/lib/photo-upload";
import { setProductPhotoAction } from "../actions";

// One photo per product: shown on the order screens and (later) the website.
export function ProductPhoto({ productId, name, url, canEdit }: { productId: string; name: string; url: string | null; canEdit: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function change(file: File | null) {
    setError(null);
    start(async () => {
      let path: string | null = null;
      if (file) {
        const uploaded = await uploadPhoto("product-photos", productId, file);
        if ("error" in uploaded) return setError(uploaded.error);
        path = uploaded.path;
      }
      const result = await setProductPhotoAction({ productId, path }).catch(() => ({ ok: false as const, message: "Not saved, check the connection." }));
      if (result.ok) router.refresh();
      else setError(result.message ?? "Could not change the photo.");
    });
  }

  return (
    <div className="flex flex-wrap items-start gap-4">
      <ProductThumb url={url} name={name} size="lg" />
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">JPEG, PNG or WebP, up to 5 MB. A square photo looks best.</p>
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <label className={cx("cursor-pointer rounded-lg border border-line bg-surface px-3 py-2 text-sm font-medium hover:bg-brand-soft", pending && "pointer-events-none opacity-60")}>
              {pending ? "Saving…" : url ? "Replace photo" : "Add photo"}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => change(e.target.files?.[0] ?? null)} />
            </label>
            {url && <Button variant="ghost" disabled={pending} onClick={() => change(null)}>Remove photo</Button>}
          </div>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </div>
  );
}
