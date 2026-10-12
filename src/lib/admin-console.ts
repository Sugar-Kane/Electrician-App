/**
 * Reading the support console.
 *
 * Every function here is one RPC. None of them widen a tenant policy — the
 * database refuses a caller who is not a platform admin, so this module holds
 * shapes and formatting rather than any decision about who may look.
 */

import type { ActivityRow } from "@/lib/activity-timeline";
import type { DeliveryEvidence } from "@/lib/admin-health";
import { parseTrace, type JobTrace } from "@/lib/admin-trace";
import type { HideableBooking } from "@/lib/booking-duplicates";
import type { TextFacts } from "@/lib/recovery/text-recovery";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export type OrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  phone: string;
  city: string;
  state: string;
  timeZone: string;
  createdAt: string;
  archived: boolean;
  memberCount: number;
  pendingInvitations: number;
  jobCount: number;
  bookingCount: number;
  lastBookingAt: string;
  ownerEmail: string;
  ownerPhone: string;
  messagingServiceSid: string;
  a2pRegistered: boolean;
};

export type PlatformUser = {
  userId: string;
  email: string;
  fullName: string;
  createdAt: string;
  lastSignInAt: string;
  emailConfirmed: boolean;
  isPlatformAdmin: boolean;
  organizationId: string;
  organizationName: string;
  role: string;
};

export type BookingDiagnostic = {
  id: string;
  createdAt: string;
  status: string;
  intent: string;
  contactName: string;
  phone: string;
  email: string;
  description: string;
  windowStart: string;
  windowEnd: string;
  intakeAnswerCount: number;
  jobId: string;
  notifications: NotificationAttempt[];
};

export type NotificationAttempt = {
  channel: string;
  to: string;
  audience: string;
  ok: boolean;
  detail: string;
  /** The provider's id for it. Older email attempts kept it as their detail. */
  ref: string;
  at: string;
};

export type McpCall = {
  id: string;
  createdAt: string;
  method: string;
  toolName: string;
  isError: boolean;
  httpStatus: number;
  durationMs: number;
  arguments: string;
  resultText: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function count(value: unknown): number {
  return typeof value === "number" ? value : Number(value ?? 0) || 0;
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

async function client() {
  return asFlexibleClient(await createClient());
}

/**
 * Whether the signed-in person may use the console at all.
 *
 * Asked before anything renders. The RPC is the authority; this is not a
 * convenience check that something else enforces later, because every read
 * below refuses independently.
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const supabase = await client();
  const { data } = await supabase.rpc("am_i_platform_admin");
  return data === true;
}

export async function listOrganizations(): Promise<OrganizationSummary[]> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_organizations");

  return rows(data).map((row) => ({
    id: text(row.organization_id),
    name: text(row.name),
    slug: text(row.slug),
    phone: text(row.phone),
    city: text(row.city),
    state: text(row.state),
    timeZone: text(row.timezone),
    createdAt: text(row.created_at),
    archived: row.archived === true,
    memberCount: count(row.member_count),
    pendingInvitations: count(row.pending_invitations),
    jobCount: count(row.job_count),
    bookingCount: count(row.booking_count),
    lastBookingAt: text(row.last_booking_at),
    ownerEmail: text(row.owner_notification_email),
    ownerPhone: text(row.owner_notification_phone),
    messagingServiceSid: text(row.messaging_service_sid),
    a2pRegistered: row.a2p_registered === true,
  }));
}

export async function listUsers(): Promise<PlatformUser[]> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_users");

  return rows(data).map((row) => ({
    userId: text(row.user_id),
    email: text(row.email),
    fullName: text(row.full_name),
    createdAt: text(row.created_at),
    lastSignInAt: text(row.last_sign_in_at),
    emailConfirmed: row.email_confirmed === true,
    isPlatformAdmin: row.is_platform_admin === true,
    organizationId: text(row.organization_id),
    organizationName: text(row.organization_name),
    role: text(row.role),
  }));
}

export type OrganizationDetail = {
  id: string;
  name: string;
  slug: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  timeZone: string;
  createdAt: string;
  archived: boolean;
  ownerEmail: string;
  ownerPhone: string;
  diagnosticFeeCents: number;
  diagnosticMinutes: number;
  messagingServiceSid: string;
  messagingPhone: string;
  a2pRegisteredAt: string;
  a2pCampaignId: string;
  legalPublished: boolean;
};

export async function getOrganizationDetail(id: string): Promise<OrganizationDetail | null> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_organization_detail", { p_organization_id: id });
  const row = rows(data)[0];
  if (!row) return null;

  return {
    id: text(row.organization_id),
    name: text(row.name),
    slug: text(row.slug),
    phone: text(row.phone),
    address: text(row.address),
    city: text(row.city),
    state: text(row.state),
    postalCode: text(row.postal_code),
    timeZone: text(row.timezone),
    createdAt: text(row.created_at),
    archived: row.archived === true,
    ownerEmail: text(row.owner_notification_email),
    ownerPhone: text(row.owner_notification_phone),
    diagnosticFeeCents: count(row.diagnostic_fee_cents),
    diagnosticMinutes: count(row.diagnostic_minutes),
    messagingServiceSid: text(row.messaging_service_sid),
    messagingPhone: text(row.messaging_phone),
    a2pRegisteredAt: text(row.a2p_registered_at),
    a2pCampaignId: text(row.a2p_campaign_id),
    legalPublished: row.legal_published === true,
  };
}

export type OrganizationMember = {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  joinedAt: string;
  lastSignInAt: string;
  emailConfirmed: boolean;
};

export async function listOrganizationMembers(id: string): Promise<OrganizationMember[]> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_organization_members", { p_organization_id: id });

  return rows(data).map((row) => ({
    userId: text(row.user_id),
    email: text(row.email),
    fullName: text(row.full_name),
    role: text(row.role),
    joinedAt: text(row.joined_at),
    lastSignInAt: text(row.last_sign_in_at),
    emailConfirmed: row.email_confirmed === true,
  }));
}

function attempts(value: unknown): NotificationAttempt[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    const detail = text(row.detail);
    const channel = text(row.channel);
    return {
      channel,
      to: text(row.to),
      audience: text(row.audience),
      ok: row.ok === true,
      detail,
      ref: text(row.ref) || (channel === "email" && row.ok === true && /^[0-9a-f-]{36}$/i.test(detail) ? detail : ""),
      at: text(row.at),
    };
  });
}

export async function listRecentBookings(id: string, limit = 20): Promise<BookingDiagnostic[]> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_recent_bookings", {
    p_organization_id: id,
    p_limit: limit,
  });

  return rows(data).map((row) => ({
    id: text(row.booking_id),
    createdAt: text(row.created_at),
    status: text(row.status),
    intent: text(row.intent),
    contactName: text(row.contact_name),
    phone: text(row.phone),
    email: text(row.email),
    description: text(row.description),
    windowStart: text(row.arrival_window_start),
    windowEnd: text(row.arrival_window_end),
    intakeAnswerCount: count(row.intake_answer_count),
    jobId: text(row.created_job_id),
    notifications: attempts(row.notification_results),
  }));
}

/** A booking as the console's Bookings tab needs it: enough to decide what may be hidden. */
export type AdminBooking = BookingDiagnostic & {
  organizationId: string;
  updatedAt: string;
  source: string;
  depositPaidAt: string;
  paymentIntentId: string;
  paymentCount: number;
  classification: string;
  archivedAt: string;
  archivedByEmail: string;
  archivedStatus: string;
  duplicateOf: string;
  duplicateReviewedAt: string;
};

export async function listBookings(id: string, limit = 40): Promise<AdminBooking[]> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_booking_list", {
    p_organization_id: id,
    p_limit: limit,
  });

  return rows(data).map((row) => ({
    id: text(row.booking_id),
    organizationId: id,
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    status: text(row.status),
    intent: text(row.intent),
    source: text(row.source),
    contactName: text(row.contact_name),
    phone: text(row.phone),
    email: text(row.email),
    description: text(row.description),
    windowStart: text(row.arrival_window_start),
    windowEnd: text(row.arrival_window_end),
    intakeAnswerCount: count(row.intake_answer_count),
    jobId: text(row.created_job_id),
    notifications: attempts(row.notification_results),
    depositPaidAt: text(row.deposit_paid_at),
    paymentIntentId: text(row.stripe_payment_intent_id),
    paymentCount: count(row.payment_count),
    classification: text(row.classification),
    archivedAt: text(row.archived_at),
    archivedByEmail: text(row.archived_by_email),
    archivedStatus: text(row.archived_status),
    duplicateOf: text(row.duplicate_of),
    duplicateReviewedAt: text(row.duplicate_reviewed_at),
  }));
}

/** The fields the hiding rules read. */
export function bookingHideable(booking: AdminBooking): HideableBooking {
  return {
    id: booking.id,
    organizationId: booking.organizationId,
    status: booking.status,
    phone: booking.phone,
    email: booking.email,
    createdAt: booking.createdAt,
    jobId: booking.jobId,
    depositPaidAt: booking.depositPaidAt,
    paymentIntentId: booking.paymentIntentId,
    paymentCount: booking.paymentCount,
    archivedAt: booking.archivedAt,
    duplicateReviewedAt: booking.duplicateReviewedAt,
  };
}

export async function listMcpCalls(id: string, limit = 40): Promise<McpCall[]> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_mcp_calls", {
    p_organization_id: id,
    p_limit: limit,
  });

  return rows(data).map((row) => ({
    id: text(row.id),
    createdAt: text(row.created_at),
    method: text(row.method),
    toolName: text(row.tool_name),
    isError: row.is_error === true,
    httpStatus: count(row.http_status),
    durationMs: count(row.duration_ms),
    arguments: JSON.stringify(row.arguments ?? {}),
    resultText: text(row.result_text),
  }));
}

/**
 * Delivery evidence for one business, or for every business keyed by id.
 *
 * From the outbound texts' own delivery reports, so What's wrong can say
 * "delivering", "failing now", "failed before but delivering since" or
 * "unknown" instead of reading a hand-kept approval date as a verdict.
 */
export async function getMessagingEvidence(id: string | null): Promise<Map<string, DeliveryEvidence>> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_messaging_evidence", { p_organization_id: id });

  return new Map(
    rows(data).map((row) => [
      text(row.organization_id),
      {
        lastDeliveredAt: text(row.last_delivered_at),
        lastFailedAt: text(row.last_failed_at),
        lastFailedCode: text(row.last_failed_code),
        outbound30d: count(row.outbound_30d),
        failed7d: count(row.failed_7d),
        failures7d: rows(row.failures_7d).map((entry) => ({
          code: text(entry.code),
          count: count(entry.count),
          lastAt: text(entry.last_at),
        })),
      },
    ]),
  );
}

export type AuditRow = {
  id: string;
  createdAt: string;
  adminEmail: string;
  action: string;
  organizationId: string;
  organizationName: string;
  timeZone: string;
  detail: Record<string, unknown>;
};

/** One page of the trail, newest first, optionally for one business or action. */
export async function listAuditPage(filter: {
  organizationId?: string;
  action?: string;
  before?: string;
  limit?: number;
}): Promise<AuditRow[]> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_audit_page", {
    p_organization_id: filter.organizationId || null,
    p_action: filter.action || null,
    p_before: filter.before || null,
    p_limit: filter.limit ?? 50,
  });

  return rows(data).map((row) => ({
    id: text(row.id),
    createdAt: text(row.created_at),
    adminEmail: text(row.admin_email),
    action: text(row.action),
    organizationId: text(row.organization_id),
    organizationName: text(row.organization_name),
    timeZone: text(row.organization_timezone),
    detail:
      row.detail && typeof row.detail === "object" && !Array.isArray(row.detail)
        ? (row.detail as Record<string, unknown>)
        : {},
  }));
}

export type SearchHit = {
  kind: "business" | "person" | "job" | "invoice" | "customer" | "booking";
  organizationId: string;
  organizationName: string;
  /** Job number for jobs and invoices, the record's id otherwise. */
  ref: string;
  title: string;
  detail: string;
  at: string;
};

const HIT_KINDS = new Set<SearchHit["kind"]>(["business", "person", "job", "invoice", "customer", "booking"]);

/** One search across every business. The database records that it ran. */
export async function searchConsole(query: string): Promise<SearchHit[]> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_search", { p_query: query.slice(0, 80) });
  return rows(data)
    .filter((row) => HIT_KINDS.has(text(row.kind) as SearchHit["kind"]))
    .map((row) => ({
      kind: text(row.kind) as SearchHit["kind"],
      organizationId: text(row.organization_id),
      organizationName: text(row.organization_name),
      ref: text(row.ref),
      title: text(row.title),
      detail: text(row.detail),
      at: text(row.at),
    }));
}

/** Records which part of a business was opened. Best effort. */
export async function recordOrganizationTab(id: string, tab: string): Promise<void> {
  const supabase = await client();
  await supabase.rpc("admin_view_organization", { p_organization_id: id, p_tab: tab });
}

/** Whether a reveal on the page address is this admin's own, fresh, for this business. */
export async function revealIsValid(auditId: string, organizationId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(auditId)) return false;
  const supabase = await client();
  const { data } = await supabase.rpc("admin_reveal_valid", {
    p_audit_id: auditId,
    p_organization_id: organizationId,
  });
  return data === true;
}

export type OrgJob = {
  id: string;
  number: string;
  status: string;
  category: string;
  scheduledStart: string;
  scheduledEnd: string;
  createdAt: string;
  customerId: string;
  customerName: string;
  city: string;
  technician: string;
  agreementSent: boolean;
  agreementSigned: boolean;
  invoiceCount: number;
};

export async function listOrgJobs(id: string, customerId?: string): Promise<OrgJob[]> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_org_jobs", {
    p_organization_id: id,
    p_customer_id: customerId || null,
    p_limit: 200,
  });
  return rows(data).map((row) => ({
    id: text(row.id),
    number: String(row.job_number ?? ""),
    status: text(row.status),
    category: text(row.category),
    scheduledStart: text(row.scheduled_start),
    scheduledEnd: text(row.scheduled_end),
    createdAt: text(row.created_at),
    customerId: text(row.customer_id),
    customerName: text(row.customer_name),
    city: text(row.city),
    technician: text(row.technician_name),
    agreementSent: row.agreement_sent === true,
    agreementSigned: row.agreement_signed === true,
    invoiceCount: count(row.invoice_count),
  }));
}

export type OrgMessage = {
  id: string;
  createdAt: string;
  direction: string;
  status: string;
  errorCode: string;
  errorDetail: string;
  sentAt: string;
  deliveredAt: string;
  body: string;
  hasProviderRef: boolean;
  customerId: string;
  customerName: string;
  customerPhone: string;
  jobNumber: string;
};

export async function listOrgMessages(id: string): Promise<OrgMessage[]> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_org_messages", { p_organization_id: id, p_limit: 150 });
  return rows(data).map((row) => ({
    id: text(row.id),
    createdAt: text(row.created_at),
    direction: text(row.direction),
    status: text(row.status),
    errorCode: text(row.error_code),
    errorDetail: text(row.error_detail),
    sentAt: text(row.sent_at),
    deliveredAt: text(row.delivered_at),
    body: text(row.body),
    hasProviderRef: Boolean(text(row.provider_message_id)),
    customerId: text(row.customer_id),
    customerName: text(row.customer_name),
    customerPhone: text(row.customer_phone),
    jobNumber: row.job_number === null || row.job_number === undefined ? "" : String(row.job_number),
  }));
}

export type OrgInvoice = {
  id: string;
  number: string;
  jobNumber: string;
  status: string;
  totalCents: number;
  balanceDueCents: number;
  dueAt: string;
  paidAt: string;
  lastSentAt: string;
  createdAt: string;
};

export async function listOrgInvoices(id: string): Promise<OrgInvoice[]> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_org_invoices", { p_organization_id: id, p_limit: 150 });
  return rows(data).map((row) => ({
    id: text(row.id),
    number: String(row.invoice_number ?? ""),
    jobNumber: row.job_number === null || row.job_number === undefined ? "" : String(row.job_number),
    status: text(row.status),
    totalCents: count(row.total_cents),
    balanceDueCents: count(row.balance_due_cents),
    dueAt: text(row.due_at),
    paidAt: text(row.paid_at),
    lastSentAt: text(row.last_sent_at),
    createdAt: text(row.created_at),
  }));
}

export type OrgPayment = {
  id: string;
  provider: string;
  status: string;
  amountCents: number;
  paidAt: string;
  createdAt: string;
  jobNumber: string;
  forBooking: boolean;
  providerRef: string;
};

export async function listOrgPayments(id: string): Promise<OrgPayment[]> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_org_payments", { p_organization_id: id, p_limit: 150 });
  return rows(data).map((row) => ({
    id: text(row.id),
    provider: text(row.provider),
    status: text(row.status),
    amountCents: count(row.amount_cents),
    paidAt: text(row.paid_at),
    createdAt: text(row.created_at),
    jobNumber: row.job_number === null || row.job_number === undefined ? "" : String(row.job_number),
    forBooking: Boolean(text(row.booking_request_id)),
    providerRef: text(row.provider_ref),
  }));
}

export async function listOrgActivity(id: string): Promise<(ActivityRow & { jobNumber: string; actorEmail: string })[]> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_org_activity", { p_organization_id: id, p_limit: 150 });
  return rows(data).map((row) => ({
    id: text(row.id),
    eventType: text(row.event_type),
    label: text(row.label),
    createdAt: text(row.created_at),
    metadata:
      row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null,
    jobId: row.job_number === null || row.job_number === undefined ? null : String(row.job_number),
    jobNumber: row.job_number === null || row.job_number === undefined ? "" : String(row.job_number),
    actorEmail: text(row.actor_email),
  }));
}

/** One job and everything attached to it, or null for no such job here. */
export async function getJobTrace(id: string, jobNumber: number): Promise<JobTrace | null> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_job_trace", { p_organization_id: id, p_job_number: jobNumber });
  return parseTrace(data);
}

/** "owner" may change things; "support" may look and check. Null for anybody else. */
export async function myAdminRole(): Promise<"owner" | "support" | null> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_my_role");
  return data === "owner" || data === "support" ? data : null;
}

export type MessageFacts = TextFacts & {
  message: TextFacts["message"] & { conversationId: string; errorDetail: string; sentAt: string; deliveredAt: string };
  operationLog: {
    id: string;
    tool: string;
    state: string;
    createdAt: string;
    finishedAt: string;
    reason: string;
    actor: string;
    result: Record<string, unknown>;
  }[];
};

/** One text and everything that decides what support may do with it, or null. */
export async function getMessageFacts(organizationId: string, messageId: string): Promise<MessageFacts | null> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_message_facts", {
    p_organization_id: organizationId,
    p_message_id: messageId,
  });
  const root = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : null;
  const message = root?.message as Record<string, unknown> | undefined;
  if (!root || !message) return null;
  const customer = root.customer as Record<string, unknown> | null;
  const consent = (root.consent ?? {}) as Record<string, unknown>;
  const job = root.job as Record<string, unknown> | null;
  const messaging = (root.messaging ?? {}) as Record<string, unknown>;
  const operations = rows(root.operations);

  return {
    organizationId,
    message: {
      id: text(message.id),
      organizationId: text(message.organization_id),
      conversationId: text(message.conversation_id),
      direction: text(message.direction),
      status: text(message.status),
      errorCode: text(message.error_code),
      errorDetail: text(message.error_detail),
      body: text(message.body),
      createdAt: text(message.created_at),
      updatedAt: text(message.updated_at),
      sentAt: text(message.sent_at),
      deliveredAt: text(message.delivered_at),
      providerMessageId: text(message.provider_message_id),
    },
    customer: customer ? { id: text(customer.id), name: text(customer.name), phone: text(customer.phone) } : null,
    consent: { optedInAt: text(consent.opted_in_at) || null, optedOutAt: text(consent.opted_out_at) || null },
    job: job ? { jobNumber: String(job.job_number ?? ""), status: text(job.status) } : null,
    messaging: {
      serviceSid: text(messaging.service_sid),
      quietStart: text(messaging.quiet_start) || "21:00:00",
      quietEnd: text(messaging.quiet_end) || "08:00:00",
      timezone: text(messaging.timezone) || "America/Los_Angeles",
    },
    laterSends: rows(root.later_sends).map((row) => ({ status: text(row.status), sameBody: row.same_body === true })),
    recipientFixedAt: text(root.recipient_fixed_at),
    operations: operations.map((row) => ({ tool: text(row.tool), state: text(row.state) })),
    operationLog: operations.map((row) => ({
      id: text(row.id),
      tool: text(row.tool),
      state: text(row.state),
      createdAt: text(row.created_at),
      finishedAt: text(row.finished_at),
      reason: text(row.reason),
      actor: text(row.actor),
      result:
        row.result && typeof row.result === "object" && !Array.isArray(row.result)
          ? (row.result as Record<string, unknown>)
          : {},
    })),
  };
}

export type OperationRow = {
  id: string;
  organizationId: string;
  organizationName: string;
  timeZone: string;
  actorEmail: string;
  tool: string;
  targetType: string;
  targetId: string;
  /** The text a number was corrected from, when there was one. */
  messageId: string;
  reason: string;
  state: string;
  result: Record<string, unknown>;
  createdAt: string;
  finishedAt: string;
};

/** The recovery history, newest first. */
export async function listOperations(filter: { organizationId?: string; tool?: string } = {}): Promise<OperationRow[]> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_operations", {
    p_organization_id: filter.organizationId || null,
    p_tool: filter.tool || null,
    p_limit: 150,
  });
  return rows(data).map((row) => ({
    id: text(row.id),
    organizationId: text(row.organization_id),
    organizationName: text(row.organization_name),
    timeZone: text(row.organization_timezone),
    actorEmail: text(row.actor_email),
    tool: text(row.tool),
    targetType: text(row.target_type),
    targetId: text(row.target_id),
    messageId:
      row.preview && typeof row.preview === "object" && !Array.isArray(row.preview)
        ? text((row.preview as Record<string, unknown>).message)
        : "",
    reason: text(row.reason),
    state: text(row.state),
    result:
      row.result && typeof row.result === "object" && !Array.isArray(row.result)
        ? (row.result as Record<string, unknown>)
        : {},
    createdAt: text(row.created_at),
    finishedAt: text(row.finished_at),
  }));
}
