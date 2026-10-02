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
  generateChangeOrder,
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
import { formatCents } from "@/lib/job-lines";

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

function ChangeOrderButton({ again }: { again: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60 sm:w-auto"
    >
      {pending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <FileText className="h-4 w-4" aria-hidden />
      )}
      {pending ? "Writing" : again ? "Generate a new change order" : "Generate change order"}
    </button>
  );
}

/** What has been written on the job since the customer last signed. */
export type AgreementChangeSummary = {
  /** Something on the job has been signed. */
  signed: boolean;
  /** Lines written after the newest signed contract or change order was drawn up. */
  addedCount: number;
  addedCents: number;
  /** An unsigned change order newer than all of them is waiting to be signed. */
  waiting: boolean;
  /** The newest contract is unsigned and older than some of the lines. */
  behind: boolean;
};

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
          <SignaturePad
            token={contract.publicToken}
            defaultName={customerName}
            onSigned={() => router.refresh()}
            kind={contract.kind}
          />
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
  const order = contract.kind === "change_order";
  if (contract.signedLabel) {
    return `${order ? "Change order signed" : "Signed"} by ${contract.signatureName} · ${contract.signedLabel}`;
  }
  const draft = order ? "Change order" : "Draft";
  if (contract.unfilled.length > 0) {
    const count = contract.unfilled.length;
    return `${draft} · ${count} ${count === 1 ? "blank" : "blanks"} left to fill in`;
  }
  if (contract.sentLabel) return `${order ? "Change order link" : "Signing link"} texted ${contract.sentLabel}`;
  return contract.document && !contract.unsignable ? `${draft} · ready to sign` : `${draft} · ${contract.createdLabel}`;
}

/** What a row calls its contract: signed, the one to sign, or one a newer draft replaced. */
function rowTitle(contract: JobContractRecord, current: boolean): string {
  const order = contract.kind === "change_order";
  // Signed first: an agreement signed before a newer draft existed is still
  // the signed contract, not a superseded draft.
  if (contract.signedLabel) return order ? "Signed change order" : "Signed contract";
  if (current) return order ? "Change order" : "Draft";
  return order ? "Superseded change order" : "Superseded draft";
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
            {rowTitle(contract, current)} · {contract.createdLabel}
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
  changes,
}: {
  jobNumber: string;
  contracts: JobContractRecord[];
  /** Pre-fills the name on the signing pad. The customer can correct it. */
  customerName?: string;
  /** What has been written on the job since the customer last signed. */
  changes?: AgreementChangeSummary;
}) {
  const [state, action] = useActionState(generateContract, initialState);
  const [orderState, orderAction] = useActionState(generateChangeOrder, initialState);
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
  useEffect(() => {
    if (orderState.contractId && drafts.current) drafts.current.open = true;
  }, [orderState.contractId]);

  const generate = (
    <form action={action}>
      <input type="hidden" name="jobNumber" value={jobNumber} />
      <GenerateButton existing={contracts.length > 0} />
    </form>
  );
  const message =
    state.error || state.notice ? (
      <div className="mt-3">
        <FormMessage error={state.error} notice={state.notice} />
      </div>
    ) : null;

  const items = (count: number) => `${count} ${count === 1 ? "item" : "items"}`;

  /*
   * Work written on the job after the customer signed.
   *
   * A signed contract is amended in writing, not edited, so the additions go on
   * a change order: a document of their own, signed the same way. Shown above
   * the folded drafts, because it is the one thing on the card that needs doing.
   */
  const asking = Boolean(changes?.signed && changes.addedCount > 0 && !changes.waiting);
  const changeOrder =
    asking && changes ? (
      <div className="mt-3 rounded-control border border-caution/30 bg-caution-bg p-4">
        <h3 className="text-sm font-semibold">Added since the customer signed</h3>
        <p className="mt-1 text-sm leading-6 text-ink-muted">
          {items(changes.addedCount)} · {formatCents(changes.addedCents)}.{" "}
          {changes.behind
            ? "The change order waiting to be signed does not include all of them. A new one replaces it."
            : "The signed contract stays as it was signed. The additions go on a change order for the customer to sign."}
        </p>
        <form action={orderAction}>
          <input type="hidden" name="jobNumber" value={jobNumber} />
          <ChangeOrderButton again={changes.behind} />
        </form>
        {orderState.error || orderState.notice ? (
          <div className="mt-3">
            <FormMessage error={orderState.error} notice={orderState.notice} />
          </div>
        ) : null}
      </div>
    ) : changes?.waiting ? (
      <p className="mt-2 text-sm leading-6 text-ink-muted">
        A change order for the {items(changes.addedCount)} added since they signed (
        {formatCents(changes.addedCents)}) is waiting to be signed.
      </p>
    ) : !changes?.signed && changes?.behind ? (
      <div className="mt-3 rounded-control border border-caution/30 bg-caution-bg p-4">
        <p className="text-sm leading-6 text-ink-muted">
          Items were added after this draft was made, so it does not include them. Generate another draft
          before it is signed.
        </p>
        <div className="mt-3">{generate}</div>
        {message}
      </div>
    ) : null;

  return (
    <section id={CONTRACT_ANCHOR} ref={section} className="scroll-mt-24">
      {/* The first contract is generated from here, there being no drafts
          yet to keep the button with. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Contract</h2>
        {contracts.length === 0 ? generate : null}
      </div>

      {/* After a change order is written the request above gives way to it,
          so what the action said is kept on screen here instead. */}
      {!asking && orderState.notice ? (
        <div className="mt-3">
          <FormMessage error="" notice={orderState.notice} />
        </div>
      ) : null}
      {changeOrder}

      {/*
        Folded by default, like Job details and History. On most visits the
        contract is settled, signed or already out, and its drafts are the
        longest thing on the page; the line it folds to says where it stands.
        A `<details>` so it opens before any JavaScript has arrived.
      */}
      {contracts.length === 0 ? (
        message
      ) : (
        <details ref={drafts} className="group mt-2">
          <summary className="tap-target flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-sm text-ink-muted [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">{contractStatus(contracts[0])}</span>
            <ChevronDown className="h-4 w-4 shrink-0 transition group-open:rotate-180" aria-hidden />
          </summary>

          {/* Another draft is made from among the drafts, folded away with
              them. On the title row it showed on every visit to the job,
              however settled the contract was. */}
          <div className="mt-2">{generate}</div>
          {message}

          <ul className="mt-3 space-y-2">
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
      )}
    </section>
  );
}
