"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, LockKeyhole } from "lucide-react";

import { authorizeBookingPaymentMethod, type AuthorizeState } from "@/app/booking/[token]/actions";
import { DiagnosticAuthorization } from "@/components/diagnostic-authorization";
import type { Language } from "@/lib/diagnostic-payment-policy";

function Submit({ disabled, language }: { disabled: boolean; language: Language }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className="tap-target mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 font-semibold text-on-brand disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : <LockKeyhole className="h-5 w-5" aria-hidden />}
      {language === "es" ? "Guardar método de pago · $0.00 hoy" : "Save payment method · $0.00 today"}
    </button>
  );
}

/** The authorization a texted or phoned-in booking is confirmed with. */
export function BookingAuthorizationForm({
  token,
  businessName,
  feeCents,
  serviceName,
  creditTowardRepairs,
  initialLanguage,
}: {
  token: string;
  businessName: string;
  feeCents: number;
  serviceName?: string;
  creditTowardRepairs: boolean;
  initialLanguage: Language;
}) {
  const action = authorizeBookingPaymentMethod.bind(null, token);
  const [state, formAction] = useActionState<AuthorizeState, FormData>(action, { error: "" });
  const [checked, setChecked] = useState(false);
  const [language, setLanguage] = useState<Language>(initialLanguage);

  return (
    <form id="authorize" action={formAction} className="mt-6">
      <input type="hidden" name="language" value={language} />
      <DiagnosticAuthorization
        businessName={businessName}
        feeCents={feeCents}
        serviceName={serviceName}
        creditTowardRepairs={creditTowardRepairs}
        requirePaymentMethod
        language={language}
        onLanguage={setLanguage}
        checked={checked}
        onChange={setChecked}
      />
      {state.error ? (
        <p role="alert" className="mt-3 rounded-control border border-critical/40 bg-critical-bg p-3 text-sm text-critical">
          {state.error}
        </p>
      ) : null}
      <Submit disabled={!checked} language={language} />
    </form>
  );
}
