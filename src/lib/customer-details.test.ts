import assert from "node:assert/strict";
import { test } from "node:test";

import { billingParty, checkCustomerDetails, detailsFromRow, mergeDetails, type CustomerDetails } from "./customer-details.ts";

const base: CustomerDetails = {
  firstName: "Jo",
  lastName: "Smith",
  businessName: "",
  phone: "209-555-0100",
  email: "",
  preferredContact: "",
  personalAddress: { line1: "12 Oak St", line2: "", city: "Fresno", state: "ca", postalCode: "93701" },
  businessAddress: { line1: "", line2: "", city: "", state: "", postalCode: "" },
  billTo: "person",
};
const service = { address_line_1: "99 Job Site Rd", city: "Clovis", state: "CA", postal_code: "93611" };

test("invoices and contracts go to the business when chosen, with the person as Attn", () => {
  const party = billingParty(
    { first_name: "Jo", last_name: "Smith", company_name: "Smith Rentals LLC", bill_to: "business", business_address_line_1: "500 Main St", business_city: "Fresno", business_state: "CA", business_postal_code: "93721", address_line_1: "12 Oak St", city: "Fresno" },
    service,
  );
  assert.equal(party.name, "Smith Rentals LLC");
  assert.equal(party.attention, "Jo Smith");
  assert.deepEqual(party.addressLines, ["500 Main St", "Fresno, CA 93721"]);
});

test("the person is billed at their own address; missing addresses fall back, never to nothing", () => {
  const person = billingParty({ first_name: "Jo", last_name: "Smith", company_name: "Smith Rentals LLC", bill_to: "person", address_line_1: "12 Oak St", city: "Fresno", state: "CA" }, service);
  assert.equal(person.name, "Jo Smith", "the person's name, not the business's");
  assert.deepEqual(person.addressLines, ["12 Oak St", "Fresno, CA"]);
  const noBusinessAddress = billingParty({ first_name: "Jo", company_name: "Smith Rentals LLC", bill_to: "business", address_line_1: "12 Oak St", city: "Fresno" }, service);
  assert.deepEqual(noBusinessAddress.addressLines, ["12 Oak St", "Fresno"], "business with no business address uses the personal one");
  const nothing = billingParty({ first_name: "Jo", bill_to: "person" }, service);
  assert.deepEqual(nothing.addressLines, ["99 Job Site Rd", "Clovis, CA 93611"], "then the service address");
});

test("one address is required, personal or business", () => {
  assert.ok(checkCustomerDetails(base).ok);
  const businessOnly = { ...base, businessName: "Smith Rentals", personalAddress: { ...base.businessAddress }, businessAddress: { line1: "500 Main St", line2: "", city: "Fresno", state: "CA", postalCode: "" } };
  assert.ok(checkCustomerDetails(businessOnly).ok);
  const neither = { ...base, personalAddress: { ...base.businessAddress } };
  assert.equal(checkCustomerDetails(neither).ok, false);
  const half = { ...base, personalAddress: { ...base.personalAddress, city: "" } };
  assert.equal(checkCustomerDetails(half).ok, false, "a street with no town is not an address");
});

test("billing the business needs a business name; phone and state are tidied", () => {
  assert.equal(checkCustomerDetails({ ...base, billTo: "business" }).ok, false);
  const saved = checkCustomerDetails(base);
  assert.ok(saved.ok && saved.details.phone === "+12095550100" && saved.details.personalAddress.state === "CA");
  assert.equal(checkCustomerDetails({ ...base, phone: "12" }).ok, false);
});

test("a partial change from ChatGPT keeps everything it didn't mention", () => {
  const current = detailsFromRow({ first_name: "Jo", last_name: "Smith", phone: "+12095550100", address_line_1: "12 Oak St", city: "Fresno", bill_to: "person" });
  const next = mergeDetails(current, { business_name: "Smith Rentals", business_address: { line1: "500 Main St", city: "Fresno" }, bill_to: "business" });
  assert.equal(next.firstName, "Jo");
  assert.equal(next.personalAddress.line1, "12 Oak St");
  assert.equal(next.businessAddress.line1, "500 Main St");
  assert.equal(next.billTo, "business");
  assert.ok(checkCustomerDetails(next).ok);
});
