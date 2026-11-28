"use client";

import { ShieldCheck } from "lucide-react";

import {
  authorizationText,
  creditNotice,
  priceSummary,
  DEFAULT_SERVICE_NAME,
  type Language,
} from "@/lib/diagnostic-payment-policy";

/**
 * The deferred diagnostic disclosure every booking surface shows: the fee,
 * $0.00 due today, the amount due on completion, and an UNTICKED box the
 * customer must tick themselves to authorize saving a payment method.
 *
 * The words come from diagnostic-payment-policy.ts, which is also what the
 * server stores with the authorization, so what was shown is what is kept.
 */
export function DiagnosticAuthorization({
  businessName,
  feeCents,
  serviceName,
  creditTowardRepairs,
  requirePaymentMethod,
  language,
  onLanguage,
  checked,
  onChange,
  name = "paymentAuthorization",
}: {
  businessName: string;
  feeCents: number;
  serviceName?: string;
  creditTowardRepairs: boolean;
  requirePaymentMethod: boolean;
  language: Language;
  onLanguage?: (language: Language) => void;
  checked: boolean;
  onChange: (checked: boolean) => void;
  name?: string;
}) {
  const rows = priceSummary(
    { feeCents, dueTodayCents: 0, dueOnCompletionCents: feeCents, serviceName: serviceName || DEFAULT_SERVICE_NAME },
    language,
  );
  const es = language === "es";

  return (
    <section lang={language} aria-labelledby="diagnostic-payment-heading" className="rounded-control border border-brand/25 bg-brand/[0.06] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id="diagnostic-payment-heading" className="text-sm font-semibold text-white">
          {es ? "Pago del diagnóstico" : "Diagnostic payment"}
        </h3>
        {onLanguage ? (
          <div role="group" aria-label={es ? "Idioma" : "Language"} className="flex rounded-chip border border-line text-xs">
            {(["en", "es"] as const).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={language === option}
                onClick={() => onLanguage(option)}
                className={`tap-target min-h-9 px-3 font-semibold ${language === option ? "bg-brand text-on-brand" : "text-ink-muted"} first:rounded-l-chip last:rounded-r-chip`}
              >
                {option === "en" ? "English" : "Español"}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <dl className="mt-3 divide-y divide-line text-sm">
        {rows.map((row, index) => (
          <div key={row.label} className="flex items-baseline justify-between gap-4 py-2">
            <dt className={index === 1 ? "font-semibold text-white" : "text-ink-muted"}>{row.label}</dt>
            <dd className={index === 1 ? "text-lg font-bold text-positive" : "font-semibold text-white"}>{row.amount}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-2 text-xs leading-5 text-ink-muted">
        {es
          ? "La tarifa de diagnóstico se paga cuando se completa el servicio de diagnóstico contratado. Guardar su método de pago no es un pago."
          : "The diagnostic fee becomes payable when the contracted diagnostic service is completed. Saving a payment method is not a payment."}
      </p>

      {creditTowardRepairs ? <p className="mt-2 text-xs leading-5 text-ink-muted">{creditNotice(language)}</p> : null}

      {requirePaymentMethod ? (
        <label className="tap-target mt-4 flex cursor-pointer items-start gap-3 rounded-control border border-line bg-raised p-4">
          {/* Never pre-checked. The server refuses a booking without this box. */}
          <input
            type="checkbox"
            name={name}
            value="yes"
            checked={checked}
            onChange={(event) => onChange(event.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-brand"
            aria-describedby="diagnostic-authorization-note"
          />
          <span className="text-sm leading-6 text-ink">{authorizationText({ businessName, feeCents, language })}</span>
        </label>
      ) : null}

      <p id="diagnostic-authorization-note" className="mt-3 flex items-start gap-2 text-xs leading-5 text-ink-faint">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
        {es
          ? "Los datos de su tarjeta se ingresan directamente en Stripe. Nunca los vemos ni los guardamos. Esta autorización no reemplaza su contrato de servicio ni sus derechos de cancelación."
          : "Your card details are entered directly with Stripe. We never see or store them. This authorization does not replace your service contract or your cancellation rights."}
      </p>
    </section>
  );
}
