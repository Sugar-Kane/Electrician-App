/**
 * Reading the support console.
 *
 * Every function here is one RPC. None of them widen a tenant policy — the
 * database refuses a caller who is not a platform admin, so this module holds
 * shapes and formatting rather than any decision about who may look.
 */

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

export type AuditEntry = {
  id: string;
  createdAt: string;
  adminEmail: string;
  action: string;
  organizationId: string;
  organizationName: string;
  detail: string;
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

/** Records that this business's records were opened. Best effort. */
export async function recordOrganizationView(id: string): Promise<void> {
  const supabase = await client();
  await supabase.rpc("admin_open_organization", { p_organization_id: id });
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
    return {
      channel: text(row.channel),
      to: text(row.to),
      audience: text(row.audience),
      ok: row.ok === true,
      detail: text(row.detail),
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

export async function listAuditTrail(limit = 100): Promise<AuditEntry[]> {
  const supabase = await client();
  const { data } = await supabase.rpc("admin_audit_trail", { p_limit: limit });

  return rows(data).map((row) => ({
    id: text(row.id),
    createdAt: text(row.created_at),
    adminEmail: text(row.admin_email),
    action: text(row.action),
    organizationId: text(row.organization_id),
    organizationName: text(row.organization_name),
    detail: JSON.stringify(row.detail ?? {}),
  }));
}
