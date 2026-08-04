import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  displayNameFor,
  formatLastUpdated,
  getTenantLegalInfo,
  legalAttributionFor,
} from "@/lib/supabase/public";

type Params = { params: Promise<{ org: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { org } = await params;
  const info = await getTenantLegalInfo(org);
  if (!info) return { title: "Not found" };
  const name = displayNameFor(info);
  return {
    title: `Privacy Policy | ${name}`,
    description: `How ${name} collects, uses, and protects customer information, including mobile phone numbers used for service text messages.`,
  };
}

export default async function TenantPrivacyPage({ params }: Params) {
  const { org } = await params;
  const info = await getTenantLegalInfo(org);
  // Unpublished or unknown tenants 404 rather than serving placeholder text.
  if (!info) notFound();

  const name = displayNameFor(info);

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Privacy Policy</h1>
      <p className="mt-2 text-sm text-slate-400">
        {legalAttributionFor(info)} · Last updated {formatLastUpdated(info.updated_at)}
      </p>

      <p className="mt-8 text-sm leading-6 text-slate-300">
        This policy explains how {name} collects, uses, and protects information about our
        customers, including the mobile phone numbers we use to send text messages about
        scheduled electrical work.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Information we collect</h2>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
        <li>• <strong className="text-white">Contact information</strong> — your name, mobile phone number, email address, and service address, provided when you book an appointment.</li>
        <li>• <strong className="text-white">Service information</strong> — details about the electrical work requested and performed at your property, including notes, photographs of the work area, estimates, and invoices.</li>
        <li>• <strong className="text-white">Message records</strong> — text messages exchanged between you and us about your appointment, with delivery status and timestamps.</li>
        <li>• <strong className="text-white">Consent records</strong> — the date you consented to receive text messages, how consent was obtained, and the disclosure you were given.</li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">How we use it</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        We use this information only to schedule and perform your electrical service, to
        communicate with you about it, and to bill for it — confirming appointments,
        sending arrival windows and technician en-route notifications, answering your
        questions, delivering estimates and invoices, and maintaining records of work
        performed at your property.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Text messaging</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        We text you only if you asked us to — by ticking the optional, empty-by-default
        text message box on our online booking page, or by agreeing when we read you the
        same disclosure on the phone or in person. Consent is never pre-checked, never
        bundled with another agreement, and is not required to book or pay for service.{" "}
        We send text messages only about service you have requested. We do not send
        marketing or promotional text messages. Reply <strong className="text-white">STOP</strong> to
        any message to stop receiving them, or <strong className="text-white">HELP</strong> for
        assistance. Opting out does not cancel your appointment — we will contact you by
        phone instead. Message and data rates may apply.
      </p>

      <h2 className="mt-8 text-lg font-semibold">We do not sell or share your information</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        <strong className="text-white">
          We do not sell your personal information. We do not share your information with
          third parties for their own marketing purposes. Mobile phone numbers and text
          message consent are never shared with third parties or affiliates for marketing.
        </strong>{" "}
        The only parties who receive your information are the service providers that
        operate this system on our behalf — our messaging carrier, which transmits the
        text messages, and our software, hosting, and database providers, which store the
        records. These providers act under contract and may use the information only to
        deliver the service to us.
      </p>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        We may also disclose information where required by law, or to protect the safety
        of a person or property.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Data retention and security</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        We keep service and billing records for as long as needed to serve you and to meet
        legal, tax, and insurance obligations. Consent and opt-out records are kept for as
        long as we operate the text messaging program, so we can honor your preferences.
        Information is stored in access-controlled systems, and access is limited to staff
        who need it to do their work.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Your choices</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        You can ask us to correct your contact details, stop texting you, or provide a copy
        of the information we hold about you. Contact us below and we will respond within a
        reasonable time.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Contact us</h2>
      <address className="mt-3 space-y-1 text-sm not-italic leading-6 text-slate-300">
        <div>{legalAttributionFor(info)}</div>
        <div>{info.mailing_address}</div>
        <div>Phone: {info.support_phone}</div>
        <div>Email: {info.support_email}</div>
      </address>
    </>
  );
}
