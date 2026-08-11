"use server";

import { revalidatePath } from "next/cache";

import { unknownPlaceholders } from "@/lib/contract-template";
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
