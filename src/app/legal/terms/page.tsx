import type { Metadata } from "next";

import { legalContact } from "@/lib/legal-contact";

export const metadata: Metadata = {
  title: "SMS Terms & Conditions | Pacific Plains Electric",
  description: "Terms and conditions for the Pacific Plains Electric service notification text message program, including message frequency, rates, and opt-out instructions.",
};

const {
  businessName, supportPhone, supportEmail, mailingAddress,
  programName, messageFrequency, lastUpdated,
} = legalContact;

export default function SmsTermsPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Text Message Terms &amp; Conditions
      </h1>
      <p className="mt-2 text-sm text-slate-400">Last updated: {lastUpdated}</p>

      <h2 className="mt-8 text-lg font-semibold">Program name</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        {programName}, operated by {businessName}.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Program description</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        We send text messages about electrical service appointments you have booked with
        us. Messages include appointment confirmations, arrival windows, notifications
        that your technician is en route or has arrived, job completion notices,
        estimates and invoices, and replies to questions you send us about your service.
      </p>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        This is a transactional program.{" "}
        <strong className="text-white">We do not send marketing or promotional messages.</strong>
      </p>

      <h2 className="mt-8 text-lg font-semibold">How to join</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        You are enrolled when you provide your mobile number and agree to receive
        appointment updates while booking a service with us. Consent to receive text
        messages is not a condition of purchasing any goods or services — if you prefer
        not to receive texts, we will contact you by phone instead.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Message frequency</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        Message frequency varies with your service activity — typically {messageFrequency}.
        You will not receive messages when you have no active or upcoming appointment.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Message and data rates</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        <strong className="text-white">Message and data rates may apply.</strong> These are
        charged by your mobile carrier, not by us. Check your plan for details.
      </p>

      <h2 className="mt-8 text-lg font-semibold">How to opt out</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        Reply <strong className="text-white">STOP</strong> to any message to stop receiving
        texts from this program. You will receive one confirmation message and then no
        further texts. You may also reply STOPALL, UNSUBSCRIBE, CANCEL, END, or QUIT.
        Opting out does not cancel your appointment; we will reach you by phone instead.
        To rejoin, reply <strong className="text-white">START</strong>.
      </p>

      <h2 className="mt-8 text-lg font-semibold">How to get help</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        Reply <strong className="text-white">HELP</strong> to any message, or contact us at{" "}
        {supportPhone} or {supportEmail}.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Supported carriers</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        Supported on major US carriers including AT&amp;T, Verizon Wireless, T-Mobile,
        US Cellular, and others. Carriers are not liable for delayed or undelivered
        messages. Delivery is not guaranteed.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Emergencies</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        <strong className="text-white">
          Do not use text messages to report an emergency.
        </strong>{" "}
        If you see sparks, smoke, or fire, or smell burning, leave the building and call
        911. For a power outage or downed line, call your utility company. We do not
        monitor messages continuously and cannot guarantee a timely response.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Privacy</h2>
      <p className="mt-3 text-sm leading-6 text-slate-300">
        Your information is handled as described in our{" "}
        <a href="/legal/privacy" className="text-[#ffc21c] underline">Privacy Policy</a>.
        We do not sell your information, and mobile phone numbers are never shared with
        third parties for marketing.
      </p>

      <h2 className="mt-8 text-lg font-semibold">Contact</h2>
      <address className="mt-3 space-y-1 text-sm not-italic leading-6 text-slate-300">
        <div>{businessName}</div>
        <div>{mailingAddress}</div>
        <div>Phone: {supportPhone}</div>
        <div>Email: {supportEmail}</div>
      </address>
    </>
  );
}
