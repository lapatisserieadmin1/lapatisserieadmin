import { NextResponse, type NextRequest } from "next/server";
import { getStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { zonedDayKey } from "@/lib/time";
import { reportRange } from "@/lib/report";
import { ordersWorkbook } from "@/lib/excel-report";
import { loadSalesReportRows } from "@/lib/sales-report-data";
import { reportTotals } from "@/lib/sales-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: "signed_out" }, { status: 401 });
  if (staff.role !== "admin") return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const timezone = await getBusinessTimezone();
  const query = request.nextUrl.searchParams;
  const today = zonedDayKey(new Date(), timezone);
  const range = reportRange({
    range: query.get("range") ?? undefined,
    from: query.get("from") ?? undefined,
    to: query.get("to") ?? undefined,
  }, today);
  if (range.error) return NextResponse.json({ error: range.error }, { status: 400 });

  const { rows, error } = await loadSalesReportRows(await createClient(), range.from, range.to, timezone);
  if (error) return NextResponse.json({ error }, { status: 500 });

  const file = await ordersWorkbook(rows, reportTotals(rows));
  return new NextResponse(file, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="orders-${range.from}-to-${range.to}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
