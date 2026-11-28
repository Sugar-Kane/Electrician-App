"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { after } from "next/server";

import { readSignature, unsignableBecause } from "@/lib/contract-signing";
import { generateContractPdf } from "@/lib/pdf/contract-data";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * A customer signing the contract they were sent.
 *
 * There is no session here — the customer has no account — so the token is the
 * whole of the authority, exactly as on the booking confirmation. Everything
 * that decides whether a signature is allowed happens in
 * `sign_contract_in_app`, in the database, where no second request can race
 * past it. This action checks first only so it can say why, in words, before
 * anybody is refused by a function that can only return nothing.
 */

export type SignState = { error: string; signed?: boolean };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PublicContract = {
  contract_id: string;
  organization_id: string;
  status: string;
  unfilled: string[] | null;
  signature_provider: string | null;
  signed_at: string | null;
  time_zone: string | null;
  superseded: boolean | null;
};

async function loadContract(token: string): Promise<PublicContract | null> {
  const { data } = await createPublicClient().rpc("get_public_contract", { p_token: token });
  return Array.isArray(data) && data.length > 0 ? (data[0] as PublicContract) : null;
}

function reasonFor(contract: PublicContract): string {
  return unsignableBecause({
    status: contract.status,
    unfilled: contract.unfilled ?? [],
    signatureProvider: contract.signature_provider,
    signedAt: contract.signed_at,
    superseded: contract.superseded === true,
  });
}

/**
 * Where the signature came from.
 *
 * Vercel puts the client's address first in `x-forwarded-for`. Capped, because
 * both of these are supplied by whoever is on the other end and end up in a row.
 */
async function requestOrigin(): Promise<{ ip: string; userAgent: string }> {
  const list = await headers();
  const forwarded = (list.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ?? "";
  const ip = (forwarded || list.get("x-real-ip") || "").slice(0, 64);
  const userAgent = (list.get("user-agent") ?? "").slice(0, 500);
  return { ip, userAgent };
}

export async function signContract(
  token: string,
  _previous: SignState,
  form: FormData,
): Promise<SignState> {
  if (!UUID.test(token)) return { error: "That signing link is not valid." };

  const contract = await loadContract(token);
  if (!contract) return { error: "We could not find that contract." };

  const blocked = reasonFor(contract);
  if (blocked) return { error: blocked };

  /*
   * Consent to sign electronically, given in so many words.
   *
   * ESIGN and UETA both turn on the signer agreeing to do this electronically
   * rather than on paper. It is asked for on the page and refused here without
   * it, so a signature on record is also a record that they agreed to sign this
   * way — no separate column needed, because one cannot exist without the other.
   */
  if (form.get("consent") !== "on") {
    return { error: "Tick the box to agree to sign electronically." };
  }

  // Checked again here. The page checks too, but that check runs on a device
  // that belongs to somebody else.
  const read = readSignature({
    method: form.get("method"),
    name: form.get("name"),
    image: form.get("image"),
  });
  if (!read.ok) return { error: read.reason };

  const { ip, userAgent } = await requestOrigin();
  const { data: signedId } = await createPublicClient().rpc("sign_contract_in_app", {
    p_token: token,
    p_method: read.signature.method,
    p_name: read.signature.name,
    p_image: read.signature.image || null,
    p_ip: ip,
    p_user_agent: userAgent,
  });

  if (typeof signedId !== "string" || !signedId) {
    // Most likely signed a moment ago in another tab. Ask again rather than
    // guess, so the message is about what actually happened.
    const now = await loadContract(token);
    return { error: (now && reasonFor(now)) || "That signature could not be saved. Try again." };
  }

  /*
   * The signed copy becomes the current version of the contract.
   *
   * With the service role, because filing a document is not something an
   * anonymous visitor may do — but only for the contract id the signing
   * function itself returned, never one taken from the request.
   *
   * A failure here does not undo the signature. Signing is the act that
   * matters and it has happened; the PDF is the business's copy of it, and the
   * job page can rebuild it.
   */
  try {
    const result = await generateContractPdf({
      database: asFlexibleClient(getSupabaseAdmin()),
      organizationId: contract.organization_id,
      contractId: signedId,
      timeZone: contract.time_zone || "America/Los_Angeles",
      uploadedBy: "",
    });
    if (result.error) console.error("signed contract PDF failed", { signedId, error: result.error });
  } catch (error) {
    console.error("signed contract PDF failed", { signedId, error });
  }

  /*
   * A change order is approved by this signature, in the same transaction
   * (the database records it). Its changes go onto the job and its invoices
   * now — an invoice the customer already has is updated and sent again.
   * Only for the change order this signature approved, found from the signed
   * contract's own id. A failure here never undoes the signature: the job
   * page offers to finish it.
   */
  try {
    const admin = asFlexibleClient(getSupabaseAdmin());
    const { data: approved } = await admin
      .from("change_orders")
      .select("id")
      .eq("organization_id", contract.organization_id)
      .eq("document_contract_id", signedId)
      .eq("status", "approved")
      .maybeSingle();
    if (approved?.id) {
      const { applyApprovedChangeOrder } = await import("@/lib/change-orders-server");
      const applied = await applyApprovedChangeOrder(admin, {
        organizationId: contract.organization_id,
        changeOrderId: String(approved.id),
      });
      if (!applied.ok) console.error("signed change order not applied", { signedId, message: applied.message });
    }
  } catch (error) {
    console.error("signed change order not applied", { signedId, error });
  }

  // The customer's own copy: emailed with the PDF, texted as a link when they
  // have texting consent. After the PDF above, so the link shows the signed one.
  try {
    const { sendSignedContractCopy } = await import("@/lib/contract-copy");
    const sent = await sendSignedContractCopy({
      organizationId: contract.organization_id,
      contractId: signedId,
      token,
      timeZone: contract.time_zone || "America/Los_Angeles",
    });
    if (sent.email !== "sent" && sent.sms !== "sent") console.warn("signed contract copy not delivered", { signedId, ...sent });
  } catch (error) {
    console.error("signed contract copy failed", { signedId, error });
  }

  // A deposit due on signing: the customer is sent its pay link now, after the
  // reply so signing never waits on it. Only for a contract that showed the
  // payment schedule, and once (the request is claimed).
  after(async () => {
    try {
      const { data: signed } = await getSupabaseAdmin()
        .from("contracts")
        .select("job_id, payment_schedule")
        .eq("id", signedId)
        .eq("organization_id", contract.organization_id)
        .maybeSingle();
      const jobId = typeof signed?.job_id === "string" ? signed.job_id : "";
      if (jobId && signed?.payment_schedule) {
        const { sendDuePaymentRequests } = await import("@/lib/job-prepayment-pay");
        await sendDuePaymentRequests({ jobId, organizationId: contract.organization_id });
      }
    } catch (error) {
      console.error("deposit request after signing failed", { signedId, error });
    }
  });

  // Phase 2 automation (off unless VOLTEIRA_PHASE2_TRIGGERS_ENABLED): after the reply.
  after(async () => {
    const { emitContractSigned } = await import("@/lib/automation-triggers-server");
    await emitContractSigned(contract.organization_id, signedId);
  });

  revalidatePath(`/contract/${token}`);
  return { error: "", signed: true };
}

export type DeclineState = { error: string; declined?: boolean };

/**
 * The customer turning a change order down from their link.
 *
 * As with signing, the token is the whole of the authority, and the database
 * function decides: only a change order still waiting, only the job's newest
 * document. Nothing on the job changes. The business sees the answer, and the
 * reason if one was given, on the job.
 */
export async function declineChangeOrder(token: string, _previous: DeclineState, form: FormData): Promise<DeclineState> {
  if (!UUID.test(token)) return { error: "That link is not valid." };
  const contract = await loadContract(token);
  if (!contract) return { error: "We could not find that change order." };
  const reason = String(form.get("reason") ?? "").trim().slice(0, 1000);

  const { data: declinedId } = await createPublicClient().rpc("decline_change_order", { p_token: token, p_reason: reason });
  if (typeof declinedId !== "string" || !declinedId) {
    const now = await loadContract(token);
    return { error: (now && reasonFor(now)) || "That change order can no longer be declined. It may already have been answered." };
  }

  try {
    const { recordActivity } = await import("@/lib/activity");
    const admin = asFlexibleClient(getSupabaseAdmin());
    const { data: order } = await admin
      .from("change_orders")
      .select("job_id, number")
      .eq("organization_id", contract.organization_id)
      .eq("id", declinedId)
      .maybeSingle();
    await recordActivity(admin, {
      organizationId: contract.organization_id,
      eventType: "change_order.rejected",
      label: `Change order #${order?.number ?? ""} declined by the customer`,
      jobId: typeof order?.job_id === "string" ? order.job_id : null,
      metadata: { change_order_id: declinedId, ...(reason ? { reason } : {}) },
    });
  } catch (error) {
    console.error("declined change order not recorded in history", { declinedId, error });
  }

  revalidatePath(`/contract/${token}`);
  return { error: "", declined: true };
}

export type CancelState = { error: string; cancelled?: boolean };

/**
 * The customer cancelling a home improvement contract from their link, within
 * their right to cancel (compliance CA-005-007/008, CSLB-007-011). As with
 * signing, the token is the whole of the authority and the database decides:
 * only a signed contract that carries a right to cancel, before its deadline.
 * The business is told at once, with the date refunds are due.
 */
export async function cancelContract(token: string, _previous: CancelState, form: FormData): Promise<CancelState> {
  if (!UUID.test(token)) return { error: "That link is not valid." };
  if (form.get("confirm") !== "on") return { error: "Tick the box to confirm you want to cancel this contract." };
  const contract = await loadContract(token);
  if (!contract) return { error: "We could not find that contract." };
  const note = String(form.get("note") ?? "").trim().slice(0, 1000);

  const { data: cancelledId } = await createPublicClient().rpc("cancel_contract_by_customer", { p_token: token, p_note: note });
  if (typeof cancelledId !== "string" || !cancelledId) {
    return { error: "This contract can no longer be cancelled here. Its cancellation period may have ended. Call the business to talk it through." };
  }

  after(async () => {
    try {
      const { notifyContractCancelled } = await import("@/lib/contract-cancellation-server");
      await notifyContractCancelled({ organizationId: contract.organization_id, contractId: cancelledId });
    } catch (error) {
      console.error("contract cancellation notice failed", { cancelledId, error });
    }
  });

  revalidatePath(`/contract/${token}`);
  return { error: "", cancelled: true };
}
