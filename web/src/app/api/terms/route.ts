import type { NextRequest } from "next/server";
import { z } from "zod";
import { getStaff } from "@/lib/auth";
import { renderTermsPdf, renderTermsPng, termsFileName } from "@/lib/terms-file";

const query = z.object({
  format: z.enum(["pdf", "png"]).default("png"),
  ref: z.string().regex(/^[A-Za-z0-9-]{1,20}$/).optional(),
});

// The Terms and Conditions file (image or PDF) for admin and counter staff to send on WhatsApp.
export async function GET(request: NextRequest) {
  const staff = await getStaff();
  if (!staff) return Response.json({ ok: false, message: "Sign in again." }, { status: 401 });
  if (staff.role !== "admin" && staff.role !== "counter") {
    return Response.json({ ok: false, message: "Only admin and counter staff can send the terms." }, { status: 403 });
  }
  const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return Response.json({ ok: false, message: "Choose PDF or image." }, { status: 400 });
  const { format, ref = null } = parsed.data;

  const file = format === "pdf" ? await renderTermsPdf(ref) : await renderTermsPng(ref);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": format === "pdf" ? "application/pdf" : "image/png",
      "Content-Disposition": `attachment; filename="${termsFileName(ref, format)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
