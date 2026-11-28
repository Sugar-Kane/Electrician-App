/**
 * When a diagnostic fee may be collected, and what the customer is told.
 *
 * The single source of truth for the deferred diagnostic payment rules. The
 * booking pages, the Stripe code, the job screen, the MCP tools, the Grok voice
 * agent and the texts all read their answers from here, and the database
 * functions in `20261126040000_deferred_diagnostic_payments.sql` enforce the
 * same rules again where the money actually moves. A rule changed in one place
 * and not the other is a bug; the tests in diagnostic-payment-policy.test.ts
 * and compliance/tests/deferred-diagnostic/*.sql pin both.
 *
 * Why the fee is deferred in California
 * -------------------------------------
 * A service and repair contract (B&P § 7159.10) is one where, among other
 * conditions, no payment is due until the work is completed; § 7159.14 adds
 * operating conditions (one service charge, disclosed in advertising and when
 * the customer calls). A home improvement contract (§ 7159 / § 7159.5) limits
 * the down payment to 10% or $1,000, whichever is less, and forbids payment
 * ahead of the work performed. Calling the money a "diagnostic", "trip",
 * "inspection" or "service" fee changes none of that. Rather than decide per
 * booking which regime a visit falls under — the facts that decide it
 * (customer-initiated, total under $750, nothing beyond what is reasonably
 * necessary) are often not known when the visit is booked — Volteira applies
 * the more conservative rule to every California diagnostic: nothing is
 * collected before the contracted diagnostic service is completed. See
 * docs/deferred-diagnostic-payments.md for the legal questions still open.
 *
 * Import-free, so every rule can be tested without a database or Stripe.
 */

/** Bump whenever the authorization wording changes. Stored with every authorization. */
export const DIAGNOSTIC_AUTHORIZATION_VERSION = "2026-11-26.1";

export type Language = "en" | "es";

/** Where the business's own preference is overridden by law, and why. */
export type JurisdictionRule = {
  code: string;
  /** No diagnostic payment before the contracted diagnostic service is completed. */
  deferDiagnosticFee: true;
  reason: string;
  citations: string[];
};

/**
 * Jurisdictions whose rules override what a contractor chooses.
 *
 * An unknown jurisdiction is treated like California until reviewed: the
 * conservative answer is never wrong to the customer, only inconvenient to the
 * contractor.
 */
export const JURISDICTION_RULES: Record<string, JurisdictionRule> = {
  CA: {
    code: "CA",
    deferDiagnosticFee: true,
    reason:
      "California: no diagnostic payment is collected before the contracted diagnostic service is completed (Bus. & Prof. Code §§ 7159.5, 7159.10, 7159.14).",
    citations: [
      "Cal. Bus. & Prof. Code § 7151",
      "Cal. Bus. & Prof. Code § 7159",
      "Cal. Bus. & Prof. Code § 7159.5",
      "Cal. Bus. & Prof. Code § 7159.10",
      "Cal. Bus. & Prof. Code § 7159.14",
    ],
  },
};

export type CollectAt = "after_completion" | "at_booking";

/** What a contractor saved in Diagnostic Payment Settings. Preferences, not the law. */
export type DiagnosticPaymentSettings = {
  feeCents: number;
  /** Two-letter state the business operates in; empty when not set. */
  jurisdiction: string;
  /** The contractor's preference. Overridden where the jurisdiction defers. */
  collectAt: CollectAt;
  requirePaymentMethod: boolean;
  autoCollect: boolean;
  allowManualAfterCompletion: boolean;
  creditTowardRepairs: boolean;
  sendSetupReminders: boolean;
  sendFailedPaymentNotices: boolean;
  serviceDescription: string;
};

export type EffectivePolicy = {
  feeCents: number;
  jurisdiction: string;
  collectAt: CollectAt;
  /** Shown on every booking surface. Always 0 when collection waits for completion. */
  dueTodayCents: number;
  dueOnCompletionCents: number;
  requirePaymentMethod: boolean;
  autoCollect: boolean;
  allowManualAfterCompletion: boolean;
  creditTowardRepairs: boolean;
  sendSetupReminders: boolean;
  sendFailedPaymentNotices: boolean;
  serviceName: string;
  /** Each contractor preference the jurisdiction overrode, in words. */
  overrides: string[];
  /** The rule that applied, when one did. */
  rule: JurisdictionRule | null;
};

export const DEFAULT_SERVICE_NAME = "Electrical Diagnostic Service";
export const DEFAULT_SERVICE_NAME_ES = "Servicio de diagnóstico eléctrico";

function whole(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export function normalizeJurisdiction(value: unknown): string {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

/**
 * The rule for a jurisdiction. An empty or unknown-to-us code is not
 * "unregulated": until somebody reviews it, it gets California's treatment.
 */
export function jurisdictionRule(jurisdiction: string): JurisdictionRule | null {
  const code = normalizeJurisdiction(jurisdiction);
  if (!code) return { ...JURISDICTION_RULES.CA, code: "", reason: "Operating jurisdiction not set: the conservative California rule applies until it is." };
  return JURISDICTION_RULES[code] ?? null;
}

/** The policy that actually applies: the contractor's settings, with the law on top. */
export function effectiveDiagnosticPolicy(settings: DiagnosticPaymentSettings): EffectivePolicy {
  const feeCents = whole(settings.feeCents);
  const jurisdiction = normalizeJurisdiction(settings.jurisdiction);
  const rule = jurisdictionRule(jurisdiction);
  const overrides: string[] = [];

  let collectAt: CollectAt = settings.collectAt === "at_booking" ? "at_booking" : "after_completion";
  if (rule?.deferDiagnosticFee && collectAt === "at_booking") {
    collectAt = "after_completion";
    overrides.push(`Upfront diagnostic payment is disabled. ${rule.reason}`);
  }

  const deferred = collectAt === "after_completion";
  return {
    feeCents,
    jurisdiction,
    collectAt,
    dueTodayCents: deferred ? 0 : feeCents,
    dueOnCompletionCents: deferred ? feeCents : 0,
    requirePaymentMethod: deferred ? Boolean(settings.requirePaymentMethod) : false,
    autoCollect: deferred ? Boolean(settings.autoCollect) : false,
    allowManualAfterCompletion: Boolean(settings.allowManualAfterCompletion),
    creditTowardRepairs: Boolean(settings.creditTowardRepairs),
    sendSetupReminders: Boolean(settings.sendSetupReminders),
    sendFailedPaymentNotices: Boolean(settings.sendFailedPaymentNotices),
    serviceName: settings.serviceDescription.trim().slice(0, 120) || DEFAULT_SERVICE_NAME,
    overrides,
    rule,
  };
}

/** Settings as stored (service_settings), read defensively. */
export function settingsFromRow(row: Record<string, unknown> | null | undefined, fallbackJurisdiction = ""): DiagnosticPaymentSettings {
  const value = row ?? {};
  const flag = (key: string, fallback: boolean) => (typeof value[key] === "boolean" ? (value[key] as boolean) : fallback);
  return {
    feeCents: whole(value.diagnostic_fee_cents),
    jurisdiction: normalizeJurisdiction(value.diagnostic_jurisdiction) || normalizeJurisdiction(fallbackJurisdiction),
    collectAt: value.diagnostic_collect_at === "at_booking" ? "at_booking" : "after_completion",
    requirePaymentMethod: flag("require_payment_method_at_booking", true),
    autoCollect: flag("auto_collect_diagnostic", true),
    allowManualAfterCompletion: flag("allow_manual_diagnostic_payment", true),
    creditTowardRepairs: flag("credit_diagnostic_to_repair", true),
    sendSetupReminders: flag("send_payment_method_reminders", true),
    sendFailedPaymentNotices: flag("send_failed_payment_notices", true),
    serviceDescription: typeof value.diagnostic_service_description === "string" ? value.diagnostic_service_description : "",
  };
}

export function money(cents: number, wholeDollars = false): string {
  const amount = whole(cents) / 100;
  if (wholeDollars && Number.isInteger(amount)) return `$${amount}`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
}

/**
 * The words the customer agrees to. Shown next to an unticked checkbox, stored
 * verbatim with the authorization, and repeated on the Stripe page.
 */
export function authorizationText(input: { businessName: string; feeCents: number; language?: Language }): string {
  const business = input.businessName.trim() || (input.language === "es" ? "el contratista" : "the contractor");
  const fee = money(input.feeCents, true);
  if (input.language === "es") {
    return `Autorizo a ${business} a guardar de forma segura mi método de pago y a cobrar ${fee} al completar el servicio de diagnóstico eléctrico contratado. Hoy no se cobrará ningún pago de diagnóstico.`;
  }
  return `I authorize ${business} to securely save my payment method and charge ${fee} upon completion of the contracted electrical diagnostic service. No diagnostic payment will be collected today.`;
}

export function creditNotice(language: Language = "en"): string {
  return language === "es"
    ? "Si aprueba reparaciones que califiquen, la tarifa de diagnóstico se acreditará al costo de la reparación aprobada de acuerdo con los términos de su acuerdo."
    : "If you approve qualifying repairs, your diagnostic fee will be credited toward the approved repair cost in accordance with the terms of your agreement.";
}

/** The three-line price summary every booking surface shows. */
export function priceSummary(policy: Pick<EffectivePolicy, "feeCents" | "dueTodayCents" | "dueOnCompletionCents" | "serviceName">, language: Language = "en") {
  const name = language === "es" && policy.serviceName === DEFAULT_SERVICE_NAME ? DEFAULT_SERVICE_NAME_ES : policy.serviceName;
  return [
    { label: name, amount: money(policy.feeCents) },
    { label: language === "es" ? "A pagar hoy" : "Due Today", amount: money(policy.dueTodayCents) },
    { label: language === "es" ? "A pagar al completar" : "Due Upon Completion", amount: money(policy.dueOnCompletionCents) },
  ];
}

/** A cheap, stable fingerprint of the exact words agreed to (not a security hash). */
export function textFingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Completion and collection
// ---------------------------------------------------------------------------

export type DiagnosticOutcomeKind = "diagnostic_only" | "fix_now" | "schedule_later";

/**
 * How the repair (if any) relates to the diagnostic's contract.
 *
 * - `none`: no repair; the diagnostic is a standalone contract (Scenario A).
 * - `separate`: the customer will sign a genuinely separate, later contract for
 *   the repair (Scenario B, separate). The diagnostic is complete and payable,
 *   and its fee is credited on the repair contract.
 * - `same_contract`: the repair is part of the same contract as the diagnostic
 *   (a fix done on the same visit, or a work order the contractor treats as
 *   the same contract). Nothing is collected until that whole contracted work
 *   is complete; the fee is billed on the job's final invoice, never by itself.
 * - `undetermined`: nobody has said. Treated like `same_contract`.
 */
export type RepairContract = "none" | "separate" | "same_contract" | "undetermined";

export function repairContractFor(outcome: DiagnosticOutcomeKind, separateConfirmed: boolean): RepairContract {
  if (outcome === "diagnostic_only") return "none";
  if (outcome === "fix_now") return "same_contract";
  return separateConfirmed ? "separate" : "undetermined";
}

export const MIN_FINDINGS_LENGTH = 15;

export type AuthorizationState =
  | "setup_pending"
  | "payment_method_saved"
  | "processing"
  | "succeeded"
  | "failed"
  | "requires_action"
  | "revoked"
  | "cancelled"
  | "expired"
  | "refunded";

export type CollectionInput = {
  via: "app" | "mcp" | "auto" | "recovery" | "voice";
  /** Who asked, already checked to be a member of this business. */
  actorRole: string | null;
  /** Whether that member may take payments (billing permission). */
  actorCanBill: boolean;
  policy: Pick<EffectivePolicy, "collectAt" | "autoCollect" | "allowManualAfterCompletion">;
  job: {
    organizationId: string;
    status: string;
    canceled: boolean;
    diagnosticPaid: boolean;
    diagnosticCompletedAt: string | null;
    diagnosticFindings: string;
    repairContract: RepairContract | null;
    /** A signed contract on this job priced above the authorized amount: a larger contract. */
    largerSignedContract: boolean;
  };
  authorization: {
    organizationId: string;
    state: AuthorizationState;
    amountCents: number;
    hasPaymentMethod: boolean;
    stripeAccountId: string;
  } | null;
  /** The business's connected Stripe account now, and whether it can charge. */
  account: { stripeAccountId: string; chargesEnabled: boolean } | null;
  requestedCents: number;
  /** A charge already processing or succeeded for this authorization. */
  openCharge: boolean;
};

/**
 * Why a diagnostic payment may not be collected now, or null when it may.
 *
 * Every condition the task lists is checked here, in the order a person would
 * explain them. The database function `claim_diagnostic_charge` checks them
 * again under a row lock; this copy is for honest messages and for tests.
 */
export function collectionRefusal(input: CollectionInput): string | null {
  if (input.via === "voice") return "The voice agent cannot collect payments.";
  if (input.via === "recovery") {
    // A customer paying their own completed bill from a secure link: no staff role.
  } else if (input.via !== "auto") {
    if (!input.actorRole) return "Only a member of this business can collect its payments.";
    if (!input.actorCanBill) return "Your role cannot take payments for this business.";
  }
  const { job, authorization } = input;
  if (input.policy.collectAt !== "after_completion") return "This business collects its diagnostic fee at booking; there is no deferred authorization to charge.";
  if (input.via === "auto" && !input.policy.autoCollect) return "Automatic collection is turned off for this business.";
  if ((input.via === "app" || input.via === "mcp") && !input.policy.allowManualAfterCompletion) {
    return "Manual collection after completion is turned off for this business.";
  }
  if (job.canceled || job.status === "canceled") return "The job is canceled; nothing is collected.";
  if (!job.diagnosticCompletedAt) return "The diagnostic service has not been marked complete.";
  if (job.diagnosticFindings.trim().length < MIN_FINDINGS_LENGTH) return "Document the diagnostic findings before collecting.";
  if (job.repairContract !== "none" && job.repairContract !== "separate") {
    return "The repair is part of the same contract as the diagnostic. Collect when that contracted work is complete, on the final invoice.";
  }
  if (job.largerSignedContract) return "This diagnostic is part of a larger signed contract that is not complete.";
  if (job.diagnosticPaid) return "The diagnostic fee is already paid.";
  if (!authorization) return "The customer has not authorized a saved payment method.";
  if (authorization.organizationId !== job.organizationId) return "The authorization belongs to another business.";
  if (authorization.state === "revoked") return "The customer revoked the payment authorization.";
  if (authorization.state === "cancelled" || authorization.state === "expired") return "The payment authorization is no longer valid.";
  if (authorization.state === "succeeded" || authorization.state === "refunded") return "The diagnostic fee was already collected.";
  if (authorization.state === "setup_pending") return "The customer has not finished saving a payment method.";
  if (input.openCharge || authorization.state === "processing") return "A payment for this diagnostic is already processing.";
  if (input.via !== "recovery" && !authorization.hasPaymentMethod) return "No saved payment method is on file.";
  const requested = whole(input.requestedCents);
  if (requested !== whole(authorization.amountCents) || requested <= 0) {
    return `Only the authorized ${money(authorization.amountCents)} can be collected.`;
  }
  if (!input.account || !input.account.chargesEnabled) return "This business's Stripe account cannot take payments right now.";
  if (input.account.stripeAccountId !== authorization.stripeAccountId) return "The saved payment method belongs to a different Stripe account.";
  return null;
}

/** The twelve customer- and contractor-facing payment states. */
export type DisplayState =
  | "payment_method_required"
  | "payment_method_setup_pending"
  | "payment_method_saved"
  | "not_yet_eligible"
  | "eligible"
  | "payment_processing"
  | "payment_successful"
  | "payment_failed"
  | "authentication_required"
  | "authorization_revoked"
  | "cancelled"
  | "refunded";

export const DISPLAY_LABELS: Record<DisplayState, { en: string; es: string }> = {
  payment_method_required: { en: "Payment method required", es: "Se requiere método de pago" },
  payment_method_setup_pending: { en: "Payment method setup pending", es: "Método de pago pendiente" },
  payment_method_saved: { en: "Payment method saved", es: "Método de pago guardado" },
  not_yet_eligible: { en: "Not yet eligible for payment", es: "Aún no se puede cobrar" },
  eligible: { en: "Eligible for payment", es: "Listo para cobrar" },
  payment_processing: { en: "Payment processing", es: "Pago en proceso" },
  payment_successful: { en: "Payment successful", es: "Pago realizado" },
  payment_failed: { en: "Payment failed", es: "El pago no se pudo procesar" },
  authentication_required: { en: "Customer authentication required", es: "Se requiere verificación del cliente" },
  authorization_revoked: { en: "Authorization revoked", es: "Autorización revocada" },
  cancelled: { en: "Cancelled", es: "Cancelado" },
  refunded: { en: "Refunded", es: "Reembolsado" },
};

export function displayState(input: {
  authorizationState: AuthorizationState | null;
  diagnosticCompleted: boolean;
  /** collectionRefusal(...) === null for an app collection. */
  eligible: boolean;
}): DisplayState {
  switch (input.authorizationState) {
    case null:
      return "payment_method_required";
    case "setup_pending":
      return "payment_method_setup_pending";
    case "processing":
      return "payment_processing";
    case "succeeded":
      return "payment_successful";
    case "failed":
      return "payment_failed";
    case "requires_action":
      return "authentication_required";
    case "revoked":
      return "authorization_revoked";
    case "cancelled":
    case "expired":
      return "cancelled";
    case "refunded":
      return "refunded";
    case "payment_method_saved":
      if (!input.diagnosticCompleted) return "not_yet_eligible";
      return input.eligible ? "eligible" : "payment_method_saved";
  }
}

/**
 * What a Stripe PaymentIntent outcome means for the authorization. Ordered so
 * an out-of-order or repeated webhook can never move a succeeded payment back.
 */
export function nextAuthorizationState(current: AuthorizationState, outcome: "succeeded" | "failed" | "requires_action" | "processing" | "canceled"): AuthorizationState {
  if (current === "succeeded" || current === "refunded") return current;
  if (current === "revoked" || current === "cancelled") return outcome === "succeeded" ? "succeeded" : current;
  if (outcome === "canceled") return current === "processing" ? "failed" : current;
  return outcome;
}

/** Keeps card numbers, CVCs and Stripe secrets out of anything a model or a log sees. */
export function redactPaymentSecrets(text: string): string {
  return text
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[card number removed]")
    .replace(/\b(?:cvc|cvv|security code)\D{0,12}\d{3,4}\b/gi, "[security code removed]")
    .replace(/\b(seti|pi|pm|cus|cs|acct|ch|re)_[A-Za-z0-9_]{6,}\b/g, "[stripe id removed]")
    .replace(/\b(sk|rk|whsec)_(?:live|test)?_?[A-Za-z0-9]{8,}\b/g, "[secret removed]")
    .replace(/_secret_[A-Za-z0-9]+/g, "_secret_[removed]");
}

/**
 * Why an invoice on this job may not be sent yet, or null.
 *
 * In a deferred business a diagnostic job is not billed until its diagnostic
 * is completed: an invoice before that is an advance payment request, by
 * whichever route (the screen, the assistant, ChatGPT/Claude) it is sent.
 */
export function diagnosticInvoiceRefusal(input: {
  deferred: boolean;
  feeCents: number;
  followUp: boolean;
  diagnosticPaid: boolean;
  diagnosticCompletedAt: string | null;
  jobCompleted: boolean;
}): string | null {
  if (!input.deferred || input.followUp || input.diagnosticPaid || input.jobCompleted) return null;
  if (!(whole(input.feeCents) > 0)) return null;
  if (input.diagnosticCompletedAt) return null;
  return "This job's diagnostic is not completed yet. Nothing can be billed before the contracted diagnostic service is completed. Nothing was sent.";
}
