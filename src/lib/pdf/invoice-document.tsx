import { Document, Page, Text, View } from "@react-pdf/renderer";

import {
  Labelled,
  Letterhead,
  MUTED,
  RULE,
  sheet,
  type BusinessLetterhead,
} from "@/lib/pdf/letterhead";

/**
 * The invoice as the customer receives it.
 *
 * Before this, "creating an invoice" produced a row and a subtotal, and the
 * electrician had to imagine what the customer would see. The point of a
 * document is that there is nothing left to imagine: the same file is previewed,
 * downloaded and sent.
 *
 * Every figure comes in already worked out. Nothing here adds up a column —
 * `invoice-math` does that once, on the server, and a template that did its own
 * arithmetic would be a second answer to disagree with the first.
 */


export type InvoiceDocumentData = {
  business: BusinessLetterhead;
  invoiceNumber: string;
  issuedLabel: string;
  dueLabel: string;
  statusLabel: string;
  customer: { name: string; addressLines: string[]; phone: string; email: string };
  job: { number: string; addressLines: string[]; serviceDateLabel: string; technician: string };
  /**
   * What the work was, in a sentence. The customer is billed for the work as a
   * whole: the line items (each part and its price) stay with the electrician
   * and are never printed on the invoice.
   */
  workSummary: string;
  totals: {
    subtotalLabel: string;
    /** Already-paid diagnostic taken off the repair. Empty when there was none. */
    diagnosticCreditLabel: string;
    taxLabel: string;
    totalLabel: string;
    paidLabel: string;
    balanceLabel: string;
  };
  paymentTerms: string;
  customerNote: string;
};

const COLUMNS = { description: "75%", amount: "25%" } as const;

function TotalRow({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: "strong" | "credit";
}) {
  return (
    <View
      style={[
        sheet.row,
        {
          justifyContent: "space-between",
          paddingVertical: emphasis === "strong" ? 7 : 3,
          borderTopWidth: emphasis === "strong" ? 1 : 0,
          borderTopColor: RULE,
        },
      ]}
    >
      <Text style={emphasis === "strong" ? sheet.bold : sheet.muted}>{label}</Text>
      <Text
        style={[
          emphasis === "strong" ? sheet.bold : undefined,
          emphasis === "strong" ? { fontSize: 13 } : undefined,
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

export function InvoiceDocument({ data }: { data: InvoiceDocumentData }) {
  const { business, totals } = data;

  return (
    <Document
      title={`Invoice ${data.invoiceNumber} — ${business.name}`}
      author={business.name}
      subject={`Invoice for job #${data.job.number}`}
    >
      <Page size="LETTER" style={sheet.page}>
        <Letterhead business={business} title="INVOICE" reference={`#${data.invoiceNumber}`} />

        {/* Dates and status opposite the two addresses, so the first glance
            answers "who is this for" and "when is it due" together. */}
        <View style={[sheet.row, { justifyContent: "space-between", marginBottom: 14 }]}>
          <Labelled
            heading="Bill to"
            width="46%"
            lines={[
              data.customer.name,
              ...data.customer.addressLines,
              data.customer.phone,
              data.customer.email,
            ]}
          />

          <View style={{ width: "40%" }}>
            {[
              ["Invoice date", data.issuedLabel],
              ["Due", data.dueLabel],
              ["Status", data.statusLabel],
            ].map(([label, value]) => (
              <View key={label} style={[sheet.row, { justifyContent: "space-between" }]}>
                <Text style={sheet.muted}>{label}</Text>
                <Text style={sheet.bold}>{value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/*
          Joined rather than stacked. On a residential job the service address
          is the billing address, so five more lines of it is the same
          information again at the cost of the page it has to fit on.
        */}
        <View style={{ marginBottom: 14 }}>
          <Labelled
            heading="Job"
            lines={[
              `Job #${data.job.number} — ${data.job.addressLines.filter(Boolean).join(", ")}`,
              [
                data.job.serviceDateLabel ? `Service date ${data.job.serviceDateLabel}` : "",
                data.job.technician ? `Electrician: ${data.job.technician}` : "",
              ]
                .filter(Boolean)
                .join("   ·   "),
            ]}
          />
        </View>

        <View
          style={[
            sheet.row,
            { borderBottomWidth: 1, borderBottomColor: "#0f172a", paddingBottom: 5 },
          ]}
        >
          <Text style={[sheet.sectionHeading, { width: COLUMNS.description, marginBottom: 0 }]}>
            DESCRIPTION
          </Text>
          <Text
            style={[sheet.sectionHeading, { width: COLUMNS.amount, marginBottom: 0, textAlign: "right" }]}
          >
            AMOUNT
          </Text>
        </View>

        <View
          style={[sheet.row, { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: RULE }]}
          wrap={false}
        >
          <View style={{ width: COLUMNS.description, paddingRight: 8 }}>
            <Text style={{ fontWeight: "bold" }}>Electrical work (labor and materials)</Text>
            {data.workSummary ? <Text style={sheet.muted}>{data.workSummary}</Text> : null}
          </View>
          <Text style={{ width: COLUMNS.amount, textAlign: "right" }}>{totals.subtotalLabel}</Text>
        </View>

        <View style={[sheet.row, { justifyContent: "flex-end", marginTop: 14 }]} wrap={false}>
          <View style={{ width: "50%" }}>
            <TotalRow label="Subtotal" value={totals.subtotalLabel} />
            {/* Only when there was one. A "Diagnostic credit $0.00" line on a
                first invoice is a line that says nothing. */}
            {totals.diagnosticCreditLabel ? (
              <TotalRow label="Diagnostic fee already paid" value={totals.diagnosticCreditLabel} />
            ) : null}
            {totals.taxLabel ? <TotalRow label="Tax" value={totals.taxLabel} /> : null}
            <TotalRow label="Total" value={totals.totalLabel} emphasis="strong" />
            {totals.paidLabel ? <TotalRow label="Payments received" value={totals.paidLabel} /> : null}
            <TotalRow label="Balance due" value={totals.balanceLabel} emphasis="strong" />
          </View>
        </View>

        {data.customerNote ? (
          <View style={{ marginTop: 16 }} wrap={false}>
            <Text style={sheet.sectionHeading}>NOTES</Text>
            <Text>{data.customerNote}</Text>
          </View>
        ) : null}

        <View style={{ marginTop: 16 }} wrap={false}>
          <Text style={sheet.sectionHeading}>PAYMENT</Text>
          <Text>{data.paymentTerms}</Text>
          <Text style={sheet.muted}>
            Thank you for your business. Questions? Call {business.phone || "us"}.
          </Text>
        </View>

        {/*
          No footer strip on the invoice. The letterhead six inches above
          already carries the name, address, phone and licence number, so a
          footer repeats all of it — and repeating it cost a second, near-empty
          page on an ordinary four-line invoice. The contract keeps one, where
          the document runs to several pages anyway.
        */}
      </Page>
    </Document>
  );
}

/** Used by the viewer's title bar so both halves say the same thing. */
export function invoiceFileName(invoiceNumber: string, businessName: string): string {
  const slug = businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `invoice-${invoiceNumber}${slug ? `-${slug}` : ""}.pdf`;
}

export { MUTED };
