"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { FileText, LoaderCircle } from "lucide-react";
import Link from "next/link";

import { generateContract, type ContractState } from "@/app/jobs/[jobId]/contract-actions";
import { FormMessage } from "@/components/ui/field";

/**
 * The contract for this job.
 *
 * Generating and sending are separate, and stay separate. A contract that goes
 * out the moment it is generated is a contract nobody read, and the scope
 * paragraph is the part most worth reading.
 */

const initialState: ContractState = { error: "" };

function GenerateButton({ existing }: { existing: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target inline-flex items-center gap-2 rounded-control border border-line px-4 text-sm font-semibold disabled:opacity-60"
    >
      {pending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <FileText className="h-4 w-4" aria-hidden />
      )}
      {pending ? "Writing" : existing ? "Generate another draft" : "Generate contract"}
    </button>
  );
}

export function JobContract({
  jobNumber,
  contracts,
}: {
  jobNumber: string;
  contracts: { id: string; createdLabel: string; body: string; unfilled: string[] }[];
}) {
  const [state, action] = useActionState(generateContract, initialState);
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="rounded-panel border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Contract</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Built from{" "}
            <Link href="/settings/contract" className="font-semibold text-brand">
              your own contract
            </Link>
            , with this job&rsquo;s details filled in.
          </p>
        </div>

        <form action={action}>
          <input type="hidden" name="jobNumber" value={jobNumber} />
          <GenerateButton existing={contracts.length > 0} />
        </form>
      </div>

      <div className="mt-3">
        <FormMessage error={state.error} notice={state.notice} />
      </div>

      {contracts.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {contracts.map((contract) => (
            <li key={contract.id} className="rounded-control border border-line">
              <button
                type="button"
                onClick={() => setOpen(open === contract.id ? null : contract.id)}
                aria-expanded={open === contract.id}
                className="tap-target flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">
                    Draft · {contract.createdLabel}
                  </span>
                  {contract.unfilled.length > 0 ? (
                    <span className="mt-0.5 block text-xs text-caution">
                      {contract.unfilled.length}{" "}
                      {contract.unfilled.length === 1 ? "blank" : "blanks"} left to fill in
                    </span>
                  ) : (
                    <span className="mt-0.5 block text-xs text-ink-faint">Complete</span>
                  )}
                </span>
                <span className="shrink-0 text-xs font-semibold text-brand">
                  {open === contract.id ? "Hide" : "Read"}
                </span>
              </button>

              {open === contract.id ? (
                <pre className="overflow-x-auto whitespace-pre-wrap border-t border-line px-4 py-3 text-xs leading-6 text-ink-muted">
                  {contract.body}
                </pre>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
