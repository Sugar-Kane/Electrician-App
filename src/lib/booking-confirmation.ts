/**
 * What a customer and an owner are told once a booking is real.
 *
 * Composing these is separated from sending them because the wording is the
 * part that matters and the part that is easy to get wrong: a confirmation that
 * omits the arrival window is useless, and one that promises something the
 * business did not agree to is worse than none. Sending is a network call;
 * this is the promise.
 *
 * Import-free apart from the wording of the intake questions, so every message
 * can be read in a test rather than in an inbox.
 */

import { intakeQuestionIn } from "./intake-phrases.ts";

export type BookingFacts = {
  paid?: boolean;
  businessName: string;
  businessPhone: string;
  contactName: string;
  /** "Mon, Aug 10, 8:00 AM-10:00 AM", already in the business's timezone. */
  slotLabel: string;
  addressLine1: string;
  city: string;
  diagnosticFee: string;
  description: string;
  /** The public confirmation page for this booking, when there is one. */
  link?: string;
  /** What was asked on the call, and what the customer said. */
  intakeAnswers?: { question: string; answer: string }[];
  /** The caller's number, so the owner can ring them back from the email. */
  customerPhone?: string;
  /**
   * The language the customer booked in: their own copy (text and email) is
   * written in it. The owner's messages are always English.
   */
  language?: string;
};

/** The customer's copy, in English or Spanish. English is the fallback. */
const CUSTOMER_COPY = {
  en: {
    smsHeld: (biz: string, slot: string) => `${biz}: your time is held for ${slot}`,
    at: (address: string) => ` at ${address}`,
    smsPay: (fee: string) => `. Pay the ${fee} diagnostic fee to confirm`,
    smsCredited: (phone: string) => ` It is credited toward approved repair work. Questions? Call ${phone}.`,
    smsReview: (biz: string, slot: string, phone: string) =>
      `${biz}: we saved your request for ${slot}, but no appointment is confirmed. An electrician will contact you to finish scheduling, usually within 24 hours. Questions? Call ${phone}.`,
    smsBooked: (biz: string, slot: string) => `${biz}: you're booked for ${slot}`,
    smsFee: (fee: string, paid: boolean) =>
      paid ? `. We received your ${fee} diagnostic fee.` : `. The diagnostic visit is ${fee}.`,
    smsDetails: (link: string) => ` Details: ${link}`,
    smsQuestions: (phone: string) => ` Questions? Call ${phone}.`,
    hi: (name: string) => (name ? `Hi ${name},` : "Hi,"),
    held: (biz: string) =>
      `Your requested time with ${biz} is being held. It is not confirmed until the diagnostic fee is paid.`,
    heldHtml: (biz: string) =>
      `Your requested time with ${biz} is being held. <strong>It is not confirmed until the diagnostic fee is paid.</strong>`,
    review: (biz: string) =>
      `We saved your request with ${biz}, but no appointment is confirmed. An electrician will contact you to finish scheduling, usually within 24 hours.`,
    reviewHtml: (biz: string) =>
      `We saved your request with ${biz}, but <strong>no appointment is confirmed.</strong> An electrician will contact you to finish scheduling, usually within 24 hours.`,
    booked: (biz: string) => `Your appointment with ${biz} is booked.`,
    when: "When",
    where: "Where",
    visit: "Diagnostic visit",
    told: "What you told us",
    wentOver: "What we went over",
    received: (fee: string) =>
      `Diagnostic fee received: ${fee}. If more work is needed, this amount is credited toward the approved work order.`,
    pay: "Pay and confirm this appointment",
    view: "View this appointment",
    change: (phone: string) => `Need to change it, or think something is wrong? Call ${phone}.`,
    subjectHeld: (slot: string) => `Payment needed to confirm: ${slot}`,
    subjectReview: (slot: string) => `We need to finish scheduling: ${slot}`,
    subjectBooked: (biz: string, slot: string) => `Your ${biz} appointment: ${slot}`,
  },
  es: {
    smsHeld: (biz: string, slot: string) => `${biz}: le estamos apartando ${slot}`,
    at: (address: string) => ` en ${address}`,
    smsPay: (fee: string) => `. Pague la tarifa de diagnóstico de ${fee} para confirmar`,
    smsCredited: (phone: string) =>
      ` Se acredita a la reparación aprobada. ¿Preguntas? Llame al ${phone}.`,
    smsReview: (biz: string, slot: string, phone: string) =>
      `${biz}: guardamos su solicitud para ${slot}, pero no hay una cita confirmada. Un electricista se comunicará con usted para terminar de agendar, normalmente en menos de 24 horas. ¿Preguntas? Llame al ${phone}.`,
    smsBooked: (biz: string, slot: string) => `${biz}: su cita está reservada para ${slot}`,
    smsFee: (fee: string, paid: boolean) =>
      paid ? `. Recibimos su tarifa de diagnóstico de ${fee}.` : `. La visita de diagnóstico cuesta ${fee}.`,
    smsDetails: (link: string) => ` Detalles: ${link}`,
    smsQuestions: (phone: string) => ` ¿Preguntas? Llame al ${phone}.`,
    hi: (name: string) => (name ? `Hola ${name}:` : "Hola:"),
    held: (biz: string) =>
      `Su horario con ${biz} está apartado. No queda confirmado hasta que se pague la tarifa de diagnóstico.`,
    heldHtml: (biz: string) =>
      `Su horario con ${biz} está apartado. <strong>No queda confirmado hasta que se pague la tarifa de diagnóstico.</strong>`,
    review: (biz: string) =>
      `Guardamos su solicitud con ${biz}, pero no hay una cita confirmada. Un electricista se comunicará con usted para terminar de agendar, normalmente en menos de 24 horas.`,
    reviewHtml: (biz: string) =>
      `Guardamos su solicitud con ${biz}, pero <strong>no hay una cita confirmada.</strong> Un electricista se comunicará con usted para terminar de agendar, normalmente en menos de 24 horas.`,
    booked: (biz: string) => `Su cita con ${biz} está reservada.`,
    when: "Cuándo",
    where: "Dónde",
    visit: "Visita de diagnóstico",
    told: "Lo que nos dijo",
    wentOver: "Lo que hablamos",
    received: (fee: string) =>
      `Tarifa de diagnóstico recibida: ${fee}. Si se necesita más trabajo, esta cantidad se acredita a la orden de trabajo aprobada.`,
    pay: "Pagar y confirmar esta cita",
    view: "Ver esta cita",
    change: (phone: string) => `¿Necesita cambiarla, o cree que algo está mal? Llame al ${phone}.`,
    subjectHeld: (slot: string) => `Pago pendiente para confirmar: ${slot}`,
    subjectReview: (slot: string) => `Necesitamos terminar de agendar: ${slot}`,
    subjectBooked: (biz: string, slot: string) => `Su cita con ${biz}: ${slot}`,
  },
};

function customerCopy(language: string | undefined) {
  return language === "es" ? CUSTOMER_COPY.es : CUSTOMER_COPY.en;
}

export type BookingMessageState = "confirmed" | "held" | "needs_review";

/** Two SMS segments. Past this a message arrives split and looks broken. */
const SMS_LIMIT = 320;

function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string, limit: number): string {
  const text = squash(value);
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

/**
 * The customer's confirmation.
 *
 * Leads with the window, because that is the one fact they will want to check
 * later. The link goes last so that a message truncated by a carrier still
 * carries the appointment itself.
 */
export function customerConfirmationSms(
  facts: BookingFacts,
  state: BookingMessageState = "confirmed",
): string {
  const address = [facts.addressLine1, facts.city].filter(Boolean).join(", ");
  const copy = customerCopy(facts.language);
  const parts =
    state === "held"
      ? [
          copy.smsHeld(facts.businessName, facts.slotLabel),
          address ? copy.at(address) : "",
          copy.smsPay(facts.diagnosticFee),
          facts.link ? `: ${facts.link}` : ".",
          copy.smsCredited(facts.businessPhone),
        ]
      : state === "needs_review"
        ? [copy.smsReview(facts.businessName, facts.slotLabel, facts.businessPhone)]
        : [
            copy.smsBooked(facts.businessName, facts.slotLabel),
            address ? copy.at(address) : "",
            copy.smsFee(facts.diagnosticFee, facts.paid === true),
            facts.link ? copy.smsDetails(facts.link) : "",
            copy.smsQuestions(facts.businessPhone),
          ];
  // A Spanish time ends in "a.m." or "p.m.", so the sentence's own full stop
  // would double it.
  return clip(parts.join("").replace(/(a\.m|p\.m)\.\./g, "$1."), SMS_LIMIT);
}

/**
 * What the owner gets when a booking lands without them.
 *
 * Written to be readable on a lock screen at 6am: who, when, where, and what is
 * wrong, in that order. No link — this one is for someone who already has the
 * app.
 */
export function ownerBookingSms(
  facts: BookingFacts,
  state: BookingMessageState = "confirmed",
): string {
  const address = [facts.addressLine1, facts.city].filter(Boolean).join(", ");
  return clip(
    [
      // A held time is not a booking yet, and telling the owner it is means he
      // plans a day around an appointment that may never be paid for.
      state === "held"
        ? `Held (unpaid): ${facts.slotLabel}.`
        : state === "needs_review"
          ? `Action needed — booking needs review: ${facts.slotLabel}. Nothing is confirmed.`
          : `${facts.paid ? "Confirmed (paid)" : "New booking"}: ${facts.slotLabel}.`,
      facts.contactName ? ` ${facts.contactName}.` : "",
      address ? ` ${address}.` : "",
      facts.description ? ` "${clip(facts.description, 75)}"` : "",
    ].join(""),
    SMS_LIMIT,
  );
}

/**
 * The intake, as a second message to the owner.
 *
 * Deliberately separate rather than crammed into the first: the booking text
 * has to survive a lock screen, and the answers are what gets read sitting down
 * with a coffee. Sent only when there is something to send, and split so a long
 * interview does not arrive as one truncated wall.
 */
export function ownerIntakeSms(facts: BookingFacts): string {
  const answers = facts.intakeAnswers ?? [];
  if (answers.length === 0) return "";

  const lines = answers.map((entry, index) => `${index + 1}. ${squash(entry.question)} — ${squash(entry.answer)}`);
  return clip(
    [`What ${facts.contactName || "the caller"} said:`, ...lines].join(" "),
    SMS_LIMIT * 2,
  );
}

export type EmailBody = { subject: string; text: string; html: string };

/**
 * The owner's copy, which is a work order rather than a reassurance.
 *
 * The customer's email tells them not to worry. This one has to be enough to
 * load a van from: what is wrong, where, when, and everything the caller said
 * when asked. It leads with the window because that is what decides the day.
 */
export function ownerBookingEmail(
  facts: BookingFacts,
  jobUrl?: string,
  state: BookingMessageState = "confirmed",
): EmailBody {
  const address = [facts.addressLine1, facts.city].filter(Boolean).join(", ");
  const answers = facts.intakeAnswers ?? [];

  const lines = [
    `${facts.slotLabel}`,
    address ? `${address}` : "",
    facts.contactName ? `${squash(facts.contactName)}${facts.customerPhone ? ` — ${facts.customerPhone}` : ""}` : "",
    "",
    state === "held"
      ? "Status: Held and unpaid. This is not a confirmed booking yet."
      : state === "needs_review"
        ? "Status: Action needed. Automatic booking could not be completed, and no appointment is confirmed."
        : "Status: Confirmed.",
    facts.description ? `Problem: ${squash(facts.description)}` : "",
    "",
    ...(answers.length > 0 ? ["What they said on the call:"] : []),
    ...answers.flatMap((entry) => [`  ${squash(entry.question)}`, `    ${squash(entry.answer)}`]),
    "",
    `Deposit: ${facts.diagnosticFee}`,
    jobUrl ? `Open the job: ${jobUrl}` : "",
  ].filter((line) => line !== "");

  const html = [
    `<p style="font-size:18px;margin:0 0 4px"><strong>${escapeHtml(facts.slotLabel)}</strong></p>`,
    address ? `<p style="margin:0 0 4px">${escapeHtml(address)}</p>` : "",
    facts.contactName
      ? `<p style="margin:0 0 16px">${escapeHtml(squash(facts.contactName))}${facts.customerPhone ? ` — <a href="tel:${escapeHtml(facts.customerPhone.replace(/[^\d+]/g, ""))}">${escapeHtml(facts.customerPhone)}</a>` : ""}</p>`
      : "",
    state === "held"
      ? "<p><strong>Status: Held and unpaid.</strong> This is not a confirmed booking yet.</p>"
      : state === "needs_review"
        ? "<p><strong>Status: Action needed.</strong> Automatic booking could not be completed, and no appointment is confirmed.</p>"
        : "<p><strong>Status: Confirmed.</strong></p>",
    facts.description
      ? `<p><strong>Problem:</strong> ${escapeHtml(squash(facts.description))}</p>`
      : "",
    ...(answers.length > 0
      ? [
          "<p><strong>What they said on the call:</strong></p><ul>",
          ...answers.map(
            (entry) =>
              `<li>${escapeHtml(squash(entry.question))}<br /><strong>${escapeHtml(squash(entry.answer))}</strong></li>`,
          ),
          "</ul>",
        ]
      : []),
    `<p><strong>Deposit:</strong> ${escapeHtml(facts.diagnosticFee)}</p>`,
    jobUrl ? `<p><a href="${escapeHtml(jobUrl)}">Open the job</a></p>` : "",
  ]
    .filter(Boolean)
    .join("");

  const who = facts.contactName ? ` — ${squash(facts.contactName)}` : "";
  return {
    subject: `${
      state === "held"
        ? "Held (unpaid)"
        : state === "needs_review"
          ? "Action needed"
          : "New booking"
    }: ${facts.slotLabel}${who}`,
    text: lines.join("\n"),
    html,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * What is known when nothing could be booked.
 *
 * A separate type rather than a loosened `BookingFacts`, because every field
 * that makes a booking message a booking message — the window, the address, the
 * fee — is absent here, and making them optional would let a caller build a
 * confirmation that quietly promises nothing.
 */
export type CallbackFacts = {
  businessName: string;
  businessPhone: string;
  contactName: string;
  /** The number to ring them back on, already normalised. */
  customerPhone: string;
  /** What they need, in their own words. */
  description: string;
  urgency: "routine" | "urgent";
  /** Which the customer chose when asked: somebody now, or a call later. */
  when: "now" | "later";
  intakeAnswers?: { question: string; answer: string }[];
  /** The booking-requests list, for the owner's email. */
  link?: string;
};

/**
 * The owner's alert when a call produced no booking.
 *
 * Until this existed a callback reached nobody at all: both intake paths only
 * sent on a booking, so the one outcome that exists *because* a person has to
 * ring somebody back was the one outcome no person heard about. The owner found
 * it by opening the app.
 *
 * "Now" leads with the fact that they are waiting, because that is the whole
 * difference between a text read at leisure and one acted on. Both versions say
 * plainly that nothing is scheduled — a message that merely names a customer
 * and a problem reads like a booking at a glance.
 */
export function ownerCallbackSms(facts: CallbackFacts): string {
  const who = squash(facts.contactName) || "A caller";
  const lead =
    facts.when === "now"
      ? `${who} is asking for a call back now — ${facts.customerPhone}.`
      : `Callback requested: ${who}, ${facts.customerPhone}.`;

  return clip(
    [
      lead,
      facts.urgency === "urgent" ? "They called it urgent." : "",
      facts.description ? squash(facts.description) : "",
      // Last, and never omitted. Everything above this reads like a booking.
      "Nothing is scheduled.",
    ]
      .filter(Boolean)
      .join(" "),
    SMS_LIMIT,
  );
}

/**
 * The same, with the interview, for the owner's inbox.
 *
 * Carries the answers because they are what decide whether this is a five
 * minute phone call or a visit, and the owner is about to make that call.
 */
export function ownerCallbackEmail(facts: CallbackFacts): EmailBody {
  const who = squash(facts.contactName) || "A caller";
  const answers = facts.intakeAnswers ?? [];
  const heading =
    facts.when === "now"
      ? `${who} asked for a call back now`
      : `${who} asked for a callback`;

  const lines = [
    heading,
    facts.customerPhone,
    facts.urgency === "urgent" ? "They called it urgent." : "",
    "",
    facts.description ? `What they need: ${squash(facts.description)}` : "",
    "",
    ...(answers.length > 0 ? ["What they said on the call:"] : []),
    ...answers.flatMap((entry) => [`  ${squash(entry.question)}`, `    ${squash(entry.answer)}`]),
    "",
    "Nothing is scheduled. No visit was booked on this call.",
    facts.link ? `Open the request: ${facts.link}` : "",
  ].filter((line) => line !== "");

  const tel = facts.customerPhone.replace(/[^\d+]/g, "");
  const html = [
    `<p style="font-size:18px;margin:0 0 4px"><strong>${escapeHtml(heading)}</strong></p>`,
    `<p style="margin:0 0 16px"><a href="tel:${escapeHtml(tel)}">${escapeHtml(facts.customerPhone)}</a>${
      facts.urgency === "urgent" ? " — <strong>they called it urgent</strong>" : ""
    }</p>`,
    facts.description
      ? `<p><strong>What they need:</strong> ${escapeHtml(squash(facts.description))}</p>`
      : "",
    ...(answers.length > 0
      ? [
          "<p><strong>What they said on the call:</strong></p><ul>",
          ...answers.map(
            (entry) =>
              `<li>${escapeHtml(squash(entry.question))}<br /><strong>${escapeHtml(squash(entry.answer))}</strong></li>`,
          ),
          "</ul>",
        ]
      : []),
    "<p><strong>Nothing is scheduled.</strong> No visit was booked on this call.</p>",
    facts.link ? `<p><a href="${escapeHtml(facts.link)}">Open the request</a></p>` : "",
  ]
    .filter(Boolean)
    .join("");

  return {
    subject:
      facts.when === "now"
        ? `Call back now: ${who}`
        : `Callback requested: ${who}`,
    text: lines.join("\n"),
    html,
  };
}

export type WebsiteRequestFacts = {
  contactName: string;
  customerPhone: string;
  serviceName: string;
  description: string;
  town: string;
  preferredTimes: string;
  /** What happens next on the customer's side, which decides what the owner does. */
  texting: "calling" | "texting" | "no_consent" | "opted_out" | "not_set_up";
  /** The booking-requests list, for the owner's email. */
  link?: string;
};

/** The one sentence that tells the owner whether this is theirs to chase. */
function websiteNextStep(texting: WebsiteRequestFacts["texting"]): string {
  switch (texting) {
    case "calling":
      return "They asked for a call, so Maya is calling them now to get the details and book a visit.";
    case "texting":
      return "The assistant is texting them now to get the details and book a visit.";
    case "opted_out":
      return "They opted out of texts earlier, so nobody is texting them. Call them.";
    case "not_set_up":
      return "Texting isn't set up, so nobody is texting them. Call them.";
    default:
      return "They didn't agree to texts, so nobody is texting them. Call them.";
  }
}

/**
 * The owner's alert for a request from their own website.
 *
 * Says plainly whether the assistant has it or the owner does: a request that
 * everybody assumes somebody else is handling is the one that goes cold.
 */
export function ownerWebsiteRequestSms(facts: WebsiteRequestFacts): string {
  const who = squash(facts.contactName) || "Someone";
  const what = [squash(facts.serviceName), squash(facts.town)].filter(Boolean).join(", ");
  return clip(
    [
      `Website request: ${who}, ${facts.customerPhone}${what ? ` — ${what}` : ""}.`,
      facts.description ? squash(facts.description) : "",
      websiteNextStep(facts.texting),
    ]
      .filter(Boolean)
      .join(" "),
    SMS_LIMIT,
  );
}

export type CallbackOutcomeFacts = {
  contactName: string;
  customerPhone: string;
  outcome: "voicemail" | "no_answer" | "busy" | "failed" | "not_booked";
  link?: string;
};

function callbackOutcomeSentence(outcome: CallbackOutcomeFacts["outcome"]): string {
  switch (outcome) {
    case "voicemail":
      return "They didn't pick up, so she left a voicemail with your number.";
    case "not_booked":
      return "She reached them, but nothing was booked.";
    case "busy":
      return "The line was busy.";
    case "failed":
      return "The call didn't go through.";
    default:
      return "They didn't pick up.";
  }
}

/** After Maya's call back, when it is the owner's turn: nobody reached, or nothing booked. */
export function ownerCallbackOutcomeSms(facts: CallbackOutcomeFacts): string {
  const who = squash(facts.contactName) || "the customer";
  return clip(
    `Maya called ${who} (${facts.customerPhone}) about their website request. ${callbackOutcomeSentence(facts.outcome)} Please call them back.`,
    SMS_LIMIT,
  );
}

export function ownerCallbackOutcomeEmail(facts: CallbackOutcomeFacts): EmailBody {
  const who = squash(facts.contactName) || "the customer";
  const heading = `Call ${who} back about their website request`;
  const sentence = `Maya called them. ${callbackOutcomeSentence(facts.outcome)}`;
  const tel = facts.customerPhone.replace(/[^\d+]/g, "");
  return {
    subject: heading,
    text: [heading, facts.customerPhone, "", sentence, facts.link ? `Open the request: ${facts.link}` : ""].filter(Boolean).join("\n"),
    html: [
      `<p style="font-size:18px;margin:0 0 4px"><strong>${escapeHtml(heading)}</strong></p>`,
      `<p style="margin:0 0 16px"><a href="tel:${escapeHtml(tel)}">${escapeHtml(facts.customerPhone)}</a></p>`,
      `<p>${escapeHtml(sentence)}</p>`,
      facts.link ? `<p><a href="${escapeHtml(facts.link)}">Open the request</a></p>` : "",
    ].join(""),
  };
}

export function ownerWebsiteRequestEmail(facts: WebsiteRequestFacts): EmailBody {
  const who = squash(facts.contactName) || "Someone";
  const heading = `${who} sent a request on your website`;
  const next = websiteNextStep(facts.texting);
  const details: [string, string][] = (
    [
      ["Service", squash(facts.serviceName)],
      ["Town", squash(facts.town)],
      ["What's happening", squash(facts.description)],
      ["Good times", squash(facts.preferredTimes)],
    ] as [string, string][]
  ).filter(([, value]) => value);

  const lines = [
    heading,
    facts.customerPhone,
    "",
    ...details.map(([label, value]) => `${label}: ${value}`),
    "",
    next,
    facts.link ? `Open the request: ${facts.link}` : "",
  ].filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""));

  const tel = facts.customerPhone.replace(/[^\d+]/g, "");
  const html = [
    `<p style="font-size:18px;margin:0 0 4px"><strong>${escapeHtml(heading)}</strong></p>`,
    `<p style="margin:0 0 16px"><a href="tel:${escapeHtml(tel)}">${escapeHtml(facts.customerPhone)}</a></p>`,
    ...details.map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`),
    `<p><strong>${escapeHtml(next)}</strong></p>`,
    facts.link ? `<p><a href="${escapeHtml(facts.link)}">Open the request</a></p>` : "",
  ]
    .filter(Boolean)
    .join("");

  return { subject: `Website request: ${who}`, text: lines.join("\n").trim(), html };
}

/**
 * The customer's copy, which has to match what they were just promised.
 *
 * They chose between somebody now and a call later, and were told which they
 * were getting. A text saying the other thing is how a person ends up waiting
 * by a phone all evening for a call that was filed as routine.
 */
export function customerCallbackSms(facts: CallbackFacts): string {
  return clip(
    `${facts.businessName}: your callback request was sent to an electrician right away. Our response time is usually within 24 hours. Need us sooner? Call ${facts.businessPhone}.`,
    SMS_LIMIT,
  );
}

/**
 * The same confirmation, for a caller who gave an email address.
 *
 * Plain text and HTML say exactly the same things: a mail client that shows
 * one must not show a customer a different appointment from the other.
 */
export function confirmationEmail(
  facts: BookingFacts,
  state: BookingMessageState = "confirmed",
): EmailBody {
  const copy = customerCopy(facts.language);
  const address = [facts.addressLine1, facts.city].filter(Boolean).join(", ");
  const greeting = copy.hi(facts.contactName ? squash(facts.contactName) : "");
  const paid = state === "confirmed" && facts.paid === true;
  const answers = (facts.intakeAnswers ?? []).map((entry) => ({
    question: squash(intakeQuestionIn(entry.question, facts.language ?? "en")),
    answer: squash(entry.answer),
  }));

  const lines = [
    greeting,
    "",
    state === "held"
      ? copy.held(facts.businessName)
      : state === "needs_review"
        ? copy.review(facts.businessName)
        : copy.booked(facts.businessName),
    "",
    `${copy.when}: ${facts.slotLabel}`,
    address ? `${copy.where}: ${address}` : "",
    `${copy.visit}: ${facts.diagnosticFee}`,
    facts.description ? `${copy.told}: ${squash(facts.description)}` : "",
    ...(answers.length ? ["", `${copy.wentOver}:`] : []),
    ...answers.flatMap((entry) => [entry.question, `  ${entry.answer}`]),
    ...(paid ? ["", copy.received(facts.diagnosticFee)] : []),
    "",
    facts.link ? `${state === "held" ? copy.pay : copy.view}: ${facts.link}` : "",
    copy.change(facts.businessPhone),
    "",
    facts.businessName,
  ].filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""));

  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    state === "held"
      ? `<p>${copy.heldHtml(escapeHtml(facts.businessName))}</p>`
      : state === "needs_review"
        ? `<p>${copy.reviewHtml(escapeHtml(facts.businessName))}</p>`
        : `<p>${escapeHtml(copy.booked(facts.businessName))}</p>`,
    "<ul>",
    `<li><strong>${copy.when}:</strong> ${escapeHtml(facts.slotLabel)}</li>`,
    address ? `<li><strong>${copy.where}:</strong> ${escapeHtml(address)}</li>` : "",
    `<li><strong>${copy.visit}:</strong> ${escapeHtml(facts.diagnosticFee)}</li>`,
    facts.description
      ? `<li><strong>${copy.told}:</strong> ${escapeHtml(squash(facts.description))}</li>`
      : "",
    "</ul>",
    answers.length
      ? [
          `<p><strong>${copy.wentOver}</strong></p>`,
          "<ul>",
          ...answers.map(
            (entry) =>
              `<li><strong>${escapeHtml(entry.question)}</strong><br />${escapeHtml(entry.answer)}</li>`,
          ),
          "</ul>",
        ].join("")
      : "",
    paid ? `<p>${escapeHtml(copy.received(facts.diagnosticFee))}</p>` : "",
    facts.link
      ? `<p><a href="${escapeHtml(facts.link)}">${state === "held" ? copy.pay : copy.view}</a></p>`
      : "",
    `<p>${escapeHtml(copy.change(facts.businessPhone))}</p>`,
    `<p>${escapeHtml(facts.businessName)}</p>`,
  ]
    .filter(Boolean)
    .join("");

  return {
    subject:
      state === "held"
        ? copy.subjectHeld(facts.slotLabel)
        : state === "needs_review"
          ? copy.subjectReview(facts.slotLabel)
          : copy.subjectBooked(facts.businessName, facts.slotLabel),
    text: lines.join("\n").trim(),
    html,
  };
}

/**
 * The From line, so the customer sees who is actually writing to them.
 *
 * A confirmation from "bookings@volteira.com" is from software the customer has
 * never heard of; the same address labelled with the business name is from the
 * electrician they just called. The address is the platform's because the
 * platform holds the verified domain — the name is the tenant's because that is
 * whose appointment it is.
 *
 * A configured value that already carries a display name is left alone, so a
 * deployment can override this entirely.
 */
export function emailSender(businessName: string, configured: string): string {
  const address = configured.trim();
  if (!address) return "";
  if (address.includes("<")) return address;

  // A quote, a comma, or an angle bracket would break the header apart. `@` is
  // stripped too: a display name that reads like an address is the shape of a
  // phishing header, and no business name needs one.
  const name = businessName.replace(/["\\<>,;:@]/g, " ").replace(/\s+/g, " ").trim().slice(0, 78);
  return name ? `${name} <${address}>` : address;
}

/**
 * Whether an address is worth attempting delivery to.
 *
 * Speech recognition turns "adam at gmail dot com" into things that are not
 * addresses. This refuses the obvious failures rather than queueing mail that
 * can only bounce — the booking is already made either way.
 */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 6 || trimmed.length > 254) return false;
  if (/\s/.test(trimmed)) return false;
  return /^[^@]+@[^@.]+\.[^@]{2,}$/.test(trimmed);
}
