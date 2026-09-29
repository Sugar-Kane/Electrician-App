"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

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

  revalidatePath(`/contract/${token}`);
  return { error: "", signed: true };
}
