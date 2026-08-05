# A2P 10DLC campaign resubmission (Twilio error 30909)

Campaign `CM6e23febad99f84935d27817022309529` was rejected with error 30909:
the Message Flow / Call to Action did not let the reviewer verify how end users
consent to receive messages.

## Why it was rejected

**The web opt-in was not a valid opt-in.** The booking form's only checkbox
mixed the cancellation policy with "I agree to receive transactional calls,
texts, or emails," and the checkout button stayed disabled until it was ticked.
Messaging consent bundled with another agreement and required to complete a
purchase is rejected under 30924 and 30925. The booking page — the one place
customers actually opt in online — was not described as an opt-in path in the
published SMS terms at all (30917), so nothing the reviewer could read
explained how consent was collected.

Consent also went nowhere. `confirm_public_booking_payment` created every
booked customer with `preferred_contact = 'sms'` regardless of what they
agreed to, and never wrote a row to `messaging_consent`, the ledger the
sending path reads. The business would have been texting customers with no
consent record to show.

The published legal pages themselves check out: `tenant_legal_pages` holds a
published row for the live tenant with a real business name, phone, email, and
mailing address, so `/legal/{slug}/privacy` and `/legal/{slug}/terms` render
for a signed-out reviewer today.

## Schema drift — captured

The deployed database had four migrations with no file in this repo:
`messaging_foundation`, `messaging_isv_tenancy`, `tenant_legal_pages_public_table`,
and `tenant_legal_pages_slug`. They created `conversations`, `messages`,
`message_templates`, `messaging_settings`, `messaging_consent`, and
`tenant_legal_pages`. The repo could not rebuild the deployed schema, and anyone
reading only the repo would conclude the legal pages were broken when they were
not.

Those four are now captured as files under their deployed version numbers, so
`supabase migration list` reconciles and a fresh environment builds the same
schema. Each is written to be a no-op where the objects already exist, so
applying them against the deployed database changes nothing. They are faithful
captures: one thing found along the way is deliberately *not* silently fixed
inside them, and is called out in a comment instead.

- `public.sync_tenant_legal_slug()` exists in the deployed database with **no
  trigger attached**, so renaming an organization never moved its legal slug
  there. The A2P remediation migration supersedes it.

An earlier revision of this documentation and of
`20260803173933_messaging_foundation.sql` also claimed `anon` held
`select, insert, update` on `public.messages`. **That was wrong.** The audit
query behind it filtered on `table_name` without a schema, and matched
Supabase's own `realtime.messages`, which grants those privileges to anon by
design. `public.messages` has never had them. The capture no longer creates the
grant, and the revoke in `20260804213000_confirm_tenant_legal_contact.sql` is
kept only to clean up any environment built from that earlier revision.

Repo and deployed migration *timestamps* still differ for several older
migrations (for example the foundation is `20260803161114` here and
`20260803162315` there). That predates this work and is left alone.

## What changed

- `supabase/migrations/20260804191500_tenant_legal_pages_and_sms_consent.sql`
  - Adds `sms_consent`, `sms_consent_at`, `sms_consent_source`, and
    `sms_consent_disclosure` to `booking_intakes`, with a check constraint that
    an opt-in cannot be stored without its evidence. Every branch of that
    constraint is an explicit `is not null` test, because a CHECK that
    evaluates to UNKNOWN passes.
  - Recreates `create_public_booking_intake` to record messaging consent
    separately from the cancellation policy. The consent source is hardcoded to
    `web_booking_form` inside the function so an anon caller cannot claim a
    verbal opt-in.
  - Recreates `confirm_public_booking_payment` to set `preferred_contact` from
    the actual consent and to upsert the opt-in into `messaging_consent` with
    `source = 'booking_form'` and the disclosure as `proof_text`. A customer who
    had replied STOP is not silently resurrected by a stale intake.
  - Creates a tenant's legal-page row on organization insert, backfills any
    organization that predates the trigger, and keeps the legal slug in sync
    with `organizations.slug` so a rename cannot orphan a URL already filed with
    the carrier. Tenants missing a required detail get no row and keep 404'ing
    rather than serving a page with a blank phone number.
  - Derives `tenant_legal_pages.slug` from the organization on every insert and
    update. Members can write their own legal row, and a freely chosen slug
    would let one tenant publish its policies at another tenant's URL.
- `src/lib/supabase/public.ts` — `getMessagingBusinessName` resolves the name
  used in the disclosure from the legal pages (`dba_name` before
  `legal_business_name`), so the checkbox, the stored proof, and the quoted
  terms all name the same business. `organizations.name` is the sole trader's
  own name for the live tenant ("Nicholas Kane") while they trade as "Pacific
  Plains Electric"; quoting different names across those three places reads as
  two different programs under review.
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

## Publishing a tenant's legal pages

A tenant's legal-page row is seeded at signup from onboarding data, but it is
**not published automatically**. The support email is prefilled from the owner's
login address, which for a sole trader is usually personal, and publishing that
to a page carriers read without ever asking is the wrong default.

The owner reviews and publishes at **Settings → Legal pages**
(`/settings/legal`), which warns while the support email is still the login
address and links to previews of both pages. A campaign cannot be approved until
the pages are published, since the reviewer has to open them signed out.

Tenants already published before this change are untouched — their pages are
live and a carrier may be mid-review.

## Hostname

`www.volteira.com` is the hostname attached to the project, so it is what the
campaign is filed against and what `NEXT_PUBLIC_APP_URL` is set to. Attach the
apex `volteira.com` as well and let it redirect to `www` — a customer typing the
bare domain must not land on nothing. File the `www` URLs rather than the apex:
a reviewer following a redirect sometimes reads it as a mismatch with the URL on
the submission.

## Before resubmitting

1. Apply the migration to the production project.
2. Open `https://www.volteira.com/legal/<org-slug>/privacy` and
   `https://www.volteira.com/legal/<org-slug>/terms` **signed out** and confirm both
   still render with the real business name, phone, email, and mailing address —
   no login wall (30921), no placeholder text.
3. Open `https://www.volteira.com/book/<org-slug>` signed out and confirm the
   messaging checkbox is visible, empty, and that checkout works with it left
   empty.
4. Set `NEXT_PUBLIC_APP_URL` to `https://www.volteira.com` in the deployment, so the
   SMS terms print the full opt-in URL rather than a bare path.
5. Capture a screenshot of the final booking step showing the unchecked box and
   its full label; attach it to the campaign.

## Campaign fields to submit

**Call to Action / Message Flow:**

> End users opt in on the business's own web booking page at
> https://www.volteira.com/book/<org-slug>. After describing the electrical problem,
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

**Privacy Policy URL:** `https://www.volteira.com/legal/<org-slug>/privacy`
**Terms and Conditions URL:** `https://www.volteira.com/legal/<org-slug>/terms`

Replace `<org-slug>` with the tenant's slug (`pacific-plains-electric` for the
first tenant) before submitting. Both pages must be publicly reachable at the
exact URLs filed — check them signed out, in a private window. A page behind
Vercel's deployment protection reads as error 30921, "website requires
authentication and cannot be reviewed".
