"use server";

import { revalidatePath } from "next/cache";

import { readSignature, readSignerTitle } from "@/lib/contract-signing";
import { unknownPlaceholders } from "@/lib/contract-template";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Saving the business's own contract.
 *
 * Stored verbatim. It is their document — the paragraph they argued with their
 * lawyer about stays exactly as they wrote it, and this app's only contribution
 * is filling in the placeholders.
 */

export type TemplateState = { error: string; notice?: string };

const MAX_TEMPLATE = 20_000;

export async function saveContractTemplate(
  _previous: TemplateState,
  formData: FormData,
): Promise<TemplateState> {
  const body = String(formData.get("body") ?? "").slice(0, MAX_TEMPLATE);
  if (!body.trim()) return { error: "The contract cannot be empty." };

  const supabase = asFlexibleClient(await createClient());

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  const organizationId =
    typeof membership?.organization_id === "string" ? membership.organization_id : "";
  if (!organizationId) return { error: "You are not a member of a business." };

  const { error } = await supabase
    .from("contract_templates")
    .upsert(
      { organization_id: organizationId, body },
      { onConflict: "organization_id" },
    );

  if (error) return { error: "That contract could not be saved." };

  revalidatePath("/settings/contract");

  // Saved either way. An unrecognised placeholder is the business asking for
  // something this app does not track, which is worth telling them about but is
  // not a reason to refuse their document.
  const unknown = unknownPlaceholders(body);
  return {
    error: "",
    notice: unknown.length
      ? `Saved. These are not filled in automatically and will stay in the contract for you to complete: ${unknown.map((key) => `{{${key}}}`).join(", ")}.`
      : "Saved.",
  };
}

export type SignerState = { error: string; notice?: string };

/**
 * Adopting your signature for this business's contracts.
 *
 * Checked the way a customer's signature is — a real PNG for a drawn one, a
 * real name either way — and written to your own row only: the table's policy
 * refuses a row for anybody else, so nobody can adopt a signature in another
 * member's name. Each contract you send is then signed with it, as you, when
 * you send it.
 */
export async function saveContractSigner(
  _previous: SignerState,
  formData: FormData,
): Promise<SignerState> {
  if (String(formData.get("consent") ?? "") !== "on") {
    return { error: "Tick the box to adopt this as your signature." };
  }

  const read = readSignature({
    method: formData.get("method"),
    name: formData.get("name"),
    image: formData.get("image"),
  });
  if (!read.ok) return { error: read.reason };

  const context = await currentContext();
  if (!context) return { error: "You are not signed in." };

  const title = readSignerTitle(formData.get("title"));
  const supabase = asFlexibleClient(await createClient());
  const { error } = await supabase.from("contract_signers").upsert(
    {
      organization_id: context.organizationId,
      user_id: context.userId,
      signer_name: read.signature.name,
      signer_title: title || null,
      method: read.signature.method,
      image: read.signature.method === "drawn" ? read.signature.image : null,
      adopted_at: new Date().toISOString(),
    },
    { onConflict: "organization_id,user_id" },
  );

  if (error) return { error: "Your signature could not be saved. Try again." };

  revalidatePath("/settings/contract");
  return { error: "", notice: "Saved. Contracts you send are signed with it." };
}

/**
 * Taking your signature off file.
 *
 * Contracts already signed with it keep it — what was signed stays signed. You
 * are asked for one again before you next send a contract.
 */
export async function removeContractSigner(_previous: SignerState): Promise<SignerState> {
  const context = await currentContext();
  if (!context) return { error: "You are not signed in." };

  const supabase = asFlexibleClient(await createClient());
  const { error } = await supabase
    .from("contract_signers")
    .delete()
    .eq("organization_id", context.organizationId)
    .eq("user_id", context.userId);

  if (error) return { error: "Your signature could not be removed. Try again." };

  revalidatePath("/settings/contract");
  return { error: "", notice: "Removed. You will be asked for a signature before you send a contract." };
}
