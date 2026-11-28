import type { Metadata } from "next";
import {
  CalendarCheck2,
  Clock3,
  CreditCard,
  MapPin,
  Phone,
  ReceiptText,
} from "lucide-react";

import { bookingPageCopy, bookingPageLanguage } from "@/lib/booking-page-copy";
import { bookingPageState, bookingPayNotice } from "@/lib/booking-page-state";
import { DEFAULT_DIAGNOSTIC_FEE_CENTS } from "@/lib/diagnostic-visit";
import { intakeQuestionIn } from "@/lib/intake-phrases";
import { realName } from "@/lib/sms-intake";
import { createPublicClient } from "@/lib/supabase/public";
import { BookingAuthorizationForm } from "@/components/booking-authorization-form";
import { revokeBookingAuthorization } from "@/app/booking/[token]/actions";
import { DISPLAY_LABELS, displayState, type AuthorizationState } from "@/lib/diagnostic-payment-policy";

/**
 * The page a customer reaches from the link in their confirmation.
 *
 * Reached by a token, not a session: the person who booked by phone has no
 * account and should not need one to check what they agreed to. The token is
 * the only thing standing between this and the world, so the page shows what
 * the caller already knows — their own appointment — and nothing that would
 * help someone guess at another.
 */

export const metadata: Metadata = {
  title: "Your appointment",
  // A confirmation link should not turn up in a search result.
  robots: { index: false, follow: false },
};

type Confirmation = {
  business_name: string;
  business_phone: string;
  contact_name: string | null;
  description: string | null;
  address_line_1: string | null;
  city: string | null;
  postal_code: string | null;
  arrival_window_start: string | null;
  arrival_window_end: string | null;
  diagnostic_fee_cents: number | null;
  time_zone: string | null;
  status: string | null;
  intake_answers: { question: string; answer: string }[] | null;
  deposit_cents: number | null;
  deposit_paid: boolean | null;
  expires_at: string | null;
};

/** The deferred diagnostic payment on this booking (get_booking_diagnostic_status). */
type DiagnosticStatus = {
  collect_after_completion: boolean | null;
  require_payment_method: boolean | null;
  credit_toward_repairs: boolean | null;
  fee_cents: number | null;
  authorization_state: string | null;
  authorized_cents: number | null;
  payment_method_brand: string | null;
  payment_method_last4: string | null;
  diagnostic_completed: boolean | null;
};

/** How it was booked, and in what language, from the same token. */
type BookingLocale = {
  language: string | null;
  channel: string | null;
  customer_name: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function windowLabel(start: string, end: string, timeZone: string, locale: string) {
  const day = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(start));
  const time = (value: string) =>
    new Intl.DateTimeFormat(locale, { timeZone, hour: "numeric", minute: "2-digit" }).format(
      new Date(value),
    );
  return { day, window: `${time(start)} – ${time(end)}` };
}

export default async function BookingConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ pay?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);

  let booking: Confirmation | null = null;
  let locale: BookingLocale | null = null;
  let diagnostic: DiagnosticStatus | null = null;
  // Checked before the round trip: a malformed token is a typo or a probe, and
  // neither is worth a database call.
  if (UUID.test(token)) {
    const supabase = createPublicClient();
    const [{ data }, { data: localeRows }, { data: diagnosticRows }] = await Promise.all([
      supabase.rpc("get_phone_booking_confirmation", { p_token: token }),
      supabase.rpc("get_booking_confirmation_locale", { p_token: token }),
      supabase.rpc("get_booking_diagnostic_status" as never, { p_booking_token: token } as never),
    ]);
    diagnostic = Array.isArray(diagnosticRows) && diagnosticRows.length > 0 ? (diagnosticRows[0] as DiagnosticStatus) : null;
    booking = Array.isArray(data) && data.length > 0 ? (data[0] as Confirmation) : null;
    locale = Array.isArray(localeRows) && localeRows.length > 0 ? (localeRows[0] as BookingLocale) : null;
  }

  // The language they booked in. A page with nothing to show still answers in
  // English and Spanish, since there is no booking to say which.
  const language = bookingPageLanguage(locale?.language);
  const copy = bookingPageCopy(language);

  if (!booking) {
    return (
      <main
        id="main-content"
        className="grid min-h-screen place-items-center bg-canvas px-4 py-10 text-white"
      >
        <section className="w-full max-w-lg rounded-[28px] border border-line bg-[#081925] p-6 text-center sm:p-8">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-caution-bg text-caution">
            <Clock3 className="h-7 w-7" aria-hidden />
          </span>
          <h1 className="mt-5 text-2xl font-semibold">{bookingPageCopy("en").notFoundTitle}</h1>
          <p className="mt-3 text-sm leading-6 text-ink-muted">{bookingPageCopy("en").notFoundBody}</p>
          <p lang="es" className="mt-5 text-sm font-semibold">{bookingPageCopy("es").notFoundTitle}</p>
          <p lang="es" className="mt-1 text-sm leading-6 text-ink-muted">{bookingPageCopy("es").notFoundBody}</p>
        </section>
      </main>
    );
  }

  const timeZone = booking.time_zone || "America/Los_Angeles";
  const labels =
    booking.arrival_window_start && booking.arrival_window_end
      ? windowLabel(booking.arrival_window_start, booking.arrival_window_end, timeZone, copy.locale)
      : null;
  const address = [booking.address_line_1, booking.city, booking.postal_code]
    .filter(Boolean)
    .join(", ");
  const money = (cents: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(cents / 100);

  const fee = money(booking.diagnostic_fee_cents ?? DEFAULT_DIAGNOSTIC_FEE_CENTS);
  const depositCents =
    booking.deposit_cents ?? booking.diagnostic_fee_cents ?? DEFAULT_DIAGNOSTIC_FEE_CENTS;
  const deposit = money(depositCents);
  // Their answers are shown as they gave them; the questions in their language.
  const answers = (Array.isArray(booking.intake_answers) ? booking.intake_answers : []).map((entry) => ({
    question: intakeQuestionIn(entry.question, language),
    answer: entry.answer,
  }));
  // A placeholder the assistant filled in is not a name.
  const name = realName(booking.contact_name ?? "") || realName(locale?.customer_name ?? "");
  const state = bookingPageState({
    status: booking.status,
    depositPaid: booking.deposit_paid === true,
    depositCents,
    expiresAt: booking.expires_at,
    // Read before `deferred` is worked out below; same rule (fails safe).
    deferred: diagnostic?.collect_after_completion !== false,
  });
  const awaitingPayment = state === "awaiting_payment";
  const confirmed = state === "confirmed";
  const paymentReview = state === "payment_review";
  // A stale query string must not make a paid appointment look canceled after
  // Stripe has already finished it.
  // Deferred diagnostic businesses (California, or no jurisdiction set): the
  // page never asks for a payment before the service. If the status cannot be
  // read, it fails safe to the deferred wording.
  const deferred = diagnostic?.collect_after_completion !== false;
  const authState = (diagnostic?.authorization_state ?? null) as AuthorizationState | null;
  const completed = diagnostic?.diagnostic_completed === true;
  const payState = displayState({ authorizationState: authState, diagnosticCompleted: completed, eligible: false });
  const es = language === "es";
  const deferredNotice =
    query.pay === "revoked"
      ? es
        ? "Retiramos su autorización y quitamos su método de pago guardado. Su cita sigue en pie."
        : "Your authorization was withdrawn and your saved payment method removed. Your appointment still stands."
      : query.pay === "recovered"
        ? es
          ? "Gracias. Su pago se está procesando."
          : "Thank you. Your payment is being processed."
        : query.pay === "canceled"
          ? es
            ? "No se guardó ningún método de pago y no se cobró nada."
            : "No payment method was saved and nothing was charged."
          : "";
  const notice = deferred ? deferredNotice : confirmed || paymentReview ? "" : bookingPayNotice(query.pay, language);

  const heading = confirmed
    ? copy.booked(name)
    : awaitingPayment
      ? copy.held(name)
      : paymentReview
        ? copy.paymentReceived
        : copy.callToConfirm;

  return (
    <main
      id="main-content"
      lang={language}
      className="grid min-h-screen place-items-center bg-canvas px-4 py-10 text-white"
    >
      <section className="w-full max-w-lg rounded-[28px] border border-line bg-[#081925] p-6 sm:p-8">
        <span
          className={`grid h-14 w-14 place-items-center rounded-full ${
            confirmed ? "bg-positive-bg text-positive" : "bg-caution-bg text-caution"
          }`}
        >
          {confirmed ? (
            <CalendarCheck2 className="h-7 w-7" aria-hidden />
          ) : (
            <Clock3 className="h-7 w-7" aria-hidden />
          )}
        </span>

        <h1 className="mt-5 text-2xl font-semibold">{heading}</h1>
        <p className="mt-2 text-sm text-ink-muted">{copy.withBusiness(booking.business_name)}</p>

        {notice ? (
          <p className="mt-5 rounded-control border border-caution/40 bg-caution-bg/40 p-3 text-sm leading-6 text-caution">
            {notice}
          </p>
        ) : null}

        {awaitingPayment && deferred ? (
          <p className="mt-5 text-sm leading-6 text-ink-muted">
            {es
              ? "Su horario está apartado hasta que guarde un método de pago. Hoy no se cobra nada."
              : "Your time is held until you save a payment method. Nothing is charged today."}
          </p>
        ) : awaitingPayment ? (
          <p className="mt-5 text-sm leading-6 text-ink-muted">{copy.heldNote}</p>
        ) : paymentReview ? (
          <p className="mt-5 text-sm leading-6 text-ink-muted">{copy.reviewNote}</p>
        ) : !confirmed ? (
          <p className="mt-5 text-sm leading-6 text-ink-muted">{copy.unconfirmedNote}</p>
        ) : null}

        <dl className="mt-7 space-y-5 text-sm">
          {labels ? (
            <div className="flex gap-3">
              <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
              <div>
                <dt className="text-ink-muted">{copy.arrivalWindow}</dt>
                <dd className="mt-0.5 font-semibold">{labels.day}</dd>
                <dd className="text-ink-muted">{labels.window}</dd>
              </div>
            </div>
          ) : null}

          {address ? (
            <div className="flex gap-3">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
              <div>
                <dt className="text-ink-muted">{copy.serviceAddress}</dt>
                <dd className="mt-0.5 font-semibold">{address}</dd>
              </div>
            </div>
          ) : null}

          <div className="flex gap-3">
            <ReceiptText className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
            <div>
              <dt className="text-ink-muted">{copy.diagnosticVisit}</dt>
              <dd className="mt-0.5 font-semibold">{fee}</dd>
            </div>
          </div>

          {booking.description ? (
            <div className="flex gap-3">
              <ReceiptText className="mt-0.5 h-5 w-5 shrink-0 text-transparent" aria-hidden />
              <div>
                <dt className="text-ink-muted">{copy.toldUs}</dt>
                <dd className="mt-0.5 text-ink">{booking.description}</dd>
              </div>
            </div>
          ) : null}
        </dl>

        {answers.length > 0 ? (
          <section className="mt-7 rounded-control border border-line bg-white/[0.03] p-4">
            <h2 className="text-sm font-semibold text-ink">{copy.wentOver(locale?.channel ?? "")}</h2>
            <dl className="mt-3 space-y-3 text-sm">
              {answers.map((entry, index) => (
                <div key={index}>
                  <dt className="text-ink-muted">{entry.question}</dt>
                  <dd className="mt-0.5 text-ink">{entry.answer}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs leading-5 text-ink-faint">{copy.electricianWillCall}</p>
          </section>
        ) : null}

        {deferred ? (
          awaitingPayment ? (
            <BookingAuthorizationForm
              token={token}
              businessName={booking.business_name}
              feeCents={depositCents}
              creditTowardRepairs={diagnostic?.credit_toward_repairs !== false}
              initialLanguage={language}
            />
          ) : (
            <section className="mt-5 rounded-control border border-line bg-white/[0.03] p-4">
              <h2 className="text-sm font-semibold text-ink">{DISPLAY_LABELS[payState][language]}</h2>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">{es ? "Servicio de diagnóstico eléctrico" : "Electrical Diagnostic Service"}</dt>
                  <dd className="font-semibold">{money(depositCents)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-ink-muted">
                    {authState === "succeeded"
                      ? es ? "Pagado" : "Paid"
                      : completed
                        ? es ? "A pagar ahora" : "Due Now"
                        : es ? "A pagar al completar" : "Due Upon Completion"}
                  </dt>
                  <dd className="font-semibold">{money(diagnostic?.authorized_cents ?? depositCents)}</dd>
                </div>
              </dl>
              {diagnostic?.payment_method_last4 && authState !== "revoked" ? (
                <p className="mt-2 text-xs text-ink-muted">
                  {es ? "Método guardado" : "Saved method"}: {(diagnostic.payment_method_brand ?? "card").toUpperCase()} •••• {diagnostic.payment_method_last4}
                </p>
              ) : null}
              <p className="mt-2 text-xs leading-5 text-ink-muted">
                {authState === "succeeded"
                  ? es
                    ? "Su pago de diagnóstico autorizado se procesó. Su recibo está disponible."
                    : "Your authorized diagnostic payment has been processed. Your receipt is available."
                  : (authState === "failed" || authState === "requires_action") && completed
                    ? es
                      ? "Su servicio de diagnóstico se completó, pero no pudimos procesar el pago. Use el botón de abajo para actualizar su método de pago de forma segura."
                      : "Your diagnostic service is complete, but we were unable to process the payment. Use the button below to securely update your payment method."
                  : es
                    ? "No se ha cobrado ningún pago de diagnóstico. La tarifa se paga cuando se completa el servicio contratado."
                    : "No diagnostic payment has been collected. The fee becomes payable once the contracted service is completed."}
              </p>
              {diagnostic?.credit_toward_repairs !== false && authState !== "succeeded" ? (
                <p className="mt-2 text-xs leading-5 text-ink-faint">
                  {es
                    ? "Si aprueba reparaciones que califiquen, la tarifa de diagnóstico se acreditará al costo de la reparación aprobada de acuerdo con los términos de su acuerdo."
                    : "If you approve qualifying repairs, your diagnostic fee will be credited toward the approved repair cost in accordance with the terms of your agreement."}
                </p>
              ) : null}
              {(authState === "failed" || authState === "requires_action") && completed ? (
                <a
                  href={`/booking/${encodeURIComponent(token)}/pay`}
                  className="tap-target mt-4 flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-5 font-semibold text-on-brand"
                >
                  <CreditCard className="h-5 w-5" aria-hidden />
                  {es ? "Actualizar método de pago y pagar" : "Update payment method and pay"}
                </a>
              ) : null}
              {authState === "payment_method_saved" && !completed ? (
                <form action={revokeBookingAuthorization.bind(null, token)} className="mt-4">
                  <button type="submit" className="tap-target min-h-11 w-full rounded-control border border-line px-4 text-sm font-semibold text-ink-muted">
                    {es ? "Retirar autorización y quitar mi método de pago" : "Withdraw authorization and remove my payment method"}
                  </button>
                </form>
              ) : null}
            </section>
          )
        ) : (
        <section className="mt-5 rounded-control border border-line bg-white/[0.03] p-4">
          <h2 className="text-sm font-semibold text-ink">
            {confirmed
              ? copy.feeReceived
              : awaitingPayment
                ? copy.paymentRequired
                : paymentReview
                  ? copy.paymentReceived
                  : copy.diagnosticFee}
          </h2>
          <p className="mt-1 text-2xl font-semibold">{deposit}</p>
          <p className="mt-2 text-xs leading-5 text-ink-muted">
            {confirmed || paymentReview
              ? copy.creditedNote
              : awaitingPayment
                ? copy.payNote
                : copy.callNote}
          </p>
        </section>

        )}

        {awaitingPayment && !deferred ? (
          <a
            href={`/booking/${encodeURIComponent(token)}/pay`}
            className="tap-target mt-6 flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-5 font-semibold text-on-brand"
          >
            <CreditCard className="h-5 w-5" aria-hidden />
            {copy.payButton(deposit)}
          </a>
        ) : null}

        {booking.business_phone ? (
          <a
            href={`tel:${booking.business_phone.replace(/[^\d+]/g, "")}`}
            className={`tap-target flex min-h-12 items-center justify-center gap-2 rounded-control px-5 font-semibold ${
              awaitingPayment && !deferred
                ? "mt-3 border border-line text-white"
                : "mt-8 bg-brand text-on-brand"
            }`}
          >
            <Phone className="h-5 w-5" aria-hidden />
            {copy.call(booking.business_phone)}
          </a>
        ) : null}
        <p className="mt-3 text-center text-xs leading-5 text-ink-faint">{copy.changeNote}</p>
      </section>
    </main>
  );
}
