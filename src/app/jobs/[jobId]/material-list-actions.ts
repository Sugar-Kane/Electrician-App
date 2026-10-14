"use server";

import { normalizeMaterialList } from "@/lib/material-list";
import { writeMaterialList } from "@/lib/material-list-server";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Edits to a job's materials list made by hand: an item tapped and changed,
 * removed, or added, or the whole list cleared to start again.
 *
 * Through the caller's session, so the list's policies decide whose it is.
 * The browser sends the whole list; it is checked into shape before it is kept.
 */

export type MaterialListActionState = { error: string };

async function jobFor(jobNumber: string) {
  const caller = await currentContext();
  const number = Number(jobNumber);
  if (!caller || !Number.isInteger(number)) return null;
  const { organizationId, userId } = caller;
  const supabase = asFlexibleClient(await createClient());
  const { data: job } = await supabase
    .from("jobs")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("job_number", number)
    .maybeSingle();
  const jobId = typeof job?.id === "string" ? job.id : "";
  return jobId ? { supabase, organizationId, jobId, userId } : null;
}

export async function saveMaterialList(jobNumber: string, raw: unknown): Promise<MaterialListActionState> {
  const list = normalizeMaterialList(raw);
  if (!list) return { error: "That list could not be read." };
  const context = await jobFor(jobNumber);
  if (!context) return { error: "That job could not be found." };
  const saved = await writeMaterialList(context.supabase, { ...context, list });
  return saved ? { error: "" } : { error: "The change could not be saved. Try again." };
}

export async function clearMaterialList(jobNumber: string): Promise<MaterialListActionState> {
  const context = await jobFor(jobNumber);
  if (!context) return { error: "That job could not be found." };
  const { error } = await context.supabase
    .from("job_material_lists")
    .delete()
    .eq("job_id", context.jobId)
    .eq("organization_id", context.organizationId);
  return error ? { error: "The list could not be cleared. Try again." } : { error: "" };
}
