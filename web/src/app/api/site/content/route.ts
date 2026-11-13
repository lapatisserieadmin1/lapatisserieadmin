import { createPublicClient } from "@/lib/supabase/server";

// Approved reviews and gallery photos for the public website (web/public/site). No login. Offers were
// removed from the site (2026-10-28), so the RPC's offers are dropped here.
export async function GET() {
  const { data, error } = await createPublicClient().rpc("website_content");
  if (error) {
    console.error("website_content failed", error.message);
    return Response.json({ reviews: [], gallery: [] }, { status: 503 });
  }
  const { reviews = [], gallery = [] } = (data ?? {}) as { reviews?: unknown[]; gallery?: unknown[] };
  return Response.json({ reviews, gallery }, {
    headers: { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=86400" },
  });
}
