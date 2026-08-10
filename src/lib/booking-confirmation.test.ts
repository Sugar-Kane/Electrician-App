import test from "node:test";
import assert from "node:assert/strict";

import {
  confirmationEmail,
  customerConfirmationSms,
  looksLikeEmail,
  ownerBookingSms,
  type BookingFacts,
} from "./booking-confirmation.ts";

const FACTS: BookingFacts = {
  businessName: "Pacific Plains Electric",
  businessPhone: "(805) 626-7761",
  contactName: "Adam",
  slotLabel: "Mon, Aug 10, 8:00 AM-10:00 AM",
  addressLine1: "4 Red Gum Lane",
  city: "Nipomo",
  diagnosticFee: "$100",
  description: "My power is out.",
  link: "https://www.volteira.com/booking/2f1b7c14-9f2a-4b8e-8c1d-6a0e2b4f7d33",
};

test("the customer is told the window, the address, and the price", () => {
  const message = customerConfirmationSms(FACTS);

  assert.match(message, /Mon, Aug 10, 8:00 AM-10:00 AM/);
  assert.match(message, /4 Red Gum Lane, Nipomo/);
  assert.match(message, /\$100/);
  assert.match(message, /\(805\) 626-7761/);
});

test("the window comes before the link, so a truncated text still has the appointment", () => {
  const message = customerConfirmationSms(FACTS);
  assert.ok(message.indexOf("Aug 10") < message.indexOf("https://"), message);
});

test("a confirmation with no link is still a complete confirmation", () => {
  const message = customerConfirmationSms({ ...FACTS, link: undefined });

  assert.doesNotMatch(message, /https?:\/\//);
  assert.match(message, /Mon, Aug 10/);
  assert.match(message, /\$100/);
});

test("nothing sent to a phone runs past two segments", () => {
  const long = customerConfirmationSms({
    ...FACTS,
    businessName: "Pacific Plains Electric and Generator Services of the Central Coast",
    addressLine1: "12345 Extraordinarily Long Rural Route Name Suite 400",
    city: "San Luis Obispo",
    description: "x".repeat(500),
  });
  assert.ok(long.length <= 320, `${long.length} characters`);
});

test("the owner's text reads on a lock screen: when, who, where, what", () => {
  const message = ownerBookingSms(FACTS);

  assert.ok(message.startsWith("New booking: Mon, Aug 10"), message);
  assert.match(message, /Adam/);
  assert.match(message, /4 Red Gum Lane, Nipomo/);
  assert.match(message, /My power is out/);
  // The owner has the app; a link would just be noise.
  assert.doesNotMatch(message, /https?:\/\//);
});

test("the owner's text survives a caller who talked for a paragraph", () => {
  const message = ownerBookingSms({ ...FACTS, description: "and then ".repeat(200) });
  assert.ok(message.length <= 320, `${message.length} characters`);
});

test("the email says the same thing in both bodies", () => {
  const mail = confirmationEmail(FACTS);

  for (const body of [mail.text, mail.html]) {
    assert.match(body, /Mon, Aug 10, 8:00 AM-10:00 AM/);
    assert.match(body, /4 Red Gum Lane, Nipomo/);
    assert.match(body, /\$100/);
    assert.match(body, /626-7761/);
  }
  assert.match(mail.subject, /Pacific Plains Electric/);
  assert.match(mail.subject, /Mon, Aug 10/);
});

test("anything a caller said is escaped before it becomes HTML", () => {
  const mail = confirmationEmail({
    ...FACTS,
    contactName: '<script>alert("x")</script>',
    description: "breaker & panel <both>",
  });

  assert.doesNotMatch(mail.html, /<script>/);
  assert.match(mail.html, /&lt;script&gt;/);
  assert.match(mail.html, /breaker &amp; panel/);
});

test("an address that came out of speech recognition is not mailed to", () => {
  // "adam at gmail dot com" does not survive transcription as an address, and
  // queueing mail that can only bounce helps nobody.
  for (const value of [
    "adam at gmail dot com",
    "adam@gmail",
    "@gmail.com",
    "adam@@gmail.com",
    "adam gmail.com",
    "",
    "a@b.c d@e.f",
  ]) {
    assert.equal(looksLikeEmail(value), false, value);
  }

  for (const value of ["adam@gmail.com", "adam.kane+jobs@pacificplainselectric.com"]) {
    assert.equal(looksLikeEmail(value), true, value);
  }
});

test("a booking with no address still confirms the window", () => {
  const message = customerConfirmationSms({ ...FACTS, addressLine1: "", city: "" });
  assert.match(message, /Mon, Aug 10/);
  assert.doesNotMatch(message, / at \./);
});
