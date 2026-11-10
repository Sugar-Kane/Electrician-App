import test from "node:test";
import assert from "node:assert/strict";

import { checkCloseOut, checkPaidInHand, checkPayment } from "./invoice-payment.ts";

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

test("paid in hand settles the whole balance, even on a draft the customer was never sent", () => {
  const draft = { status: "draft", totalCents: 45_000, balanceDueCents: 45_000 };
  assert.deepEqual(checkPaidInHand({ invoice: draft, method: "cash" }), { ok: true, amountCents: 45_000, method: "cash" });
  const partPaid = { status: "partially_paid", totalCents: 45_000, balanceDueCents: 20_000 };
  assert.deepEqual(checkPaidInHand({ invoice: partPaid, method: "check" }), { ok: true, amountCents: 20_000, method: "check" }, "only what is still owed");
});

test("paid in hand is refused when it would record money wrongly", () => {
  const base = { status: "sent", totalCents: 45_000, balanceDueCents: 45_000 };
  assert.equal(checkPaidInHand({ invoice: { ...base, status: "paid" }, method: "cash" }).ok, false, "already paid");
  assert.equal(checkPaidInHand({ invoice: { ...base, status: "void" }, method: "cash" }).ok, false, "void");
  assert.equal(checkPaidInHand({ invoice: { ...base, stripeInvoiceId: "in_123" }, method: "cash" }).ok, false, "collected online");
  assert.equal(checkPaidInHand({ invoice: { ...base, balanceDueCents: 0 }, method: "cash" }).ok, false, "nothing owed");
  assert.equal(checkPaidInHand({ invoice: base, method: "bitcoin" }).ok, false, "unknown method");
  assert.equal(checkPaidInHand({ invoice: base, method: "bank" }).ok, false, "bank is only ever recorded by the online payment, never by hand");
});

test("a job closes out only when every live invoice is paid and nothing is left unbilled", () => {
  assert.deepEqual(checkCloseOut({ jobStatus: "draft", invoices: [{ status: "paid" }], unbilledCents: 0 }), { ok: true });
  assert.deepEqual(checkCloseOut({ jobStatus: "draft", invoices: [{ status: "paid" }, { status: "void" }], unbilledCents: 0 }), { ok: true }, "a void invoice doesn't count");
  assert.equal(checkCloseOut({ jobStatus: "draft", invoices: [], unbilledCents: 0 }).ok, false, "no invoice");
  assert.equal(checkCloseOut({ jobStatus: "draft", invoices: [{ status: "paid" }, { status: "sent" }], unbilledCents: 0 }).ok, false, "one still owed");
  assert.equal(checkCloseOut({ jobStatus: "draft", invoices: [{ status: "paid" }], unbilledCents: 5000 }).ok, false, "work not billed");
  assert.equal(checkCloseOut({ jobStatus: "completed", invoices: [{ status: "paid" }], unbilledCents: 0 }).ok, false, "already done");
  assert.equal(checkCloseOut({ jobStatus: "canceled", invoices: [{ status: "paid" }], unbilledCents: 0 }).ok, false, "called off");
});
