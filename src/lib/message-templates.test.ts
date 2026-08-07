import test from "node:test";
import assert from "node:assert/strict";

import {
  decideAutomaticSend,
  renderTemplate,
  triggerIgnoresQuietHours,
} from "./message-templates.ts";

const template = (body: string, isActive = true) => ({ body, isActive });

test("placeholders are substituted", () => {
  assert.equal(
    renderTemplate("Hi {{customer_first_name}}, {{business_name}} is confirmed.", {
      customer_first_name: "Ada",
      business_name: "Pacific Plains Electric",
    }),
    "Hi Ada, Pacific Plains Electric is confirmed.",
  );
});

test("an unknown or empty placeholder never reaches the customer as braces", () => {
  // A customer receiving literal "{{customer_first_name}}" is the kind of thing
  // that turns into a carrier complaint.
  assert.equal(renderTemplate("Hi {{customer_first_name}}, welcome.", {}), "Hi, welcome.");
  assert.equal(renderTemplate("Hi {{nonsense}}.", {}), "Hi.");
});

test("substitution does not leave doubled spaces or floating punctuation", () => {
  assert.equal(
    renderTemplate("{{business_name}}: your tech {{technician_name}} is on the way.", {
      business_name: "Pacific Plains Electric",
    }),
    "Pacific Plains Electric: your tech is on the way.",
  );
});

test("placeholder matching tolerates whitespace and case", () => {
  assert.equal(renderTemplate("Hi {{ Customer_First_Name }}!", { customer_first_name: "Ada" }), "Hi Ada!");
});

test("messages the customer is waiting on ignore quiet hours", () => {
  assert.equal(triggerIgnoresQuietHours("job_en_route"), true);
  assert.equal(triggerIgnoresQuietHours("job_arrived"), true);
  assert.equal(triggerIgnoresQuietHours("job_confirmed"), true);
});

test("messages that can wait respect quiet hours", () => {
  assert.equal(triggerIgnoresQuietHours("review_request"), false);
  assert.equal(triggerIgnoresQuietHours("invoice_overdue"), false);
  assert.equal(triggerIgnoresQuietHours("job_reminder"), false);
});

test("a review request is held during quiet hours", () => {
  const decision = decideAutomaticSend({
    trigger: "review_request",
    template: template("Thanks from {{business_name}}."),
    variables: { business_name: "Pacific Plains Electric" },
    currentlyQuiet: true,
  });
  assert.equal(decision.send, false);
  assert.match(decision.send === false ? decision.reason : "", /Quiet hours/);
});

test("an en-route message goes out during quiet hours", () => {
  // 07:50 is inside the default quiet window and is exactly when someone needs
  // to know a van is about to arrive.
  const decision = decideAutomaticSend({
    trigger: "job_en_route",
    template: template("{{business_name}}: your technician is on the way."),
    variables: { business_name: "Pacific Plains Electric" },
    currentlyQuiet: true,
  });
  assert.equal(decision.send, true);
  assert.equal(
    decision.send === true ? decision.body : "",
    "Pacific Plains Electric: your technician is on the way.",
  );
});

test("a switched-off template does not send even when everything else is fine", () => {
  const decision = decideAutomaticSend({
    trigger: "job_confirmed",
    template: template("Confirmed.", false),
    variables: {},
    currentlyQuiet: false,
  });
  assert.equal(decision.send, false);
  assert.match(decision.send === false ? decision.reason : "", /switched off/);
});

test("a missing template is a reason, not a crash", () => {
  const decision = decideAutomaticSend({
    trigger: "job_confirmed",
    template: null,
    variables: {},
    currentlyQuiet: false,
  });
  assert.equal(decision.send, false);
  assert.match(decision.send === false ? decision.reason : "", /No template/);
});

test("a template that renders to nothing is not sent", () => {
  const decision = decideAutomaticSend({
    trigger: "job_confirmed",
    template: template("{{customer_first_name}}"),
    variables: {},
    currentlyQuiet: false,
  });
  assert.equal(decision.send, false);
  assert.match(decision.send === false ? decision.reason : "", /empty/);
});

test("a template too long for one message is refused rather than truncated", () => {
  const decision = decideAutomaticSend({
    trigger: "job_confirmed",
    template: template("x".repeat(1601)),
    variables: {},
    currentlyQuiet: false,
  });
  assert.equal(decision.send, false);
  assert.match(decision.send === false ? decision.reason : "", /too long/);
});
