import { Document, Image, Page, Text, View } from "@react-pdf/renderer";

import { bodyProvidesSignatures } from "@/lib/contract-signatures";
import {
  DocumentFooter,
  Labelled,
  Letterhead,
  RULE,
  sheet,
  type BusinessLetterhead,
} from "@/lib/pdf/letterhead";

/**
 * The contract as the customer signs it.
 *
 * The "Read" button showed the contract as preformatted text in a panel, which
 * is fine for checking a placeholder got filled and no use at all as the thing
 * somebody agrees to. This is the document.
 *
 * The body is the business's own template with this job's details filled in,
 * and it is printed as written. Headings are recognised and set in bold; nothing
 * else is reformatted, reordered or reworded — it is their contract, and the
 * paragraph they argued with their lawyer about has to survive being rendered.
 *
 * The signature block is real space on the page rather than a picture of one, so
 * a printed copy can be signed by hand today and an electronic signature can be
 * placed against the same coordinates later — and it is omitted entirely when
 * the business's own text already ends with somewhere to sign, because two
 * signature blocks on one contract is not a tidiness problem.
 */

export type ContractDocumentData = {
  business: BusinessLetterhead;
  reference: string;
  createdLabel: string;
  customer: { name: string; addressLines: string[]; phone: string; email: string };
  job: { number: string; addressLines: string[]; scheduledLabel: string };
  /** The filled template, verbatim. */
  body: string;
  /** Placeholders the job could not supply, named so nobody signs around them. */
  unfilled: string[];
  /** Present once the customer has signed in the app. */
  signature?: ContractSignature;
};

export type ContractSignature = {
  method: "drawn" | "typed";
  /** The printed name they gave. */
  name: string;
  /** A PNG data URI, for a drawn signature only. */
  image: string;
  /** When they signed, already in the business's timezone. */
  signedLabel: string;
  /**
   * The start of the SHA-256 of the body they signed.
   *
   * Printed on the page so paper and record can be matched: anyone holding a
   * copy can check it against the stored hash, and a copy whose text was edited
   * afterwards stops matching.
   */
  fingerprint: string;
};

/**
 * A line that is acting as a heading.
 *
 * Short, no trailing full stop, and either all caps or title case followed by a
 * colon — which is how every contract template in the wild writes one. Guessing
 * wrong only changes a weight, never the words.
 */
function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 60) return false;
  if (/[.,;]$/.test(trimmed)) return false;
  return trimmed === trimmed.toUpperCase() || /^[A-Z][^.!?]*:$/.test(trimmed);
}

function Body({ body }: { body: string }) {
  // Blank lines separate paragraphs, which is how the template is written and
  // how it has always been shown. Collapsing runs of them keeps a template with
  // generous spacing from producing a mostly-empty second page.
  const blocks = body.replace(/\r\n/g, "\n").split(/\n{2,}/).map((block) => block.trim());

  return (
    <View>
      {blocks.filter(Boolean).map((block, index) => {
        const heading = looksLikeHeading(block);
        return (
          <Text
            key={`block-${index}`}
            style={[
              heading ? sheet.bold : {},
              {
                marginTop: heading ? 14 : 8,
                fontSize: heading ? 11 : 10,
              },
            ]}
          >
            {block}
          </Text>
        );
      })}
    </View>
  );
}

/**
 * One party's signing column: signature, printed name, date.
 *
 * The three blank spaces above the rules are where a pen goes on a printed copy,
 * and where an electronic signature goes once there is one — the same
 * coordinates either way, which is why this is real space rather than a picture
 * of a form. Unsigned, it is exactly the blank block it always was.
 */
function SignatureLine({
  role,
  name,
  signed,
}: {
  role: string;
  name?: string;
  signed?: ContractSignature;
}) {
  return (
    <View style={{ width: "46%" }}>
      <View style={{ height: 34, justifyContent: "flex-end" }}>
        {signed?.method === "drawn" && signed.image ? (
          // Sized to the space the pen would use, so it sits on the line
          // rather than floating over the paragraph above.
          //
          // The rule below is written for an HTML <img>. This is react-pdf's
          // Image, which has no alt prop at all; who signed is carried as text
          // on the same page, in the "signed electronically by" line and the
          // printed name beneath.
          // eslint-disable-next-line jsx-a11y/alt-text
          <Image src={signed.image} style={{ height: 32, objectFit: "contain", objectPosition: "left bottom" }} />
        ) : signed?.method === "typed" ? (
          // Tight line height and a lift off the rule: at 18pt the text box
          // otherwise reaches the bottom of this space, and the rule strikes
          // straight through the name.
          <Text style={{ fontFamily: "Times-Italic", fontSize: 18, lineHeight: 1, marginBottom: 4, color: "#0f172a" }}>
            {signed.name}
          </Text>
        ) : null}
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: "#0f172a", paddingTop: 4 }}>
        <Text style={sheet.bold}>{role}</Text>
        {name ? <Text style={sheet.muted}>{name}</Text> : null}
      </View>

      <View style={{ height: 26, justifyContent: "flex-end" }}>
        {signed ? <Text>{signed.name}</Text> : null}
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: "#0f172a", paddingTop: 4 }}>
        <Text style={sheet.muted}>Printed name</Text>
      </View>

      <View style={{ height: 26, justifyContent: "flex-end" }}>
        {signed ? <Text>{signed.signedLabel}</Text> : null}
      </View>
      <View style={{ borderTopWidth: 1, borderTopColor: "#0f172a", paddingTop: 4 }}>
        <Text style={sheet.muted}>Date</Text>
      </View>
    </View>
  );
}

export function ContractDocument({ data }: { data: ContractDocumentData }) {
  const { business } = data;
  const ownSignatures = bodyProvidesSignatures(data.body);

  return (
    <Document
      title={`Contract ${data.reference} — ${business.name}`}
      author={business.name}
      subject={`Contract for job #${data.job.number}`}
    >
      <Page size="LETTER" style={sheet.page}>
        <Letterhead business={business} title="CONTRACT" reference={data.reference} />

        <View style={[sheet.row, { justifyContent: "space-between", marginBottom: 8 }]}>
          <Labelled
            heading="Customer"
            width="46%"
            lines={[
              data.customer.name,
              ...data.customer.addressLines,
              data.customer.phone,
              data.customer.email,
            ]}
          />
          <Labelled
            heading="Job"
            width="46%"
            lines={[
              `Job #${data.job.number}`,
              ...data.job.addressLines,
              data.job.scheduledLabel,
              `Contract date ${data.createdLabel}`,
            ]}
          />
        </View>

        {/*
          Named on the document itself, not just in the app. A contract with
          {{permit_number}} still in it is one somebody signs without noticing,
          and the electrician is the last person who can catch it.
        */}
        {data.unfilled.length > 0 ? (
          <View
            style={{
              marginTop: 14,
              padding: 8,
              borderWidth: 1,
              borderColor: RULE,
              backgroundColor: "#fffbeb",
            }}
          >
            <Text style={sheet.bold}>Not ready to sign — {data.unfilled.length} blank to fill in</Text>
            <Text style={sheet.muted}>{data.unfilled.join(", ")}</Text>
          </View>
        ) : null}

        <View style={[sheet.divider, { marginTop: 16 }]} />

        <Body body={data.body} />

        {/*
          Unsigned, the block is left out when the business's own text already
          ends with somewhere to sign — two blank places to sign is a customer
          signing in the wrong one.

          Signed, it always appears. Otherwise a contract whose template has its
          own signing lines would come out of an electronic signature looking
          exactly as unsigned as it went in, while the record says it is signed.
          It is headed as a record of the signing, not a second place to sign.
        */}
        {ownSignatures && !data.signature ? null : (
          <View style={{ marginTop: 30 }} wrap={false}>
            <Text style={sheet.sectionHeading}>
              {data.signature && ownSignatures ? "SIGNED ELECTRONICALLY" : "SIGNATURES"}
            </Text>
            <Text style={[sheet.muted, { marginBottom: 6 }]}>
              {data.signature
                ? `Signed electronically by ${data.signature.name} on ${data.signature.signedLabel}.`
                : "By signing below both parties agree to the work and the price set out above."}
            </Text>
            <View style={[sheet.row, { justifyContent: "space-between", marginTop: 6 }]}>
              <SignatureLine
                role="Customer signature"
                name={data.customer.name}
                signed={data.signature}
              />
              <SignatureLine role="Contractor signature" name={business.name} />
            </View>
            {data.signature ? (
              <Text style={[sheet.muted, { marginTop: 10, fontSize: 7 }]}>
                Document fingerprint {data.signature.fingerprint}
              </Text>
            ) : null}
          </View>
        )}

        <DocumentFooter business={business} />
      </Page>
    </Document>
  );
}

export function contractFileName(reference: string, businessName: string): string {
  const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const safe = reference.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `contract-${safe || "draft"}${slug ? `-${slug}` : ""}.pdf`;
}
