"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, ButtonLink, Field, Input, cx } from "@/components/ui";
import { CakeChargeFields, CakeFields, type CakeFormValue } from "@/components/cake-fields";
import { MAX_CAKE_PHOTOS, cakeExtraCounts, cakePhotoProblem } from "@/lib/custom-cake";
import { formatPaise, paiseToRupeesInput } from "@/lib/money";
import { uploadPhoto } from "@/lib/photo-upload";
import { setCustomCakePhotosAction, updateCustomCakeAction } from "../actions";

export type CustomCake = {
  flavour: string;
  weight_kg: number;
  tiers: number;
  theme: string | null;
  design: string | null;
  model: string | null;
  fondant: string | null;
  cream: string | null;
  filling: string | null;
  toppings: string | null;
  message: string | null;
  is_eggless: boolean;
  instructions: string | null;
  has_cupcakes: boolean;
  has_popsicles: boolean;
  cupcake_count: number;
  popsicle_count: number;
  setup_charge_paise: number;
  delivery_charge_paise: number;
  addon_details: string | null;
  addon_charge_paise: number;
};

export type CakePhoto = { path: string; url: string | null };

// The custom cake as a yellow sticky note (owner's mock-up), with its photos (up to 5), edit and print.
export function CakeCard({
  orderId,
  version,
  cake,
  pricePaise,
  photos,
  canEdit,
  canChangePhoto,
}: {
  orderId: string;
  version: number;
  cake: CustomCake;
  pricePaise: number;
  photos: CakePhoto[];
  canEdit: boolean;
  canChangePhoto: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<CakeFormValue>(() => ({
    flavour: cake.flavour,
    weightKg: String(Number(cake.weight_kg)),
    tiers: String(cake.tiers),
    theme: cake.theme ?? "",
    design: cake.design ?? "",
    model: cake.model ?? "",
    fondant: cake.fondant ?? "",
    cream: cake.cream ?? "",
    message: cake.message ?? "",
    isEggless: cake.is_eggless,
    instructions: cake.instructions ?? "",
    cupcakeCount: String(cakeExtraCounts(cake).cupcakes),
    popsicleCount: String(cakeExtraCounts(cake).popsicles),
    setupCharge: cake.setup_charge_paise ? paiseToRupeesInput(cake.setup_charge_paise) : "",
    deliveryCharge: cake.delivery_charge_paise ? paiseToRupeesInput(cake.delivery_charge_paise) : "",
    hasAddon: Boolean(cake.addon_details || cake.addon_charge_paise),
    addonDetails: cake.addon_details ?? "",
    addonCharge: cake.addon_charge_paise ? paiseToRupeesInput(cake.addon_charge_paise) : "",
  }));
  const [price, setPrice] = useState(paiseToRupeesInput(pricePaise));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const result = await updateCustomCakeAction({
        orderId,
        version,
        price,
        cake: { ...value },
      }).catch(() => ({ ok: false as const, message: "Not saved, check the connection." }));
      if (result.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(result.message ?? "Could not save the cake.");
      }
    });
  }

  function savePhotos(paths: string[]) {
    return setCustomCakePhotosAction({ orderId, paths }).catch(() => ({ ok: false as const, message: "Not saved, check the connection." }));
  }

  function addPhotos(files: File[]) {
    setError(null);
    const room = MAX_CAKE_PHOTOS - photos.length;
    if (files.length > room) return setError(`A custom cake can have up to ${MAX_CAKE_PHOTOS} photos. You can add ${room} more.`);
    const problem = files.map(cakePhotoProblem).find(Boolean);
    if (problem) return setError(problem);
    start(async () => {
      const added: string[] = [];
      for (const file of files) {
        const uploaded = await uploadPhoto("custom-cake-photos", orderId, file);
        if ("error" in uploaded) {
          setError(uploaded.error);
          break;
        }
        added.push(uploaded.path);
      }
      if (!added.length) return;
      const result = await savePhotos([...photos.map((p) => p.path), ...added]);
      if (result.ok) router.refresh();
      else setError(result.message ?? "Could not add the photos.");
    });
  }

  function removePhoto(path: string) {
    setError(null);
    start(async () => {
      const result = await savePhotos(photos.map((p) => p.path).filter((p) => p !== path));
      if (result.ok) router.refresh();
      else setError(result.message ?? "Could not remove the photo.");
    });
  }

  const rows: [string, string | null][] = [
    ["Flavour", cake.flavour],
    ["Size", `${Number(cake.weight_kg)} kg${cake.tiers > 1 ? ` · ${cake.tiers} tiers` : ""}`],
    ["Theme", cake.theme],
    ["Colour", cake.design],
    ["Model", cake.model],
    ["Fondant", cake.fondant],
    ["Cream", cake.cream],
    // No longer on the form (2026-10-24); shown when an older cake has them.
    ["Filling", cake.filling],
    ["Toppings", cake.toppings],
    ["Cupcakes", cakeExtraCounts(cake).cupcakes ? String(cakeExtraCounts(cake).cupcakes) : null],
    ["Popsicles", cakeExtraCounts(cake).popsicles ? String(cakeExtraCounts(cake).popsicles) : null],
    ["Instructions", cake.instructions],
    ["Set-up charges", cake.setup_charge_paise ? formatPaise(cake.setup_charge_paise) : null],
    ["Delivery charges", cake.delivery_charge_paise ? formatPaise(cake.delivery_charge_paise) : null],
    ["Add on", cake.addon_details],
    ["Add-on amount", cake.addon_charge_paise ? formatPaise(cake.addon_charge_paise) : null],
  ];

  return (
    <section aria-label="Custom cake" className="relative rotate-[-0.3deg] rounded-sm border border-note-line bg-note p-5 shadow-[0_10px_24px_-14px_rgba(120,90,0,0.45)]">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <h2 className="font-display text-xl font-semibold">🎂 Custom cake</h2>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/print/cake/${orderId}`} variant="secondary">Print cake sheet</ButtonLink>
          {canEdit && !editing && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
        </div>
      </div>

      {editing ? (
        <div className="flex flex-col gap-4 rounded-xl bg-surface/80 p-4">
          <CakeFields value={value} onChange={setValue} idPrefix="edit-cake" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Cake price (₹)" htmlFor="edit-cake-price" hint="Price and charges change the order total.">
              <Input id="edit-cake-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
            </Field>
            <CakeChargeFields value={value} onChange={setValue} idPrefix="edit-cake" />
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex gap-2">
            <Button disabled={pending} onClick={save}>{pending ? "Saving…" : "Save cake"}</Button>
            <Button variant="secondary" onClick={() => { setEditing(false); setError(null); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            {cake.message && (
              <p className="mb-3 font-display text-2xl italic leading-tight text-script">“{cake.message}”</p>
            )}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {rows
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{k}</dt>
                    <dd className="font-medium">{v}</dd>
                  </div>
                ))}
            </dl>
            <p className={cx("mt-3 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold", cake.is_eggless ? "bg-ok-soft text-ok" : "bg-surface text-ink")}>
              {cake.is_eggless ? "Eggless" : "With egg"}
            </p>
            {error && <div className="mt-3"><Alert tone="danger">{error}</Alert></div>}
          </div>
          <div className="flex w-full flex-col items-start gap-2 md:w-72">
            {photos.length > 0 ? (
              <ul className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-2">
                {photos.map((p, i) => (
                  <li key={p.path} className="flex flex-col items-start gap-1">
                    {p.url ? (
                      <a href={p.url} target="_blank" rel="noreferrer" className="block w-full" title="Open the photo">
                        {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage */}
                        <img src={p.url} alt={`Customer's reference photo ${i + 1}`} className="aspect-square w-full rounded-lg border border-note-line bg-surface object-cover" />
                      </a>
                    ) : (
                      <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-note-line bg-surface/60 text-xs text-muted">Not available</div>
                    )}
                    {canChangePhoto && (
                      <Button variant="ghost" disabled={pending} onClick={() => removePhoto(p.path)}>Remove</Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex h-48 w-full items-center justify-center rounded-lg border border-dashed border-note-line bg-surface/60 text-sm text-muted md:w-48">
                No reference photo
              </div>
            )}
            {canChangePhoto && photos.length < MAX_CAKE_PHOTOS && (
              <label className={cx("cursor-pointer rounded-lg border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-brand-soft", pending && "pointer-events-none opacity-60")}>
                {pending ? "Saving…" : photos.length ? `Add photos (${photos.length} of ${MAX_CAKE_PHOTOS})` : `Add photos (up to ${MAX_CAKE_PHOTOS})`}
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    addPhotos(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
              </label>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
