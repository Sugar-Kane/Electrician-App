import type { Metadata } from "next";

import { legalContact } from "@/lib/legal-contact";

export const metadata: Metadata = {
  title: "Privacy Policy | Pacific Plains Electric",
  description: "How Pacific Plains Electric collects, uses, and protects customer information, including mobile phone numbers used for service text messages.",
};

const { businessName, supportPhone, supportEmail, mailingAddress, lastUpdated } = legalContact;

export default function PrivacyPolicyPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Privacy Policy</h1>
      <p className="mt-2 text-sm text-slate-400">Last updated: {lastUpdated}</p>

      <section className="mt-8 space-y-4 text-sm leading-6 text-slate-300">
        <p>
          This policy explains how {businessName} collects, uses, and protects information
          about our customers, including the mobile phone numbers we use to send text
          messages about scheduled electrical work.
        </p>
      </section>

      <h2 className="mt-8 text-lg font-semibold">Information we collect</h2>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
        <li>• <strong className="text-white">Contact information</strong> — your name, mobile phone number, email address, and service address, provided when you book an appointment.</li>
        <li>• <strong className="text-white">Service information</strong> — details about the electrical work requested and performed at your property, including notes, photographs of the work area, estimates, and invoices.</li>
        <li>• <strong className="text-white">Message records</strong> — the text messages exchanged between you and us about your appointment, along with delivery status and timestamps.</li>
        <li>• <strong className="text-white">Consent records</strong> — the date you consented to receive text messages, how consent was obtained, and the disclosure you were given.</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">How we use it</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        We use this information only to schedule and perform your electrical service, to
        communicate with you about it, and to bill for it. Specifically: confirming
        appointments, sending arrival windows and technician en-route notifications,
        answering your questions, delivering estimates and invoices, and maintaining
        records of work performed at your property.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Text messaging</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        We send text messages only about service you have requested. We do not send
        marketing or promotional text messages. You can reply <strong className="text-white">STOP</strong> to
        any message to stop receiving them, or <strong className="text-white">HELP</strong> for assistance.
        Opting out of text messages does not cancel your appointment — we will contact
        you by phone instead. Message and data rates may apply.
      </p>

      <h2 className="mt-8 text-lg font-semibold">
        We do not sell or share your information
      </h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        <strong className="text-white">
          We do not sell your personal information. We do not share your information with
          third parties for their own marketing purposes. Mobile phone numbers and text
          message consent are never shared with third parties or affiliates for marketing.
        </strong>{" "}
        The only parties who receive your information are the service providers that
        operate this system on our behalf — our messaging carrier, which transmits the
        text messages, and our hosting and database providers, which store the records.
        These providers act under contract and may use the information only to deliver
        the service to us.
      </p>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        We may also disclose information where required by law, or to protect the safety
        of a person or property.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Data retention and security</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        We keep service and billing records for as long as needed to serve you and to
        meet legal, tax, and insurance obligations. Consent and opt-out records are kept
        for as long as we operate the text messaging program, so we can honor your
        preferences. Information is stored in access-controlled systems, and access is
        limited to staff who need it to do their work.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Your choices</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        You can ask us to correct your contact details, stop texting you, or provide a
        copy of the information we hold about you. Contact us using the details below
        and we will respond within a reasonable time.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Contact us</h2>
      <address className="mt-3 space-y-1 text-sm not-italic leading-6 text-slate-300">
        <div>{businessName}</div>
        <div>{mailingAddress}</div>
        <div>Phone: {supportPhone}</div>
        <div>Email: {supportEmail}</div>
      </address>
    </>
  );
}
