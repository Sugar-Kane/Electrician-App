import "server-only";

import { canEditContract, spliceScope } from "@/lib/document-edit";
import { cleanScope, workItemLabel } from "@/lib/job-scope";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Saving a job's scope of work, from the job page or from ChatGPT: on the job,
 * where the contract and the estimate read it, and into the job's newest
 * contract while it can still be edited (the scope paragraph replaced, the PDF
 * rebuilt). A sent or signed contract is left as the customer has it.
 *
 * The caller has already found the job in its own business.
 */

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export type ScopeSaveResult = { ok: false; message: string } | { ok: true; scope: string; contractNote: string };

export async function saveJobScope(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; jobId: string; scope: string; timeZone: string; uploadedBy: string },
): Promise<ScopeSaveResult> {
  if (input.scope.trim().length > 2000) return { ok: false, message: "That is longer than the scope holds. Trim it a little." };
  const scope = cleanScope(input.scope);

  const { error } = await database
    .from("jobs")
    .update({ scope_of_work: scope || null })
    .eq("id", input.jobId)
    .eq("organization_id", input.organizationId);
  if (error) {
    console.error("job scope save failed", error);
    return { ok: false, message: "The scope could not be saved. Try again." };
  }

  let contractNote = "";
  if (scope) {
    const { data: found } = await database
      .from("contracts")
      .select("id, body, scope, status, kind")
      .eq("organization_id", input.organizationId)
      .eq("job_id", input.jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const contract = (found ?? null) as Record<string, unknown> | null;
    const flat = scope.replace(/\s+/g, " ");
    if (contract && text(contract.kind) !== "change_order" && canEditContract({ status: text(contract.status) || "draft" }).ok) {
      const current = text(contract.scope);
      const body = current ? spliceScope(text(contract.body), current, flat) : null;
      if (body && current !== flat) {
        const { error: contractError } = await database
          .from("contracts")
          .update({ body, scope: flat, updated_at: new Date().toISOString() })
          .eq("id", text(contract.id))
          .eq("organization_id", input.organizationId);
        if (!contractError) {
          let rebuilt = false;
          if (input.uploadedBy) {
            const { generateContractPdf } = await import("@/lib/pdf/contract-data");
            const result = await generateContractPdf({
              database,
              organizationId: input.organizationId,
              contractId: text(contract.id),
              timeZone: input.timeZone,
              uploadedBy: input.uploadedBy,
            });
            rebuilt = !result.error;
          }
          contractNote = rebuilt
            ? " The draft contract is updated too."
            : " The draft contract's wording is updated; rebuild its PDF from the contract.";
        }
      } else if (!body && current !== flat) {
        contractNote = " Draft the contract again to use it.";
      }
    }
  }

  return { ok: true, scope, contractNote };
}

/** The job's lines as the scope is written from them: "Labour: … (3 hr)". */
export function scopeWorkItems(lines: unknown): string[] {
  return (Array.isArray(lines) ? (lines as Record<string, unknown>[]) : []).map(workItemLabel).filter(Boolean);
}
