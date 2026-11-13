import { createPublicClient } from "@/lib/supabase/server";

// Products for the public website (web/public/site). No login; prices in paise.
export async function GET() {
  const { data, error } = await createPublicClient().rpc("website_catalogue");
  if (error) {
    console.error("website_catalogue failed", error.message);
    return Response.json({ products: [] }, { status: 503 });
  }
  return Response.json(
    { products: data ?? [] },
    { headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=86400" } },
  );
}
