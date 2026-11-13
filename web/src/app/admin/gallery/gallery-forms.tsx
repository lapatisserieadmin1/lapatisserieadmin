"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Checkbox, Input, cx } from "@/components/ui";
import { FormMessage, SubmitButton, type ActionState } from "@/components/form-status";
import { browserClient } from "@/lib/supabase/browser";
import { uploadPhoto } from "@/lib/photo-upload";
import { GALLERY_MAX_UPLOAD, GALLERY_PHOTO_FOLDER } from "@/lib/gallery";
import type { Tables } from "@/lib/database.types";

type Photo = Tables<"gallery_photos">;

// Pick one or more photos: each goes straight to Storage (gallery/…), then they are added in one go.
export function AddGalleryPhotos({ action }: { action: (urls: string[]) => Promise<ActionState> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState<string | null>(null);
  const [state, setState] = useState<ActionState>({});

  function pick(list: FileList | null) {
    const files = [...(list ?? [])].slice(0, GALLERY_MAX_UPLOAD);
    if (!files.length) return;
    setState({});
    start(async () => {
      const urls: string[] = [];
      const failed: string[] = [];
      for (const [i, file] of files.entries()) {
        setProgress(`Uploading ${i + 1} of ${files.length}…`);
        const uploaded = await uploadPhoto("product-photos", GALLERY_PHOTO_FOLDER, file);
        if ("error" in uploaded) failed.push(`${file.name}: ${uploaded.error}`);
        else urls.push(browserClient().storage.from("product-photos").getPublicUrl(uploaded.path).data.publicUrl);
      }
      setProgress(null);
      const result = urls.length ? await action(urls) : { message: "No photo was uploaded." };
      setState(failed.length ? { ok: result.ok, message: `${result.message ?? ""} Not added: ${failed.join("; ")}` } : result);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <label
          className={cx(
            "cursor-pointer rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-strong",
            pending && "pointer-events-none opacity-60",
          )}
        >
          {pending ? (progress ?? "Saving…") : "Add photos"}
          <input
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            onChange={(e) => {
              pick(e.target.files);
              e.target.value = "";
            }}
          />
        </label>
        <p className="text-sm text-muted">Pick up to {GALLERY_MAX_UPLOAD} at once. JPEG, PNG or WebP, up to 5 MB each.</p>
      </div>
      {state.message && <Alert tone={state.ok ? "ok" : "danger"}>{state.message}</Alert>}
    </div>
  );
}

export function GalleryPhotoCard({
  photo,
  saveAction,
  deleteAction,
}: {
  photo: Photo;
  saveAction: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  deleteAction: () => Promise<void>;
}) {
  const [state, formAction] = useActionState(saveAction, {});
  const [deleting, startDelete] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const id = photo.id;

  return (
    <li className={cx("flex flex-col overflow-hidden rounded-2xl border bg-surface", photo.is_active ? "border-line" : "border-dashed border-line opacity-70")}>
      <div className="relative aspect-[4/3] bg-brand-soft">
        {/* eslint-disable-next-line @next/next/no-img-element -- Storage URL */}
        <img src={photo.image_url} alt={photo.caption ?? ""} loading="lazy" className="h-full w-full object-cover" />
        {!photo.is_active && <Badge className="absolute left-2 top-2">Hidden</Badge>}
      </div>
      <form action={formAction} className="flex flex-col gap-3 p-3">
        <div>
          <label htmlFor={`${id}-caption`} className="mb-1 block text-xs font-medium text-muted">Caption (optional)</label>
          <Input id={`${id}-caption`} name="caption" maxLength={60} defaultValue={photo.caption ?? ""} placeholder="e.g. Wedding cake" />
          {state.fieldErrors?.caption && <p className="mt-1 text-xs text-danger">{state.fieldErrors.caption}</p>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-20">
            <label htmlFor={`${id}-sort`} className="mb-1 block text-xs font-medium text-muted">Order</label>
            <Input id={`${id}-sort`} name="sort_order" inputMode="numeric" defaultValue={photo.sort_order} />
          </div>
          <div className="pb-2">
            <Checkbox name="is_active" label="Show" defaultChecked={photo.is_active} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton variant="secondary">Save</SubmitButton>
          {confirming ? (
            <>
              <Button type="button" variant="danger" disabled={deleting} onClick={() => startDelete(() => deleteAction())}>
                {deleting ? "Deleting…" : "Delete"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
            </>
          ) : (
            <Button type="button" variant="ghost" onClick={() => setConfirming(true)}>Delete</Button>
          )}
        </div>
        <FormMessage state={state} />
      </form>
    </li>
  );
}
