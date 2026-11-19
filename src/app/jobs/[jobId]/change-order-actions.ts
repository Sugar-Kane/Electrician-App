"use server";

import { revalidatePath } from "next/cache";

import { canEditBilling } from "@/lib/billing-permission";
import { billingRefusal, techniciansCanEditBilling } from "@/lib/billing-permission-server";
import {
  addChangeOrderItem,
  applyApprovedChangeOrder,
  cancelChangeOrder,
  createChangeOrder,
  foldIntoContract,
  removeChangeOrderItem,
  requestChangeOrderApproval,
  updateChangeOrder,
  updateChangeOrderItem,
  type ChangeOrderActor,
  type ItemInput,
} from "@/lib/change-orders-server";
import { formatCents } from "@/lib/job-lines";
import { currentContext } from "@/lib/request-context";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Change orders from the job page.
 *
 * Everything reads and writes through the person's own session, so row-level
 * security decides whose job and change order this is; the ids passed in are
 * lookup keys, never authority. Prices are set only by somebody the business
 * lets change billing. The two steps that need the service role — applying an
 * approved change order, and sending an updated invoice — first read the
 * change order or invoice through the person's session, so they only ever act
 * on something that person can see.
 */

export type ChangeOrderActionState = { error: string; notice?: string; changeOrderId?: string; contractId?: string };

async function caller() {
  const context = await currentContext();
  if (!context) return null;
  const database = asFlexibleClient(await createClient());
  const canSetPrices = canEditBilling(
    context.role,
    context.role === "technician" ? await techniciansCanEditBilling(context.organizationId) : true,
  );
  const actor: ChangeOrderActor = { userId: context.userId, canSetPrices };
  return { context, database, actor };
}

function refresh(jobNumber: string) {
  if (jobNumber) revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath("/invoices");
}

export async function createChangeOrderAction(
  jobNumber: string,
  input: { description: string; reason?: string },
): Promise<ChangeOrderActionState> {
  const who = await caller();
  if (!who) return { error: "Sign in first." };
  const created = await createChangeOrder(who.database, {
    organizationId: who.context.organizationId,
    job: { jobNumber },
    userId: who.context.userId,
    description: input.description,
    reason: input.reason,
  });
  if (!created.ok) return { error: created.error };
  refresh(jobNumber);
  return {
    error: "",
    changeOrderId: created.changeOrderId,
    notice:
      created.swept > 0
        ? `Change order #${created.number} started. ${created.swept} ${created.swept === 1 ? "item" : "items"} added to the job since the customer signed ${created.swept === 1 ? "is" : "are"} included.`
        : `Change order #${created.number} started.`,
  };
}

export async function addChangeOrderItemAction(
  jobNumber: string,
  changeOrderId: string,
  item: ItemInput,
): Promise<ChangeOrderActionState> {
  const who = await caller();
  if (!who) return { error: "Sign in first." };
  const added = await addChangeOrderItem(who.database, {
    organizationId: who.context.organizationId,
    changeOrderId,
    actor: who.actor,
    item,
  });
  if (!added.ok) return { error: added.error };
  refresh(jobNumber);
  return { error: "", notice: added.duplicate ? "Already added." : "Added." };
}

export async function updateChangeOrderItemAction(
  jobNumber: string,
  changeOrderId: string,
  itemId: string,
  item: ItemInput,
): Promise<ChangeOrderActionState> {
  const who = await caller();
  if (!who) return { error: "Sign in first." };
  const updated = await updateChangeOrderItem(who.database, {
    organizationId: who.context.organizationId,
    changeOrderId,
    itemId,
    actor: who.actor,
    item,
  });
  if (!updated.ok) return { error: updated.error };
  refresh(jobNumber);
  return { error: "", notice: "Saved." };
}

export async function removeChangeOrderItemAction(
  jobNumber: string,
  changeOrderId: string,
  itemId: string,
  expectedVersion?: number,
): Promise<ChangeOrderActionState> {
  const who = await caller();
  if (!who) return { error: "Sign in first." };
  const removed = await removeChangeOrderItem(who.database, {
    organizationId: who.context.organizationId,
    changeOrderId,
    itemId,
    expectedVersion,
  });
  if (!removed.ok) return { error: removed.error };
  refresh(jobNumber);
  return { error: "", notice: "Removed from the change order." };
}

export async function updateChangeOrderAction(
  jobNumber: string,
  changeOrderId: string,
  input: { description?: string; reason?: string; expectedVersion?: number },
): Promise<ChangeOrderActionState> {
  const who = await caller();
  if (!who) return { error: "Sign in first." };
  const updated = await updateChangeOrder(who.database, {
    organizationId: who.context.organizationId,
    changeOrderId,
    ...input,
  });
  if (!updated.ok) return { error: updated.error };
  refresh(jobNumber);
  return { error: "", notice: "Saved." };
}

/**
 * Write the change order the customer signs. It becomes the job's newest
 * contract, sent for signature or signed in person from the contract card,
 * the same as any contract.
 */
export async function requestChangeOrderApprovalAction(
  jobNumber: string,
  changeOrderId: string,
  expectedVersion?: number,
  /** How to send the signing link; text only when not said. */
  send: { sms: boolean; email: boolean } = { sms: true, email: false },
): Promise<ChangeOrderActionState> {
  const who = await caller();
  if (!who) return { error: "Sign in first." };
  if (!send.sms && !send.email) return { error: "Tick text, email or both to send it." };
  // Asking the customer to agree to a price is a billing change.
  const blocked = await billingRefusal();
  if (blocked) return { error: blocked };
  const requested = await requestChangeOrderApproval(who.database, {
    organizationId: who.context.organizationId,
    changeOrderId,
    userId: who.context.userId,
    expectedVersion,
  });
  if (!requested.ok) return { error: requested.error };

  // Sent the way a contract is: signed for the business, then the signing link
  // texted to the customer, through the same action the contract card uses
  // (consent, the STOP ledger and the resend guard included).
  const form = new FormData();
  form.set("contractId", requested.contractId);
  form.set("jobNumber", jobNumber);
  form.set("channels", "chosen");
  if (send.sms) form.set("sendSms", "on");
  if (send.email) form.set("sendEmail", "on");
  const { sendSigningLink } = await import("@/app/jobs/[jobId]/contract-actions");
  const sent = await sendSigningLink({ error: "" }, form);
  refresh(jobNumber);

  const revised = requested.revisedCents === null ? "" : ` The contract would then stand at ${formatCents(requested.revisedCents)}.`;
  if (sent.error) {
    // The change order is written and waiting; only the text did not go. Said
    // as an error so the sheet stays open and the reason is read.
    return {
      error: `The change order is ready to sign, but the link was not sent: ${sent.error}${
        sent.needsSignature ? " Add your signature in Settings, then send it from the contract above." : " Send it, or have them sign here, from the contract above."
      }`,
      contractId: requested.contractId,
    };
  }
  return {
    error: "",
    contractId: requested.contractId,
    notice: `${sent.notice ?? "Signing link texted."}${revised}${requested.pdfError ? " The PDF could not be built yet; open it to try again." : ""}`,
  };
}

/**
 * An unsigned contract: update it with the change instead, as a new draft the
 * customer signs. The outdated draft stays on file and can no longer be signed.
 */
export async function foldChangeOrderIntoContractAction(
  jobNumber: string,
  changeOrderId: string,
): Promise<ChangeOrderActionState> {
  const who = await caller();
  if (!who) return { error: "Sign in first." };
  const blocked = await billingRefusal();
  if (blocked) return { error: blocked };
  const folded = await foldIntoContract(who.database, asFlexibleClient(getSupabaseAdmin()), {
    organizationId: who.context.organizationId,
    changeOrderId,
    userId: who.context.userId,
  });
  if (!folded.ok) return { error: folded.error };
  if (!folded.applied.ok) {
    refresh(jobNumber);
    return { error: folded.applied.message };
  }

  // The revised contract, written from the job as it now stands.
  const { generateContract } = await import("./contract-actions");
  const form = new FormData();
  form.set("jobNumber", folded.jobNumber || jobNumber);
  const drafted = await generateContract({ error: "" }, form);
  refresh(jobNumber);
  if (drafted.error) {
    return { error: `The job is updated, but the revised contract could not be written: ${drafted.error} Generate another draft from the contract card.` };
  }
  return {
    error: "",
    contractId: drafted.contractId,
    notice: `Contract updated: a new draft includes the change. The earlier draft is kept and can no longer be signed. ${drafted.notice ?? ""}`.trim(),
  };
}

export async function cancelChangeOrderAction(jobNumber: string, changeOrderId: string): Promise<ChangeOrderActionState> {
  const who = await caller();
  if (!who) return { error: "Sign in first." };
  const canceled = await cancelChangeOrder(who.database, {
    organizationId: who.context.organizationId,
    changeOrderId,
    userId: who.context.userId,
  });
  if (!canceled.ok) return { error: canceled.error };
  refresh(jobNumber);
  return { error: "", notice: `Change order #${canceled.number} withdrawn. Nothing on the job changed.` };
}

/** The customer said no in person, or on the phone: recorded, and nothing changes. */
export async function recordChangeOrderDeclinedAction(
  jobNumber: string,
  changeOrderId: string,
  reason: string,
): Promise<ChangeOrderActionState> {
  const who = await caller();
  if (!who) return { error: "Sign in first." };
  const declined = await cancelChangeOrder(who.database, {
    organizationId: who.context.organizationId,
    changeOrderId,
    userId: who.context.userId,
    declinedByCustomer: true,
    reason,
  });
  if (!declined.ok) return { error: declined.error };
  refresh(jobNumber);
  return { error: "", notice: `Change order #${declined.number} recorded as declined. Nothing on the job changed.` };
}

/** Finish an approved change order whose job update did not complete (or send an update that failed). */
export async function finishChangeOrderAction(jobNumber: string, changeOrderId: string): Promise<ChangeOrderActionState> {
  const who = await caller();
  if (!who) return { error: "Sign in first." };
  const blocked = await billingRefusal();
  if (blocked) return { error: blocked };
  const { data: visible } = await who.database
    .from("change_orders")
    .select("id, status")
    .eq("organization_id", who.context.organizationId)
    .eq("id", changeOrderId)
    .maybeSingle();
  if (!visible) return { error: "That change order could not be found." };
  if (visible.status !== "approved") return { error: "Only an approved change order is applied." };

  const outcome = await applyApprovedChangeOrder(asFlexibleClient(getSupabaseAdmin()), {
    organizationId: who.context.organizationId,
    changeOrderId,
    actorUserId: who.context.userId,
  });
  refresh(jobNumber);
  return outcome.ok ? { error: "", notice: outcome.message } : { error: outcome.message };
}
