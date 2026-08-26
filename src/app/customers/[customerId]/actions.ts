"use server";

import { revalidatePath } from "next/cache";

import { chooseLanguage, languageLabel } from "@/lib/customer-language";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export type LanguageActionState = { error: string; notice?: string };

/**
 * Pin a customer to a language, on the owner's say-so.
 *
 * The other half of detection, and the reason detection is safe to have at all.
 * Reading a language off a text message is a guess — "ok gracias" from an
 * English speaker is one word of Spanish — and a guess with no way to correct it
 * is worse than no guess, because the business watches it be wrong and can do
 * nothing.
 *
 * `chooseLanguage` stamps `source: "owner"`, which is what makes it stick:
 * `resolveLanguage` refuses to write over an owner's row, so the next inbound
 * message cannot undo this. Nothing here re-derives that rule; it is one
 * function, used by the intake and by this.
 *
 * Written through the caller's session rather than the service role, so RLS
 * decides whether this person may touch this customer at all.
 */
export async function setCustomerLanguage(
  _previousState: LanguageActionState,
  formData: FormData,
): Promise<LanguageActionState> {
  const customerId = String(formData.get("customerId") ?? "").trim();
  // A path segment reaches a uuid comparison, and Postgres errors on a
  // malformed one rather than returning nothing.
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) {
    return { error: "That customer could not be found." };
  }

  const chosen = chooseLanguage(String(formData.get("language") ?? ""));

  const context = await currentContext();
  if (!context) return { error: "Sign in to change this." };

  const supabase = asFlexibleClient(await createClient());
  const { error } = await supabase
    .from("customers")
    .update({ preferred_language: chosen.language, language_source: chosen.source })
    .eq("organization_id", context.organizationId)
    .eq("id", customerId);

  if (error) {
    // The detail stays in the log; the person reading is trying to change a
    // dropdown and cannot act on a Postgres code.
    console.error("customer language save failed", error);
    return { error: "That could not be saved. Try again." };
  }

  revalidatePath(`/customers/${customerId}`);
  return {
    error: "",
    notice: `Messages to this customer will be in ${languageLabel(chosen.language)}.`,
  };
}
