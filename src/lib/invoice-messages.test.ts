import test from "node:test";
import assert from "node:assert/strict";

import {
  describeDelivery,
  formatMoney,
  invoiceCanBeSent,
  invoiceEmail,
  invoiceSms,
  type DeliveryAttempt,
  type InvoiceFacts,
} from "./invoice-messages.ts";

const attempt = (over: Partial<DeliveryAttempt>): DeliveryAttempt => ({
  channel: "sms",
  to: "+12096269313",
  ok: true,
  detail: "queued",
  at: "2026-08-11T23:00:00.000Z",
  ...over,
});

const base: InvoiceFacts = {
  businessName: "Pacific Plains Electric",
  businessPhone: "(209) 626-9313",
  contactName: "Dana Harper",
  invoiceNumber: "INV-10024",
  amountDue: 1280,
  dueLabel: "Aug 21, 2026",
};

test("money is written the way it is written on a bill", () => {
  // "$1,280" and "$1,280.00" are the same number, but only one of them looks
  // like a figure somebody checked.
  assert.equal(formatMoney(1280), "$1,280.00");
  assert.equal(formatMoney(3789.32), "$3,789.32");
  assert.equal(formatMoney(950.5), "$950.50");
  assert.equal(formatMoney(0), "$0.00");
  assert.equal(formatMoney(1234567.89), "$1,234,567.89");
});

test("money survives values that should never reach it", () => {
  assert.equal(formatMoney(Number.NaN), "$0.00");
  assert.equal(formatMoney(Number.POSITIVE_INFINITY), "$0.00");
  assert.equal(formatMoney(-42), "-$42.00");
});

test("the text leads with the amount, not the business name", () => {
  const message = invoiceSms(base);

  // What the customer decides on is the number. A lock screen shows the first
  // few words and nothing else.
  assert.ok(message.startsWith("Dana:"), message);
  assert.ok(message.includes("$1,280.00"));
  assert.ok(message.includes("INV-10024"));
  assert.ok(message.includes("due Aug 21, 2026"));
});

test("a nameless customer is not texted a sentence starting mid-clause", () => {
  // The same fault that shipped in the cancellation text: without a name the
  // message opened at "your", lowercase, reading like a fragment.
  const message = invoiceSms({ ...base, contactName: "" });

  assert.ok(message.startsWith("Your Pacific Plains Electric invoice"), message);
});

test("without a pay link the text says how to pay instead", () => {
  // An invoice that states an amount and offers no way to settle it is a
  // demand, not a bill.
  const message = invoiceSms(base);
  assert.ok(message.includes("Call (209) 626-9313 to pay."), message);

  const withLink = invoiceSms({ ...base, payUrl: "https://pay.stripe.com/i/abc123" });
  assert.ok(withLink.includes("Pay: https://pay.stripe.com/i/abc123"));
  assert.ok(!withLink.includes("to pay."), "the fallback must not also appear");
});

test("the text stays inside two SMS segments", () => {
  // Past 320 characters carriers split the message and may deliver the halves
  // out of order, so the amount can arrive after the link.
  const message = invoiceSms({
    ...base,
    businessName: "Pacific Plains Electric and Generator Service of the Central Coast",
    contactName: "Bartholomew",
    payUrl: `https://pay.stripe.com/i/${"x".repeat(200)}`,
  });

  assert.ok(message.length <= 320, `was ${message.length}`);
});

test("no due date simply goes unmentioned", () => {
  const message = invoiceSms({ ...base, dueLabel: "" });

  assert.ok(!message.includes("due "), message);
  assert.ok(!message.includes("undefined"));
  assert.ok(message.includes("is ready."));
});

test("the email subject carries the amount", () => {
  // "Invoice from Pacific Plains Electric" tells somebody scanning an inbox
  // nothing they can act on.
  const mail = invoiceEmail(base);

  assert.ok(mail.subject.includes("$1,280.00"), mail.subject);
  assert.ok(mail.subject.includes("INV-10024"));
});

test("the email offers a button when there is a link and a phone number when there is not", () => {
  const withLink = invoiceEmail({ ...base, payUrl: "https://pay.stripe.com/i/abc123" });
  assert.ok(withLink.html.includes("https://pay.stripe.com/i/abc123"));
  assert.ok(withLink.text.includes("Pay online: https://pay.stripe.com/i/abc123"));

  const without = invoiceEmail(base);
  assert.ok(without.text.includes("To pay, call (209) 626-9313."));
  assert.ok(without.html.includes("tel:"));
});

test("customer-supplied text cannot inject markup into the email", () => {
  const mail = invoiceEmail({
    ...base,
    contactName: '<script>alert("x")</script>',
    workSummary: "Panel upgrade & <b>rewire</b>",
  });

  assert.ok(!mail.html.includes("<script>"), "a name must never become markup");
  assert.ok(mail.html.includes("&lt;script&gt;"));
  assert.ok(mail.html.includes("Panel upgrade &amp; &lt;b&gt;rewire&lt;/b&gt;"));
});

test("the tel: link is digits, not the formatted number", () => {
  const mail = invoiceEmail(base);
  const href = /href="tel:([^"]*)"/.exec(mail.html)?.[1] ?? "";

  assert.ok(href.length > 0, "expected a tel: link");
  assert.ok(/^[\d+]+$/.test(href), `dialable digits only, got ${href}`);
});

test("a paid invoice is not sent again", () => {
  // A second demand for money already handed over is the kind of mistake a
  // customer tells other people about.
  const paid = invoiceCanBeSent({ status: "Paid", amountDue: 0 });
  assert.equal(paid.ok, false);
  assert.match(paid.ok === false ? paid.reason : "", /already paid/);

  assert.equal(invoiceCanBeSent({ status: "paid", amountDue: 500 }).ok, false);
});

test("a zero balance is not sent either", () => {
  const settled = invoiceCanBeSent({ status: "Unpaid", amountDue: 0 });
  assert.equal(settled.ok, false);
  assert.match(settled.ok === false ? settled.reason : "", /nothing left to pay/);
});

test("an ordinary unpaid invoice can be sent", () => {
  assert.equal(invoiceCanBeSent({ status: "Unpaid", amountDue: 1280 }).ok, true);
  assert.equal(invoiceCanBeSent({ status: "Overdue", amountDue: 950 }).ok, true);
});

test("both channels landing is reported as one plain success", () => {
  const result = describeDelivery([
    attempt({ channel: "sms" }),
    attempt({ channel: "email", to: "dana@example.com", detail: "re_123" }),
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.message, "Invoice sent by text and email.");
  // Provider ids are for the log, not for the person who pressed the button.
  assert.ok(!result.message.includes("re_123"));
});

test("partial success is neither claimed as success nor reported as failure", () => {
  // The common case: a customer with an email address and no mobile. Calling
  // this a failure hides that the invoice did go out; calling it a clean
  // success hides that the text did not.
  const result = describeDelivery([
    attempt({ channel: "sms", ok: false, detail: "No phone number on this customer." }),
    attempt({ channel: "email", to: "dana@example.com" }),
  ]);

  assert.equal(result.ok, true, "the invoice did reach the customer");
  assert.ok(result.message.includes("Sent by email."), result.message);
  assert.ok(result.message.includes("text: No phone number on this customer."), result.message);
});

test("total failure gives the reason, not a summary of it", () => {
  // "Could not send" sends somebody looking through logs for something the
  // screen already knew.
  const result = describeDelivery([
    attempt({ channel: "sms", ok: false, detail: "21610: recipient has opted out." }),
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.message, "21610: recipient has opted out.");
});

test("sending with nothing selected is a fault, not a quiet success", () => {
  const result = describeDelivery([]);

  assert.equal(result.ok, false);
  assert.match(result.message, /no delivery method was chosen/);
});
