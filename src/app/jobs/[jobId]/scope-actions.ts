"use server";

import { revalidatePath } from "next/cache";

import { takeAiUse } from "@/lib/ai-allowance";
import { draftScope } from "@/lib/claude";
import { canEditContract, spliceScope } from "@/lib/document-edit";
import { cleanScope, workItemLabel } from "@/lib/job-scope";
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

  const items = (Array.isArray(job.job_line_items) ? (job.job_line_items as Record<string, unknown>[]) : [])
    .map(workItemLabel)
    .filter(Boolean);
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
  const raw = text(formData.get("scope"));
  if (raw.trim().length > 2000) return { error: "That is longer than the scope holds. Trim it a little." };
  const scope = cleanScope(raw);

  const loaded = await loadJob(jobNumber);
  if (!loaded) return { error: "That job could not be found." };
  const { context, supabase, job } = loaded;

  const { error } = await supabase
    .from("jobs")
    .update({ scope_of_work: scope || null })
    .eq("id", text(job.id))
    .eq("organization_id", context.organizationId);
  if (error) {
    console.error("job scope save failed", error);
    return { error: "The scope could not be saved. Try again." };
  }

  // The newest contract, while it can still be edited: the new scope replaces
  // its scope paragraph and the PDF is rebuilt. A signed or sent one is left
  // as the customer has it.
  let contractNote = "";
  if (scope) {
    const { data: found } = await supabase
      .from("contracts")
      .select("id, body, scope, status, kind")
      .eq("organization_id", context.organizationId)
      .eq("job_id", text(job.id))
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const contract = (found ?? null) as Record<string, unknown> | null;
    const flat = scope.replace(/\s+/g, " ");
    if (contract && text(contract.kind) !== "change_order" && canEditContract({ status: text(contract.status) || "draft" }).ok) {
      const current = text(contract.scope);
      const body = current ? spliceScope(text(contract.body), current, flat) : null;
      if (body && current !== flat) {
        const { error: contractError } = await supabase
          .from("contracts")
          .update({ body, scope: flat, updated_at: new Date().toISOString() })
          .eq("id", text(contract.id))
          .eq("organization_id", context.organizationId);
        if (!contractError) {
          const { generateContractPdf } = await import("@/lib/pdf/contract-data");
          const rebuilt = await generateContractPdf({
            database: supabase,
            organizationId: context.organizationId,
            contractId: text(contract.id),
            timeZone: context.timeZone,
            uploadedBy: context.userId ?? "",
          });
          contractNote = rebuilt.error ? " The draft contract's wording is updated; rebuild its PDF from the contract." : " The draft contract is updated too.";
        }
      } else if (!body && current !== flat) {
        contractNote = " Draft the contract again to use it.";
      }
    }
  }

  revalidatePath(`/jobs/${jobNumber}`);
  return { error: "", notice: scope ? `Saved.${contractNote}` : "Scope cleared." };
}
