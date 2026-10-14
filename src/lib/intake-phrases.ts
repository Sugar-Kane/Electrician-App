/**
 * Everything the intake says to a customer, in each language it speaks.
 *
 * These are not the model's words. Look at `decideIntakeAction`: the model's
 * text is used for exactly one outcome — the question it composes for `ask_for`
 * — and every other reply a customer reads is written here and assembled
 * deterministically. Offering a window, confirming a booking, promising a call
 * back: all of them. So translating the intake is mostly translating this file,
 * not prompting harder.
 *
 * They are written here rather than generated per message for the same reason
 * `holdSentence` is: an offer names a time and a price, and a sentence composed
 * fresh each time is a sentence that misquotes one of them eventually.
 *
 * ## STOP stays STOP
 *
 * `optOut` keeps the literal word in both languages. STOP is a carrier keyword —
 * Twilio's error 21610 is the carrier's own opt-out list, not ours — so
 * "responda PARE" would hand a Spanish speaker a word that reads like an opt-out
 * and does not actually opt them out. That is a compliance failure dressed up as
 * a translation.
 *
 * ## Worth knowing before anybody shortens the reply cap
 *
 * `á í ó ú` are not in the GSM-7 alphabet, so a Spanish reply carrying any of
 * them is sent as UCS-2, where a segment is 70 characters rather than 160.
 * (`é è ù ì ò à ñ ¿ ¡ ü` are all in GSM-7; it is the other four accents that
 * force it.) The composed replies below all land near 150 characters, so this
 * costs a segment or two and nothing is truncated — but a future cap picked from
 * the English arithmetic would cut Spanish messages in half.
 *
 * Import-free apart from the language type, so the wording can be tested without
 * a database or a model.
 */

import type { LanguageCode } from "./customer-language.ts";

export type IntakePhrases = {
  /** The first thing said when the model gave us nothing to work with. */
  opening: (business: string) => string;
  /** Anything the business says, prefixed with its own name. */
  fromBusiness: (business: string, said: string) => string;
  askProblemAndAddress: (business: string) => string;
  askAddress: (business: string) => string;
  callback: (business: string, firstName: string, urgent: boolean) => string;
  offer: (business: string, slotLabel: string, fee: string) => string;
  haveWindow: (business: string, slotLabel: string) => string;
  noOpening: (business: string) => string;
  booked: (business: string, slotLabel: string, phone: string) => string;
  messageTaken: (business: string) => string;
  /** Appended to the first reply in a thread. Keeps the literal word STOP. */
  optOut: string;
  /** The five intake questions, keyed as `INTAKE_QUESTIONS` keys them. */
  questions: Record<string, string>;
  deliveryQuestion: string;
  /**
   * The last question before a text booking: where to email their copy of the
   * booking and receipt. Optional, and the customer is told so.
   */
  emailQuestion: string;
  /**
   * A visit already held, or already booked, in this conversation.
   *
   * Said instead of anything that would hold a second time or send a second
   * payment link. A customer who texts again after the link went out ("ok",
   * "actually", a photo) is still talking about the same visit.
   */
  alreadyHeld: (business: string, slotLabel: string, phone: string) => string;
  alreadyBooked: (business: string, slotLabel: string, phone: string) => string;
  /** The held-booking reply, which never goes through `composeReply`. */
  holding: (business: string, slotLabel: string) => string;
  holdSentence: (fee: string, payUrl: string, minutes: number) => string;
  questionsAt: (phone: string) => string;
};

const EN: IntakePhrases = {
  opening: (business) =>
    `${business}: thanks for reaching out. What is the electrical problem, and what is the service address?`,
  fromBusiness: (business, said) => `${business}: ${said}`,
  askProblemAndAddress: (business) =>
    `${business}: what is the electrical problem, and what is the service address?`,
  askAddress: (business) => `${business}: what is the service address, including the city?`,
  callback: (business, firstName, urgent) =>
    `${business}: got it${firstName ? `, ${firstName}` : ""}. We have your number and will call you back${
      urgent ? " as soon as we can" : " to get you scheduled"
    }.`,
  offer: (business, slotLabel, fee) =>
    `${business}: we can come ${slotLabel}. The diagnostic visit is ${fee}. Reply YES to book it.`,
  haveWindow: (business, slotLabel) => `${business}: we have ${slotLabel}. Does that work?`,
  noOpening: (business) =>
    `${business}: we do not have an opening to offer yet. We will call you back to schedule.`,
  booked: (business, slotLabel, phone) =>
    `${business}: booked for ${slotLabel}. We will text when the technician is on the way. Questions? ${phone}`,
  messageTaken: (business) => `${business}: thanks — we have your message and will call you back.`,
  optOut: " Reply STOP to opt out.",
  questions: {
    scope: "Is this affecting the whole house, one room, or a single outlet or fixture?",
    onset:
      "When did it start, and did anything change just before — a new appliance, a storm, or work done?",
    breaker: "Have you looked at the breaker panel? Is anything tripped, and does it reset?",
    property:
      "Is this a house, a condo, or a commercial space, and roughly how old is the building?",
    access:
      "Is there anything the electrician needs to get in — a gate code, a dog, parking, or someone home?",
  },
  deliveryQuestion: "Would you like your confirmation by text, email, or both?",
  emailQuestion:
    "What email should we send a copy of your booking and receipt to? You can also reply 'skip'.",
  alreadyHeld: (business, slotLabel, phone) =>
    `${business}: thanks! We're holding ${slotLabel} for you. Use the payment link we texted you to confirm it. Need a different time? Call ${phone}.`,
  alreadyBooked: (business, slotLabel, phone) =>
    `${business}: thanks! You're all set for ${slotLabel}. Need to change it? Call ${phone}.`,
  holding: (business, slotLabel) => `${business}: holding ${slotLabel} for you.`,
  holdSentence: (fee, payUrl, minutes) =>
    `To confirm this time, pay the ${fee} diagnostic fee here: ${payUrl} — we are holding it for ${minutes} minutes.`,
  questionsAt: (phone) => `Questions? ${phone}`,
};

/**
 * A sentence ending in a time, with one full stop. A Spanish time already ends
 * in one ("10:00 a.m."), and a second reads as a typo.
 */
function endSentence(label: string): string {
  return label.endsWith(".") ? label : `${label}.`;
}

/*
 * Written the way this business's customers speak rather than the way a
 * textbook does. "Panel de breakers" is what a household on the Central Coast
 * calls it; "panel de disyuntores" is correct and nobody says it, and an intake
 * question somebody has to re-read is one they answer badly.
 */
const ES: IntakePhrases = {
  opening: (business) =>
    `${business}: gracias por escribirnos. ¿Cuál es el problema eléctrico y cuál es la dirección del servicio?`,
  fromBusiness: (business, said) => `${business}: ${said}`,
  askProblemAndAddress: (business) =>
    `${business}: ¿cuál es el problema eléctrico y cuál es la dirección del servicio?`,
  askAddress: (business) => `${business}: ¿cuál es la dirección del servicio, incluyendo la ciudad?`,
  callback: (business, firstName, urgent) =>
    `${business}: entendido${firstName ? `, ${firstName}` : ""}. Tenemos su número y le llamamos${
      urgent ? " lo antes posible" : " para agendar su cita"
    }.`,
  offer: (business, slotLabel, fee) =>
    `${business}: podemos ir ${slotLabel}. La visita de diagnóstico cuesta ${fee}. Responda SÍ para reservar.`,
  haveWindow: (business, slotLabel) =>
    `${business}: tenemos disponible ${slotLabel}. ¿Le funciona?`,
  noOpening: (business) =>
    `${business}: todavía no tenemos un horario que ofrecerle. Le llamamos para agendar.`,
  booked: (business, slotLabel, phone) =>
    `${business}: reservado para ${slotLabel}. Le avisamos por mensaje cuando el técnico vaya en camino. ¿Preguntas? ${phone}`,
  messageTaken: (business) => `${business}: gracias, recibimos su mensaje y le llamamos.`,
  optOut: " Responda STOP para no recibir más mensajes.",
  questions: {
    scope: "¿Esto afecta toda la casa, un solo cuarto, o un solo enchufe o lámpara?",
    onset:
      "¿Cuándo empezó, y cambió algo justo antes? Un aparato nuevo, una tormenta, o algún trabajo hecho.",
    breaker: "¿Ha revisado el panel de breakers? ¿Hay alguno botado, y vuelve a prender?",
    property:
      "¿Es una casa, un condominio, o un local comercial, y más o menos de qué año es el edificio?",
    access:
      "¿Hay algo que el electricista necesite para entrar? Código del portón, un perro, estacionamiento, o alguien en casa.",
  },
  deliveryQuestion: "¿Prefiere su confirmación por mensaje, por correo electrónico, o las dos?",
  emailQuestion:
    "¿A qué correo electrónico le enviamos una copia de su cita y su recibo? También puede responder 'omitir'.",
  alreadyHeld: (business, slotLabel, phone) =>
    `${business}: ¡gracias! Le estamos apartando ${slotLabel}; use el enlace de pago que le enviamos por mensaje para confirmar. ¿Necesita otro horario? Llame al ${phone}.`,
  alreadyBooked: (business, slotLabel, phone) =>
    `${business}: ¡gracias! Ya tiene su cita para ${slotLabel}; si necesita cambiarla, llame al ${phone}.`,
  holding: (business, slotLabel) => `${business}: le estamos apartando ${endSentence(slotLabel)}`,
  holdSentence: (fee, payUrl, minutes) =>
    `Para confirmar este horario, pague la tarifa de diagnóstico de ${fee} aquí: ${payUrl} — se lo apartamos por ${minutes} minutos.`,
  questionsAt: (phone) => `¿Preguntas? ${phone}`,
};

const SETS: Record<LanguageCode, IntakePhrases> = { en: EN, es: ES };

/**
 * The phrase set for a language.
 *
 * Falls back to English rather than throwing. A customer reading one English
 * message is a worse experience; a thrown error inside a Twilio webhook is a
 * customer who gets no reply at all.
 */
export function phrasesFor(language: string): IntakePhrases {
  return SETS[language as LanguageCode] ?? EN;
}

/**
 * The date-and-time locale a slot label should be formatted in.
 *
 * Separate from the language code because `Intl` wants a locale and this app
 * stores a language. "es-US" rather than "es": a Spanish speaker in California
 * reads 8-10am, not 08:00-10:00.
 */
export function localeFor(language: string): string {
  return language === "es" ? "es-US" : "en-US";
}

/**
 * An intake question as it was stored, in the language a customer reads.
 *
 * Answers are stored beside the English wording of the question they answer,
 * because that is what the electrician reads. The customer's own copy (the
 * booking page, the confirmation email) shows the question in their language.
 * A question this list does not know is shown as it was stored.
 */
export function intakeQuestionIn(question: string, language: string): string {
  const target = phrasesFor(language);
  if (target === EN) return question;
  const key = Object.entries(EN.questions).find(([, english]) => english === question.trim())?.[0];
  return (key && target.questions[key]) || question;
}
