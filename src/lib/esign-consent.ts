/**
 * The consent to electronic records and signatures a customer agrees to before
 * signing a contract or change order.
 *
 * Under the federal ESIGN Act (15 U.S.C. § 7001(c)), when a law requires a
 * consumer to receive something in writing, it may be given electronically
 * only after the consumer has been told, before consenting: that they may have
 * it on paper; that they may withdraw consent and how; what the consent covers;
 * how to get a paper copy and whether it costs anything; and what they need to
 * open and keep the records. California home improvement contracts carry
 * written notices (Bus. & Prof. Code § 7159), so this is the version shown.
 *
 * Plain words on purpose: a homeowner reads this on a phone. Have a California
 * lawyer review the final wording.
 *
 * Import-free, so the text can be read in a test.
 */

/** Bumped whenever the wording below changes. */
export const ESIGN_CONSENT_VERSION = "2026-11-19";

export type EsignSection = { heading: string; body: string };

export function esignConsentSections(business = "the business"): EsignSection[] {
  return [
    {
      heading: "What you are agreeing to",
      body: `You agree to receive this agreement, its notices (including any notice of your right to cancel), and any change orders from ${business} electronically, and to sign them electronically. Your electronic signature has the same effect as signing by hand.`,
    },
    {
      heading: "Paper copies",
      body: `You can ask ${business} for a paper copy of anything you sign here, at no charge, at any time. You do not have to sign electronically: you can ask to sign on paper instead.`,
    },
    {
      heading: "Changing your mind",
      body: `You can withdraw this consent at any time by telling ${business} by phone, text or email. Withdrawing does not undo anything you already signed; from then on, documents will be given to you on paper.`,
    },
    {
      heading: "What you need",
      body: "A phone, tablet or computer with a current web browser that can open PDF files, and an email address or mobile number where we can send your copies. Keep your signed copy by downloading it or keeping the email.",
    },
    {
      heading: "Keeping your contact details up to date",
      body: `If your email address or phone number changes, tell ${business} so your copies and notices reach you.`,
    },
  ];
}

/** The one line beside the checkbox. */
export function esignConsentLine(what: string): string {
  return `I have read the electronic records consent below and agree to receive and sign this ${what} electronically. My electronic signature counts the same as signing by hand.`;
}
