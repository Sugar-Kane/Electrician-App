# Stripe integration: what's left

Volteira uses **hosted Stripe Checkout**: customers are sent to a page Stripe hosts.

Volteira is a Stripe Connect platform. Each business (for example Nick's) connects its own Stripe account. Customer deposits and invoice payments are charged on that account, and Volteira keeps 1% as an application fee. Memberships are charged on Volteira's own account.

## Values to replace

None of the Checkout calls contain placeholder values. `mode`, `success_url`, `cancel_url` and `line_items` already use the app's real values. Each call sets the amount, the return pages and the mode for what it sells.

One value is unset on purpose:

| Field | Current value | What to set |
|-------|---------------|-------------|
| Membership `line_items[].price` | `process.env.STRIPE_PREMIUM_PRICE_ID` (unset, so the membership shows **Free**) | Create a recurring $50/month price on the live Volteira account (Product catalog → Add product → Recurring). Put its `price_…` ID in Vercel as `STRIPE_PREMIUM_PRICE_ID` when you want to start charging. |

## Configured parameters

These were set in Checkout Studio and are applied to every Checkout Session:

- [src/lib/booking-checkout.ts](src/lib/booking-checkout.ts): booking deposits, `mode: "payment"`.
- [src/lib/invoice-online-pay.ts](src/lib/invoice-online-pay.ts): invoice payments, `mode: "payment"`.
- [src/app/account/actions.ts](src/app/account/actions.ts): Volteira membership, `mode: "subscription"`.

| Parameter | Value |
|-----------|-------|
| ui_mode | `hosted_page` (the stripe SDK installed is 22.4.0, which takes `hosted_page`) |
| billing_address_collection | `auto` |
| phone_number_collection | `{ enabled: false }` |
| automatic_tax | `{ enabled: false }` |
| allow_promotion_codes | `false` (the membership checkout used to allow codes) |
| submit_type | `auto` (payment mode only) |
| payment_method_collection | `always` (subscription mode only) |
| integration_identifier | `hosted_web_0001` (replaces the old `volteira_diagnostic_booking_kqvmrjta` on deposits) |
| origin_context | `web` |

The calls also keep some parameters Checkout Studio doesn't list, because the app depends on them:

- `metadata`: the webhook uses it to match a payment to its booking or invoice.
- `payment_intent_data.application_fee_amount`: Volteira's 1%.
- `expires_at`: the 30-minute slot hold, or 23 hours for invoices.
- `payment_method_types` / `excluded_payment_method_types`: ACH for invoices; no slow bank debits for a 30-minute hold.
- `customer_email` and `locale`.
- The connected-account `stripeAccount` option.

## Setup

All of these are in Vercel → electrician-app → Settings → Environment Variables, **Production**. Keys never go in code or in chat.

| Variable | Value |
|----------|-------|
| `STRIPE_SECRET_KEY` | The **live** Volteira secret key, `sk_live_…` (Stripe → Developers → API keys, with the sandbox switched off). |
| `STRIPE_WEBHOOK_SECRET` | Signing secret of the **Your account** webhook destination. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Signing secret of the **Connected accounts** webhook destination. |
| `STRIPE_PREMIUM_PRICE_ID` | Optional, for later. Leave unset to keep the membership free. |

Redeploy after changing any of them.

Stripe Dashboard, on the **live** Volteira account:

1. Verify the account: business details, ID, payout bank.
2. Set up Connect as a **Platform**:
   - connected accounts pay Stripe's fees;
   - Stripe covers losses;
   - connected accounts get the full Stripe Dashboard;
   - onboarding is hosted by Stripe.
3. Add two webhook destinations. Both point at `https://www.volteira.com/api/stripe/webhook`; include the `www`, because the bare domain redirects.
   - **Your account:** `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`.
   - **Connected accounts:** the four `checkout.session.*` events and `account.updated`.
4. Optional: turn on ACH Direct Debit under Settings → Payment methods.

No new dependencies. `stripe` 22.4.0 is already installed.

## How it works

1. **The business connects.** The owner opens Settings → Integrations → Customer payments → **Set up payments** ([src/app/settings/payments/start/route.ts](src/app/settings/payments/start/route.ts)). Stripe's onboarding creates their account, and [src/lib/stripe-connect.ts](src/lib/stripe-connect.ts) records it.
2. **Deposit.** A booking creates a Checkout Session on the business's account. The webhook confirms the booking only for the exact checkout attached to it.
3. **Invoice.** The customer's invoice link has a Pay button, which posts to `/invoice/[token]/pay`. The webhook then records the payment against the invoice:
   - card: right away;
   - ACH: when it clears, in 3–5 business days.
4. **Membership.** Account → Premium creates a subscription Checkout on Volteira's own account, but only once `STRIPE_PREMIUM_PRICE_ID` is set.
5. **Before a business has connected**, nothing is collected online for it:
   - invoices say "call to pay";
   - web bookings arrive as callback requests;
   - text and phone bookings needing a deposit go to review.

## Testing

- Use the **sandbox**, with `sk_test_…` keys and sandbox webhook destinations, in a Preview deployment. Don't use it in Production.
- Test card: `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.
- Declined card: `4000 0000 0000 0002`.
- ACH test: in Checkout choose US bank account, then "Test Institution" and a success account. The payment settles after the async event.
- Live smoke test: pay a $1 invoice with a real card. Check that the invoice, job and timeline show paid. Then refund it in the business's Stripe dashboard.

## Next steps

- Connect Nick's business: owner login → Settings → Integrations → Set up payments.
- Set the $50/month membership price when you're ready to charge.
- Refunds and disputes are handled in each business's own Stripe dashboard.

## Resources

- https://support.stripe.com
- https://docs.stripe.com/mcp
