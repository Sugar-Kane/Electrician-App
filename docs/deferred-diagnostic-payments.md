# Deferred diagnostic payments

**Status:** implemented on branch `claude/volteira-deferred-diagnostics-ifgb9v`. Not deployed. No live
Stripe setting changed, no production schema changed, no customer charged.
**Date:** 2026-11-27. **Initial tenant:** Pacific Plains Electric ($180 diagnostic, California).

In California (and for any business whose operating jurisdiction is not set) Volteira no longer
collects a diagnostic fee at booking. The customer ticks an unticked box authorizing the exact
amount, saves a card with Stripe in **setup mode** (no PaymentIntent, no hold), and the authorized
amount — never more — is charged off-session only after the diagnostic is documented complete.

---

## 1. Existing architecture (before this change)

| Area | What it did | Where |
|---|---|---|
| Booking (web) | Held a slot, then **Stripe Checkout `mode: "payment"`** for the full diagnostic fee on the tenant's connected account; the webhook turned the paid hold into a job with `diagnostic_paid = true`. | `src/app/book/[slug]/actions.ts`, `src/lib/booking-checkout.ts`, `confirm_public_booking_payment` |
| Booking (SMS / voice) | Same hold; an eager payment Checkout created before the link was texted; `/booking/[token]/pay` redirected to it. | `src/lib/intake-shared.ts`, `src/app/booking/[token]/pay/route.ts` |
| Voice agent (Grok realtime) | Prompt said *"to book the visit we require a $X deposit"*; tool result said *"confirmed once the fee is paid"*. | `src/lib/grok-voice.ts`, `src/lib/booking-tool-rules.ts` |
| SMS assistant | *"booking takes a $X diagnostic deposit"*; held text *"pay the $X diagnostic fee to confirm"*. | `src/lib/sms-intake.ts`, `src/lib/intake-phrases.ts` |
| Confirmations | *"Payment needed to confirm"*, *"Pay $X to confirm your appointment"*, owner alert *"Deposit: $X"*. | `src/lib/booking-confirmation.ts` |
| Job screen | "Send the diagnostic fee invoice" offered as the **first step** of a hand-added diagnostic, before the visit. | `src/app/jobs/[jobId]/line-actions.ts`, `src/lib/job-flow-server.ts` |
| Credit | A fee paid at booking is credited once across the diagnostic and its follow-up jobs, as money already paid. | `src/lib/invoice-math.ts`, `src/lib/diagnostic-credit.ts`, `src/lib/follow-up-jobs.ts` |
| Down payment cap | 10% / $1,000 with work-done gating (PR #308). | `src/lib/payment-plan.ts` |
| Webhooks | Signature verified for two destinations; **no replay protection** (`stripe_webhook_events` existed but was unused). | `src/app/api/stripe/webhook/route.ts` |
| Stripe Customers | `stripe_customers` existed, unused, and **writable by any member** (could point at another tenant's Customer). | migrations |

Every place the fee was collected, requested or described: the six rows above plus the booking
page hero and footer, the Stripe line-item description, the `/booking/[token]` page, the return
page, and the job flow's fee-invoice step.

## 2. What was built

One rule set, enforced twice:

- **`src/lib/diagnostic-payment-policy.ts`** (import-free, unit-tested): jurisdiction override,
  effective policy, authorization wording (EN/ES), every collection refusal, the twelve payment
  states, order-safe state transitions, secret redaction, the "no invoice before completion" rule.
- **`supabase/migrations/20261127010000_deferred_diagnostic_payments.sql`**: the same rules where
  money moves, under row locks, callable only by the service role (or, for completion, by a
  signed-in member whose role the function checks).

### Booking
1. Every surface shows *Electrical Diagnostic Service $180.00 · Due Today $0.00 · Due Upon
   Completion $180.00*, the credit sentence (only when the business credits), and the unticked
   authorization: *"I authorize Pacific Plains Electric to securely save my payment method and
   charge $180 upon completion of the contracted electrical diagnostic service. No diagnostic
   payment will be collected today."* (EN/ES, language toggle).
2. The server refuses without the tick, then records the authorization **before Stripe**:
   amount, currency, contractor, booking, customer, timestamp, agreement version
   (`2026-11-26.1`), exact text, fingerprint, language, channel, IP and user agent.
3. A Stripe Customer is created (or reused) **on the tenant's connected account**, then Checkout
   `mode: "setup"`, `payment_method_types: ["card"]`, with the authorization text repeated on
   Stripe's page (`custom_text.submit`). No PaymentIntent, no hold.
4. `checkout.session.completed` (mode setup) → SetupIntent retrieved from Stripe → ownership
   checked (account and Customer) → `confirm_public_booking_setup` books the job exactly as a paid
   booking would (shared `private.book_confirmed_intake`), with `diagnostic_paid = false`.
5. Customer notices: *"Your payment method has been securely saved. No diagnostic payment has been
   collected."* SMS/voice bookings get a link to the booking page, where the same authorization is
   ticked before Stripe opens.

A business that turns **Require a payment method** off books with nothing saved
(`confirm_public_booking_without_payment_method`); the fee is billed after completion.

### Completion and collection
- **Complete diagnostic** (job screen or MCP): outcome, findings (≥ one sentence), and for a work
  order whether the repair is a *separate* later contract. Owner/admin or the assigned technician
  only. A trigger stops members editing completion columns directly.
- `claim_diagnostic_charge` checks, under lock: business policy; job not canceled; completed with
  findings; repair contract `none` or `separate`; not already paid; live authorization of this
  business; not revoked/cancelled/pending/processing; payment method on file; **amount equals the
  authorized amount**; no larger signed contract; no prior diagnostic payment; fee not already on a
  sent invoice; the tenant's own Stripe account with charges enabled; the customer is not inside a
  contract's right-to-cancel (`private.job_cancellation_hold`, from PR #310, when present). A
  partial unique index allows one processing/succeeded charge per authorization.
- Off-session PaymentIntent with an idempotency key `diagnostic-charge-<charge id>`, on the
  connected account, with Volteira's application fee. Results recorded by
  `record_diagnostic_charge_result` (idempotent; never moves a success backwards). Success marks
  the job paid, records a `payments` row (so refunds, reports and the credit keep working), and
  sends *"Your electrical diagnostic service has been completed, and your authorized diagnostic
  payment has been processed. Your receipt is available."*
- Decline → *"We were unable to process the payment for your completed service. Please use this
  secure link to update your payment method."* Authentication required → bank-confirmation notice.
  The link opens a payment-mode Checkout for **exactly the authorized amount** of a **completed**
  service, saving the new card (`setup_future_usage`).
- Revocation: customer button on the booking page (detaches the card in Stripe), Stripe
  `payment_method.detached`, job or booking cancellation (trigger). The appointment stands; the fee
  is then billed by invoice after completion.

### Scenario A / B and the credit
- **A — declines repairs:** outcome *diagnostic only* → standalone → collected (automatically if
  the business has that on) → receipt.
- **B — same contract** (fixed on the visit, or a work order not confirmed as separate): nothing
  collected now; the fee line goes on the job's final invoice when that contracted work is complete.
- **B — separate later contract:** the completed diagnostic is collected; its fee is credited once
  on the repair invoice by the existing credit logic.
- **Accounting treatment selected:** the credit is a **prior payment applied** (the repair's price is
  unchanged; the money already paid comes off what is owed). It is not treated as a discount.
  Flagged for accountant and attorney review (section 10).

### Contractor settings
Settings → Get paid online → **Diagnostic Payment Settings**: fee, jurisdiction, when collected,
require payment method, automatic collection, manual collection, credit, setup reminders,
failed-payment notices, customer-facing description. California shows the rule and offers no
upfront option; the database trigger refuses it anyway (owner/admin only, RLS).

## 3. Files

**New:** `src/lib/diagnostic-payment-policy.ts` (+ test), `src/lib/diagnostic-payment-messages.ts`,
`src/lib/diagnostic-payment-server.ts`, `src/lib/mcp-diagnostic-payment-tools.ts`,
`src/components/diagnostic-authorization.tsx`, `booking-authorization-form.tsx`,
`diagnostic-payment-panel.tsx`, `diagnostic-payment-controls.tsx`,
`src/app/booking/[token]/actions.ts`, `src/app/jobs/[jobId]/diagnostic-payment-actions.ts`,
`src/app/settings/payments/diagnostic-actions.ts`, `diagnostic-settings-form.tsx`,
`supabase/migrations/20261127010000_deferred_diagnostic_payments.sql`,
`compliance/tests/deferred-diagnostic/deferred-diagnostic-rollback.sql`,
`compliance/tests/deferred-diagnostic/pacific-plains-test-seed.sql`, this document and
`docs/deferred-diagnostic-screenshots/`.

**Changed:** booking web action, confirmation and token pages, pay route; booking page and flow;
`booking-checkout.ts` (refuses payment mode for deferred businesses); Stripe webhook (replay
protection + diagnostic events); `intake-shared.ts`, `sms-intake.ts`, `sms-intake-runner.ts`,
`intake-phrases.ts`, `booking-hold.ts`, `booking-confirmation.ts`, `booking-notifications.ts`;
`grok-voice.ts`, `booking-tool-rules.ts`, `booking-tools.ts`, Twilio voice route (card redaction);
MCP route, dispatch, approval list, log redaction; `payment-plan-server.ts` (no invoice before
completion); job screen, `line-actions.ts`, `job-flow-server.ts`; payments settings page;
`booking-page-state.ts`; compliance registers, test manifest, both compliance skills,
`.claude/COMMANDS.md`; tests listed in section 8.

## 4. Database migration

`20261127010000_deferred_diagnostic_payments.sql` — sorts after every file in `main`, including
PR #310's four migrations (`20261126040000`–`070000`, merged 2026-11-28 and already run in production). It touches none
of #310's functions. It adds settings columns + CA guard trigger; job completion columns + guard
trigger; `diagnostic_payment_authorizations` and `diagnostic_charges` (RLS: members read own
business, nobody signed-in writes); makes `payments.provider_checkout_session_id` nullable (an
off-session charge has no Checkout); locks `stripe_customers` writes to the service role; extracts
`private.book_confirmed_intake` from `confirm_public_booking_payment` **unchanged in behaviour**
(DD-037/038 prove the paid path); new RPCs listed in its section 15 with grants.

After applying with Supabase MCP `apply_migration`, rename the recorded row in the same change
(AGENTS.md): `update supabase_migrations.schema_migrations set version = '20261127010000', name =
'deferred_diagnostic_payments' where version = '<recorded>';`

**Testing the SQL** (no production access needed): replay every migration into a local Postgres 16
with Supabase-like stubs (roles, `auth.uid()` reading `request.jwt.claims`, default grants), then run
`psql -1 -f compliance/tests/deferred-diagnostic/deferred-diagnostic-rollback.sql` and expect
`DD_RESULTS 39 passed, 0 failed`.

## 5. Stripe configuration required (not changed by this work)

1. **Connected-account webhook destination** (`STRIPE_CONNECT_WEBHOOK_SECRET`): add
   `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.requires_action`,
   `payment_intent.canceled`, `payment_method.detached` (it already sends `checkout.session.*`).
2. Test mode first: a test-mode `STRIPE_SECRET_KEY` and Connect test account for Pacific Plains,
   then the card matrix: `4242…` (success), `4000 0000 0000 0002` (decline), `4000 0027 6000 3184`
   (authentication required off-session), `4000 0000 0000 9995` (insufficient funds).
3. Card payments must be enabled on the connected account (setup mode uses `card` only, the method
   that can be charged off-session).
4. Checkout custom text is used (`custom_text.submit`); no Dashboard change needed.

**Blocker:** this session has no Stripe test key (`sk_test_…`) or Stripe MCP. Stripe-side tests
(real SetupIntent, off-session success/decline/3DS, webhooks) could not be executed; see section 8.

## 6. Grok voice agent

The prompt (`buildRealtimeInstructions` → `paymentLines`) now reads the fee and policy from the
business's settings on every call (`IntakeContext.diagnosticDeferred`, `creditTowardRepairs`) and
contains, verbatim, each customer-facing statement from the brief (fee explanation, not charged
today, agree to schedule, why a card, declines repairs, approves repairs, no card, card over the
phone, failed payment — the last only after `get_diagnostic_booking_status` confirms it), plus the
restrictions: never take card data, never charge, never claim a payment, never call it a deposit,
never mark a job complete, waive fees, override rules, give legal advice or reveal ids. The Twilio
`<Gather>` path redacts card numbers/CVCs from caller speech before the model or storage sees it.

**Tools** (names follow the existing ones):

| Requested | Implemented as | Notes |
|---|---|---|
| get_diagnostic_payment_policy | `get_diagnostic_payment_policy` | live fee, $0 today, when due, credit |
| create_diagnostic_booking | `book_visit` (existing) | result wording deferred |
| send / resend setup link | `resend_booking_link` (existing) | link opens the authorization page |
| get_payment_method_setup_status, get_diagnostic_booking_status | `get_diagnostic_booking_status` | one read-only tool, verified caller only |
| send_payment_recovery_link | `send_payment_recovery_link` | refuses unless a payment actually failed |
| escalate_payment_exception | `escalate_payment_exception` | activity + owner text; redacted |

No voice tool can create, confirm or capture a payment (tested); `claim_diagnostic_charge` rejects
any `voice` route (DD-016).

## 7. MCP (ChatGPT / Claude)

New: `get_diagnostic_payment_status` (status, refusal reason, charges, credit left),
`complete_diagnostic`, `collect_diagnostic_payment` (no amount argument — always the authorized
amount), `send_payment_method_setup_link`, `send_payment_recovery_link`, `list_payment_exceptions`.
The four that act wait in the owner's AI approval inbox (`mcp-approval.ts`) and then run the same
server functions and database checks as the app. `create_invoice`/`send_invoice` cannot bill an
uncompleted deferred diagnostic (`invoiceSendCheck`). Credits are applied by the existing invoice
logic once; there is deliberately no "apply credit" tool that could apply one twice.

## 8. Test results (executed)

| Suite | Result |
|---|---|
| `npm test` (whole unit suite) | **1589 passed, 0 failed** after merging `main` with PR #310 (1575 before the merge; was 1562; 9 existing tests updated for the intended wording change, legacy paths pinned with `deferred: false`) |
| Deferred SQL scenarios, local replay of `main` migrations | **39/39** (DD-039 vacuous: #310 absent, reported as such) |
| Deferred SQL scenarios, replay incl. PR #310 migrations (now in `main`) | **39/39** (DD-039 real) |
| Tenant-isolation suite (existing), local, on top of the new migration | **75/75** |
| `npx tsc --noEmit` | clean |
| `npm run build` | succeeds |
| `npm run lint` | 1 error, **pre-existing** in untouched `src/app/estimate/[token]/page.tsx` (`Date.now` in render); none from this change |
| Browser (Playwright, local app against local PostgREST + seeded test tenant), desktop 1440×900 and Pixel 7 | booking flow to the payment step; authorization unticked by default; submit disabled until ticked; Spanish toggle; held (EN/ES), saved, failed, revoked token pages; settings form (no upfront option in CA); job panel; **0 horizontal overflow, 0 page errors** on every page |
| Web form submission end to end (invalid Stripe key on purpose) | authorization recorded with version/amount/IP/UA before Stripe; Stripe refused; hold released; authorization expired by trigger; logged error had the Stripe id redacted |

Defects found and fixed during testing (each has a regression test): column-level REVOKE was
ineffective, letting members mark completion directly (DD-035 → trigger); confirmed deferred
bookings showed "Please call to confirm" (`booking-page-state.test.ts`); the confirmed SMS was
clipped before the business phone (`booking-confirmation.test.ts`); a fee already on a sent invoice
could also be charged to the card (claim check); the hero said "Paid diagnostic booking".

**Test-plan coverage (brief §16):** executed — 1, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17 (duplicate and
out-of-order results, event de-duplication function), 18, 19, 20, 21, 22, 23 (CT-DEPOSIT-001),
24, 25, 26 (link wording/target), 27, 28, 29, 30 (full suite). Partially — 2, 3 (DB path proven;
real Stripe setup not run), 12–15 (DB recording proven with synthetic results; real Stripe
off-session not run). **Blocked by the missing Stripe test key:** live SetupIntent, live
off-session success/decline/3DS, live webhook delivery. Contractor screens were rendered on a
temporary preview route (signed-in pages need an auth server the local stack lacks); the route was
removed before commit.

Screenshots: `docs/deferred-diagnostic-screenshots/`.

## 9. Security and tenant isolation

- Authorizations/charges: RLS read by own members only; no signed-in writes (DD-032/033); money
  functions service-role only (DD-034); completion via role-checked function (DD-017–019, DD-035).
- Ownership: Stripe account verified on attach (DD-006) and on setup; Customer verified (DD-009);
  account re-verified on every charge and every webhook (`event.account` must equal the tenant's).
- Replay: `stripe_webhook_events` claim/finish; all handlers idempotent; charge idempotency keys;
  partial unique index (DD-025); success never reverses (DD-027).
- Amount: only the authorized amount; mismatched webhook amounts refused (DD-022, DD-026).
- Data: no card number/expiry/CVC stored (brand + last 4 only); Stripe ids, secrets and card data
  redacted from MCP logs, voice speech and server error logs; links carry only the booking token.
- Not done here: rate limiting of `/booking/[token]` actions beyond Vercel's defaults (the token is
  a 122-bit UUID); recommended follow-up.

## 10. California compliance assessment and open legal questions

Sources: the registry's 2026-11-25 verification against the CSLB 2026 Law Book (official,
cslb.ca.gov) confirmed B&P 7159.10(a)(1)(A)–(D) (≤ $750, buyer-initiated, nothing beyond what is
reasonably necessary, **no payment due until the work is completed**) and 7159.14(a)(1), (8), (9)
(one service charge; disclosed in advertising and when the customer calls). leginfo returned HTTP
403 to this session on 2026-11-27, so current text was **not** re-read today.

| Item | Status | Why |
|---|---|---|
| No diagnostic collected before completion (CA) | YELLOW | Enforced in code and DB, tested; legal sufficiency needs attorney review |
| Service-and-repair qualification | YELLOW | No contract-type classifier yet (CSLB-002-001 RED); conservative rule applied to all CA diagnostics |
| Home improvement down payment | YELLOW | Cap enforced (PR #308); attorney review of credit counting |
| Stripe SetupIntent / off-session consent | GREEN (technical) | Unticked box, stored text/version, Stripe page repeats it; Stripe-side test pending |
| Diagnostic credit accounting | YELLOW | Prior-payment treatment chosen; accountant/attorney review |
| Disclosures EN/ES | YELLOW | Implemented and tested; wording review by counsel |
| Multi-tenant isolation | GREEN (technical) | 39/39 + 75/75 |

Questions for a California-licensed attorney:
1. Is a diagnostic visit with a separately signed repair contract a completed service-and-repair
   contract whose fee may be collected before the repair contract is performed?
2. Does a saved-card authorization at booking count as a "payment due" or "deposit" under
   7159.10/7159.5? (Implementation assumes no; no charge or hold is made.)
3. Is the diagnostic credit a prior payment or a price reduction for the repair contract's price,
   down-payment calculation and any sales tax?
4. Commercial customers in CA: may they be excluded from deferral? (Not excluded today.)
5. Cancellation fee: the booking page states the business's late-cancellation policy but the
   authorization does not cover it; may such a fee be charged at all for a deferred visit?
6. Does the three-day (five for seniors) right to cancel apply to diagnostic bookings made by phone
   or web, and does it delay collection? (PR #310 adds this for home improvement contracts; the
   charge claim honors its hold when present.)

## 11. Existing payments: migration plan and reconciliation

Production snapshot (read-only SELECTs, 2026-11-27, counts only, no customer data):

| Check | Result |
|---|---|
| Active tenants | 1 — `pacific-plains-electric` (CA) |
| Open holds with a payment Checkout attached | 0 |
| Open holds without a Checkout | 0 |
| Diagnostic paid at booking, visit not completed | 0 |
| Booking payments ever recorded | 0 |
| Paid but unscheduled | 0 |
| Unpaid diagnostic-fee invoices on jobs not completed | 0 |
| Open invoice Checkouts on uncompleted diagnostic jobs | 0 |
| Payment intents shared by two payment rows | 0 |
| **Records requiring manual review** | **none** |

Plan (nothing is refunded, re-charged, cancelled or altered automatically):
1. Re-run the snapshot query just before deploying (it is in this PR's description).
2. Any hold that still has a payment-mode Checkout keeps working (`confirm_public_booking_payment`
   is unchanged in behaviour); new holds use setup mode. The texted link of an old hold without a
   Checkout now opens the authorization page.
3. Fees already paid at booking stay `diagnostic_paid`, keep their refund path and credit.
4. Draft or sent diagnostic-fee invoices on uncompleted jobs: list for the owner; they cannot be
   sent again until completion.

## 12. Deployment checklist

1. PR #310 is merged into `main` and merged into this branch (only the test manifest conflicted;
   resolved by keeping both sides' entries).
2. Attorney sign-off on section 10 questions 1–3 (or accept the conservative behaviour as is).
3. Stripe test mode: add the webhook events (section 5); run the card matrix on a preview deploy
   with a test-mode key; confirm webhooks reconcile and `stripe_webhook_events` de-duplicates.
4. Apply the migration (it must precede the code: the code reads the new columns), then rename the
   migration row; confirm `select version, name from supabase_migrations.schema_migrations` matches
   the files.
5. Run `deferred-diagnostic-rollback.sql` on a branch or as one aborting transaction: 39/39.
6. Owner reviews Diagnostic Payment Settings (defaults already match Pacific Plains' requested
   settings: $180, deferred, card required, auto-collect, credit on, CA).
7. Deploy; place one test-mode booking end to end; then switch to live keys only with approval.
8. Re-run `/volteira-compliance contractors` and `/website-compliance https://pacificplainselectric.com`.

## 13. Rollback

- **Code:** revert the PR. Bookings already authorized stay valid in the database; with the code
  reverted they would confirm only via the old payment flow, so before reverting, pause online
  booking or keep the migration (it is additive).
- **Database:** the migration is additive; leave it in place. Upfront collection for California is
  refused by the settings trigger by design, so returning CA bookings to the old payment flow needs
  a new migration that restores the previous body of `attach_public_booking_checkout` (from
  `20260905193000_eager_booking_checkout.sql`) together with the code revert. Never delete
  authorization or charge rows: they are the consent and payment record.
- **Stripe:** removing the added webhook events is safe; saved payment methods remain on the
  connected accounts and can be detached per customer.
