import test from "node:test";
import assert from "node:assert/strict";

import {
  cancellationEmail,
  cancellationSms,
  changeNeedsCustomerNotice,
  rescheduleEmail,
  rescheduleSms,
  type JobChangeFacts,
} from "./job-change-messages.ts";

const FACTS: JobChangeFacts = {
  businessName: "Pacific Plains Electric",
  businessPhone: "(805) 626-7761",
  contactName: "Adam Kane",
  slotLabel: "Tue, Aug 11, 8:00 AM-10:00 AM",
  newSlotLabel: "Thu, Aug 13, 1:00 PM-3:00 PM",
};

test("the cancellation leads with the cancellation, not the business name", () => {
  // On a lock screen the first few words are all that gets read, and the part
  // that changes somebody's morning is that nobody is coming.
  const message = cancellationSms(FACTS);
  assert.ok(message.startsWith("Adam, your Pacific Plains Electric appointment"), message);
  assert.match(message, /has been canceled/);
});

test("the cancellation says when it was and how to rebook", () => {
  const message = cancellationSms(FACTS);
  assert.match(message, /Tue, Aug 11, 8:00 AM-10:00 AM/);
  assert.match(message, /\(805\) 626-7761/);
});

test("a reason given by the business reaches the customer", () => {
  const message = cancellationSms({ ...FACTS, reason: "Our van broke down." });
  assert.match(message, /Our van broke down\./);
});

test("nothing sent to a phone runs past two segments", () => {
  // Carriers split anything longer and may deliver the halves out of order.
  const long = cancellationSms({
    ...FACTS,
    businessName: "Pacific Plains Electric and Generator Services of the Central Coast",
    contactName: "Bartholomew Fitzgerald-Winchester",
    reason: "x".repeat(500),
  });
  assert.ok(long.length <= 320, `${long.length} characters`);

  const moved = rescheduleSms({
    ...FACTS,
    businessName: "Pacific Plains Electric and Generator Services of the Central Coast",
  });
  assert.ok(moved.length <= 320, `${moved.length} characters`);
});

test("a customer with no name on file still gets a sentence", () => {
  const message = cancellationSms({ ...FACTS, contactName: "" });
  assert.ok(message.startsWith("Your Pacific Plains Electric"), message);
  assert.doesNotMatch(message, /^, /);
});

test("the reschedule shows both windows, old first", () => {
  const message = rescheduleSms(FACTS);
  assert.ok(
    message.indexOf("Tue, Aug 11") < message.indexOf("Thu, Aug 13"),
    message,
  );
  assert.match(message, /moved from/);
});

test("a reschedule with no new window still reads as a sentence", () => {
  const message = rescheduleSms({ ...FACTS, newSlotLabel: undefined });
  assert.match(message, /to a new time/);
  assert.doesNotMatch(message, /undefined/);
});

test("both email bodies carry the same facts", () => {
  const mail = cancellationEmail({ ...FACTS, reason: "Our van broke down." });
  for (const body of [mail.text, mail.html]) {
    assert.match(body, /Tue, Aug 11, 8:00 AM-10:00 AM/);
    assert.match(body, /canceled/);
    assert.match(body, /626-7761/);
    assert.match(body, /Our van broke down/);
  }
  assert.match(mail.subject, /^Canceled:/);
  assert.match(mail.subject, /Tue, Aug 11/);
});

test("the reschedule subject names the new time, because that is the inbox line", () => {
  const mail = rescheduleEmail(FACTS);
  assert.match(mail.subject, /^Moved:/);
  assert.match(mail.subject, /Thu, Aug 13/);
  for (const body of [mail.text, mail.html]) {
    assert.match(body, /Tue, Aug 11/);
    assert.match(body, /Thu, Aug 13/);
  }
});

test("a reason typed by the business cannot become markup", () => {
  // It is free text from a person, landing in a stranger's inbox.
  const mail = cancellationEmail({
    ...FACTS,
    reason: '<img src=x onerror=alert(1)>',
    contactName: "<script>alert(2)</script>",
  });
  assert.doesNotMatch(mail.html, /<img|<script/);
  assert.match(mail.html, /&lt;img/);
});

test("a phone number cannot break the tel: link apart", () => {
  // The escaped text of the link may legitimately contain the characters
  // somebody typed; what must not happen is those characters closing the href
  // attribute. So this asserts the href itself, not the absence of a substring.
  const mail = cancellationEmail({ ...FACTS, businessPhone: '(805) 626-7761" onmouseover="x' });

  const href = mail.html.match(/href="tel:([^"]*)"/)?.[1];
  assert.ok(href, mail.html);
  assert.match(href, /^[\d+]*$/);

  // And nothing outside a tag ever becomes one.
  assert.doesNotMatch(mail.html, /<[^>]*onmouseover/);
});

test("an email with no reason does not leave an empty paragraph", () => {
  const mail = cancellationEmail(FACTS);
  assert.doesNotMatch(mail.html, /<p><\/p>/);
  assert.doesNotMatch(mail.text, /\n\n\n/);
});

test("a cancellation always warrants telling the customer", () => {
  assert.equal(
    changeNeedsCustomerNotice({
      canceled: true,
      previousStart: "a",
      nextStart: "a",
      previousEnd: "b",
      nextEnd: "b",
    }),
    true,
  );
});

test("moving the time warrants it; editing anything else does not", () => {
  // Reassigning which electrician turns up is the business's own business.
  // The two hours somebody booked off work is not.
  assert.equal(
    changeNeedsCustomerNotice({
      canceled: false,
      previousStart: "2026-08-11T15:00:00Z",
      nextStart: "2026-08-13T20:00:00Z",
      previousEnd: "2026-08-11T17:00:00Z",
      nextEnd: "2026-08-13T22:00:00Z",
    }),
    true,
  );

  assert.equal(
    changeNeedsCustomerNotice({
      canceled: false,
      previousStart: "2026-08-11T15:00:00Z",
      nextStart: "2026-08-11T15:00:00Z",
      previousEnd: "2026-08-11T17:00:00Z",
      nextEnd: "2026-08-11T17:00:00Z",
    }),
    false,
  );
});

test("shortening the window alone still counts as a change worth sending", () => {
  // Same start, earlier end: somebody waiting until 10 needs to know it is now 9.
  assert.equal(
    changeNeedsCustomerNotice({
      canceled: false,
      previousStart: "2026-08-11T15:00:00Z",
      nextStart: "2026-08-11T15:00:00Z",
      previousEnd: "2026-08-11T17:00:00Z",
      nextEnd: "2026-08-11T16:00:00Z",
    }),
    true,
  );
});
