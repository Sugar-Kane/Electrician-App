"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, ShieldCheck } from "lucide-react";

import { Banner } from "@/components/ui/banner";
import { readTotpCode } from "@/lib/mfa-policy";
import { createClient } from "@/lib/supabase/client";

/** The second step of signing in: the code from the authenticator app. */
export function MfaVerifyForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const digits = readTotpCode(code);
    if (!digits) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const supabase = createClient();
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      const factor = factors?.totp?.[0];
      if (listError || !factor) throw new Error("Two-step sign-in isn't set up on this account.");
      const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: digits });
      if (verifyError) throw new Error("That code didn't work. Check the time on your phone and try the newest code.");
      router.replace(nextPath);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That code didn't work. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-ink">Code from your authenticator app</span>
        <input
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          required
          autoFocus
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="123456"
          className="field-inset block min-h-13 w-full rounded-control border border-line bg-raised px-4 text-center text-2xl tracking-[0.3em] text-white outline-none focus:border-brand/60"
        />
      </label>
      {error ? <Banner tone="critical">{error}</Banner> : null}
      <button
        type="submit"
        disabled={submitting}
        className="tap-target inline-flex min-h-13 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-base font-bold text-on-brand disabled:opacity-60"
      >
        {submitting ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : <ShieldCheck className="h-5 w-5" aria-hidden />}
        Continue
      </button>
    </form>
  );
}
