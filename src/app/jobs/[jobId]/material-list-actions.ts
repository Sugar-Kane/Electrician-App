"use server";

import { normalizeMaterialList } from "@/lib/material-list";
import { readMaterialList, writeMaterialList, type SavedMaterialList } from "@/lib/material-list-server";
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

export type MaterialListActionState = {
  error: string;
  /** The version now kept, to send with the next change. */
  updatedAt?: string | null;
  /** The list as it is now, when it was changed somewhere else first. */
  current?: SavedMaterialList;
};

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

/**
 * Keep a hand edit, made on the version `expectedUpdatedAt` (null: there was
 * no list yet). If the list was changed somewhere else since, the edit is not
 * kept and the list as it is now comes back instead.
 */
export async function saveMaterialList(
  jobNumber: string,
  raw: unknown,
  expectedUpdatedAt: string | null,
): Promise<MaterialListActionState> {
  const list = normalizeMaterialList(raw);
  if (!list) return { error: "That list could not be read." };
  const context = await jobFor(jobNumber);
  if (!context) return { error: "That job could not be found." };
  const write = await writeMaterialList(context.supabase, {
    ...context,
    list,
    expectedUpdatedAt: typeof expectedUpdatedAt === "string" ? expectedUpdatedAt : null,
  });
  if (write.status === "saved") return { error: "", updatedAt: write.updatedAt };
  if (write.status === "changed") {
    return {
      error: "This list was changed somewhere else, so that edit was not kept. This is the list as it is now.",
      current: await readMaterialList(context.supabase, context.jobId),
    };
  }
  return { error: "The change could not be saved. Try again." };
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
