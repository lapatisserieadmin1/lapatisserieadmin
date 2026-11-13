import type { Metadata } from "next";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { AddGalleryPhotos, GalleryPhotoCard } from "./gallery-forms";
import { addGalleryPhotos, deleteGalleryPhoto, saveGalleryPhoto } from "./actions";

export const metadata: Metadata = { title: "Gallery" };

// Photos for the website's Gallery section (owner, 2026-10-20). Until one is shown, the website keeps its own photos.
export default async function GalleryPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { data } = await supabase.from("gallery_photos").select("*").order("sort_order").order("created_at", { ascending: false });
  const photos = data ?? [];
  const shown = photos.filter((p) => p.is_active).length;

  return (
    <>
      <PageHeader
        title="Gallery"
        description="Photos in the website's Gallery section. Lower order numbers show first; untick Show to hide a photo without deleting it."
      />
      <div className="flex flex-col gap-6">
        <Card>
          <h2 className="mb-1 text-lg font-semibold">Add photos</h2>
          <p className="mb-4 text-sm text-muted">
            {shown === 0
              ? "The website shows its built-in photos until you add some here."
              : `${shown} photo${shown === 1 ? "" : "s"} on the website.`}
          </p>
          <AddGalleryPhotos action={addGalleryPhotos} />
        </Card>
        {photos.length === 0 ? (
          <EmptyState title="No gallery photos yet">Cakes you made, the shop, events you set up — anything customers would love to see.</EmptyState>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map((p) => (
              <GalleryPhotoCard
                key={p.id}
                photo={p}
                saveAction={saveGalleryPhoto.bind(null, p.id)}
                deleteAction={deleteGalleryPhoto.bind(null, p.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
