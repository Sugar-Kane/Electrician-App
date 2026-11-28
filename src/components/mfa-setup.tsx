"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, ShieldCheck, Trash2 } from "lucide-react";

import { Banner } from "@/components/ui/banner";
import { readTotpCode } from "@/lib/mfa-policy";
import { createClient } from "@/lib/supabase/client";

type Factor = { id: string; name: string; createdLabel: string };
type Pending = { id: string; qr: string; secret: string };

function toFactors(list: { id: string; friendly_name?: string; created_at: string }[]): Factor[] {
  return list.map((factor) => ({
    id: factor.id,
    name: factor.friendly_name || "Authenticator app",
    createdLabel: new Date(factor.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
  }));
}

/**
 * Setting up two-step sign-in: scan the QR code with an authenticator app
 * (Google Authenticator, 1Password, Authy...), type the code it shows to
 * confirm, and from then on every sign-in asks for a code. Supabase Auth's
 * TOTP factors; nothing is stored by this app.
 */
export function MfaSetup({ nextPath }: { nextPath: string | null }) {
  const router = useRouter();
  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const { data } = await createClient().auth.mfa.listFactors();
    setFactors(toFactors(data?.totp ?? []));
  }, []);

  useEffect(() => {
    let live = true;
    createClient()
      .auth.mfa.listFactors()
      .then(({ data }) => {
        if (live) setFactors(toFactors(data?.totp ?? []));
      });
    return () => {
      live = false;
    };
  }, []);

  async function start() {
    setBusy(true);
    setError("");
    setNotice("");
    const supabase = createClient();
    // An earlier attempt left unconfirmed is cleared first; it can't be used.
    const { data: existing } = await supabase.auth.mfa.listFactors();
    for (const factor of existing?.all ?? []) {
      if (factor.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}` });
    setBusy(false);
    if (enrollError || !data) {
      setError("Two-step sign-in couldn't be started. Try again.");
      return;
    }
    setPending({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending || busy) return;
    const digits = readTotpCode(code);
    if (!digits) {
      setError("Enter the 6-digit code your app shows for Volteira.");
      return;
    }
    setBusy(true);
    setError("");
    const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({ factorId: pending.id, code: digits });
    setBusy(false);
    if (verifyError) {
      setError("That code didn't work. Check the time on your phone and try the newest code.");
      return;
    }
    setPending(null);
    setCode("");
    setNotice("Two-step sign-in is on. Each sign-in will ask for a code from your app.");
    await load();
    if (nextPath) router.replace(nextPath);
    router.refresh();
  }

  async function remove(factor: Factor) {
    if (!window.confirm(`Remove ${factor.name}? Signing in will no longer ask for a code${factors && factors.length <= 1 ? ", and owners and admins must set it up again" : ""}.`)) return;
    setBusy(true);
    setError("");
    const { error: removeError } = await createClient().auth.mfa.unenroll({ factorId: factor.id });
    setBusy(false);
    if (removeError) {
      setError("It couldn't be removed. Sign in again with your code, then try once more.");
      return;
    }
    setNotice("Removed.");
    await load();
    router.refresh();
  }

  if (factors === null) return <p className="text-sm text-ink-muted">Loading…</p>;

  return (
    <div className="space-y-4">
      {notice ? <Banner tone="positive">{notice}</Banner> : null}
      {error ? <Banner tone="critical">{error}</Banner> : null}

      {factors.length > 0 ? (
        <ul className="space-y-2">
          {factors.map((factor) => (
            <li key={factor.id} className="flex items-center justify-between gap-3 rounded-control border border-line p-3">
              <span className="min-w-0">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <ShieldCheck className="h-4 w-4 text-brand" aria-hidden /> {factor.name}
                </span>
                <span className="block text-sm text-ink-muted">Added {factor.createdLabel}</span>
              </span>
              <button
                type="button"
                onClick={() => void remove(factor)}
                disabled={busy}
                className="tap-target inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-critical disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" aria-hidden /> Remove
              </button>
            </li>
          ))}
        </ul>
      ) : pending ? (
        <form onSubmit={confirm} className="space-y-4">
          <ol className="list-decimal space-y-1 pl-5 text-sm leading-6 text-ink-muted">
            <li>Open an authenticator app on your phone (Google Authenticator, 1Password, Authy, Microsoft Authenticator).</li>
            <li>Add an account and scan this code.</li>
            <li>Type the 6-digit code it shows.</li>
          </ol>
          {/* The QR code Supabase returns is an SVG data URL. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pending.qr} alt="QR code to add Volteira to your authenticator app" className="h-48 w-48 rounded-control bg-white p-2" />
          <p className="break-all text-sm text-ink-muted">
            Can&apos;t scan it? Enter this key instead: <span className="font-mono text-ink">{pending.secret}</span>
          </p>
          <label className="block text-sm font-medium">
            Code from the app
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
              className="mt-1 block min-h-12 w-full max-w-xs rounded-control border border-line bg-surface px-3 text-center text-xl tracking-[0.3em]"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-bold text-on-brand disabled:opacity-60 sm:w-auto"
          >
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
            Turn on two-step sign-in
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy}
          className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-bold text-on-brand disabled:opacity-60 sm:w-auto"
        >
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
          Set up two-step sign-in
        </button>
      )}
    </div>
  );
}
