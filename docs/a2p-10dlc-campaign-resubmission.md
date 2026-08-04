# A2P 10DLC campaign resubmission (Twilio error 30909)

Campaign `CM6e23febad99f84935d27817022309529` was rejected with error 30909:
the Message Flow / Call to Action did not let the reviewer verify how end users
consent to receive messages.

## Why it was rejected

Two defects, both fixed on this branch:

1. **The legal URLs filed with the campaign returned 404.** `/legal/{org}/privacy`
   and `/legal/{org}/terms` read `public.tenant_legal_pages`, a table no migration
   ever created. `getTenantLegalInfo` returned `null` and both pages called
   `notFound()`, so a reviewer opening the Privacy Policy or SMS terms saw a 404.
   That alone triggers the companion codes 30907, 30908, 30933, and 30934.
2. **The web opt-in was not a valid opt-in.** The booking form's only checkbox
   mixed the cancellation policy with "I agree to receive transactional calls,
   texts, or emails," and checkout was blocked until it was ticked. Messaging
   consent bundled with another agreement and required to complete a purchase is
   rejected under 30924 and 30925, and the booking page was not described as an
   opt-in path in the SMS terms at all (30917).

## What changed

- `supabase/migrations/20260804191500_tenant_legal_pages_and_sms_consent.sql`
  - Creates `public.tenant_legal_pages` with anon-readable RLS for published
    rows, so the legal pages render for a signed-out reviewer.
  - Backfills a published row per onboarded organization from its business
    name, phone, address, and owner email. Tenants missing any of those stay
    unpublished and continue to 404 rather than showing placeholder text.
  - Keeps `tenant_legal_pages.slug` in sync with `organizations.slug` so a
    rename never orphans a URL already filed with the carrier.
  - Adds `sms_consent`, `sms_consent_at`, `sms_consent_source`, and
    `sms_consent_disclosure` to `booking_intakes`, with a check constraint that
    an opt-in cannot be stored without its evidence.
  - Recreates `create_public_booking_intake` to record messaging consent
    separately from the cancellation policy. The consent source is hardcoded to
    `web_booking_form` inside the function so an anon caller cannot claim a
    verbal opt-in.
- `src/lib/sms-consent.ts` — one source of truth for the disclosure wording,
  used by the checkbox, the stored consent record, and the published SMS terms.
- `src/components/public-booking-flow.tsx` — the messaging opt-in is now its own
  checkbox: empty by default, optional, and never disabling the checkout button.
  The required checkbox covers the diagnostic and cancellation policy plus phone
  and email contact about the request.
- `src/app/book/[slug]/actions.ts` — posts the consent flag and rebuilds the
  disclosure text server-side rather than trusting the browser's copy.
- `src/app/legal/[org]/terms/page.tsx` — documents the online booking opt-in as
  a complete workflow, quotes the checkbox label verbatim, names the URL where
  consent is collected, and adds sample messages.
- `src/app/legal/[org]/privacy/page.tsx` — states how consent is obtained and
  that it is neither pre-checked, bundled, nor required to book.

## Before resubmitting

1. Apply the migration to the production project.
2. Open `https://<app-domain>/legal/<org-slug>/privacy` and
   `https://<app-domain>/legal/<org-slug>/terms` **signed out** and confirm both
   render with the real business name, phone, email, and mailing address — no
   404, no login wall (30921), no placeholder text.
3. Open `https://<app-domain>/book/<org-slug>` signed out and confirm the
   messaging checkbox is visible, empty, and that checkout works with it left
   empty.
4. Set `NEXT_PUBLIC_APP_URL` in the deployment so the SMS terms print the full
   opt-in URL rather than a bare path.
5. Capture a screenshot of the final booking step showing the unchecked box and
   its full label; attach it to the campaign.

## Campaign fields to submit

**Call to Action / Message Flow:**

> End users opt in on the business's own web booking page at
> https://<app-domain>/book/<org-slug>. After describing the electrical problem,
> completing a safety check, entering their contact and service address details,
> and selecting an arrival window, the customer reaches the final step, which
> shows a checkbox that is unchecked by default and separate from every other
> agreement on the page. Its label reads: "I agree to receive text messages from
> {Business Name} about this appointment, including confirmations, arrival
> windows, technician en-route notices, and replies about my service. Message
> frequency varies. Message and data rates may apply. Reply STOP to opt out or
> HELP for help. Consent is not a condition of purchase, and declining does not
> affect this booking." Links to the Privacy Policy and the Text Message Terms
> appear directly beneath it. The customer must tick the box themselves; leaving
> it empty does not block booking or payment. The opt-in date, the exact
> disclosure text, and the opt-in source are stored with the booking record.
>
> Customers who book by phone opt in verbally: the scheduler asks, "May we send
> you text message updates about this appointment? Message and data rates may
> apply, message frequency varies, and you can reply STOP at any time to opt
> out." The same disclosure is read in person when a technician books follow-up
> work. Both are recorded against the customer record with the date and the
> disclosure given. No numbers are purchased, rented, or obtained from third
> parties.

**Sample messages:**

1. `{Business Name}: your electrical diagnostic is confirmed for Tue Aug 11, 8:00-10:00 AM at 214 Oak St. Reply STOP to opt out, HELP for help.`
2. `{Business Name}: your technician is on the way and should arrive in about 20 minutes. Reply STOP to opt out, HELP for help.`
3. `{Business Name}: your estimate for the panel repair is ready. Reply with any questions. Reply STOP to opt out, HELP for help.`

**Opt-in keywords:** START · **Opt-out keywords:** STOP, STOPALL, UNSUBSCRIBE,
CANCEL, END, QUIT · **Help keywords:** HELP

**Privacy Policy URL:** `https://<app-domain>/legal/<org-slug>/privacy`
**Terms and Conditions URL:** `https://<app-domain>/legal/<org-slug>/terms`

Replace `<app-domain>` and `<org-slug>` with the deployed values before
submitting; both pages must be publicly reachable at the exact URLs filed.
