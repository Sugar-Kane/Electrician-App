"use server";

import { revalidatePath } from "next/cache";

import { getMessagingContext } from "@/lib/messaging";
import { renderTemplate, TEMPLATE_TRIGGERS } from "@/lib/message-templates";

export type TemplateActionState = { error: string; saved?: boolean };

/**
 * Save one template's wording and whether it is switched on.
 *
 * Writes through the caller's session so RLS decides whether they may touch
 * this organization's templates.
 */
export async function saveMessageTemplate(
  _previousState: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const trigger = String(formData.get("trigger") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const isActive = formData.get("isActive") === "on";

  if (!(TEMPLATE_TRIGGERS as readonly string[]).includes(trigger)) {
    return { error: "Unknown message type." };
  }
  if (body.length < 1) return { error: "Write the message first." };
  if (body.length > 1600) return { error: "Messages are limited to 1600 characters." };

  // Checked against a rendering with no variables supplied, which is the
  // shortest the message can ever be. A template that is only placeholders
  // would otherwise save and then refuse to send at the moment it mattered.
  if (renderTemplate(body, {}).length < 1) {
    return { error: "This would send an empty message when the placeholders are filled in." };
  }

  const context = await getMessagingContext();
  if (!context) return { error: "Sign in to edit templates." };

  const { error } = await context.database
    .from("message_templates")
    .update({ body, is_active: isActive })
    .eq("organization_id", context.organizationId)
    .eq("trigger_event", trigger)
    .eq("channel", "sms")
    // Without this the same body is written over every language's row, so
    // editing the English wording silently destroys the Spanish one.
    .eq("language", "en");

  if (error) return { error: "That could not be saved. Try again." };

  revalidatePath("/settings/messages");
  return { error: "", saved: true };
}
