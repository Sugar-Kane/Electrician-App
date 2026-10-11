"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, LoaderCircle, Mail } from "lucide-react";

import { Banner } from "@/components/ui/banner";
import { createClient } from "@/lib/supabase/client";

/**
 * Asking for a reset link.
 *
 * Sent from the browser, not the server, because the link is tied to the
 * browser that asked for it: Supabase keeps half of a one-time code here and
 * the other half in the email. That is also why the message says to open the
 * link on this device.
 *
 * The answer is the same whether or not the email has an account, so this box
 * cannot be used to find out who uses Volteira.
 */
export function ForgotPasswordForm({ initialError }: { initialError?: string }) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(initialError ?? "");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    setError("");

    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Enter the email address you sign in with.");
      return;
    }

    setSending(true);
    try {
      const callback = new URL("/auth/callback", window.location.origin);
      callback.searchParams.set("next", "/reset-password");
      const { error: resetError } = await createClient().auth.resetPasswordForEmail(address, {
        redirectTo: callback.toString(),
      });
      // Only a refusal that says nothing about the account is shown: asking
      // too often. Anything else still reads as sent.
      if (resetError && resetError.status === 429) {
        setError("Too many reset emails were asked for. Wait a minute, then try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("The reset email could not be sent. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-ink">Email address</span>
          <span className="flex min-h-13 items-center gap-3 rounded-control border border-line bg-raised px-4 focus-within:border-brand/60">
            <Mail className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
            <input
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              className="min-w-0 flex-1 bg-transparent py-3 text-base text-white outline-none placeholder:text-ink-faint"
            />
          </span>
        </label>

        {error ? <Banner tone="critical">{error}</Banner> : null}
        {sent ? (
          <Banner tone="positive">
            If {email.trim()} has a Volteira account, a reset link is on its way. Open it on this
            device, in this browser, within an hour.
          </Banner>
        ) : null}

        <button
          type="submit"
          disabled={sending || sent}
          className="tap-target flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-semibold text-on-brand disabled:cursor-not-allowed disabled:opacity-60"
        >
          {sending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : null}
          {sending ? "Sending…" : sent ? "Reset link sent" : "Send reset link"}
          {!sending && !sent ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        Remembered it?{" "}
        <Link href="/login" className="tap-target inline-flex items-center font-semibold text-brand hover:text-caution">
          Sign in
        </Link>
      </p>
    </>
  );
}
