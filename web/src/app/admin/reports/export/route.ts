import { NextResponse, type NextRequest } from "next/server";
import { getStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { paymentMethodLabel, sourceLabel } from "@/lib/orders";
import { zonedDayKey } from "@/lib/time";
import { parseSalesReport, reportRange } from "@/lib/report";
import { analyticsWorkbook } from "@/lib/excel-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Excel workbook of the sales report for ?from=&to= (or ?range=). Admin only; the database checks again.
export async function GET(request: NextRequest) {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const q = request.nextUrl.searchParams;
  const today = zonedDayKey(new Date(), await getBusinessTimezone());
  const range = reportRange({ range: q.get("range") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined }, today);
  if (range.error) return NextResponse.json({ error: range.error }, { status: 400 });

  const { data, error } = await (await createClient()).rpc("sales_report", { p_from: range.from, p_to: range.to });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const file = await analyticsWorkbook(parseSalesReport(data), { method: paymentMethodLabel, source: sourceLabel });
  return new NextResponse(file, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="sales-${range.from}-to-${range.to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
