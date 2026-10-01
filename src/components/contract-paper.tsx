import { signatureFont } from "@/components/signature-font";
import { contractBlocks, signatureSection } from "@/lib/contract-layout";
import { bodyProvidesSignatures } from "@/lib/contract-signatures";
import type { ContractDocumentData, ContractSignature } from "@/lib/pdf/contract-document";

/** What a signature line needs, whichever party's it is. */
type SignedLine = Pick<ContractSignature, "method" | "name" | "image" | "signedLabel">;

/**
 * The contract, laid out the way its PDF is, at a size a phone can be read at.
 *
 * The PDF is a letter page. Fitted to a phone it is a postage stamp — its 10pt
 * text comes out about six pixels tall — and zooming in turns every line into a
 * sideways swipe. This is the same document set as real text instead: the same
 * letterhead and accent rule, the same Customer and Job blocks, the same
 * paragraphs and headings (decided in contract-layout.ts, which the PDF reads
 * too), the same signature block, built from the same data the PDF is drawn
 * from. It wraps to the screen, so nobody has to zoom to read what they sign.
 *
 * The colours are the PDF's own (letterhead.tsx): ink #0f172a, muted #64748b,
 * rules #cbd5e1 and the #b8860b accent line.
 */

/** An address that, when the column is narrow, breaks at the @ rather than mid-word. */
function Email({ address }: { address: string }) {
  const at = address.indexOf("@");
  if (at <= 0) return <>{address}</>;
  return (
    <>
      {address.slice(0, at)}
      <wbr />
      {address.slice(at)}
    </>
  );
}

function Labelled({ heading, lines }: { heading: string; lines: (string | null | undefined)[] }) {
  const visible = lines.filter((line): line is string => Boolean(line && line.trim()));
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{heading}</p>
      {visible.length === 0 ? (
        <p className="mt-1 text-slate-500">Not recorded</p>
      ) : (
        <div className="mt-1 break-words">
          {visible.map((line, index) => (
            <p key={`${heading}-${index}`} className={index === 0 ? "font-semibold" : undefined}>
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/** One party's column: the signature on its line, then printed name and date. */
function SignatureColumn({
  role,
  name,
  signed,
  printedName,
}: {
  role: string;
  name?: string;
  signed?: SignedLine;
  /** What goes on the printed-name line, when it is more than the name signed. */
  printedName?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex h-14 items-end">
        {signed?.method === "drawn" && signed.image ? (
          // A data URI from the signature pad: there is nothing for next/image
          // to optimise or fetch.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={signed.image}
            alt={`Signature of ${signed.name}`}
            className="h-12 w-auto max-w-full object-contain object-left-bottom"
          />
        ) : signed?.method === "typed" ? (
          <span className={`${signatureFont.className} mb-1 text-3xl leading-none`}>{signed.name}</span>
        ) : null}
      </div>
      <div className="border-t border-slate-900 pt-1">
        <p className="font-semibold">{role}</p>
        {name ? <p className="text-sm text-slate-500">{name}</p> : null}
      </div>

      <div className="flex h-9 items-end">{signed ? printedName || signed.name : null}</div>
      <p className="border-t border-slate-900 pt-1 text-sm text-slate-500">Printed name</p>

      <div className="flex h-9 items-end">{signed ? signed.signedLabel : null}</div>
      <p className="border-t border-slate-900 pt-1 text-sm text-slate-500">Date</p>
    </div>
  );
}

export function ContractPaper({ data }: { data: ContractDocumentData }) {
  const { business } = data;
  const cityLine = [business.city, business.state].filter(Boolean).join(", ");
  const contractor = data.contractorSignature;
  const section = signatureSection({
    ownSignatures: bodyProvidesSignatures(data.body),
    businessName: business.name,
    customer: data.signature,
    contractor,
  });

  return (
    <article className="rounded-panel bg-white px-5 py-6 text-[15px] leading-7 text-slate-900 shadow-lg sm:px-8 sm:py-8">
      {/* Side by side at any width, as on the PDF: the business's lines wrap
          inside their column rather than pushing the title underneath them. */}
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xl font-bold leading-tight tracking-[0.01em]">{business.name}</p>
          <div className="mt-1 break-words text-sm leading-6 text-slate-500">
            {business.addressLine1 ? <p>{business.addressLine1}</p> : null}
            {cityLine || business.postalCode ? (
              <p>{[cityLine, business.postalCode].filter(Boolean).join(" ")}</p>
            ) : null}
            {business.phone || business.email ? (
              <p>
                {business.phone}
                {business.phone && business.email ? "  ·  " : ""}
                <Email address={business.email} />
              </p>
            ) : null}
            {business.licenseNumber ? <p className="mt-1">Lic. {business.licenseNumber}</p> : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xl font-bold leading-tight">CONTRACT</p>
          <p className="text-sm text-slate-500">{data.reference}</p>
        </div>
      </header>

      <div className="mb-5 mt-3 h-[3px] bg-[#b8860b]" aria-hidden />

      <div className="grid gap-5 sm:grid-cols-2">
        <Labelled
          heading="Customer"
          lines={[data.customer.name, ...data.customer.addressLines, data.customer.phone, data.customer.email]}
        />
        <Labelled
          heading="Job"
          lines={[
            `Job #${data.job.number}`,
            ...data.job.addressLines,
            data.job.scheduledLabel,
            `Contract date ${data.createdLabel}`,
          ]}
        />
      </div>

      {data.unfilled.length > 0 ? (
        <div className="mt-5 border border-slate-300 bg-amber-50 p-3">
          <p className="font-semibold">Not ready to sign — {data.unfilled.length} blank to fill in</p>
          <p className="text-sm text-slate-500">{data.unfilled.join(", ")}</p>
        </div>
      ) : null}

      <hr className="mt-6 border-slate-300" />

      <div>
        {contractBlocks(data.body).map((block, index) =>
          block.heading ? (
            <h2 key={`block-${index}`} className="mt-6 text-base font-bold">
              {block.text}
            </h2>
          ) : (
            <p key={`block-${index}`} className="mt-4 whitespace-pre-line break-words">
              {block.text}
            </p>
          ),
        )}
      </div>

      {/* The PDF's block, decided by the same rule in contract-layout.ts: the
          record of who signed and when, the business first. */}
      {section.show ? (
        <section className="mt-10">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
            {section.heading}
          </p>
          {section.lines.map((line, index) => (
            <p key={`signed-${index}`} className="mt-1 text-sm text-slate-500">
              {line}
            </p>
          ))}
          <div className="mt-4 grid gap-8 sm:grid-cols-2">
            <SignatureColumn role="Customer signature" name={data.customer.name} signed={data.signature} />
            <SignatureColumn
              role="Contractor signature"
              name={business.name}
              signed={contractor}
              printedName={contractor?.title ? `${contractor.name}, ${contractor.title}` : undefined}
            />
          </div>
          {data.signature ? (
            <p className="mt-4 text-xs text-slate-500">Document fingerprint {data.signature.fingerprint}</p>
          ) : null}
        </section>
      ) : null}

      <footer className="mt-10 border-t border-slate-300 pt-2 text-xs leading-5 text-slate-500">
        {[business.name, business.phone, business.licenseNumber ? `Lic. ${business.licenseNumber}` : ""]
          .filter(Boolean)
          .join("  ·  ")}
      </footer>
    </article>
  );
}
