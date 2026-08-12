"use server";

import { revalidatePath } from "next/cache";

import { toE164 } from "@/lib/phone-format";
import { isSupportedTimezone } from "@/lib/timezones";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Editing the business's own details.
 *
 * These could be set during onboarding and never again. A business that moved
 * premises, changed its number, or was set up with a typo had no way to correct
 * it — and the settings menu linked here to a page that did not exist, so the
 * one visible route to fixing it was a 404.
 *
 * Written through the caller's session, so RLS decides whether they may change
 * this business at all. The organization comes from their own membership and is
 * never read from the form.
 */

export type BusinessState = { error: string; notice?: string };

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export async function saveBusinessDetails(
  _previous: BusinessState,
  formData: FormData,
): Promise<BusinessState> {
  const name = field(formData, "name");
  if (!name) return { error: "The business needs a name." };

  const rawPhone = field(formData, "phone");
  const phone = rawPhone ? toE164(rawPhone) : "";
  if (rawPhone && !phone) {
    return {
      error: "That phone number could not be read. A 10-digit US number or +country code works.",
    };
  }

  const timezone = field(formData, "timezone");
  if (timezone && !isSupportedTimezone(timezone)) {
    return { error: "That is not a timezone this app knows about." };
  }

  const supabase = asFlexibleClient(await createClient());

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .limit(1)
    .maybeSingle();

  const organizationId =
    typeof membership?.organization_id === "string" ? membership.organization_id : "";
  if (!organizationId) return { error: "You are not a member of a business." };

  // The form disables itself for a technician, but a disabled fieldset is a
  // courtesy to the person filling it in, not a permission check — the action
  // is reachable without it. RLS would refuse this anyway; saying so plainly
  // beats "Those details could not be saved.", which reads like a fault.
  const role = typeof membership?.role === "string" ? membership.role : "";
  if (role !== "owner" && role !== "admin") {
    return { error: "Only an owner or administrator can change the business details." };
  }

  const { error } = await supabase
    .from("organizations")
    .update({
      name,
      phone: phone || null,
      base_address_line_1: field(formData, "addressLine1") || null,
      base_city: field(formData, "city") || null,
      base_state: field(formData, "state") || null,
      base_postal_code: field(formData, "postalCode") || null,
      ...(timezone ? { timezone } : {}),
    })
    .eq("id", organizationId);

  // RLS answers somebody without permission with a policy violation rather than
  // silence, so a failure here is genuinely "you may not do this".
  if (error) return { error: "Those details could not be saved." };

  // The name and phone appear in every message a customer receives and on the
  // public booking page, and the timezone decides what "today" and every
  // arrival window read as. This page is the only thing that writes the
  // timezone now — the account page used to as well — so the whole layout is
  // revalidated rather than three paths, which is what the account page did
  // and what stops a stale schedule surviving the change.
  revalidatePath("/", "layout");

  return { error: "", notice: "Saved. Customers will see this on new messages." };
}
