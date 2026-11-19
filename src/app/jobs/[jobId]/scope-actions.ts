"use server";

import { revalidatePath } from "next/cache";

import { takeAiUse } from "@/lib/ai-allowance";
import { draftScope } from "@/lib/claude";
import { cleanScope } from "@/lib/job-scope";
import { saveJobScope, scopeWorkItems } from "@/lib/job-scope-server";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * The scope of work on a job's Estimate card: typed, or drafted from the work
 * and materials lines. Saved on the job, where the contract and the estimate
 * read it, and written into the job's unsigned contract straight away so the
 * draft Nick is looking at says the same thing.
 *
 * Through the caller's own session, so row security keeps it to their business.
 */

export type ScopeState = { error: string; notice?: string; draft?: string };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function loadJob(jobNumber: string) {
  const context = await currentContext();
  if (!context) return null;
  const numeric = Number(jobNumber);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  const supabase = asFlexibleClient(await createClient());
  const { data } = await supabase
    .from("jobs")
    .select("id, category, customer_description, job_line_items ( kind, description, quantity, unit )")
    .eq("organization_id", context.organizationId)
    .eq("job_number", numeric)
    .maybeSingle();
  if (!data) return null;
  return { context, supabase, job: data as Record<string, unknown> };
}

/** A first draft from the lines, put in the box for the electrician to read and save. Saves nothing. */
export async function draftJobScopeAction(_previous: ScopeState, formData: FormData): Promise<ScopeState> {
  const loaded = await loadJob(text(formData.get("jobNumber")));
  if (!loaded) return { error: "That job could not be found." };
  const { context, job } = loaded;

  const items = scopeWorkItems(job.job_line_items);
  const description = text(job.customer_description).trim();
  if (items.length === 0 && description.length < 10) {
    return { error: "Add the work and materials first, or type the scope yourself." };
  }

  const allowance = await takeAiUse(context.organizationId, "contract_scope");
  if (!allowance.ok) return { error: allowance.message };

  const drafted = await draftScope({
    description,
    workType: text(job.category).replace(/_/g, " ") || "electrical work",
    workItems: items,
  });
  if (!drafted) return { error: "A summary could not be written just now. Type the scope instead." };
  return { error: "", draft: cleanScope(drafted), notice: "Drafted. Read it, change anything, then Save." };
}

export async function saveJobScopeAction(_previous: ScopeState, formData: FormData): Promise<ScopeState> {
  const jobNumber = text(formData.get("jobNumber"));
  const loaded = await loadJob(jobNumber);
  if (!loaded) return { error: "That job could not be found." };
  const { context, supabase, job } = loaded;

  const saved = await saveJobScope(supabase, {
    organizationId: context.organizationId,
    jobId: text(job.id),
    scope: text(formData.get("scope")),
    timeZone: context.timeZone,
    uploadedBy: context.userId ?? "",
  });
  if (!saved.ok) return { error: saved.message };

  revalidatePath(`/jobs/${jobNumber}`);
  return { error: "", notice: saved.scope ? `Saved.${saved.contractNote}` : "Scope cleared." };
}
