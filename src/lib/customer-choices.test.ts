import test from "node:test";
import assert from "node:assert/strict";

import {
  addressLabel,
  choiceDetail,
  choiceFill,
  findCustomerChoices,
  type CustomerChoice,
} from "./customer-choices.ts";

const at = (line1: string, city: string, extra: Partial<NonNullable<CustomerChoice["address"]>> = {}) => ({
  line1,
  line2: "",
  city,
  state: "CA",
  postalCode: "93454",
  accessNotes: "",
  ...extra,
});

const daniel: CustomerChoice = {
  key: "daniel:juniper",
  customerId: "daniel",
  name: "Daniel Reyes",
  phone: "+18055550118",
  email: "daniel@example.com",
  address: at("155 Juniper Ln", "Nipomo", { postalCode: "93444-1234", state: "ca", accessNotes: "Side gate." }),
  lastSeen: "2026-09-29T20:00:00Z",
};
const maria: CustomerChoice = {
  key: "maria:chapel",
  customerId: "maria",
  name: "Maria Gonzalez",
  phone: "(805) 555-0147",
  email: "",
  address: at("412 E Chapel St", "Santa Maria"),
  lastSeen: "2026-10-01T20:00:00Z",
};
const harborA: CustomerChoice = {
  key: "harbor:cypress",
  customerId: "harbor",
  name: "Harbor View Apartments",
  phone: "+18055550171",
  email: "office@harborview.example",
  address: at("810 W Cypress St", "Santa Maria", { line2: "Building B" }),
  lastSeen: "2026-09-28T17:00:00Z",
};
const harborB: CustomerChoice = { ...harborA, key: "harbor:main", address: at("22 Main St", "Orcutt") };
const danielle: CustomerChoice = {
  key: "danielle",
  customerId: "danielle",
  name: "Danielle Brooks",
  phone: "",
  email: "danielle@example.com",
  address: null,
  lastSeen: "2026-08-01T17:00:00Z",
};
const all = [daniel, maria, harborA, harborB, danielle];
const keys = (list: CustomerChoice[]) => list.map((choice) => choice.key);

test("with nothing typed, the people seen most recently", () => {
  assert.deepEqual(keys(findCustomerChoices(all, "")), [
    "maria:chapel",
    "daniel:juniper",
    "harbor:cypress",
    "harbor:main",
    "danielle",
  ]);
  assert.equal(findCustomerChoices(all, "   ", 2).length, 2);
});

test("a name, from the start of either part of it", () => {
  assert.deepEqual(keys(findCustomerChoices(all, "reyes")), ["daniel:juniper"]);
  // Both Daniels, the closer match first, though Danielle is no more recent.
  assert.deepEqual(keys(findCustomerChoices(all, "dan")), ["daniel:juniper", "danielle"]);
  assert.deepEqual(keys(findCustomerChoices(all, "Daniel R")), ["daniel:juniper"]);
});

test("a phone number, however it was stored and however it is typed", () => {
  assert.deepEqual(keys(findCustomerChoices(all, "0118")), ["daniel:juniper"]);
  assert.deepEqual(keys(findCustomerChoices(all, "(805) 555-0147")), ["maria:chapel"]);
  assert.deepEqual(keys(findCustomerChoices(all, "8055550147")), ["maria:chapel"]);
});

test("a street, a town, a house number or an email", () => {
  assert.deepEqual(keys(findCustomerChoices(all, "juniper")), ["daniel:juniper"]);
  assert.deepEqual(keys(findCustomerChoices(all, "155")), ["daniel:juniper"]);
  assert.deepEqual(keys(findCustomerChoices(all, "orcutt")), ["harbor:main"]);
  assert.deepEqual(keys(findCustomerChoices(all, "danielle@")), ["danielle"]);
});

test("ranked the way Search ranks it", () => {
  // A town is an address match for everybody there, in name order.
  assert.deepEqual(keys(findCustomerChoices(all, "santa maria")), ["harbor:cypress", "maria:chapel"]);
  // A full name is a name match, and beats the town of the same name.
  assert.deepEqual(keys(findCustomerChoices(all, "maria gonzalez")), ["maria:chapel"]);
  assert.deepEqual(keys(findCustomerChoices(all, "maria")), ["maria:chapel", "harbor:cypress"]);
  assert.deepEqual(findCustomerChoices(all, "nobody"), []);
});

test("one choice per address, so a landlord's buildings can be told apart", () => {
  const found = findCustomerChoices(all, "harbor");
  assert.deepEqual(keys(found), ["harbor:cypress", "harbor:main"]);
  assert.deepEqual(found.map(choiceDetail), [
    "(805) 555-0171 · 810 W Cypress St, Building B, Santa Maria",
    "(805) 555-0171 · 22 Main St, Orcutt",
  ]);
});

test("the line under the name: how to reach them, and where", () => {
  assert.equal(choiceDetail(daniel), "(805) 555-0118 · 155 Juniper Ln, Nipomo");
  // No phone: the email instead. No address: nothing after it.
  assert.equal(choiceDetail(danielle), "danielle@example.com");
  assert.equal(addressLabel(null), "");
});

test("picking a customer fills the form in the shapes it keeps", () => {
  assert.deepEqual(choiceFill(daniel), {
    customerName: "Daniel Reyes",
    phone: "8055550118",
    email: "daniel@example.com",
    addressLine1: "155 Juniper Ln",
    addressLine2: "",
    city: "Nipomo",
    state: "CA",
    postalCode: "93444",
    accessNotes: "Side gate.",
  });
  assert.equal(choiceFill(harborA).addressLine2, "Building B");
  assert.equal(choiceFill(harborA).customerName, "Harbor View Apartments");
});

test("a customer with no address empties it rather than keeping the last one", () => {
  const fill = choiceFill(danielle);
  assert.equal(fill.phone, "");
  assert.equal(fill.addressLine1, "");
  assert.equal(fill.city, "");
  assert.equal(fill.state, "");
  assert.equal(fill.postalCode, "");
});
