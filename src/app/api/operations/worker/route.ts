import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { scanScheduledAutomationEvents } from "@/lib/automation-triggers-server";
import { sendDuePaymentRequests } from "@/lib/job-prepayment-pay";
import { sendMissedRefundNotices } from "@/lib/refund-notice";
import { runSupervisedWorker } from "@/lib/supervised-executor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One pass of the supervised-action executor, and the scheduled triggers
 * (overdue invoices, material shortages).
 *
 * Nothing calls this yet. It is off unless VOLTEIRA_PHASE2_WORKER_ENABLED is
 * "true", and answers only a caller presenting VOLTEIRA_SUPERVISED_WORKER_TOKEN
 * in the x-supervised-worker-token header (for a pg_cron job, as the old
 * task worker had).
 */
function tokenMatches(presented: string | null): boolean {
  const expected = process.env.VOLTEIRA_SUPERVISED_WORKER_TOKEN ?? "";
  if (expected.length < 32 || !presented) return false;
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (process.env.VOLTEIRA_PHASE2_WORKER_ENABLED !== "true") {
    return NextResponse.json({ error: "The executor is not turned on." }, { status: 503 });
  }
  if (!tokenMatches(request.headers.get("x-supervised-worker-token"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const scanned = process.env.VOLTEIRA_PHASE2_TRIGGERS_ENABLED === "true" ? await scanScheduledAutomationEvents() : null;
  const report = await runSupervisedWorker({ limit: 10 });
  // Refund receipts that have not gone out yet. Best effort: a failure here
  // never stops the rest of the pass.
  const refundReceipts = await sendMissedRefundNotices(10).catch((error) => {
    console.error("worker: missed refund notices failed", error);
    return 0;
  });
  // Deposits and installments that have come due: the customer is sent the
  // pay link, once each.
  const paymentRequests = await sendDuePaymentRequests({ limit: 25 }).catch((error) => {
    console.error("worker: payment requests failed", error);
    return 0;
  });
  return NextResponse.json({ ...report, scanned, refundReceipts, paymentRequests });
}
