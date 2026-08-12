import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  displayNameFor,
  formatLastUpdated,
  getTenantLegalInfo,
  legalAttributionFor,
} from "@/lib/supabase/public";
import { smsConsentDisclosure } from "@/lib/sms-consent";

type Params = { params: Promise<{ org: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { org } = await params;
  const info = await getTenantLegalInfo(org);
  if (!info) return { title: "Not found" };
  const name = displayNameFor(info);
  return {
    title: `SMS Terms & Conditions | ${name}`,
    description: `Terms and conditions for the ${name} service notification text message program, including message frequency, rates, and opt-out instructions.`,
  };
}

export default async function TenantSmsTermsPage({ params }: Params) {
  const { org } = await params;
  const info = await getTenantLegalInfo(org);
  if (!info) notFound();

  const name = displayNameFor(info);
  // The reviewer needs to be able to open the opt-in page and see the checkbox
  // for themselves, so the terms name the exact URL where consent is collected.
  const appOrigin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  const bookingUrl = `${appOrigin ?? ""}/book/${info.slug}`;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Text Message Terms &amp; Conditions
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        {legalAttributionFor(info)} · Last updated {formatLastUpdated(info.updated_at)}
      </p>

      <h2 className="mt-8 text-lg font-semibold">Program name</h2>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        {info.program_name}, operated by {legalAttributionFor(info)}.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Program description</h2>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        {name} sends text messages about electrical service appointments you have booked
        with us. Messages include appointment confirmations, arrival windows,
        notifications that your technician is en route or has arrived, job completion
        notices, estimates and invoices, and replies to questions you send us about your
        service.
      </p>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        This is a transactional program operated solely by {name} for its own customers.{" "}
        <strong className="text-white">
          We do not send marketing or promotional messages, and we do not send messages on
          behalf of any third party.
        </strong>
      </p>

      <h2 className="mt-8 text-lg font-semibold">How you join (opt-in)</h2>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        There is one way to join, and it is described in full below. Consent is
        never pre-checked, never assumed, and never obtained from a third party or
        purchased list.
      </p>
      <ul className="mt-3 space-y-3 text-sm leading-6 text-ink-muted">
        <li>
          • <strong className="text-white">On the online booking page.</strong> At{" "}
          <span className="break-all">{bookingUrl}</span> you describe the
          electrical problem, answer a short safety check, enter your contact and
          service details, and choose an arrival window. On the final step, below
          the appointment summary, there is a checkbox that is{" "}
          <strong className="text-white">empty by default</strong> and separate
          from every other agreement on the page. Its label reads, in full:{" "}
          <em>&ldquo;{smsConsentDisclosure(name)}&rdquo;</em> You are enrolled only
          if you tick that box yourself before submitting the form. Leaving it
          empty does not stop the booking or the payment — the checkout button
          works either way — and we record the date, the wording above, and the
          fact that consent came from this form.
        </li>
      </ul>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        Consent to receive text messages is not a condition of purchasing any goods or
        services. Declining does not affect your appointment — we will reach you by phone.
      </p>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        <strong className="text-white">Booking by phone does not enroll you.</strong> If
        you call {name} to book, we arrange the appointment and reach you by phone about
        it. We text you only if you opt in yourself through the booking page above.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Sample messages</h2>
      <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-muted">
        <li>
          • <em>&ldquo;{name}: your electrical diagnostic is confirmed for Tue Aug 11,
          8:00–10:00 AM at 214 Oak St. Reply STOP to opt out, HELP for help.&rdquo;</em>
        </li>
        <li>
          • <em>&ldquo;{name}: your technician is on the way and should arrive in about
          20 minutes. Reply STOP to opt out, HELP for help.&rdquo;</em>
        </li>
        <li>
          • <em>&ldquo;{name}: your estimate for the panel repair is ready. Reply with any
          questions. Reply STOP to opt out, HELP for help.&rdquo;</em>
        </li>
      </ul>

      <h2 className="mt-8 text-lg font-semibold">Message frequency</h2>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        Message frequency varies with your service activity — typically {info.message_frequency}.
        You will not receive messages when you have no active or upcoming appointment.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Message and data rates</h2>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        <strong className="text-white">Message and data rates may apply.</strong> These are
        charged by your mobile carrier, not by us. Check your plan for details.
      </p>

      <h2 className="mt-8 text-lg font-semibold">How to opt out</h2>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        Reply <strong className="text-white">STOP</strong> to any message to stop receiving
        texts from this program. You will receive one confirmation message and then no
        further texts. You may also reply STOPALL, UNSUBSCRIBE, CANCEL, END, or QUIT.
        Opting out does not cancel your appointment; we will reach you by phone instead.
        To rejoin, reply <strong className="text-white">START</strong>.
      </p>

      <h2 className="mt-8 text-lg font-semibold">How to get help</h2>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        Reply <strong className="text-white">HELP</strong> to any message, or contact us at{" "}
        {info.support_phone} or {info.support_email}.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Supported carriers</h2>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        Supported on major US carriers including AT&amp;T, Verizon Wireless, T-Mobile, and
        US Cellular. Carriers are not liable for delayed or undelivered messages. Delivery
        is not guaranteed.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Emergencies</h2>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        <strong className="text-white">Do not use text messages to report an emergency.</strong>{" "}
        If you see sparks, smoke, or fire, or smell burning, leave the building and call
        911. For a power outage or downed line, call your utility company. We do not
        monitor messages continuously and cannot guarantee a timely response.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Privacy</h2>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        Your information is handled as described in our{" "}
        <a href={`/legal/${info.slug}/privacy`} className="text-brand underline">
          Privacy Policy
        </a>
        . We do not sell your information, and mobile phone numbers and messaging consent
        are never shared with third parties or affiliates for marketing or promotional
        purposes.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Contact</h2>
      <address className="mt-3 space-y-1 text-sm not-italic leading-6 text-ink-muted">
        <div>{legalAttributionFor(info)}</div>
        <div>{info.mailing_address}</div>
        <div>Phone: {info.support_phone}</div>
        <div>Email: {info.support_email}</div>
      </address>
    </>
  );
}
