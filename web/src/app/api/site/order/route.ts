import { createPublicClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE } from "@/lib/time";
import { submitArgs, websiteOrderSchema } from "@/lib/website";

const FALLBACK = "Sorry, we could not send your order. Please WhatsApp or call us.";

// Orders from the public website's form. They arrive in Orders as Online, pending confirmation.
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 20_000) {
    return Response.json({ ok: false, message: "Your order is too long. Please WhatsApp us." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, message: FALLBACK }, { status: 400 });
  }

  const parsed = websiteOrderSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, message: parsed.error.issues[0]?.message ?? FALLBACK }, { status: 422 });
  }
  // A bot filled in the hidden field: answer as if it worked and store nothing.
  if (parsed.data.website) return Response.json({ ok: true, reference: null });

  // Visitors cannot read Settings; the website uses the bakery's default time zone (Chennai).
  const prepared = submitArgs(parsed.data, DEFAULT_TIMEZONE);
  if ("error" in prepared) return Response.json({ ok: false, message: prepared.error }, { status: 422 });

  const { data, error } = await createPublicClient().rpc("submit_website_order", prepared.args);
  if (error) {
    if (error.code === "P0001") return Response.json({ ok: false, message: error.message }, { status: 422 });
    console.error("submit_website_order failed", error.code, error.message);
    return Response.json({ ok: false, message: FALLBACK }, { status: 500 });
  }
  const result = data as { reference: string; due_at: string };
  return Response.json({ ok: true, reference: result.reference, dueAt: result.due_at });
}
