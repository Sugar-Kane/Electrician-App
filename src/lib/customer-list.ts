import "server-only";

import { currentContext } from "@/lib/request-context";
import { createClient } from "@/lib/supabase/server";
import { asFlexibleClient } from "@/lib/supabase/flexible";

/**
 * Every customer the business has, for the Customers list.
 *
 * Read through the caller's own session, so row security decides whose
 * customers these are. Each carries what somebody scanning the list looks
 * for: how to reach them, where the work is, and the last job.
 */

export type CustomerListItem = {
  id: string;
  name: string;
  /** "es" when the customer speaks Spanish. */
  language: "en" | "es";
  phone: string;
  email: string;
  address: string;
  lastJob: { number: string; when: string; at: string } | null;
  jobCount: number;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function getCustomerList(): Promise<CustomerListItem[]> {
  const context = await currentContext();
  if (!context) return [];

  const supabase = asFlexibleClient(await createClient());
  const { data, error } = await supabase
    .from("customers")
    .select(
      `id, first_name, last_name, company_name, phone, email, created_at, preferred_language,
       properties ( address_line_1, city, archived_at ),
       jobs ( job_number, scheduled_start, created_at, archived_at )`,
    )
    .eq("organization_id", context.organizationId)
    .is("archived_at", null)
    // New calls and texts wait under "New contacts" until the owner keeps them.
    .eq("pending_review", false)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return [];

  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: context.timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const properties = ((row.properties ?? []) as Record<string, unknown>[]).filter((p) => !p.archived_at);
    const jobs = ((row.jobs ?? []) as Record<string, unknown>[])
      .filter((job) => !job.archived_at)
      .map((job) => ({
        number: String(job.job_number ?? ""),
        // A job with no time yet still happened when it was written down.
        at: text(job.scheduled_start) || text(job.created_at),
        scheduled: Boolean(job.scheduled_start),
      }))
      .sort((a, b) => b.at.localeCompare(a.at));
    const last = jobs[0];
    const property = properties[0];

    return {
      id: text(row.id),
      name:
        text(row.company_name) ||
        [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ") ||
        "Unnamed customer",
      language: row.preferred_language === "es" ? "es" : "en",
      phone: text(row.phone),
      email: text(row.email),
      address: property ? [text(property.address_line_1), text(property.city)].filter(Boolean).join(", ") : "",
      lastJob: last
        ? {
            number: last.number,
            when: last.at ? `${last.scheduled ? "" : "Added "}${day.format(new Date(last.at))}` : "",
            at: last.at,
          }
        : null,
      jobCount: jobs.length,
    };
  });
}

/**
 * Numbers that called or texted on their own and are waiting for the owner:
 * Keep makes them a customer, Delete archives them. Spam lives here instead
 * of in the Customers list. Each shows what they last texted, so the owner
 * can tell a person from a robot without opening the conversation.
 */
export type PendingContact = {
  id: string;
  name: string;
  phone: string;
  /** "Texted" or "Called", from how the contact was first saved. */
  how: string;
  when: string;
  lastText: string;
  conversationId: string;
};

export async function getPendingContacts(): Promise<PendingContact[]> {
  const context = await currentContext();
  if (!context) return [];

  const supabase = asFlexibleClient(await createClient());
  const { data, error } = await supabase
    .from("customers")
    .select("id, first_name, last_name, company_name, phone, notes, created_at, conversations ( id, last_message_at, archived_at )")
    .eq("organization_id", context.organizationId)
    .is("archived_at", null)
    .eq("pending_review", true)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];

  const rows = data as Record<string, unknown>[];
  const conversationOf = new Map<string, string>();
  for (const row of rows) {
    const open = ((row.conversations ?? []) as Record<string, unknown>[])
      .filter((conversation) => !conversation.archived_at)
      .sort((a, b) => text(b.last_message_at).localeCompare(text(a.last_message_at)))[0];
    if (open) conversationOf.set(text(row.id), text(open.id));
  }

  const lastText = new Map<string, string>();
  const ids = [...conversationOf.values()];
  if (ids.length > 0) {
    const { data: messages } = await supabase
      .from("messages")
      .select("conversation_id, body, created_at")
      .eq("organization_id", context.organizationId)
      .eq("direction", "inbound")
      .in("conversation_id", ids)
      .order("created_at", { ascending: false })
      .limit(200);
    for (const message of (messages ?? []) as Record<string, unknown>[]) {
      const id = text(message.conversation_id);
      if (!lastText.has(id)) lastText.set(id, text(message.body));
    }
  }

  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: context.timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return rows.map((row) => {
    const id = text(row.id);
    const conversationId = conversationOf.get(id) ?? "";
    const createdAt = text(row.created_at);
    return {
      id,
      name:
        text(row.company_name) ||
        [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ") ||
        "Unknown",
      phone: text(row.phone),
      how: /text message/i.test(text(row.notes)) ? "Texted" : "Called",
      when: createdAt ? day.format(new Date(createdAt)) : "",
      lastText: (conversationId ? lastText.get(conversationId) : "") ?? "",
      conversationId,
    };
  });
}
