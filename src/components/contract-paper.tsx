import { documentFont } from "@/components/document-font";
import { signatureFont } from "@/components/signature-font";
import { contractBlocks, signatureSection, unwrapped } from "@/lib/contract-layout";
import { bodyProvidesSignatures } from "@/lib/contract-signatures";
import type { ContractDocumentData, ContractSignature } from "@/lib/pdf/contract-document";

/** What a signature line needs, whichever party's it is. */
type SignedLine = Pick<ContractSignature, "method" | "name" | "image" | "signedLabel">;

/**
 * The contract, drawn the way its PDF is, at a size a phone can read.
 *
 * The PDF is a letter page. Fitted to a phone it is a postage stamp — its 10pt
 * text comes out about six pixels tall — and zooming in turns every line into a
 * sideways swipe. So this is the same document as real text that wraps to the
 * screen, and it is drawn the way the PDF is (contract-document.tsx and
 * letterhead.tsx), not as a web page about it:
 *
 * - in the PDF's face, Arimo (document-font.ts), and its colours: ink #0f172a,
 *   muted #64748b, rules #cbd5e1 and the #b8860b accent line;
 * - to the PDF's measurements, a point to a pixel and a half: 10pt text is
 *   15px on a 21px line, an 8pt heading 12px, the 3pt accent line 4.5px. Only
 *   the letterhead is smaller on a phone, where the PDF's 20pt name at that
 *   scale would break a word to a line;
 * - in the PDF's arrangement at every width: Customer beside Job, and the
 *   customer's signature beside the contractor's, on a square white sheet.
 *
 * Paragraphs and headings are decided in contract-layout.ts, which the PDF
 * reads too, and everything comes from the data the PDF is drawn from. What the
 * screen changes is where a line wraps, which is why a paragraph wrapped by hand
 * for the PDF's longer line flows as one here.
 *
 * It was the app's own type on a rounded card, with the blocks and signatures
 * stacked on a phone and lines half again as far apart as the PDF's, and next
 * to the PDF it read as a different document.
 */

/** The PDF's section heading: 8pt bold capitals, spaced, muted. */
const SECTION_HEADING = "mb-[7.5px] text-[12px] font-bold uppercase tracking-[0.1375em] text-[#64748b]";

/** A line that, when its column is narrow, breaks before an @ rather than mid-word. */
function Wrappable({ text }: { text: string }) {
  const at = text.indexOf("@");
  if (at <= 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <wbr />
      {text.slice(at)}
    </>
  );
}

/** A Customer or Job block: the heading, then its lines, the first in bold. */
function Labelled({ heading, lines }: { heading: string; lines: (string | null | undefined)[] }) {
  const visible = lines.filter((line): line is string => Boolean(line && line.trim()));
  return (
    // 46% wide, as on the PDF; 48% on a phone, like the signature columns.
    <div className="w-[48%] min-w-0 break-words sm:w-[46%]">
      <p className={SECTION_HEADING}>{heading}</p>
      {visible.length === 0 ? (
        <p className="text-[#64748b]">Not recorded</p>
      ) : (
        visible.map((line, index) => (
          <p key={`${heading}-${index}`} className={index === 0 ? "font-bold" : undefined}>
            <Wrappable text={line} />
          </p>
        ))
      )}
    </div>
  );
}

/**
 * A typed signature's size: the PDF's 20pt, 30px here, where the line is long
 * enough, and smaller where a phone's column is not, so the name stays on one
 * line as it would in ink. Half an em a letter is a little more than this face
 * takes, which leaves the line some room.
 */
function typedSignatureSize(name: string): string {
  const ems = Math.max(Array.from(name).length, 1) * 0.5;
  return `clamp(18px, calc(100cqi / ${ems}), 30px)`;
}

/**
 * One party's signing column: the signature on its line, the role under it,
 * then printed name and date.
 *
 * Six cells of a grid the two columns share rather than a column of its own,
 * so the rules stay level across the page when one side's name runs to two
 * lines and the other's does not, as on the printed form.
 */
function SignatureCells({
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
    <>
      <div className="@container flex min-h-[51px] min-w-0 flex-col justify-end">
        {signed?.method === "drawn" && signed.image ? (
          // A data URI from the signature pad: there is nothing for next/image
          // to optimise or fetch.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={signed.image}
            alt={`Signature of ${signed.name}`}
            className="h-12 w-full object-contain object-left-bottom"
          />
        ) : signed?.method === "typed" ? (
          <span
            className={`${signatureFont.className} mb-1.5 break-words leading-none`}
            style={{ fontSize: typedSignatureSize(signed.name) }}
          >
            {signed.name}
          </span>
        ) : null}
      </div>
      <div className="min-w-0 break-words border-t border-[#0f172a] pt-1.5">
        <p className="font-bold">{role}</p>
        {name ? <p className="text-[#64748b]">{name}</p> : null}
      </div>

      <div className="flex min-h-[39px] min-w-0 flex-col justify-end break-words">
        {signed ? <p>{printedName || signed.name}</p> : null}
      </div>
      <p className="border-t border-[#0f172a] pt-1.5 text-[#64748b]">Printed name</p>

      <div className="flex min-h-[39px] min-w-0 flex-col justify-end break-words">
        {signed ? <p>{signed.signedLabel}</p> : null}
      </div>
      <p className="border-t border-[#0f172a] pt-1.5 text-[#64748b]">Date</p>
    </>
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
    // The 21px line is set here and inherited as it is, not as a ratio: the
    // PDF hands its 14pt line down the same way, so its small headings and the
    // fingerprint sit on full-height lines too.
    <article
      className={`${documentFont.className} rounded-[3px] bg-white px-5 pb-8 pt-7 text-[15px] leading-[21px] text-[#0f172a] shadow-lg sm:px-[66px] sm:pb-[66px] sm:pt-[60px]`}
    >
      {/* Side by side at any width, as on the PDF: the business's lines wrap
          inside their column rather than pushing the title underneath them.
          On a phone the letterhead is drawn smaller as a whole, its 20pt name
          at 22px or less and its 10pt lines at 13px, keeping the PDF's
          proportions between them. */}
      <header className="flex items-start justify-between gap-4 text-[13px] leading-[18px] text-[#64748b] sm:text-[15px] sm:leading-[21px]">
        <div className="min-w-0 max-w-[450px] flex-1 break-words">
          <p className="mb-[0.15em] text-[clamp(18px,5.65vw,22px)] font-bold leading-[1.25] tracking-[0.015em] text-[#0f172a] sm:text-[30px]">
            {business.name}
          </p>
          {business.addressLine1 ? <p>{business.addressLine1}</p> : null}
          {cityLine || business.postalCode ? (
            <p>{[cityLine, business.postalCode].filter(Boolean).join(" ")}</p>
          ) : null}
          {business.phone || business.email ? (
            // Pre-wrap keeps the PDF's two spaces either side of the dot.
            <p className="whitespace-pre-wrap">
              {business.phone}
              {business.phone && business.email ? "  ·  " : ""}
              <Wrappable text={business.email} />
            </p>
          ) : null}
          {business.licenseNumber ? <p className="mt-[0.4em]">Lic. {business.licenseNumber}</p> : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="mb-[0.1em] text-[clamp(18px,5.65vw,22px)] font-bold leading-[1.25] text-[#0f172a] sm:text-[30px]">
            CONTRACT
          </p>
          <p>{data.reference}</p>
        </div>
      </header>

      <div className="mb-[21px] mt-[15px] h-[4.5px] bg-[#b8860b]" aria-hidden />

      <div className="mb-3 flex justify-between">
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
        <div className="mt-[21px] border border-[#cbd5e1] bg-[#fffbeb] p-3">
          <p className="font-bold">Not ready to sign — {data.unfilled.length} blank to fill in</p>
          <p className="break-words text-[#64748b]">{data.unfilled.join(", ")}</p>
        </div>
      ) : null}

      <hr className="mt-6 border-[#cbd5e1]" />

      <div>
        {contractBlocks(data.body).map((block, index) =>
          block.heading ? (
            <h2 key={`block-${index}`} className="mt-[21px] whitespace-pre-line break-words text-[16.5px] font-bold">
              {block.text}
            </h2>
          ) : (
            // Without the breaks the template was wrapped at by hand: they fit
            // the PDF's line, and a phone's is half as long.
            <p key={`block-${index}`} className="mt-3 whitespace-pre-line break-words">
              {unwrapped(block.text)}
            </p>
          ),
        )}
      </div>

      {/* The PDF's block, decided by the same rule in contract-layout.ts: the
          record of who signed and when, the business first. */}
      {section.show ? (
        <section className="mt-[45px]">
          <p className={SECTION_HEADING}>{section.heading}</p>
          {section.lines.map((line, index) => (
            <p
              key={`signed-${index}`}
              className={`text-[#64748b] ${index === section.lines.length - 1 ? "mb-[9px]" : "mb-[3px]"}`}
            >
              {line}
            </p>
          ))}
          {/* Filled a column at a time, so a screen reader reads the
              customer's cells, then the contractor's. 48% on a phone, where
              the PDF's 46% would wrap "Contractor signature". */}
          <div className="mt-[9px] grid grid-flow-col grid-cols-[48%_48%] grid-rows-[repeat(6,auto)] justify-between sm:grid-cols-[46%_46%]">
            <SignatureCells role="Customer signature" name={data.customer.name} signed={data.signature} />
            <SignatureCells
              role="Contractor signature"
              name={business.name}
              signed={contractor}
              printedName={contractor?.title ? `${contractor.name}, ${contractor.title}` : undefined}
            />
          </div>
          {data.signature ? (
            <p className="mt-[15px] text-[10.5px] text-[#64748b]">Document fingerprint {data.signature.fingerprint}</p>
          ) : null}
        </section>
      ) : null}

      <footer className="mt-[39px] whitespace-pre-wrap break-words border-t border-[#cbd5e1] pt-3 text-[12px] leading-[1.4] text-[#64748b]">
        {[business.name, business.phone, business.licenseNumber ? `Lic. ${business.licenseNumber}` : ""]
          .filter(Boolean)
          .join("  ·  ")}
      </footer>
    </article>
  );
}
