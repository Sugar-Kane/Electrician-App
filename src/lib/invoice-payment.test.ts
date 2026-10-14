import test from "node:test";
import assert from "node:assert/strict";

import { checkPayment } from "./invoice-payment.ts";

const sent = { status: "sent", totalCents: 128_050, balanceDueCents: 128_050 };

test("paying the balance marks the invoice paid; paying part leaves it part paid", () => {
  const full = checkPayment({ invoice: sent, method: "check", amountText: "$1,280.50" });
  assert.deepEqual(full, { ok: true, amountCents: 128_050, method: "check", status: "paid", balanceAfterCents: 0 });

  const part = checkPayment({ invoice: sent, method: "cash", amountText: "500" });
  assert.equal(part.ok && part.status, "partially_paid");
  assert.equal(part.ok && part.balanceAfterCents, 78_050);

  // A part-paid invoice is owed its balance, not its total.
  const rest = checkPayment({
    invoice: { status: "partially_paid", totalCents: 128_050, balanceDueCents: 78_050 },
    method: "card",
    amountText: "780.50",
  });
  assert.equal(rest.ok && rest.status, "paid");
});

test("a payment is never recorded for more than is owed, nothing, or an unreadable amount", () => {
  for (const amountText of ["1280.51", "0", "", "twelve", "-5"]) {
    assert.equal(checkPayment({ invoice: sent, method: "cash", amountText }).ok, false, amountText);
  }
  assert.equal(checkPayment({ invoice: sent, method: "bitcoin", amountText: "10" }).ok, false);
});

test("a void, draft, paid, or online-collected invoice takes no payment here", () => {
  for (const invoice of [
    { ...sent, status: "void" },
    { ...sent, status: "draft" },
    { ...sent, status: "paid", balanceDueCents: 0 },
    { ...sent, stripeInvoiceId: "in_123" },
  ]) {
    assert.equal(checkPayment({ invoice, method: "cash", amountText: "10" }).ok, false, JSON.stringify(invoice));
  }
});
