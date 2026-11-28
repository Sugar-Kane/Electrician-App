/**
 * What customers are told about a deferred diagnostic payment, by text, email
 * and on the booking pages. Wording only; the rules are in
 * diagnostic-payment-policy.ts. Every message is populated from the business's
 * own name, its configured fee and a secure link, and carries no Stripe id,
 * card detail or anything another customer could use.
 *
 * Import-free so the wording is reviewable and testable.
 */

import { money, type Language } from "./diagnostic-payment-policy.ts";

export type NoticeKind =
  | "booking_confirmed"
  | "setup_request"
  | "setup_saved"
  | "payment_succeeded"
  | "payment_failed"
  | "authentication_required"
  | "setup_reminder";

export type NoticeInput = {
  kind: NoticeKind;
  businessName: string;
  feeCents: number;
  /** "Thursday, Dec 3, 8–10 AM", already formatted in the business's zone. */
  appointment?: string;
  link?: string;
  language?: Language;
};

type Wording = { subject: string; body: string };

function line(value: string | undefined, prefix: string): string {
  return value ? ` ${prefix}${value}` : "";
}

const EN: Record<NoticeKind, (input: NoticeInput) => Wording> = {
  booking_confirmed: (input) => ({
    subject: `Your electrical diagnostic with ${input.businessName} is scheduled`,
    body:
      `${input.businessName}: Your electrical diagnostic appointment has been scheduled${line(input.appointment, "for ")}. ` +
      "Your payment method will be securely saved through Stripe. No diagnostic payment is due today." +
      line(input.link, "Details: "),
  }),
  setup_request: (input) => ({
    subject: `Authorize your payment method for ${input.businessName}`,
    body:
      `${input.businessName}: Please use this secure link to authorize your payment method for your scheduled electrical diagnostic service. ` +
      `Your diagnostic fee (${money(input.feeCents, true)}) will not be collected until the contracted service is completed.` +
      line(input.link, ""),
  }),
  setup_reminder: (input) => ({
    subject: `Reminder: authorize your payment method for ${input.businessName}`,
    body:
      `${input.businessName}: Your appointment is waiting on your payment method authorization. Nothing is charged today.` +
      line(input.link, ""),
  }),
  setup_saved: (input) => ({
    subject: `Payment method saved with ${input.businessName}`,
    body: `${input.businessName}: Your payment method has been securely saved. No diagnostic payment has been collected.`,
  }),
  payment_succeeded: (input) => ({
    subject: `Receipt from ${input.businessName}`,
    body:
      `${input.businessName}: Your electrical diagnostic service has been completed, and your authorized diagnostic payment of ${money(input.feeCents)} has been processed. Your receipt is available.` +
      line(input.link, ""),
  }),
  payment_failed: (input) => ({
    subject: `Action needed: payment for ${input.businessName}`,
    body:
      `${input.businessName}: We were unable to process the payment for your completed service. Please use this secure link to update your payment method.` +
      line(input.link, ""),
  }),
  authentication_required: (input) => ({
    subject: `Please confirm your payment for ${input.businessName}`,
    body:
      `${input.businessName}: Your bank asked you to confirm the payment for your completed service. Please use this secure link to finish it.` +
      line(input.link, ""),
  }),
};

const ES: Record<NoticeKind, (input: NoticeInput) => Wording> = {
  booking_confirmed: (input) => ({
    subject: `Su diagnóstico eléctrico con ${input.businessName} está programado`,
    body:
      `${input.businessName}: Su cita de diagnóstico eléctrico ha sido programada${line(input.appointment, "para ")}. ` +
      "Su método de pago se guardará de forma segura a través de Stripe. Hoy no se cobra ningún pago de diagnóstico." +
      line(input.link, "Detalles: "),
  }),
  setup_request: (input) => ({
    subject: `Autorice su método de pago para ${input.businessName}`,
    body:
      `${input.businessName}: Use este enlace seguro para autorizar su método de pago para su servicio de diagnóstico eléctrico programado. ` +
      `La tarifa de diagnóstico (${money(input.feeCents, true)}) no se cobrará hasta que se complete el servicio contratado.` +
      line(input.link, ""),
  }),
  setup_reminder: (input) => ({
    subject: `Recordatorio: autorice su método de pago para ${input.businessName}`,
    body:
      `${input.businessName}: Su cita espera la autorización de su método de pago. Hoy no se cobra nada.` +
      line(input.link, ""),
  }),
  setup_saved: (input) => ({
    subject: `Método de pago guardado con ${input.businessName}`,
    body: `${input.businessName}: Su método de pago se guardó de forma segura. No se ha cobrado ningún pago de diagnóstico.`,
  }),
  payment_succeeded: (input) => ({
    subject: `Recibo de ${input.businessName}`,
    body:
      `${input.businessName}: Su servicio de diagnóstico eléctrico se completó y se procesó su pago de diagnóstico autorizado de ${money(input.feeCents)}. Su recibo está disponible.` +
      line(input.link, ""),
  }),
  payment_failed: (input) => ({
    subject: `Acción necesaria: pago para ${input.businessName}`,
    body:
      `${input.businessName}: No pudimos procesar el pago de su servicio completado. Use este enlace seguro para actualizar su método de pago.` +
      line(input.link, ""),
  }),
  authentication_required: (input) => ({
    subject: `Confirme su pago para ${input.businessName}`,
    body:
      `${input.businessName}: Su banco pidió que confirme el pago de su servicio completado. Use este enlace seguro para terminarlo.` +
      line(input.link, ""),
  }),
};

export function diagnosticNotice(input: NoticeInput): Wording {
  const table = input.language === "es" ? ES : EN;
  return table[input.kind](input);
}

/** The link a customer opens to authorize, revoke, update or pay. Empty without an https origin. */
export function bookingLinkFor(origin: string, token: string): string {
  const base = origin.trim().replace(/\/+$/, "");
  if (!base || !token || !/^https?:\/\//i.test(base)) return "";
  return `${base}/booking/${encodeURIComponent(token)}`;
}
