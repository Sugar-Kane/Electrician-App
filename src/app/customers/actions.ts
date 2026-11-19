"use server";

import { revalidatePath } from "next/cache";

import { mayReviewContacts, readReviewChoice } from "@/lib/pending-contacts";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export type ReviewContactState = { error: string; notice?: string };

/**
 * Keep a new caller or texter as a customer, or delete them.
 *
 * Only a contact still waiting for review: these buttons can never archive a
 * customer the business already has. Delete archives the contact and their
 * conversation, so a spam number leaves Messages too. Through the caller's own
 * session, so row security keeps it to their business.
 */
export async function reviewContactAction(_previous: ReviewContactState, formData: FormData): Promise<ReviewContactState> {
  const customerId = String(formData.get("customerId") ?? "").trim();
  const choice = readReviewChoice(formData.get("choice"));
  if (!/^[0-9a-f-]{36}$/i.test(customerId) || !choice) return { error: "That contact could not be found." };

  const context = await currentContext();
  if (!context) return { error: "Sign in to do this." };
  if (!mayReviewContacts(context.role)) return { error: "Only the owner or an admin can do this." };

  const supabase = asFlexibleClient(await createClient());
  const now = new Date().toISOString();
  const { data: changed, error } = await supabase
    .from("customers")
    .update(choice === "keep" ? { pending_review: false } : { archived_at: now })
    .eq("organization_id", context.organizationId)
    .eq("id", customerId)
    .eq("pending_review", true)
    .is("archived_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("contact review failed", error);
    return { error: "That could not be saved. Try again." };
  }
  if (!changed) return { error: "That contact was already reviewed." };

  if (choice === "delete") {
    const { error: conversationError } = await supabase
      .from("conversations")
      .update({ archived_at: now })
      .eq("organization_id", context.organizationId)
      .eq("customer_id", customerId)
      .is("archived_at", null);
    if (conversationError) console.error("contact review: conversation not archived", conversationError);
  }

  revalidatePath("/customers");
  revalidatePath("/messages");
  revalidatePath(`/customers/${customerId}`);
  return { error: "", notice: choice === "keep" ? "Added to your customers." : "Deleted." };
}
