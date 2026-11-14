"use server";

import { revalidatePath } from "next/cache";

import { billingRefusal } from "@/lib/billing-permission-server";
import { sendJobEstimate } from "@/lib/estimate-server";
import { formatMoney } from "@/lib/invoice-messages";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export type SendEstimateState = { error: string; notice?: string };

/**
 * Send the customer an estimate of the job's priced lines, by text, email or
 * both. Through the person's own session, so RLS decides whether the job is
 * theirs; the same billing permission as raising an invoice.
 */
export async function sendEstimateAction(_previous: SendEstimateState, formData: FormData): Promise<SendEstimateState> {
  const jobNumber = Number(String(formData.get("jobNumber") ?? "").trim());
  const blocked = await billingRefusal();
  if (blocked) return { error: blocked };

  const context = await currentContext();
  if (!context) return { error: "Sign in to send an estimate." };

  const supabase = asFlexibleClient(await createClient());
  const { data: auth } = await supabase.auth.getUser();

  const channels = [
    ...(formData.get("sendSms") === "on" ? ["sms"] : []),
    ...(formData.get("sendEmail") === "on" ? ["email"] : []),
  ];

  const result = await sendJobEstimate({
    database: supabase,
    organizationId: context.organizationId,
    jobNumber,
    channels,
    userId: auth.user?.id ?? null,
  });

  revalidatePath(`/jobs/${jobNumber}`);
  if (!result.ok) return { error: result.message };

  const fee = result.adminFeeCents > 0 ? ` It includes ${formatMoney(result.adminFeeCents / 100)} of admin fee, which the customer doesn't see.` : "";
  return { error: "", notice: `${result.message}${fee}` };
}
