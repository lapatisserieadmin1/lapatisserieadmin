import type { NextRequest } from "next/server";
import { z } from "zod";
import { getStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { makeQuotationFile } from "@/lib/quotation-send";

// Signed links to the stored file last this long; the file itself stays private.
const LINK_SECONDS = 300;

const body = z.object({ format: z.enum(["pdf", "png"]).default("pdf") });

// Makes the customer's quotation file, fresh from the order as it is now, for admin and counter staff.
// Chefs get 403 here: the price-free version is never made into a file for a customer.
export async function POST(request: NextRequest, ctx: RouteContext<"/api/orders/[id]/quotation">) {
  const staff = await getStaff();
  if (!staff) return Response.json({ ok: false, message: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin" && staff.role !== "counter") {
    return Response.json({ ok: false, message: "Only admin and counter staff can send the Order in msg." }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ ok: false, message: "Order not found." }, { status: 404 });
  const parsed = body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ ok: false, message: "Choose PDF or image." }, { status: 400 });

  const supabase = await createClient();
  const made = await makeQuotationFile(supabase, id, parsed.data.format);
  if (!made.ok) return Response.json({ ok: false, message: made.message }, { status: made.status });

  const { data: signed, error: signError } = await supabase.storage
    .from("quotations")
    .createSignedUrl(made.path, LINK_SECONDS, { download: made.fileName });
  if (signError || !signed) {
    console.error("quotation signed link failed", signError?.message);
    return Response.json({ ok: false, message: "Could not open the Order in msg file. Try again." }, { status: 500 });
  }

  return Response.json(
    { ok: true, path: made.path, fileName: made.fileName, contentType: made.contentType, url: signed.signedUrl, expiresIn: LINK_SECONDS },
    { headers: { "Cache-Control": "no-store" } },
  );
}
