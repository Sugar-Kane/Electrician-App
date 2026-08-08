import test from "node:test";
import assert from "node:assert/strict";

import {
  decideAutomaticSend,
  renderTemplate,
  triggerIgnoresQuietHours,
  unresolvedPlaceholders,
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

test("a template that is nothing but an unfillable placeholder is refused by name", () => {
  // This used to be caught by the "renders empty" branch, which meant the
  // operator was told the template was empty rather than which value was
  // missing. Naming the placeholder is the more useful failure.
  const decision = decideAutomaticSend({
    trigger: "job_confirmed",
    template: template("{{customer_first_name}}"),
    variables: {},
    currentlyQuiet: false,
  });
  assert.equal(decision.send, false);
  assert.match(decision.send === false ? decision.reason : "", /customer_first_name/);
});

test("a template with no content at all is still refused as empty", () => {
  const decision = decideAutomaticSend({
    trigger: "job_confirmed",
    template: template("   "),
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

test("a placeholder nothing can fill is reported rather than blanked", () => {
  // The deployed job_confirmed template asks for {{reschedule_hours}}; blanking
  // it sends "Free reschedule up to h before" to a real customer.
  assert.deepEqual(
    unresolvedPlaceholders("Free reschedule up to {{reschedule_hours}}h before.", {}),
    ["reschedule_hours"],
  );
  assert.deepEqual(
    unresolvedPlaceholders("Hi {{customer_first_name}}.", { customer_first_name: "Ada" }),
    [],
  );
});

test("a template with an unfillable placeholder refuses to send", () => {
  const decision = decideAutomaticSend({
    trigger: "job_confirmed",
    template: template(
      "You're booked with {{business_name}}. Free reschedule up to {{reschedule_hours}}h before.",
    ),
    variables: { business_name: "Pacific Plains Electric" },
    currentlyQuiet: false,
  });
  assert.equal(decision.send, false, "sending mangled text is worse than sending nothing");
  assert.match(decision.send === false ? decision.reason : "", /reschedule_hours/);
});

test("the same template sends once the value is supplied", () => {
  const decision = decideAutomaticSend({
    trigger: "job_confirmed",
    template: template(
      "You're booked with {{business_name}}. Free reschedule up to {{reschedule_hours}}h before.",
    ),
    variables: { business_name: "Pacific Plains Electric", reschedule_hours: "24" },
    currentlyQuiet: false,
  });
  assert.equal(decision.send, true);
  assert.equal(
    decision.send === true ? decision.body : "",
    "You're booked with Pacific Plains Electric. Free reschedule up to 24h before.",
  );
});

test("link placeholders in the deployed templates are refused, not silently dropped", () => {
  // Several deployed templates carry {{invoice_link}} and friends. The campaign
  // was filed with "messages include embedded links" unchecked, so these must
  // not go out until both the data and the registration support them.
  const decision = decideAutomaticSend({
    trigger: "invoice_sent",
    template: template("{{business_name}}: invoice {{invoice_number}} is ready. {{invoice_link}}"),
    variables: { business_name: "Pacific Plains Electric" },
    currentlyQuiet: false,
  });
  assert.equal(decision.send, false);
  assert.match(decision.send === false ? decision.reason : "", /invoice_number|invoice_link/);
});
