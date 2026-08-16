"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Download, FileText, LoaderCircle, RefreshCw } from "lucide-react";
import Link from "next/link";

import {
  generateContract,
  rebuildContractPdf,
  type ContractState,
} from "@/app/jobs/[jobId]/contract-actions";
import { PdfViewer } from "@/components/pdf-viewer";
import { FormMessage } from "@/components/ui/field";
import type { JobContract as JobContractRecord } from "@/lib/job-data";

/**
 * The contract for this job.
 *
 * Generating and sending are separate, and stay separate. A contract that goes
 * out the moment it is generated is a contract nobody read, and the scope
 * paragraph is the part most worth reading.
 *
 * What "read" means changed. It used to open the filled template as preformatted
 * text, which is a developer's view of a contract — fine for checking a
 * placeholder was substituted, no use at all as the thing somebody is asked to
 * sign, and nothing like what the customer receives. Now it opens the document.
 *
 * The text is still reachable, one tap further in, because a screen reader gets
 * far more out of the words than out of a canvas, and because somebody checking
 * for a stray {{placeholder}} wants to search rather than squint.
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

/** One draft, with its document behind the row that names it. */
function ContractRow({
  contract,
  jobNumber,
  current,
  open,
  onToggle,
}: {
  contract: JobContractRecord;
  jobNumber: string;
  /** The newest draft. The others are labelled as superseded. */
  current: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const [state, rebuild, rebuilding] = useActionState(rebuildContractPdf, initialState);
  const [showText, setShowText] = useState(false);

  return (
    <li className="rounded-control border border-line">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="tap-target flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">
            {current ? "Draft" : "Superseded draft"} · {contract.createdLabel}
          </span>
          {contract.unfilled.length > 0 ? (
            <span className="mt-0.5 block text-xs text-caution">
              {contract.unfilled.length} {contract.unfilled.length === 1 ? "blank" : "blanks"} left
              to fill in
            </span>
          ) : (
            <span className="mt-0.5 block text-xs text-ink-faint">
              {contract.document ? "Ready to send" : "Complete"}
            </span>
          )}
        </span>
        <span className="shrink-0 text-xs font-semibold text-brand">{open ? "Hide" : "Open"}</span>
      </button>

      {open ? (
        <div className="border-t border-line p-3">
          {contract.document ? (
            <>
              <PdfViewer url={contract.document.url} fileName={contract.document.fileName} />

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {/*
                  A plain download rather than a share sheet: `download` with a
                  filename behaves the same on a desktop, an Android phone and an
                  iPhone, and on iOS it hands the file to the share sheet anyway,
                  which is where somebody emails it from.
                */}
                <a
                  href={contract.document.url}
                  download={contract.document.fileName}
                  className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand"
                >
                  <Download className="h-4 w-4" aria-hidden />
                  Download
                </a>

                <button
                  type="button"
                  onClick={() => setShowText((value) => !value)}
                  aria-expanded={showText}
                  className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-semibold"
                >
                  {showText ? "Hide text version" : "Text version"}
                </button>
              </div>
            </>
          ) : (
            /*
              A contract drafted before documents existed, or one whose render
              failed. The words are safe either way — they were frozen when the
              draft was written — so this lays them out again rather than
              redrafting anything.
            */
            <form action={rebuild} className="rounded-control border border-line bg-surface p-4">
              <p className="text-sm leading-6 text-ink-muted">
                This draft has no PDF yet. Building one lays out the text below exactly as it
                stands — nothing is rewritten.
              </p>
              <input type="hidden" name="contractId" value={contract.id} />
              <input type="hidden" name="jobNumber" value={jobNumber} />
              <button
                type="submit"
                disabled={rebuilding}
                className="tap-target mt-3 inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60"
              >
                {rebuilding ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <RefreshCw className="h-4 w-4" aria-hidden />
                )}
                {rebuilding ? "Building…" : "Build the PDF"}
              </button>
              {state.error ? <p className="mt-2 text-sm text-critical">{state.error}</p> : null}
            </form>
          )}

          {showText || !contract.document ? (
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-control bg-sunken px-3 py-3 text-xs leading-6 text-ink-muted">
              {contract.body}
            </pre>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function JobContract({
  jobNumber,
  contracts,
}: {
  jobNumber: string;
  contracts: JobContractRecord[];
}) {
  const [state, action] = useActionState(generateContract, initialState);
  // The newest draft is open on arrival. It is the one somebody came here to
  // look at, and a list of collapsed rows with the document one tap away is the
  // plain-text view again with extra steps.
  const [open, setOpen] = useState<string | null>(contracts[0]?.id ?? null);

  return (
    <section>
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
          {contracts.map((contract, index) => (
            <ContractRow
              key={contract.id}
              contract={contract}
              jobNumber={jobNumber}
              current={index === 0}
              open={open === contract.id}
              onToggle={() => setOpen(open === contract.id ? null : contract.id)}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
