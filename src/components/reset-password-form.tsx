"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff, LoaderCircle, LockKeyhole } from "lucide-react";

import { resetPassword, type ResetPasswordState } from "@/app/reset-password/actions";
import { Banner } from "@/components/ui/banner";
import { MIN_NEW_PASSWORD_LENGTH } from "@/lib/password-reset";

const initialState: ResetPasswordState = { error: "" };

export function ResetPasswordForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState(resetPassword, initialState);
  const [showPassword, setShowPassword] = useState(false);

  const box =
    "flex min-h-13 items-center gap-3 rounded-control border border-line bg-raised px-4 focus-within:border-brand/60";
  const input =
    "min-w-0 flex-1 bg-transparent py-3 text-base text-white outline-none placeholder:text-ink-faint";

  return (
    <form action={action} className="space-y-4">
      {/* For password managers, so the new password is saved against the right login. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />

      <label className="block">
        <span className="mb-2 block text-sm font-medium text-ink">New password</span>
        <span className={box}>
          <LockKeyhole className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
          <input
            type={showPassword ? "text" : "password"}
            name="password"
            autoComplete="new-password"
            required
            minLength={MIN_NEW_PASSWORD_LENGTH}
            placeholder={`At least ${MIN_NEW_PASSWORD_LENGTH} characters`}
            className={input}
          />
          <button
            type="button"
            onClick={() => setShowPassword((visible) => !visible)}
            className="tap-target -mr-2 grid min-w-11 place-items-center text-ink-muted"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
          </button>
        </span>
      </label>

      <label className="block">
        <span className="mb-2 block text-sm font-medium text-ink">Type it again</span>
        <span className={box}>
          <LockKeyhole className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
          <input
            type={showPassword ? "text" : "password"}
            name="passwordConfirmation"
            autoComplete="new-password"
            required
            minLength={MIN_NEW_PASSWORD_LENGTH}
            className={input}
          />
        </span>
      </label>

      {state.error ? <Banner tone="critical">{state.error}</Banner> : null}

      <button
        type="submit"
        disabled={pending}
        className="tap-target flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-semibold text-on-brand disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : null}
        {pending ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
