"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { acceptOutcome } from "@/lib/invitation-message";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export type AcceptState = { error: string };

/**
 * Taking up an invitation.
 *
 * All of the deciding happens in the database function, which is the only place
 * that can see both the token and the signed-in address at once. This reads its
 * one-word answer and turns it into either a redirect or a sentence.
 */
export async function acceptInvitation(
  _previousState: AcceptState,
  formData: FormData,
): Promise<AcceptState> {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) return { error: acceptOutcome("invalid").detail };

  const supabase = asFlexibleClient(await createClient());
  const { data, error } = await supabase.rpc("accept_organization_invitation", {
    p_token: token,
  });

  if (error) return { error: "That could not be completed. Try again." };

  const outcome = acceptOutcome(typeof data === "string" ? data : "invalid");
  if (!outcome.ok) return { error: outcome.detail };

  revalidatePath("/", "layout");
  redirect("/");
}
