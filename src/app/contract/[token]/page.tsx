import type { Metadata } from "next";
import { ArrowDown, CheckCircle2, FileSignature, FileX2, PenLine, Phone } from "lucide-react";

import { ContractPdfPages } from "@/app/contract/[token]/contract-pdf";
import { ContractSigning } from "@/app/contract/[token]/contract-signing";
import { ContractPaper } from "@/components/contract-paper";
import { unsignableBecause } from "@/lib/contract-signing";
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
  const [copy, document] = await Promise.all([
    contractCopy(contract, timeZone),
    contractDocument(contract, timeZone),
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
            {contract.job_number ? `Contract for job #${contract.job_number}` : "Your contract"}
          </h1>
          {contract.customer_name ? (
            <p className="mt-1 text-sm text-ink-muted">For {contract.customer_name}</p>
          ) : null}
        </header>

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
              <ContractSigning token={token} defaultName={contract.customer_name ?? ""} />
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
