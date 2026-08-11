import test from "node:test";
import assert from "node:assert/strict";

import {
  confirmationEmail,
  customerConfirmationSms,
  emailSender,
  looksLikeEmail,
  ownerBookingEmail,
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

test("the email comes from the business, not from the software", () => {
  // The address is the platform's, because the platform holds the verified
  // domain. The name is the electrician's, because that is who called.
  assert.equal(
    emailSender("Pacific Plains Electric", "bookings@volteira.com"),
    "Pacific Plains Electric <bookings@volteira.com>",
  );
});

test("a From line that already names a sender is left alone", () => {
  assert.equal(
    emailSender("Pacific Plains Electric", "Bookings <hello@example.com>"),
    "Bookings <hello@example.com>",
  );
});

test("a business name cannot break the From header apart", () => {
  // The name is tenant-controlled, so it is the untrusted half of this header.
  const sender = emailSender('Bob "Sparks" Reyes, Inc. <evil@attacker.test>', "b@volteira.com");

  // Exactly one address, and it is ours.
  assert.equal(sender.match(/</g)?.length, 1);
  assert.equal(sender.match(/>/g)?.length, 1);
  assert.ok(sender.endsWith("<b@volteira.com>"), sender);

  // Nothing in the display name reads as an address of its own.
  const displayName = sender.slice(0, sender.indexOf("<"));
  assert.doesNotMatch(displayName, /[@"<>,;:]/);
});

test("with nothing configured there is no sender at all", () => {
  assert.equal(emailSender("Pacific Plains Electric", ""), "");
  assert.equal(emailSender("", "bookings@volteira.com"), "bookings@volteira.com");
});

const WITH_ANSWERS = {
  ...FACTS,
  customerPhone: "209-819-9985",
  intakeAnswers: [
    { question: "Whole house or one room?", answer: "just the kitchen" },
    { question: "When did it start?", answer: "yesterday, new oven" },
    { question: "Anything to get in?", answer: "I have a dog" },
  ],
};

test("the owner's email is a work order, not a reassurance", () => {
  // Enough to load a van from without opening the app.
  const mail = ownerBookingEmail(WITH_ANSWERS, "https://www.volteira.com/jobs/abc");

  for (const body of [mail.text, mail.html]) {
    assert.match(body, /Mon, Aug 10, 8:00 AM-10:00 AM/);
    assert.match(body, /4 Red Gum Lane, Nipomo/);
    assert.match(body, /209-819-9985/);
    assert.match(body, /just the kitchen/);
    assert.match(body, /I have a dog/);
    assert.match(body, /\$100/);
    assert.match(body, /jobs\/abc/);
  }
});

test("the owner's subject says when and who, because that is the inbox line", () => {
  const mail = ownerBookingEmail(WITH_ANSWERS);
  assert.match(mail.subject, /^New booking: Mon, Aug 10/);
  assert.match(mail.subject, /Adam/);
});

test("the owner's email survives having no job link and no answers", () => {
  const mail = ownerBookingEmail(FACTS);
  assert.doesNotMatch(mail.text, /Open the job/);
  assert.match(mail.text, /Mon, Aug 10/);
});

test("a caller's words cannot become markup in the owner's email either", () => {
  const mail = ownerBookingEmail({
    ...WITH_ANSWERS,
    intakeAnswers: [{ question: "Access?", answer: "<img src=x onerror=alert(1)>" }],
  });
  assert.doesNotMatch(mail.html, /<img/);
  assert.match(mail.html, /&lt;img/);
});

test("a booking with no address still confirms the window", () => {
  const message = customerConfirmationSms({ ...FACTS, addressLine1: "", city: "" });
  assert.match(message, /Mon, Aug 10/);
  assert.doesNotMatch(message, / at \./);
});
