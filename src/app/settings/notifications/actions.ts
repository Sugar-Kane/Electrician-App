"use server";

import { revalidatePath } from "next/cache";

import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Where this business hears about a booking taken without them.
 *
 * The write goes through the caller's session, so RLS decides whether they may
 * touch this organization's row — the organization id in the form is a
 * convenience, never an authorisation.
 */

export type NotificationActionState = { error: string; saved?: boolean };

function value(formData: FormData, key: string, maxLength: number) {
  return String(formData.get(key) ?? "").trim().slice(0, maxLength);
}

export async function saveOwnerNotifications(
  _previousState: NotificationActionState,
  formData: FormData,
): Promise<NotificationActionState> {
  const organizationId = value(formData, "organizationId", 40);
  const email = value(formData, "ownerEmail", 254).toLowerCase();
  const phone = value(formData, "ownerPhone", 30);

  if (!organizationId) return { error: "No business workspace was found." };

  // Both are optional — a business may genuinely want neither, and saying so by
  // clearing the field should work. Only a value that cannot work is refused.
  if (email && !/^[^@\s]+@[^@.\s]+\.[^@\s]{2,}$/.test(email)) {
    return { error: "That email address does not look right." };
  }
  if (phone && phone.replace(/\D/g, "").length < 10) {
    return { error: "Enter a full phone number, including the area code." };
  }

  const supabase = asFlexibleClient(await createClient());
  // Selecting the row back is the only way to tell a save from a no-op: only
  // admins may update an organization, and RLS answers a non-admin with zero
  // rows and no error. Without this the form would say "Saved" to someone whose
  // change never happened.
  const { data, error } = await supabase
    .from("organizations")
    .update({
      owner_notification_email: email || null,
      owner_notification_phone: phone || null,
    })
    .eq("id", organizationId)
    .select("id");

  if (error) return { error: "That could not be saved. Try again." };
  if (!Array.isArray(data) || data.length === 0) {
    return { error: "Only an owner or admin of this business can change booking alerts." };
  }

  revalidatePath("/settings/notifications");
  return { error: "", saved: true };
}
