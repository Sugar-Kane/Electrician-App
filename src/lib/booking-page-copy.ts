/**
 * The customer's booking page, in the language they booked in.
 *
 * A customer who booked by text in Spanish used to land on an English page that
 * summed up their own Spanish answers under English headings. The page is the
 * customer's record of what they agreed to, so it reads in their language.
 * Only English and Spanish, the two the intake speaks; anything else is English.
 *
 * Import-free, so the wording can be read without rendering the page.
 */

export type BookingPageLanguage = "en" | "es";

export function bookingPageLanguage(value: unknown): BookingPageLanguage {
  return value === "es" ? "es" : "en";
}

const EN = {
  locale: "en-US",
  title: "Your appointment",
  notFoundTitle: "We could not find that appointment",
  notFoundBody:
    "The link may be old, or it may have been copied incompletely. Call the business and they will find your booking.",
  booked: (name: string) => (name ? `You're booked, ${name}` : "You're booked"),
  held: (name: string) => (name ? `Your time is being held, ${name}` : "Your time is being held"),
  paymentReceived: "Payment received",
  callToConfirm: "Please call to confirm this appointment",
  withBusiness: (business: string) => `with ${business}`,
  heldNote: "This appointment is not confirmed until the diagnostic fee is paid.",
  reviewNote:
    "Do not pay again. The business has your payment and will contact you while the appointment is finalized.",
  unconfirmedNote:
    "This time is not currently confirmed. Call the business before planning around it.",
  arrivalWindow: "Arrival window",
  serviceAddress: "Service address",
  diagnosticVisit: "Diagnostic visit",
  toldUs: "What you told us",
  wentOver: (channel: string): string =>
    channel === "phone"
      ? "What we went over on the call"
      : channel === "sms"
        ? "What we went over by text"
        : "What we went over",
  electricianWillCall: "An electrician will call to go over a few more details before the visit.",
  feeReceived: "Diagnostic fee received",
  paymentRequired: "Payment required to confirm",
  diagnosticFee: "Diagnostic fee",
  creditedNote: "If more work is needed, this amount is credited toward the approved work order.",
  payNote:
    "Pay securely to confirm. If more work is needed, this amount is credited toward the approved work order.",
  callNote: "Call the business to confirm whether payment is needed.",
  payButton: (amount: string) => `Pay ${amount} securely`,
  call: (phone: string) => `Call ${phone}`,
  changeNote: "Need to change or cancel? Call and we will sort it out.",
  payNotice: {
    canceled: "Checkout was canceled. Your appointment is not confirmed yet.",
    unavailable: "Secure checkout could not be started. Please try again or call the business.",
    expired: "That payment link is no longer active. Call the business to choose another time.",
  },
};

export type BookingPageCopy = typeof EN;

const ES: BookingPageCopy = {
  locale: "es-US",
  title: "Su cita",
  notFoundTitle: "No encontramos esa cita",
  notFoundBody:
    "Puede que el enlace sea viejo o que no se haya copiado completo. Llame al negocio y ellos encontrarán su cita.",
  booked: (name) => (name ? `Su cita está reservada, ${name}` : "Su cita está reservada"),
  held: (name) => (name ? `Le estamos apartando su horario, ${name}` : "Le estamos apartando su horario"),
  paymentReceived: "Pago recibido",
  callToConfirm: "Llame para confirmar esta cita",
  withBusiness: (business) => `con ${business}`,
  heldNote: "Esta cita no queda confirmada hasta que se pague la tarifa de diagnóstico.",
  reviewNote:
    "No vuelva a pagar. El negocio recibió su pago y se comunicará con usted mientras termina de confirmar la cita.",
  unconfirmedNote: "Este horario no está confirmado. Llame al negocio antes de hacer planes.",
  arrivalWindow: "Horario de llegada",
  serviceAddress: "Dirección del servicio",
  diagnosticVisit: "Visita de diagnóstico",
  toldUs: "Lo que nos dijo",
  wentOver: (channel) =>
    channel === "phone"
      ? "Lo que hablamos por teléfono"
      : channel === "sms"
        ? "Lo que hablamos por mensaje"
        : "Lo que hablamos",
  electricianWillCall:
    "Un electricista le llamará para revisar algunos detalles más antes de la visita.",
  feeReceived: "Tarifa de diagnóstico recibida",
  paymentRequired: "Pago requerido para confirmar",
  diagnosticFee: "Tarifa de diagnóstico",
  creditedNote:
    "Si se necesita más trabajo, esta cantidad se acredita a la orden de trabajo aprobada.",
  payNote:
    "Pague de forma segura para confirmar. Si se necesita más trabajo, esta cantidad se acredita a la orden de trabajo aprobada.",
  callNote: "Llame al negocio para confirmar si necesita pagar.",
  payButton: (amount) => `Pagar ${amount}`,
  call: (phone) => `Llamar al ${phone}`,
  changeNote: "¿Necesita cambiar o cancelar? Llame y lo resolvemos.",
  payNotice: {
    canceled: "Se canceló el pago. Su cita todavía no está confirmada.",
    unavailable: "No se pudo abrir el pago seguro. Inténtelo de nuevo o llame al negocio.",
    expired: "Ese enlace de pago ya no está activo. Llame al negocio para elegir otro horario.",
  },
};

export function bookingPageCopy(language: BookingPageLanguage): BookingPageCopy {
  return language === "es" ? ES : EN;
}
