import { renderTermsPdf, termsFileName } from "@/lib/terms-file";

// The Terms and Conditions PDF for a customer, opened from the link staff send on WhatsApp (owner,
// 2026-11-07). Public on purpose: the terms are the same for everyone and carry only the order number.
export async function GET(_request: Request, { params }: RouteContext<"/terms/[ref]">) {
  const { ref } = await params;
  if (!/^[A-Za-z0-9-]{1,20}$/.test(ref)) return new Response("Not found", { status: 404 });
  const file = await renderTermsPdf(ref);
  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${termsFileName(ref, "pdf")}"`,
      "Cache-Control": "public, max-age=3600",
    },
  });
}
