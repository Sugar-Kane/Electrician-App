"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

type AuthMode = "login" | "signup";

export function AuthForm({ mode, nextPath, initialError }: { mode: AuthMode; nextPath: string; initialError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(initialError ?? "");
  const [message, setMessage] = useState("");
  const isSignup = mode === "signup";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setMessage("");

    if (isSignup && password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }

    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient();
      if (isSignup) {
        const callback = new URL("/auth/callback", window.location.origin);
        callback.searchParams.set("next", nextPath);
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: callback.toString() },
        });
        if (authError) throw authError;
        if (data.session) {
          router.replace(nextPath);
          router.refresh();
          return;
        }
        setMessage("Check your email to confirm your account. The confirmation link will bring you back to Volteira.");
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
        router.replace(nextPath);
        router.refresh();
      }
    } catch (authError) {
      const fallback = isSignup ? "We couldn’t create the account. Please try again." : "The email or password is incorrect.";
      setError(authError instanceof Error && !authError.message.toLowerCase().includes("invalid login") ? authError.message : fallback);
    } finally {
      setSubmitting(false);
    }
  }

  const alternateHref = isSignup ? `/login?next=${encodeURIComponent(nextPath)}` : `/signup?next=${encodeURIComponent(nextPath)}`;

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <label className="block"><span className="mb-2 block text-sm font-medium text-slate-200">Email address</span><span className="flex min-h-13 items-center gap-3 rounded-2xl border border-white/10 bg-[#0d202d] px-4 focus-within:border-[#ffc21c]/60"><Mail className="h-5 w-5 shrink-0 text-slate-500" aria-hidden /><input type="email" name="email" autoComplete="email" inputMode="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" className="min-w-0 flex-1 bg-transparent py-3 text-base text-white outline-none placeholder:text-slate-600" /></span></label>
        <label className="block"><span className="mb-2 block text-sm font-medium text-slate-200">Password</span><span className="flex min-h-13 items-center gap-3 rounded-2xl border border-white/10 bg-[#0d202d] px-4 focus-within:border-[#ffc21c]/60"><LockKeyhole className="h-5 w-5 shrink-0 text-slate-500" aria-hidden /><input type={showPassword ? "text" : "password"} name="password" autoComplete={isSignup ? "new-password" : "current-password"} required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" className="min-w-0 flex-1 bg-transparent py-3 text-base text-white outline-none placeholder:text-slate-600" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} className="tap-target -mr-2 grid min-w-11 place-items-center text-slate-400" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}</button></span></label>
        {isSignup ? <label className="block"><span className="mb-2 block text-sm font-medium text-slate-200">Confirm password</span><span className="flex min-h-13 items-center gap-3 rounded-2xl border border-white/10 bg-[#0d202d] px-4 focus-within:border-[#ffc21c]/60"><LockKeyhole className="h-5 w-5 shrink-0 text-slate-500" aria-hidden /><input type={showPassword ? "text" : "password"} name="confirmPassword" autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Enter it again" className="min-w-0 flex-1 bg-transparent py-3 text-base text-white outline-none placeholder:text-slate-600" /></span></label> : null}

        {error ? <p role="alert" className="flex items-start gap-2 rounded-2xl border border-red-400/20 bg-red-400/[0.07] p-3 text-sm leading-5 text-red-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p> : null}
        {message ? <p role="status" className="flex items-start gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.07] p-3 text-sm leading-5 text-emerald-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{message}</p> : null}

        <button type="submit" disabled={submitting || Boolean(message)} className="tap-target flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#ffc21c] px-5 text-sm font-semibold text-[#071723] shadow-lg shadow-yellow-500/10 disabled:cursor-not-allowed disabled:opacity-60">{submitting ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : null}{submitting ? (isSignup ? "Creating account…" : "Signing in…") : (isSignup ? "Create account" : "Sign in")} {!submitting ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}</button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-400">{isSignup ? "Already have an account?" : "New to Volteira?"} <Link href={alternateHref} className="tap-target inline-flex items-center font-semibold text-[#ffc21c] hover:text-yellow-300">{isSignup ? "Sign in" : "Create an account"}</Link></p>
    </>
  );
}
