import { StyleSheet, Text, View } from "@react-pdf/renderer";

/**
 * What every document this business sends has in common.
 *
 * One letterhead, one palette, one set of margins, so an invoice and a contract
 * arriving a week apart look like they came from the same company. They are
 * built as PDFs rather than as HTML somebody prints: a customer forwards an
 * invoice to their landlord, opens it on a phone eight months later, or gives
 * it to an insurer, and none of that survives a screenshot of a web page.
 *
 * Deliberately plain. Colour is one accent line and one heading; everything
 * else is black on white, because this gets printed on the cheapest office
 * printer in the world and has to be legible when it does.
 */

export type BusinessLetterhead = {
  name: string;
  phone: string;
  email: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  /** Printed verbatim under the address. Empty when the business has not set one. */
  licenseNumber: string;
};

export const INK = "#0f172a";
export const MUTED = "#64748b";
export const RULE = "#cbd5e1";
export const ACCENT = "#b8860b";

export const sheet = StyleSheet.create({
  page: {
    paddingTop: 40,
    // 44 at the bottom, which is the footer's own height plus a little. More
    // than that and a single-line invoice runs to two pages with an inch of
    // nothing at the bottom of the first, which reads as a mistake.
    paddingBottom: 44,
    paddingHorizontal: 44,
    fontSize: 10,
    // 1.4, not 1.5. A one-page invoice stacks about twenty lines between the
    // letterhead and the totals, and the extra tenth of a line on each was
    // enough to push the notes and the payment terms onto a second page that
    // was otherwise empty.
    lineHeight: 1.4,
    color: INK,
    fontFamily: "Helvetica",
  },
  // Explicit line heights on both. The page's `lineHeight` does not cascade to
  // a Text that sets its own fontSize, so a 20pt heading was given a ~10pt line
  // box and the address underneath was drawn straight through it.
  businessName: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.3,
    lineHeight: 1.25,
    marginBottom: 3,
  },
  documentTitle: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
    lineHeight: 1.25,
    marginBottom: 2,
  },
  muted: { color: MUTED },
  accentRule: { height: 3, backgroundColor: ACCENT, marginTop: 10, marginBottom: 14 },
  sectionHeading: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.1,
    color: MUTED,
    marginBottom: 5,
  },
  row: { flexDirection: "row" },
  bold: { fontFamily: "Helvetica-Bold" },
  divider: { borderBottomWidth: 1, borderBottomColor: RULE },
  /*
   * In the flow, after the content, rather than absolutely positioned and
   * `fixed`.
   *
   * The absolute-and-fixed recipe is the documented way to repeat a footer on
   * every page and it rendered nothing at all here — no rule, no text, no page
   * number, silently. `marginTop: auto` to pin it to the bottom was worse
   * again: the flex fill consumed the remaining space and forced a second page.
   *
   * So it simply follows the content. A footer that always appears beats one
   * that is theoretically on every page and is in practice on none.
   */
  footer: {
    marginTop: 26,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: RULE,
    fontSize: 8,
    lineHeight: 1.4,
    color: MUTED,
  },
});

/** The business, top-left, with the document's own name opposite it. */
export function Letterhead({
  business,
  title,
  reference,
}: {
  business: BusinessLetterhead;
  /** "INVOICE" or "CONTRACT". */
  title: string;
  /** The number under the title, e.g. "#1024". */
  reference?: string;
}) {
  const cityLine = [business.city, business.state].filter(Boolean).join(", ");

  return (
    <View>
      <View style={[sheet.row, { justifyContent: "space-between", alignItems: "flex-start" }]}>
        <View style={{ maxWidth: 300 }}>
          <Text style={sheet.businessName}>{business.name}</Text>
          {business.addressLine1 ? (
            <Text style={sheet.muted}>{business.addressLine1}</Text>
          ) : null}
          {cityLine || business.postalCode ? (
            <Text style={sheet.muted}>{[cityLine, business.postalCode].filter(Boolean).join(" ")}</Text>
          ) : null}
          {/* Phone and email on one line. Two lines of contact detail at the
              top and the same again in the footer is the same information
              three times, at the cost of the page it has to fit on. */}
          {business.phone || business.email ? (
            <Text style={sheet.muted}>
              {[business.phone, business.email].filter(Boolean).join("  ·  ")}
            </Text>
          ) : null}
          {/* The one line that makes this a contractor's paperwork rather than
              a receipt. Omitted rather than faked when it is not set. */}
          {business.licenseNumber ? (
            <Text style={[sheet.muted, { marginTop: 4 }]}>Lic. {business.licenseNumber}</Text>
          ) : null}
        </View>

        <View>
          <Text style={sheet.documentTitle}>{title}</Text>
          {reference ? (
            <Text style={[sheet.muted, { textAlign: "right" }]}>{reference}</Text>
          ) : null}
        </View>
      </View>

      <View style={sheet.accentRule} />
    </View>
  );
}

/** A labelled block, the shape both documents use for Bill To and Job. */
export function Labelled({
  heading,
  lines,
  width,
}: {
  heading: string;
  lines: (string | null | undefined)[];
  width?: string | number;
}) {
  const visible = lines.filter((line): line is string => Boolean(line && line.trim()));

  return (
    <View style={{ width }}>
      <Text style={sheet.sectionHeading}>{heading.toUpperCase()}</Text>
      {visible.length === 0 ? (
        <Text style={sheet.muted}>Not recorded</Text>
      ) : (
        visible.map((line, index) => (
          <Text key={`${heading}-${index}`} style={index === 0 ? sheet.bold : undefined}>
            {line}
          </Text>
        ))
      )}
    </View>
  );
}

/** The strip along the foot of the document. */
export function DocumentFooter({
  business,
  note,
}: {
  business: BusinessLetterhead;
  note?: string;
}) {
  return (
    <View style={sheet.footer}>
      {note ? <Text style={{ marginBottom: 3 }}>{note}</Text> : null}
      <View style={[sheet.row, { justifyContent: "space-between" }]}>
        <Text>
          {[business.name, business.phone, business.licenseNumber ? `Lic. ${business.licenseNumber}` : ""]
            .filter(Boolean)
            .join("  ·  ")}
        </Text>
        {/*
          `fixed` so the callback is evaluated per page. It reports the page it
          is drawn on, which for an in-flow footer is the last one.
        */}
        <Text fixed render={({ totalPages }) => `${totalPages} ${totalPages === 1 ? "page" : "pages"}`} />
      </View>
    </View>
  );
}
