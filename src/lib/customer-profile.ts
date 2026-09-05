import "server-only";

import type { ActivityRow } from "@/lib/activity-timeline";
import {
  readLanguage,
  readLanguageSource,
  type LanguageState,
} from "@/lib/customer-language";
import { currentContext } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { toE164 } from "@/lib/phone-format";

/**
 * One customer, read for their own page.
 *
 * Everything on it already existed and was only reachable through something
 * else — the jobs through the schedule, the conversation through the inbox, the
 * inquiry through the booking-requests list. Nothing new is stored; this is the
 * query that puts a person's own records in one place, which is what makes
 * "open that customer" from search a real destination.
 */

export type CustomerProfile = {
  id: string;
  name: string;
  phone: string;
  email: string;
  preferredContact: string;
  /** The first service address, for the page's subtitle. */
  address: string;
  properties: { id: string; address: string; accessNotes: string }[];
  jobs: { id: string; number: string; when: string; summary: string; status: string }[];
  openRequests: { id: string; summary: string; status: string }[];
  /** Their thread, whatever the inbox has been told to show. */
  conversationId: string | null;
  /** The business's timezone, which is the one the history is grouped by. */
  timeZone: string;
  /** Which language they are written to in, and who decided. */
  language: LanguageState;
  /** Recorded inbound calls, newest first. Audio is served through an authenticated route. */
  recordings: {
    sid: string;
    startedAt: string;
    durationSeconds: number | null;
    channels: number | null;
  }[];
  /** What has happened to them, newest first, ready for `buildTimeline`. */
  history: ActivityRow[];
};

const OPEN_REQUEST_STATUSES = ["new", "needs_review", "awaiting_payment", "safety_escalated"];

const REQUEST_LABELS: Record<string, string> = {
  new: "New request",
  needs_review: "Needs review",
  awaiting_payment: "Waiting on payment",
  safety_escalated: "Safety — needs attention",
};

const JOB_LABELS: Record<string, string> = {
  draft: "Pending",
  awaiting_payment: "Pending",
  confirmed: "Scheduled",
  assigned: "Scheduled",
  rescheduled: "Scheduled",
  needs_review: "In progress",
  en_route: "In progress",
  arrived: "In progress",
  in_progress: "In progress",
  completed: "Completed",
  canceled: "Canceled",
  no_show: "Canceled",
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function getCustomerProfile(customerId: string): Promise<CustomerProfile | null> {
  const id = customerId.trim();
  // A path segment goes straight into a uuid comparison, and Postgres rejects a
  // malformed one with an error rather than an empty result.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const context = await currentContext();
  if (!context) return null;

  const supabase = asFlexibleClient(await createClient());

  const { data: customer } = await supabase
    .from("customers")
    .select(
      "id, first_name, last_name, company_name, phone, email, preferred_contact, preferred_language, language_source",
    )
    .eq("organization_id", context.organizationId)
    .eq("id", id)
    .maybeSingle();

  if (!customer) return null;

  const customerPhone = text(customer.phone);
  const recordedFrom = toE164(customerPhone);

  const [
    { data: properties },
    { data: jobs },
    { data: requests },
    { data: conversation },
    { data: recordings },
    { data: history },
  ] = await Promise.all([
      supabase
        .from("properties")
        .select("id, address_line_1, address_line_2, city, state, postal_code, access_notes")
        .eq("organization_id", context.organizationId)
        .eq("customer_id", id)
        .is("archived_at", null),
      supabase
        .from("jobs")
        .select("id, job_number, status, scheduled_start, category, customer_description")
        .eq("organization_id", context.organizationId)
        .eq("customer_id", id)
        .is("archived_at", null)
        .order("scheduled_start", { ascending: false, nullsFirst: false })
        .limit(20),
      supabase
        .from("booking_requests")
        .select("id, status, description, category")
        .eq("organization_id", context.organizationId)
        .eq("customer_id", id)
        .in("status", OPEN_REQUEST_STATUSES)
        .order("created_at", { ascending: false })
        .limit(10),
      // Blind to archived_at and deleted_at on purpose: the customer's thread is
      // the customer's thread, whatever somebody has done to their own inbox.
      supabase
        .from("conversations")
        .select("id")
        .eq("organization_id", context.organizationId)
        .eq("customer_id", id)
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      recordedFrom
        ? supabase
            .from("inbound_calls")
            .select(
              "recording_sid, recording_status, recording_channels, recording_started_at, started_at, duration_seconds",
            )
            .eq("organization_id", context.organizationId)
            .eq("from_number", recordedFrom)
            .eq("recording_status", "completed")
            .not("recording_sid", "is", null)
            .order("recording_started_at", { ascending: false, nullsFirst: false })
            .limit(20)
        : Promise.resolve({ data: [] }),
      // Everything that has happened to this person, whichever part of the app
      // it happened in. Capped: a history is for reading, and nobody reads the
      // hundredth entry.
      supabase
        .from("activity_events")
        .select("id, event_type, label, created_at, metadata, job_id")
        .eq("organization_id", context.organizationId)
        .eq("customer_id", id)
        .order("created_at", { ascending: false })
        .limit(60),
    ]);

  const addressOf = (row: Record<string, unknown>) =>
    [
      text(row.address_line_1),
      text(row.address_line_2),
      text(row.city),
      [text(row.state), text(row.postal_code)].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(", ");

  const propertyList = ((properties ?? []) as Record<string, unknown>[]).map((row) => ({
    id: text(row.id),
    address: addressOf(row),
    accessNotes: text(row.access_notes),
  }));

  const when = (value: unknown) => {
    if (!value) return "Not scheduled";
    return new Intl.DateTimeFormat("en-US", {
      timeZone: context.timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(String(value)));
  };

  return {
    id,
    name:
      text(customer.company_name) ||
      [text(customer.first_name), text(customer.last_name)].filter(Boolean).join(" ") ||
      "Unnamed customer",
    phone: customerPhone,
    email: text(customer.email),
    preferredContact: text(customer.preferred_contact),
    address: propertyList[0]?.address ?? "",
    properties: propertyList,
    jobs: ((jobs ?? []) as Record<string, unknown>[]).map((row) => ({
      id: text(row.id),
      number: String(row.job_number ?? ""),
      when: when(row.scheduled_start),
      summary: text(row.customer_description) || text(row.category) || "No description",
      status: JOB_LABELS[text(row.status)] ?? "Pending",
    })),
    openRequests: ((requests ?? []) as Record<string, unknown>[]).map((row) => ({
      id: text(row.id),
      summary: text(row.description) || text(row.category) || "Service request",
      status: REQUEST_LABELS[text(row.status)] ?? text(row.status),
    })),
    conversationId: conversation?.id ? String(conversation.id) : null,
    timeZone: context.timeZone,
    language: {
      language: readLanguage(customer.preferred_language),
      source: readLanguageSource(customer.language_source),
    },
    recordings: ((recordings ?? []) as Record<string, unknown>[])
      .map((row) => ({
        sid: text(row.recording_sid),
        startedAt: text(row.recording_started_at) || text(row.started_at),
        durationSeconds:
          typeof row.duration_seconds === "number" ? row.duration_seconds : null,
        channels:
          typeof row.recording_channels === "number" ? row.recording_channels : null,
      }))
      .filter((row) => Boolean(row.sid)),
    history: ((history ?? []) as Record<string, unknown>[]).map((row) => ({
      id: text(row.id),
      eventType: text(row.event_type),
      label: text(row.label),
      createdAt: text(row.created_at),
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      jobId: row.job_id ? text(row.job_id) : null,
    })),
  };
}
