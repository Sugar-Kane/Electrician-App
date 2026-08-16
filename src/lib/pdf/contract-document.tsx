import { Document, Page, Text, View } from "@react-pdf/renderer";

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

function SignatureLine({ role, name }: { role: string; name?: string }) {
  return (
    <View style={{ width: "46%" }}>
      <View style={{ height: 34 }} />
      <View style={{ borderTopWidth: 1, borderTopColor: "#0f172a", paddingTop: 4 }}>
        <Text style={sheet.bold}>{role}</Text>
        {name ? <Text style={sheet.muted}>{name}</Text> : null}
      </View>

      <View style={{ height: 26 }} />
      <View style={{ borderTopWidth: 1, borderTopColor: "#0f172a", paddingTop: 4 }}>
        <Text style={sheet.muted}>Printed name</Text>
      </View>

      <View style={{ height: 26 }} />
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

        {ownSignatures ? null : (
          <View style={{ marginTop: 30 }} wrap={false}>
            <Text style={sheet.sectionHeading}>SIGNATURES</Text>
            <Text style={[sheet.muted, { marginBottom: 6 }]}>
              By signing below both parties agree to the work and the price set out above.
            </Text>
            <View style={[sheet.row, { justifyContent: "space-between", marginTop: 6 }]}>
              <SignatureLine role="Customer signature" name={data.customer.name} />
              <SignatureLine role="Contractor signature" name={business.name} />
            </View>
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
