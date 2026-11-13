import { z } from "zod";
import { createPublicClient } from "@/lib/supabase/server";

const FALLBACK = "Sorry, we could not send your review. Please try again.";

const reviewSchema = z.object({
  name: z.string().trim().min(1, "Please enter your name.").max(60, "Please keep your name under 60 characters."),
  rating: z.number().int().min(1, "Please choose 1 to 5 stars.").max(5, "Please choose 1 to 5 stars."),
  comment: z.string().trim().min(1, "Please write your review.").max(600, "Please keep your review under 600 characters."),
  // Hidden field people never see; bots fill it in.
  website: z.string().optional(),
});

// Reviews from the website. They wait in Reviews until an admin approves them.
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 5_000) {
    return Response.json({ ok: false, message: "Your review is too long." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: FALLBACK }, { status: 400 });
  }
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, message: parsed.error.issues[0]?.message ?? FALLBACK }, { status: 422 });
  }
  if (parsed.data.website) return Response.json({ ok: true });

  const { error } = await createPublicClient().rpc("submit_review", {
    p_name: parsed.data.name,
    p_rating: parsed.data.rating,
    p_comment: parsed.data.comment,
  });
  if (error) {
    if (error.code === "P0001") return Response.json({ ok: false, message: error.message }, { status: 422 });
    console.error("submit_review failed", error.code, error.message);
    return Response.json({ ok: false, message: FALLBACK }, { status: 500 });
  }
  return Response.json({ ok: true });
}
