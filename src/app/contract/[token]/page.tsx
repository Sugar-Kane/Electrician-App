import type { Metadata } from "next";
import { ArrowDown, CheckCircle2, FileSignature, FileX2, MessageSquare, PenLine, Phone } from "lucide-react";

import { ContractPdfPages } from "@/app/contract/[token]/contract-pdf";
import { ContractSigning } from "@/app/contract/[token]/contract-signing";
import { ContractPaper } from "@/components/contract-paper";
import { approvalSummary, type ApprovalSummary } from "@/lib/approval-summary";
import { unsignableBecause } from "@/lib/contract-signing";
import { formatCents } from "@/lib/job-lines";
import { loadContractDocument, type LoadedContract } from "@/lib/pdf/contract-data";
import { currentDocument, type StoredDocument } from "@/lib/pdf/store";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * The contract a customer was sent, and where they sign it.
 *
 * Reached by a token, not a session, for the same reason as the booking
 * confirmation: the person asked to sign has no account and must not need one.
 * The token is the only thing between this page and the world, so it shows the
 * one contract behind it and nothing that would help anybody guess at another.
 *
 * What is shown is the contract as its document lays it out — the letterhead,
 * the Customer and Job blocks, the terms and the signature block, built from
 * the same data and the same stored body as the PDF the business files (the
 * body is the text the signature is hashed against). Plain paragraphs looked
 * nothing like the contract the business sent; the PDF itself, fitted to a
 * phone, was too small to read. So the copy is real text that wraps to the
 * screen, drawn the way the PDF is, and the exact PDF pages are one tap away,
 * with a copy to download. When that data cannot be read, the stored words are
 * the page.
 *
 * On a phone the contract runs to several screens before the place to sign, so
 * while it can be signed, a button at the top goes straight there.
 */

/** Where the button at the top of the page goes: the Sign section. */
const SIGN_ANCHOR = "sign";

export const metadata: Metadata = {
  title: "Your contract",
  // A signing link must never turn up in a search result.
  robots: { index: false, follow: false },
};

type PublicContract = {
  contract_id: string;
  organization_id: string;
  business_name: string;
  business_phone: string;
  body: string;
  unfilled: string[] | null;
  status: string;
  signature_provider: string | null;
  signed_at: string | null;
  signature_name: string | null;
  customer_name: string | null;
  job_number: number | null;
  time_zone: string | null;
  /** A newer contract has been drafted for the job, so this link cannot sign. */
  superseded: boolean | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signedLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/*
 * Both of these read with the service role, because an anonymous visitor cannot
 * read the business's jobs, customers or documents — but only for the contract
 * the token resolved to, never for anything taken from the request, which is
 * how the signing action files the signed copy too.
 */

/** The contract laid out as its document: letterhead, parties, terms, signatures. */
async function contractCopy(contract: PublicContract, timeZone: string): Promise<LoadedContract | null> {
  try {
    return await loadContractDocument({
      database: asFlexibleClient(getSupabaseAdmin()),
      organizationId: contract.organization_id,
      contractId: contract.contract_id,
      timeZone,
    });
  } catch (error) {
    console.error("contract page: could not load the contract", error);
    return null;
  }
}

/** The contract's current PDF — the signed copy, once there is one. Null when there is none yet. */
async function contractDocument(
  contract: PublicContract,
  timeZone: string,
): Promise<StoredDocument | null> {
  try {
    return await currentDocument({
      database: asFlexibleClient(getSupabaseAdmin()),
      organizationId: contract.organization_id,
      contractId: contract.contract_id,
      timeZone,
    });
  } catch (error) {
    console.error("contract page: could not load the document", error);
    return null;
  }
}

/** The figures and scope the contract saved when it was drawn up, for the summary above it. */
async function contractTerms(
  contract: PublicContract,
): Promise<{ summary: ApprovalSummary | null; scope: string }> {
  try {
    const { data } = await asFlexibleClient(getSupabaseAdmin())
      .from("contracts")
      .select("total_cents, deposit_cents, deposit_paid, scope")
      .eq("organization_id", contract.organization_id)
      .eq("id", contract.contract_id)
      .maybeSingle();
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      summary: approvalSummary({
        totalCents: typeof row.total_cents === "number" ? row.total_cents : null,
        depositCents: typeof row.deposit_cents === "number" ? row.deposit_cents : null,
        depositPaid: typeof row.deposit_paid === "boolean" ? row.deposit_paid : null,
      }),
      scope: typeof row.scope === "string" ? row.scope.trim() : "",
    };
  } catch (error) {
    console.error("contract page: could not load the figures", error);
    return { summary: null, scope: "" };
  }
}

/**
 * What the customer is being asked to agree to, before the terms.
 *
 * The contract runs to several screens of terms, and the three things a
 * customer wants to know — what is being done, what it costs after what they
 * already paid, and when — were somewhere inside them. They come first now,
 * from the figures the contract saved, so they match the terms underneath.
 */
function Summary({
  summary,
  scope,
  timing,
  businessName,
  businessPhone,
  jobNumber,
}: {
  summary: ApprovalSummary | null;
  scope: string;
  timing: string;
  businessName: string;
  businessPhone: string;
  jobNumber: number | null;
}) {
  const rows: [string, string][] = summary
    ? [
        ["Total", formatCents(summary.totalCents)],
        ...(summary.paidCents > 0
          ? ([["Diagnostic fee already paid", `−${formatCents(summary.paidCents)}`]] as [string, string][])
          : []),
        ...(summary.dueBeforeWorkCents > 0
          ? ([["Diagnostic fee, due before work begins", formatCents(summary.dueBeforeWorkCents)]] as [string, string][])
          : []),
      ]
    : [];
  const sms = businessPhone.replace(/[^\d+]/g, "");
  const question = encodeURIComponent(`Question about ${jobNumber ? `job #${jobNumber}` : "my contract"}: `);

  return (
    <section aria-labelledby="summary-heading" className="mt-6 rounded-panel border border-line bg-[#081925] p-5 sm:p-6">
      <h2 id="summary-heading" className="text-lg font-semibold">
        What you are agreeing to
      </h2>
      {scope ? (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">The work</p>
          <p className="mt-1 line-clamp-6 whitespace-pre-line text-sm leading-6 text-ink">{scope}</p>
        </div>
      ) : null}
      {summary ? (
        <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="shrink-0 font-semibold">{value}</dd>
            </div>
          ))}
          <div className="flex items-baseline justify-between gap-3 border-t border-line pt-2 text-base">
            <dt className="font-semibold">Left to pay</dt>
            <dd className="shrink-0 font-bold text-brand">{formatCents(summary.balanceCents)}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-4 text-sm text-ink-muted">The price is set out in the contract below.</p>
      )}
      <p className="mt-3 text-sm text-ink-muted">
        <span className="font-semibold text-ink">When:</span> {timing || "A date to be agreed with you."}
      </p>
      {sms ? (
        <a
          href={`sms:${sms}?&body=${question}`}
          className="tap-target mt-4 inline-flex min-h-11 items-center gap-2 rounded-control border border-line px-4 text-sm font-semibold"
        >
          <MessageSquare className="h-4 w-4" aria-hidden />
          Ask {businessName || "us"} a question
        </a>
      ) : null}
      <p className="mt-3 text-xs text-ink-faint">The full contract is below. Read it before you sign.</p>
    </section>
  );
}

/** The body as paragraphs, split where the template left a blank line. */
function Body({ text }: { text: string }) {
  const paragraphs = text.split(/\n\s*\n/).filter((block) => block.trim());
  return (
    <div className="space-y-4 text-[15px] leading-7 text-slate-900">
      {paragraphs.map((block, index) => (
        <p key={index} className="whitespace-pre-line">
          {block.trim()}
        </p>
      ))}
    </div>
  );
}

export default async function ContractPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let contract: PublicContract | null = null;
  // Checked before the round trip: a malformed token is a typo or a probe.
  if (UUID.test(token)) {
    const { data } = await createPublicClient().rpc("get_public_contract", { p_token: token });
    contract = Array.isArray(data) && data.length > 0 ? (data[0] as PublicContract) : null;
  }

  if (!contract) {
    return (
      <main id="main-content" className="grid min-h-screen place-items-center bg-canvas px-4 py-10 text-white">
        <section className="w-full max-w-lg rounded-[28px] border border-line bg-[#081925] p-6 text-center sm:p-8">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-caution-bg text-caution">
            <FileX2 className="h-7 w-7" aria-hidden />
          </span>
          <h1 className="mt-5 text-2xl font-semibold">We could not find that contract</h1>
          <p className="mt-3 text-sm leading-6 text-ink-muted">
            The link may be old, it may have been copied incompletely, or the contract may have been
            cancelled. Call the business and they can send it again.
          </p>
        </section>
      </main>
    );
  }

  const timeZone = contract.time_zone || "America/Los_Angeles";
  const [copy, document, terms] = await Promise.all([
    contractCopy(contract, timeZone),
    contractDocument(contract, timeZone),
    contractTerms(contract),
  ]);
  const blocked = unsignableBecause({
    status: contract.status,
    unfilled: contract.unfilled ?? [],
    signatureProvider: contract.signature_provider,
    signedAt: contract.signed_at,
    superseded: contract.superseded === true,
  });
  const signable = !contract.signed_at && !blocked;

  return (
    <main id="main-content" className="min-h-screen bg-canvas px-4 py-8 text-white sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
            {contract.business_name}
          </p>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold">
            <FileSignature className="h-6 w-6 shrink-0 text-brand" aria-hidden />
            {copy?.document.kind === "change_order"
              ? contract.job_number
                ? `Change order for job #${contract.job_number}`
                : "Your change order"
              : contract.job_number
                ? `Contract for job #${contract.job_number}`
                : "Your contract"}
          </h1>
          {contract.customer_name ? (
            <p className="mt-1 text-sm text-ink-muted">For {contract.customer_name}</p>
          ) : null}
        </header>

        {signable ? (
          <Summary
            summary={terms.summary}
            scope={terms.scope}
            timing={copy?.document.job.scheduledLabel ?? ""}
            businessName={contract.business_name}
            businessPhone={contract.business_phone ?? ""}
            jobNumber={contract.job_number}
          />
        ) : null}

        {signable ? (
          // A plain link to the section, so it works before the page's
          // scripts have loaded, and the page scrolls there smoothly.
          <a
            href={`#${SIGN_ANCHOR}`}
            className="tap-target mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-base font-bold text-on-brand sm:inline-flex sm:w-auto"
          >
            <PenLine className="h-5 w-5" aria-hidden />
            Click to sign
            <ArrowDown className="h-5 w-5" aria-hidden />
          </a>
        ) : null}

        {contract.signed_at ? (
          <section className="mt-6 flex items-start gap-3 rounded-panel border border-brand/30 bg-brand/10 p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
            <div>
              <p className="font-semibold">Signed</p>
              <p className="mt-1 text-sm leading-6 text-ink-muted">
                {contract.signature_name ? `${contract.signature_name} signed` : "Signed"} on{" "}
                {signedLabel(contract.signed_at, timeZone)}. {contract.business_name} has a copy.
              </p>
            </div>
          </section>
        ) : blocked ? (
          <section role="status" className="mt-6 rounded-panel border border-caution/40 bg-caution-bg p-4 text-sm leading-6 text-caution">
            {blocked}
          </section>
        ) : null}

        <section className="mt-6" aria-label="The contract">
          {copy ? (
            <ContractPaper data={copy.document} />
          ) : (
            /* The words, set like paper: long terms read better dark on light. */
            <article className="rounded-panel bg-white p-5 sm:p-8">
              <Body text={contract.body} />
            </article>
          )}
          {document ? <ContractPdfPages url={document.url} fileName={document.fileName} /> : null}
        </section>

        {signable ? (
          <section
            id={SIGN_ANCHOR}
            className="mt-6 scroll-mt-4 rounded-panel border border-line bg-[#081925] p-5 sm:p-6"
          >
            <h2 className="text-lg font-semibold">Sign</h2>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              By signing you agree to the work and the price above.
            </p>
            <div className="mt-4">
              <ContractSigning
                token={token}
                defaultName={contract.customer_name ?? ""}
                kind={copy?.document.kind}
              />
            </div>
          </section>
        ) : null}

        {contract.business_phone ? (
          // Two flex children, not five. Laid out as one flex row, the sentence,
          // the link and the full stop each became their own column, and the
          // number was squeezed into three lines with its full stop adrift.
          <p className="mt-6 flex items-start gap-2 text-sm leading-6 text-ink-muted">
            <Phone className="mt-1 h-4 w-4 shrink-0" aria-hidden />
            <span>
              Questions about this contract? Call {contract.business_name} at{" "}
              <a
                href={`tel:${contract.business_phone.replace(/[^\d+]/g, "")}`}
                className="whitespace-nowrap font-semibold text-white underline"
              >
                {contract.business_phone}
              </a>
              .
            </span>
          </p>
        ) : null}
      </div>
    </main>
  );
}
