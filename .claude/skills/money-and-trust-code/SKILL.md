---
name: money-and-trust-code
description: Write or change anything involving money, payments or customer trust - prices, totals, tax, fees, deposits, credits, refunds, invoices, Stripe checkout or webhooks, contracts and signatures, texting/email consent and opt-outs (STOP), reminders, scheduled sends, and AI actions that spend money or message customers. Use whenever the work touches those, even if the user only says "add a button to refund", "send a reminder", "text the customer", or "take a deposit".
---

# Money and trust code

These areas hurt real people when wrong, and in this project they are where review rounds found real bugs (double credit on refund, refund races, unscheduled payments, reminders sent after payment). The habits below catch those early.

## Money

1. **Integer cents everywhere.** Never floats. Convert for display at the edge only.
2. **Put the rule in a pure function** in `src/lib/*.ts` (`invoice-math.ts` is the model) and call it from the UI and the server. One implementation of totals, fees, credits and rounding. State the rounding direction in a comment and a test.
3. **Idempotency.** Every payment, refund, webhook handler and scheduled send must be safe to run twice: use a unique key (Stripe idempotency key, event id, `unique` constraint) and check state before acting.
4. **Races.** Anything that checks then writes (refund, apply credit, mark paid) happens in one transaction or an atomic update with a state guard in the `where` clause (`... where status = 'paid'`), then checks the affected row count. Think: what if two requests, or the webhook and the success page, arrive together?
5. **Re-check right before the side effect.** A reminder, text or charge decided earlier is verified against current state at send time (invoice still unpaid? customer still consenting? job not cancelled?).
6. **Credits and refunds must reconcile.** If a refund reverses a credit, make sure credit can't be counted twice and a partial refund can't exceed what was paid. Ask "what if it is refunded after the credit was already used?"
7. **Trust the provider, not the browser.** Fulfil from the signed webhook (and a verified fallback), never from a client claim of success. Verify signatures, and keep secrets server-side.
8. **Record who and when.** Money state changes get an audit/activity row.

## Customer messaging and consent

1. Check consent **at send time** through the single shared helper, not in each caller. Only an explicit opt-out (STOP) blocks; follow whatever the repo's consent rule says, and keep it in one place.
2. STOP/HELP/START keywords are handled by the inbound webhook and recorded; opt-outs are honored immediately and across every send path (automations, manual, AI).
3. Respect quiet hours and rate limits; save every outbound message to the conversation with delivery status so support can see what happened.
4. Never send from an AI or automated path without the supervised-approval flow where one exists; approval names the exact content it saw.
5. Don't include sensitive details in a text that the customer didn't expect; keep texts short and identify the business.

## Contracts and signatures

Store the signed content as shown (not a pointer to something editable), with signer name, time, and method (online vs in person). A signed contract is immutable; changes create a new version.

## Tests (the only things worth testing in most apps)

Add `node --test` unit tests for: price and total math, fee rounding, credits/deposits/refunds, who may see/change what, tenant isolation, signature rules, consent/opt-out. Name tests as sentences describing the rule. Don't test layout or copy. Run the whole suite before merging, and when a test breaks, fix the code unless the behaviour was meant to change; never delete or skip it to get green.

## Quick self-review before finishing

- Could this run twice? Could two run at once? Could it run after the situation changed?
- Does any number pass through a float or get computed in two places?
- Can the customer end up charged, texted, or credited when they shouldn't be?
