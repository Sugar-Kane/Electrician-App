"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  CheckCircle2,
  ChevronDown,
  Download,
  FileText,
  LoaderCircle,
  MessageSquare,
  PenLine,
  RefreshCw,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  completeContractDetails,
  generateContract,
  rebuildContractPdf,
  sendSigningLink,
  signForBusiness,
  type ContractState,
} from "@/app/jobs/[jobId]/contract-actions";
import { PdfViewer } from "@/components/pdf-viewer";
import { SignaturePad } from "@/components/signature-pad";
import { FormMessage } from "@/components/ui/field";
import { CONTRACT_ANCHOR, revealContract } from "@/lib/contract-anchor";
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

function SendLinkButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-semibold disabled:opacity-60"
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <MessageSquare className="h-4 w-4" aria-hidden />}
      {pending ? "Sending…" : "Send for signing"}
    </button>
  );
}

function MissingContractDetails({ contract }: { contract: JobContractRecord }) {
  const [state, save, pending] = useActionState(completeContractDetails, initialState);
  return (
    <form action={save} className="space-y-3 rounded-control border border-line p-3">
      <input type="hidden" name="contractId" value={contract.id} />
      <p className="text-sm font-semibold">Complete contract details</p>
      <p className="text-xs text-ink-muted">These values apply to this contract only. Saving creates a new draft for review.</p>
      {contract.unfilled.map((field) => (
        <label key={field} className="block text-sm">
          <span className="mb-1 block capitalize">{field === "total" ? "Agreed total price" : field.replace(/_/g, " ")}</span>
          <textarea name={`field:${field}`} required maxLength={5000} rows={field === "scope" ? 4 : 2}
            placeholder={field === "total" || field === "deposit" ? "e.g. $180.00" : undefined}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-base text-ink" />
        </label>
      ))}
      <button type="submit" disabled={pending} className="tap-target inline-flex min-h-12 w-full items-center justify-center rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60">
        {pending ? "Saving…" : "Save contract details"}
      </button>
      <FormMessage error={state.error} notice={state.notice} />
    </form>
  );
}

function SignInPersonButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60"
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <PenLine className="h-4 w-4" aria-hidden />}
      Sign in person
    </button>
  );
}

/** Who signed for the business, once somebody has — it happens as the contract goes out. */
function BusinessSigned({ contract }: { contract: JobContractRecord }) {
  if (!contract.businessSignedLabel) return null;
  return (
    <p className="flex items-start gap-2 text-xs text-ink-muted">
      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-positive" aria-hidden />
      <span>
        Signed for the business by {contract.businessSignedBy} · {contract.businessSignedLabel}
      </span>
    </p>
  );
}

/**
 * Getting the customer's signature: at the door, or by text.
 *
 * Both end in the same place — the one signing action, keyed by the contract's
 * token — so a signature taken on this phone and one taken from a text are
 * recorded identically. Only how the customer reached the pad differs.
 *
 * Either way the business signs first, with the signature of whoever is
 * sending it or holding out the phone, so the contract the customer sees
 * already carries it.
 */
function ContractSigning({
  contract,
  jobNumber,
  customerName,
}: {
  contract: JobContractRecord;
  jobNumber: string;
  customerName: string;
}) {
  const router = useRouter();
  const [inPerson, setInPerson] = useState(false);
  const [state, send] = useActionState(sendSigningLink, initialState);
  // The pad opens only once the business has signed.
  const [businessState, signBusiness] = useActionState(
    async (previous: ContractState, formData: FormData) => {
      const result = await signForBusiness(previous, formData);
      if (result.signedForBusiness) setInPerson(true);
      return result;
    },
    initialState,
  );

  if (contract.signedLabel) {
    return (
      <div className="mt-3 space-y-2">
        <p className="flex items-start gap-2 rounded-control border border-brand/30 bg-brand/10 px-3 py-2 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
          <span>
            Signed by <strong>{contract.signatureName}</strong> · {contract.signedLabel}
          </span>
        </p>
        <BusinessSigned contract={contract} />
      </div>
    );
  }

  const error = state.error || businessState.error;
  const needsSignature = Boolean(state.needsSignature || businessState.needsSignature);

  if (contract.unsignable) {
    return (
      <div className="mt-3 space-y-2">
        <button type="button" disabled className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-semibold opacity-60">
          <MessageSquare className="h-4 w-4" aria-hidden />
          Send for signing
        </button>
        <p className="text-sm text-ink-muted">{contract.unsignable}</p>
        {contract.unfilled.length > 0 ? (
          <MissingContractDetails contract={contract} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      {inPerson ? (
        /*
          Handed across at the door. The pad is the customer's, on this phone,
          and the page refreshes once they have signed so the signed copy is
          the one on screen.
        */
        <div className="rounded-control border border-line p-3">
          <p className="mb-3 text-sm text-ink-muted">Hand the phone to the customer to sign.</p>
          <SignaturePad token={contract.publicToken} defaultName={customerName} onSigned={() => router.refresh()} />
          <button
            type="button"
            onClick={() => setInPerson(false)}
            className="tap-target mt-2 inline-flex min-h-11 w-full items-center justify-center text-sm font-semibold text-ink-muted"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <form action={signBusiness}>
            <input type="hidden" name="contractId" value={contract.id} />
            <input type="hidden" name="jobNumber" value={jobNumber} />
            <SignInPersonButton />
          </form>
          <form action={send}>
            <input type="hidden" name="contractId" value={contract.id} />
            <input type="hidden" name="jobNumber" value={jobNumber} />
            <SendLinkButton />
          </form>
        </div>
      )}

      <BusinessSigned contract={contract} />
      {contract.sentLabel && !state.notice ? (
        <p className="text-xs text-ink-faint">Signing link texted {contract.sentLabel}.</p>
      ) : null}
      {state.notice ? <p className="text-sm text-brand">{state.notice}</p> : null}
      {error ? <p className="text-sm text-critical">{error}</p> : null}
      {needsSignature ? (
        <Link
          href="/settings/contract#signature"
          className="tap-target inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-brand"
        >
          <PenLine className="h-4 w-4" aria-hidden />
          Add your signature
        </Link>
      ) : null}
    </div>
  );
}

/** Where the newest contract stands, in the one line the folded section shows. */
function contractStatus(contract: JobContractRecord): string {
  if (contract.signedLabel) return `Signed by ${contract.signatureName} · ${contract.signedLabel}`;
  if (contract.unfilled.length > 0) {
    const count = contract.unfilled.length;
    return `Draft · ${count} ${count === 1 ? "blank" : "blanks"} left to fill in`;
  }
  if (contract.sentLabel) return `Signing link texted ${contract.sentLabel}`;
  return contract.document && !contract.unsignable ? "Draft · ready to sign" : `Draft · ${contract.createdLabel}`;
}

/** One draft, with its document behind the row that names it. */
function ContractRow({
  contract,
  jobNumber,
  customerName,
  current,
  open,
  onToggle,
}: {
  contract: JobContractRecord;
  jobNumber: string;
  customerName: string;
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
            {/* Signed first: an agreement signed before a newer draft existed is
                still the signed contract, not a superseded draft. */}
            {contract.signedLabel ? "Signed contract" : current ? "Draft" : "Superseded draft"} ·{" "}
            {contract.createdLabel}
          </span>
          {contract.unfilled.length > 0 ? (
            <span className="mt-0.5 block text-xs text-caution">
              {contract.unfilled.length} {contract.unfilled.length === 1 ? "blank" : "blanks"} left
              to fill in
            </span>
          ) : (
            <span className="mt-0.5 block text-xs text-ink-faint">
              {contract.signedLabel
                ? `Signed by ${contract.signatureName}`
                : !current
                  ? "Can no longer be signed"
                  : contract.document
                    ? "Ready to sign"
                    : "Complete"}
            </span>
          )}
        </span>
        <span className="shrink-0 text-xs font-semibold text-brand">{open ? "Hide preview" : "Preview"}</span>
      </button>

      {current ? (
        <div className="border-t border-line px-3 pb-3">
          <ContractSigning contract={contract} jobNumber={jobNumber} customerName={customerName} />
          {!contract.signedLabel && !contract.unsignable ? (
            <p className="mt-2 text-xs text-ink-muted">Sends the signing link by text.</p>
          ) : null}
        </div>
      ) : null}

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
  customerName = "",
}: {
  jobNumber: string;
  contracts: JobContractRecord[];
  /** Pre-fills the name on the signing pad. The customer can correct it. */
  customerName?: string;
}) {
  const [state, action] = useActionState(generateContract, initialState);
  // Keep the document preview optional while signing actions stay visible.
  const [open, setOpen] = useState<string | null>(null);
  const section = useRef<HTMLElement>(null);
  const drafts = useRef<HTMLDetailsElement>(null);

  // Arriving already pointed here — a new tab, the back button, a link from
  // another page — the section is still folded away. Open it and go to it.
  useEffect(() => {
    if (window.location.hash !== `#${CONTRACT_ANCHOR}`) return;
    revealContract();
    section.current?.scrollIntoView({ block: "start" });
  }, []);

  // A draft just written is the next thing to read and send, so the list
  // opens onto it rather than leaving it folded under a status line.
  useEffect(() => {
    if (state.contractId && drafts.current) drafts.current.open = true;
  }, [state.contractId]);

  return (
    <section id={CONTRACT_ANCHOR} ref={section} className="scroll-mt-24">
      {/* Generating stays in reach whether or not the drafts are open: it was
          tucked under "Options" once a contract existed, which hid the one
          thing somebody comes back to this card to do. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Contract</h2>
        <form action={action}>
          <input type="hidden" name="jobNumber" value={jobNumber} />
          <GenerateButton existing={contracts.length > 0} />
        </form>
      </div>

      {state.error || state.notice ? (
        <div className="mt-3">
          <FormMessage error={state.error} notice={state.notice} />
        </div>
      ) : null}

      {/*
        Folded by default, like Job details and History. On most visits the
        contract is settled, signed or already out, and its drafts are the
        longest thing on the page; the line it folds to says where it stands.
        A `<details>` so it opens before any JavaScript has arrived.
      */}
      {contracts.length > 0 ? (
        <details ref={drafts} className="group mt-2">
          <summary className="tap-target flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm text-ink-muted [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">{contractStatus(contracts[0])}</span>
            <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" aria-hidden />
          </summary>

          <ul className="mt-2 space-y-2">
            {contracts.map((contract, index) => (
              <ContractRow
                key={contract.id}
                contract={contract}
                jobNumber={jobNumber}
                customerName={customerName}
                current={index === 0}
                open={open === contract.id}
                onToggle={() => setOpen(open === contract.id ? null : contract.id)}
              />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
