# Electrician App Stripe integration plan

## Business model and payment flows

The Electrician App is a multi-tenant field-service platform for electrical contractors. Each contractor should remain the seller of its own electrical services. The platform coordinates booking, payment, invoicing, and reporting, and may collect a clearly disclosed software or application fee.

The initial payment flows are:

1. A customer prepays a diagnostic visit through Stripe Checkout.
2. The diagnostic payment is credited toward approved repair work.
3. The contractor completes the repair and sends an itemized Stripe invoice for the remaining amount.
4. Stripe pays the contractor, while the platform may collect an application fee.

## Recommended Stripe architecture

### Payments

- Use Stripe-hosted Checkout for diagnostic fees. It minimizes custom payment UI and keeps card data out of the application.
- Calculate prices on the server from organization settings; never accept a price supplied by the browser.
- Create one Checkout Session per booking intake with a stable idempotency key.
- Confirm appointments from signed webhooks. Keep the confirmation-page fulfillment fallback so customers see an immediate result even if the webhook is delayed.
- Keep payment and booking records linked with internal IDs in Stripe metadata.

### Connect

- Use Connect **direct charges** for customer payments once multiple electrical businesses are onboarded.
- Treat each electrical contractor as the merchant for its own work. The payment, refund, dispute, and customer objects live on that contractor's connected account.
- Configure the connected account so Stripe collects processing fees and negative balances from the contractor where supported. The platform collects only an explicit `application_fee_amount`.
- Start with Stripe-hosted onboarding. It is the fastest implementation and Stripe keeps the compliance questions current. Embedded onboarding can replace it later without changing the payment model.
- Store each organization's connected account ID, onboarding status, payment capability status, payout status, and the last time requirements were checked.
- Never confirm a paid booking for an organization whose connected account cannot accept payments.

Direct charges fit this product better than destination charges because the contractor—not the software platform—is providing the electrical service. Destination charges would make the platform responsible for Stripe fees, refunds, chargebacks, and negative balances.

### Invoicing

- Create the Stripe Customer on the same connected account that owns the payment.
- Create a draft invoice after the technician and customer approve the repair scope.
- Add labor, material, permit, travel, and tax line items.
- Add the diagnostic credit as a negative line item, never allowing the invoice total to fall below zero.
- Use `send_invoice` for the MVP so the customer pays through Stripe's Hosted Invoice Page when work is complete.
- Finalize only after the technician confirms the work and amounts. Finalized invoices have accounting and tax restrictions.
- Listen to `invoice.paid` for the authoritative paid state and `invoice.payment_failed` for collection follow-up.

## Delivery phases

### Phase 1 — paid diagnostic MVP

Status: implemented in the repository; database deployment and end-to-end sandbox verification remain.

- Stripe-hosted Checkout for $180 standard and $200 urgent diagnostics.
- Thirty-minute appointment hold.
- Server-side pricing and booking metadata.
- Signed webhook processing.
- Confirmation-page fulfillment fallback.
- Automatic release of expired Checkout holds.
- Payment and job creation in one database transaction.

Required webhook events:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.expired`

### Phase 2 — Connect onboarding

- Enable the Stripe account as a Connect platform.
- Add an owner-only **Payments setup** screen.
- Create a connected account for each organization.
- Generate single-use Stripe-hosted onboarding links.
- Refresh the account state after return and from Connect webhooks.
- Block live booking until `charges_enabled` and `payouts_enabled` are true and no currently due requirements remain.
- Create Checkout Sessions in the connected-account context with an optional application fee.

Required Connect events include account capability/requirement updates and the payment events delivered for connected accounts.

### Phase 3 — repair invoices

- Add invoice line-item editing to a completed job.
- Create or reuse the customer on the contractor's connected account.
- Create a draft Stripe invoice with the diagnostic credit.
- Preview, finalize, and send the invoice.
- Store Stripe customer, invoice, hosted invoice, and PDF identifiers/URLs.
- Synchronize `draft`, `open`, `paid`, `void`, `uncollectible`, and payment-failure states from webhooks.
- Provide an owner-authorized refund and credit-note workflow.

Required invoice events:

- `invoice.finalized`
- `invoice.sent`
- `invoice.paid`
- `invoice.payment_failed`
- `invoice.voided`
- `credit_note.created`

### Phase 4 — production readiness

- Keep test and live data completely separate.
- Use managed or restricted server-side keys and encrypted environment variables.
- Record processed webhook event IDs to guard against duplicate deliveries.
- Add monitoring for failed webhooks, stuck payment holds, failed payouts, and overdue invoices.
- Test success, declined card, duplicate submission, expired Checkout, refund, dispute, failed invoice payment, and webhook retry paths.
- Complete Stripe's Connect platform review, business identity, statement descriptor, customer support, refund, privacy, and terms settings before accepting live payments.

## Data additions for Connect and Invoicing

The next database migration should add:

- `stripe_connect_accounts`: organization, account ID, controller/fee configuration, onboarding state, charges enabled, payouts enabled, requirements, timestamps.
- `stripe_customers`: organization, customer, connected account, Stripe customer ID.
- Stripe identifiers and hosted/PDF URLs on `invoices`.
- `stripe_webhook_events`: event ID, connected account ID, type, object ID, processing state, attempts, error, processed timestamp.
- Refund and credit-note records tied to the original payment or invoice.

All business-owned rows must remain scoped by `organization_id` with row-level security. Secret keys and webhook secrets remain server-only.

## Decisions before live Connect charges

1. Confirm that each electrical contractor is the merchant shown to the customer and responsible for refunds/disputes.
2. Choose the platform fee: no fee for the pilot, a fixed amount, a percentage, or a subscription plus reduced payment fee.
3. Decide who can issue refunds and whether the application fee is also refunded.
4. Decide whether repair invoices are due immediately or have payment terms.

## Official references

- Stripe Connect direct charges: https://docs.stripe.com/connect/direct-charges
- Stripe-hosted and embedded onboarding: https://docs.stripe.com/connect/onboarding
- Invoicing with Connect: https://docs.stripe.com/invoicing/connect
- Stripe Checkout fulfillment: https://docs.stripe.com/checkout/fulfillment
- Webhook security and retries: https://docs.stripe.com/webhooks
- Secret key best practices: https://docs.stripe.com/keys-best-practices
