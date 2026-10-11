"use server";

import { redirect } from "next/navigation";

import { mayResetPassword, newPasswordProblem } from "@/lib/password-reset";
import { createClient } from "@/lib/supabase/server";

export type ResetPasswordState = { error: string };

/**
 * Setting a new password from a reset link.
 *
 * The page only shows the form to a session that came through a link, but the
 * page is not what keeps anybody out: this checks again, on the token, because
 * a form can be posted without the page.
 */
export async function resetPassword(
  _previous: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirmation = String(formData.get("passwordConfirmation") ?? "");

  const problem = newPasswordProblem(password, confirmation);
  if (problem) return { error: problem };

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims || !mayResetPassword(data.claims.amr, Math.floor(Date.now() / 1000))) {
    return { error: "This reset link has expired. Ask for a new one and use it within an hour." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") {
      return { error: "That is already your password. Choose a different one, or sign in with it." };
    }
    if (error.code === "weak_password") {
      return { error: "That password is too easy to guess. Try a longer one." };
    }
    return { error: "The password was not changed. Ask for a new reset link and try again." };
  }

  redirect(`/account?${new URLSearchParams({ section: "security", saved: "Password updated." })}#security`);
}
