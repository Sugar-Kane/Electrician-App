"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { zonedWallClockToIso } from "@/lib/schedule-labels";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { isSupportedTimezone } from "@/lib/timezones";

/**
 * Working a support case. Each goes straight to an `admin_case_*` function,
 * which refuses anybody who isn't a platform admin and records the step on the
 * case. A case changed by somebody else since the page was shown is refused
 * rather than overwritten.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(formData: FormData, key: string, max = 4000): string {
  return String(formData.get(key) ?? "").trim().slice(0, max);
}

/** A wall-clock time typed in a zone, as an instant, or "" when there isn't one. */
function instant(local: string, zone: string): string {
  if (!local) return "";
  return zonedWallClockToIso(local, isSupportedTimezone(zone) ? zone : "America/Los_Angeles");
}

/** The database's refusal when it is written for people, else a plain one. */
function why(error: { code?: string; message?: string } | null): string {
  if (!error) return "That didn't save.";
  if (error.code === "PT409" || error.code === "22023") return error.message ?? "That didn't save.";
  if (error.code === "42501") return "Only a Volteira admin can do that.";
  if (error.code === "P0002") return error.message ?? "That couldn't be found.";
  return "That didn't save.";
}

export async function openCase(formData: FormData): Promise<void> {
  const organizationId = field(formData, "organizationId", 64);
  const linkType = field(formData, "linkType", 20);
  const linkId = field(formData, "linkId", 64);
  const zone = field(formData, "zone", 64);
  const back = new URLSearchParams(
    Object.entries({
      org: organizationId,
      type: linkType,
      id: linkId,
      label: field(formData, "linkLabel", 120),
      category: field(formData, "category", 20),
    }).filter(([, value]) => value) as [string, string][],
  );

  const occurredAt = instant(field(formData, "occurredAt", 20), zone) || null;
  const supabase = asFlexibleClient(await createClient());
  const { data, error } = await supabase.rpc("admin_case_open", {
    p_organization_id: UUID.test(organizationId) ? organizationId : null,
    p_category: field(formData, "category", 20),
    p_severity: field(formData, "severity", 20) || "normal",
    p_symptom: field(formData, "symptom", 2000),
    p_steps: field(formData, "steps") || null,
    p_reporter: field(formData, "reporter", 300) || null,
    p_occurred_at: occurredAt,
    // A zone only means something beside a time.
    p_occurred_zone: occurredAt ? zone || null : null,
    p_link_type: linkType && UUID.test(linkId) ? linkType : null,
    p_link_id: linkType && UUID.test(linkId) ? linkId : null,
    p_link_label: field(formData, "linkLabel", 120) || null,
  });
  if (error || typeof data !== "string") {
    back.set("error", why(error));
    redirect(`/admin/cases/new?${back.toString()}`);
  }
  redirect(`/admin/cases/${data}`);
}

function caseTarget(formData: FormData) {
  const caseId = field(formData, "caseId", 64);
  return UUID.test(caseId) ? { caseId, page: `/admin/cases/${caseId}` } : null;
}

/**
 * Back to the case with a word on what happened. Revalidated first: without it
 * a return to an address this tab has seen ("Saved." twice) is drawn from the
 * browser's cache, and the next change carries that copy's stale stamp.
 */
function done(page: string, key: "saved" | "error", message: string): never {
  revalidatePath(page);
  redirect(`${page}?${new URLSearchParams({ [key]: message }).toString()}`);
}

/** Change a case's details; only the fields on the form are sent. */
export async function editCase(formData: FormData): Promise<void> {
  const target = caseTarget(formData);
  if (!target) return;
  const zone = field(formData, "zone", 64);
  const fields: Record<string, string | null> = {};
  for (const key of ["reporter", "category", "severity", "symptom", "steps", "root_cause", "fix", "resolution_evidence"]) {
    if (formData.has(key)) fields[key] = field(formData, key);
  }
  if (formData.has("next_update_due")) fields.next_update_due = instant(field(formData, "next_update_due", 20), zone) || null;
  if (formData.has("occurred_at")) {
    fields.occurred_at = instant(field(formData, "occurred_at", 20), zone) || null;
    // A zone only means something beside a time.
    fields.occurred_zone = fields.occurred_at ? zone || null : null;
  }

  const supabase = asFlexibleClient(await createClient());
  const { error } = await supabase.rpc("admin_case_edit", {
    p_case_id: target.caseId,
    p_expected_updated_at: field(formData, "updatedAt", 64) || null,
    p_fields: fields,
  });
  if (error) done(target.page, "error", why(error));
  done(target.page, "saved", "Saved.");
}

export async function moveCase(formData: FormData): Promise<void> {
  const target = caseTarget(formData);
  if (!target) return;
  const supabase = asFlexibleClient(await createClient());
  const { error } = await supabase.rpc("admin_case_move", {
    p_case_id: target.caseId,
    p_expected_updated_at: field(formData, "updatedAt", 64) || null,
    p_to_state: field(formData, "to", 20),
    p_note: field(formData, "note") || null,
  });
  if (error) done(target.page, "error", why(error));
  done(target.page, "saved", "Moved.");
}

export async function assignCase(formData: FormData): Promise<void> {
  const target = caseTarget(formData);
  if (!target) return;
  const assignee = field(formData, "assignee", 64);
  const supabase = asFlexibleClient(await createClient());
  const { error } = await supabase.rpc("admin_case_assign", {
    p_case_id: target.caseId,
    p_assignee: UUID.test(assignee) ? assignee : null,
  });
  if (error) done(target.page, "error", why(error));
  done(target.page, "saved", UUID.test(assignee) ? "Assigned." : "Unassigned.");
}

export async function noteCase(formData: FormData): Promise<void> {
  const target = caseTarget(formData);
  if (!target) return;
  const supabase = asFlexibleClient(await createClient());
  const { error } = await supabase.rpc("admin_case_note", { p_case_id: target.caseId, p_body: field(formData, "body") });
  if (error) done(target.page, "error", why(error));
  done(target.page, "saved", "Note added.");
}
