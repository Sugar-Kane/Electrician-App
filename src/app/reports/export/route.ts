import { NextResponse } from "next/server";

import { canExportReports, exportRange, toCsv } from "@/lib/csv";
import { organizationTimeZone } from "@/lib/job-billing-server";
import { buildReportExport, isReportExportKey, REPORT_EXPORTS } from "@/lib/report-exports";
import { calendarDate } from "@/lib/schedule-labels";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * A report's records as a CSV file: /reports/export?report=invoices&from=2026-01-01&to=2026-11-05
 *
 * For the business's owners, admins and accountants: the files carry
 * customers' contact details and the business's money.
 */
export async function GET(request: Request) {
  const context = await currentContext();
  if (!context) return new NextResponse("Sign in to download reports.", { status: 401 });
  if (!canExportReports(context.role)) {
    return new NextResponse("Only an owner, admin or accountant can download reports.", { status: 403 });
  }

  const url = new URL(request.url);
  const report = url.searchParams.get("report") ?? "";
  if (!isReportExportKey(report)) return new NextResponse("That report does not exist.", { status: 404 });

  const database = asFlexibleClient(await createClient());
  const timeZone = await organizationTimeZone(database, context.organizationId);
  const range = exportRange(url.searchParams.get("from"), url.searchParams.get("to"), calendarDate(new Date().toISOString(), timeZone));
  const table = await buildReportExport({ database, organizationId: context.organizationId, report, range, timeZone });

  const name = report === "customers"
    ? `volteira-customers-${range.to}.csv`
    : `volteira-${REPORT_EXPORTS[report].file}-${range.from}-to-${range.to}.csv`;
  return new NextResponse(toCsv(table.headers, table.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
