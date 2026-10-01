import test from "node:test";
import assert from "node:assert/strict";

import {
  completeDraftFields,
  CONTRACT_PLACEHOLDERS,
  contractMoney,
  fillTemplate,
  placeholdersUsed,
  scopePrompt,
  STARTER_TEMPLATE,
  unknownPlaceholders,
  type ContractFacts,
} from "./contract-template.ts";
import { bodyProvidesSignatures } from "./contract-signatures.ts";

const facts: ContractFacts = {
  business_name: "Pacific Plains Electric",
  business_phone: "(209) 626-9313",
  customer_name: "Dana Harper",
  service_address: "994 Red Gum Lane, Nipomo, CA 93444",
  job_number: "1045",
  job_date: "Tue, Aug 18",
  work_type: "Panel or breaker",
  total: "$1,280.00",
  deposit: "$100.00",
  scope: "Replace the main service panel and reterminate the branch circuits.",
  today: "Aug 11, 2026",
};

test("a template is filled from the job", () => {
  const filled = fillTemplate(
    "Agreement for {{customer_name}} at {{service_address}} for {{total}}.",
    facts,
  );

  assert.equal(
    filled.body,
    "Agreement for Dana Harper at 994 Red Gum Lane, Nipomo, CA 93444 for $1,280.00.",
  );
  assert.deepEqual(filled.unfilled, []);
});

test("whitespace inside the braces still matches", () => {
  // People type {{ customer_name }} and expect it to work.
  const filled = fillTemplate("Hello {{ customer_name }}.", facts);
  assert.equal(filled.body, "Hello Dana Harper.");
});

test("a missing value leaves the placeholder visible and is reported", () => {
  // The failure this prevents: an unpriced contract emailed to a customer with
  // a blank where the figure should be. A visible {{total}} is a document
  // somebody looks at.
  const filled = fillTemplate("Total: {{total}}", { ...facts, total: "" });

  assert.equal(filled.body, "Total: {{total}}");
  assert.deepEqual(filled.unfilled, ["total"]);
});

test("a whitespace-only value counts as missing", () => {
  const filled = fillTemplate("Customer: {{customer_name}}", { ...facts, customer_name: "   " });

  assert.deepEqual(filled.unfilled, ["customer_name"]);
});

test("a placeholder this app does not know is kept, not deleted", () => {
  // A business asking for {{permit_number}} is asking for something not tracked
  // here. Silently removing it would hide that from them.
  const filled = fillTemplate("Permit: {{permit_number}}", facts);

  assert.equal(filled.body, "Permit: {{permit_number}}");
  assert.deepEqual(filled.unfilled, ["permit_number"]);
  assert.deepEqual(unknownPlaceholders("Permit: {{permit_number}} for {{total}}"), [
    "permit_number",
  ]);
});

test("the same missing placeholder is only reported once", () => {
  const filled = fillTemplate("{{total}} ... {{total}} ... {{total}}", { ...facts, total: "" });

  assert.deepEqual(filled.unfilled, ["total"]);
});

test("placeholders are listed in the order the template asks for them", () => {
  assert.deepEqual(placeholdersUsed("{{total}} then {{customer_name}} then {{total}}"), [
    "total",
    "customer_name",
  ]);
  assert.deepEqual(placeholdersUsed("no placeholders here"), []);
});

test("a template with nothing in it does not crash", () => {
  assert.deepEqual(fillTemplate("", facts), { body: "", unfilled: [] });
});

test("customer text cannot smuggle a placeholder into the output", () => {
  // A customer called "{{total}}" must not cause the price to appear where
  // their name goes. Replacement is single-pass, so a substituted value is
  // never re-scanned.
  const filled = fillTemplate("Customer: {{customer_name}} owes {{total}}", {
    ...facts,
    customer_name: "{{total}}",
  });

  assert.equal(filled.body, "Customer: {{total}} owes $1,280.00");
  assert.deepEqual(filled.unfilled, []);
});

test("the starter template only uses placeholders that can be filled", () => {
  // Shipping a starter template with a placeholder the app cannot answer would
  // hand every new business a document with blanks in it.
  assert.deepEqual(unknownPlaceholders(STARTER_TEMPLATE), []);

  const filled = fillTemplate(STARTER_TEMPLATE, facts);
  assert.deepEqual(filled.unfilled, []);
  assert.ok(!filled.body.includes("{{"), filled.body);
});

test("the starter template carries the parts that make it a contract", () => {
  assert.match(STARTER_TEMPLATE, /SCOPE OF WORK/);
  assert.match(STARTER_TEMPLATE, /PRICE/);
  // Both parties named in the agreement's own words, not only in the document's
  // header blocks — a contract that identifies who it binds only in a letterhead
  // is a letter.
  assert.match(STARTER_TEMPLATE, /\{\{business_name\}\}/);
  assert.match(STARTER_TEMPLATE, /\{\{customer_name\}\}/);
  // Work beyond scope needing approval is the clause that stops an argument on
  // the day.
  assert.match(STARTER_TEMPLATE, /will not begin without your\s+approval/);
});

test("the starter template leaves signing to the document", () => {
  // It used to end with its own two signature lines, from when the filled text
  // was the whole contract. The PDF prints a signature block now, and a template
  // that carries one too produces a page with two places to sign.
  assert.equal(bodyProvidesSignatures(STARTER_TEMPLATE), false);
});

test("every documented placeholder is one fillTemplate handles", () => {
  // The settings screen lists these to the business. A listed placeholder that
  // does not work would be a documented lie.
  for (const entry of CONTRACT_PLACEHOLDERS) {
    const filled = fillTemplate(`{{${entry.key}}}`, facts);
    assert.equal(filled.unfilled.length, 0, entry.key);
    assert.equal(filled.body, facts[entry.key], entry.key);
  }
});

test("the scope prompt forbids everything that is filled in deterministically", () => {
  // A model-written price that contradicts the PRICE section two lines below it
  // is the worst possible output of this feature.
  const prompt = scopePrompt();

  assert.match(prompt, /Never state a price/i);
  assert.match(prompt, /Never promise a completion date/i);
  assert.match(prompt, /Never invent work/i);
});

test("completing a draft preserves terms and fills repeated and custom fields literally", () => {
  const result = completeDraftFields("Terms unchanged. {{ total }} / {{total}}. Permit {{permit_number}}", { total: "$180.00", permit_number: "$&-123" });
  assert.equal(result.body, "Terms unchanged. $180.00 / $180.00. Permit $&-123");
  assert.deepEqual(result.unfilled, []);
});
test("draft completion keeps missing fields blocked and does not use inherited values", () => {
  const result = completeDraftFields("{{total}} {{scope}} {{constructor}}", { total: "  " });
  assert.deepEqual(result.unfilled, ["total", "scope", "constructor"]);
});

// A diagnostic booked and paid for online, before anybody has looked: the shape
// of the job whose contract could not be sent because its total was blank.
const prepaidDiagnostic = {
  category: "diagnostic",
  diagnosticFeeCents: 18_000,
  diagnosticPaid: true,
  invoices: [],
  pricedLineCount: 0,
};

test("a prepaid diagnostic visit is contracted at its fee, already paid", () => {
  assert.deepEqual(contractMoney(prepaidDiagnostic), {
    totalCents: 18_000,
    depositCents: 18_000,
    depositPaid: true,
    source: "diagnostic",
  });
});

test("a diagnostic that has not been paid is still priced at its fee, not marked paid", () => {
  const money = contractMoney({ ...prepaidDiagnostic, diagnosticPaid: false });
  assert.equal(money.totalCents, 18_000);
  assert.equal(money.depositPaid, false);
  assert.equal(money.source, "diagnostic");
});

test("invoices set the total, with a prepaid diagnostic added back", () => {
  // $1,540 of work, billed with the $180 already paid taken off. The contract
  // says $1,540 and reports the $180 as paid, rather than reading as $1,360.
  const money = contractMoney({
    ...prepaidDiagnostic,
    invoices: [{ totalCents: 136_000, diagnosticCreditCents: 18_000 }],
    pricedLineCount: 3,
  });
  assert.equal(money.totalCents, 154_000);
  assert.equal(money.depositPaid, true);
  assert.equal(money.source, "invoices");
});

test("a job billed in stages is contracted at the sum of its invoices", () => {
  const money = contractMoney({
    ...prepaidDiagnostic,
    invoices: [
      { totalCents: 82_000, diagnosticCreditCents: 18_000 },
      { totalCents: 54_000, diagnosticCreditCents: 0 },
    ],
  });
  assert.equal(money.totalCents, 154_000);
});

test("itemised but unbilled work does not fall back to the diagnostic fee", () => {
  // $180 on a contract for work priced at far more is the wrong number, not a
  // missing one. Blank sends somebody to bill it; $180 sends it to the customer.
  const money = contractMoney({ ...prepaidDiagnostic, pricedLineCount: 2 });
  assert.equal(money.totalCents, 0);
  assert.equal(money.source, "none");
  assert.equal(money.depositPaid, true, "what was paid is still reported");
});

test("other work with nothing priced stays blank", () => {
  const money = contractMoney({ ...prepaidDiagnostic, category: "panel_upgrade" });
  assert.equal(money.totalCents, 0);
  assert.equal(money.source, "none");
});

test("a diagnostic with no fee has nothing to fill either line with", () => {
  assert.deepEqual(contractMoney({ ...prepaidDiagnostic, diagnosticFeeCents: 0 }), {
    totalCents: 0,
    depositCents: 0,
    depositPaid: false,
    source: "none",
  });
});
