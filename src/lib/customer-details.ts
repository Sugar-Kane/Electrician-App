/**
 * A customer's details as the business keeps them: names, how to reach them,
 * a personal address, a business name and address, and who invoices and
 * contracts are made out to.
 *
 * One set of rules for every way in (the customer page and ChatGPT/Claude):
 * - At least a person's name or a business name.
 * - At least one address, personal or business. Either may be left empty.
 * - An address is a street and a town at least; a state is the two letters, a
 *   ZIP is five digits (or ZIP+4).
 * - Made out to the business only with a business name. With no business
 *   address it falls back to the personal address, then the service address.
 *
 * Import-free, so it can be tested without a database.
 */

import { toE164 } from "./phone-format.ts";
import { isUsStateCode } from "./us-states.ts";

export type BillTo = "person" | "business";

export type CustomerAddress = { line1: string; line2: string; city: string; state: string; postalCode: string };

export type CustomerDetails = {
  firstName: string;
  lastName: string;
  businessName: string;
  phone: string;
  email: string;
  preferredContact: "" | "phone" | "sms" | "email";
  personalAddress: CustomerAddress;
  businessAddress: CustomerAddress;
  billTo: BillTo;
};

type Row = Record<string, unknown>;

function text(value: unknown, max = 200): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

const EMPTY_ADDRESS: CustomerAddress = { line1: "", line2: "", city: "", state: "", postalCode: "" };

/** The details as stored on a customers row. */
export function detailsFromRow(row: Row): CustomerDetails {
  const contact = text(row.preferred_contact);
  return {
    firstName: text(row.first_name),
    lastName: text(row.last_name),
    businessName: text(row.company_name),
    phone: text(row.phone),
    email: text(row.email),
    preferredContact: contact === "phone" || contact === "sms" || contact === "email" ? contact : "",
    personalAddress: {
      line1: text(row.address_line_1),
      line2: text(row.address_line_2),
      city: text(row.city),
      state: text(row.state),
      postalCode: text(row.postal_code),
    },
    businessAddress: {
      line1: text(row.business_address_line_1),
      line2: text(row.business_address_line_2),
      city: text(row.business_city),
      state: text(row.business_state),
      postalCode: text(row.business_postal_code),
    },
    billTo: text(row.bill_to) === "business" ? "business" : "person",
  };
}

function hasAddress(address: CustomerAddress): boolean {
  return Boolean(address.line1 || address.line2 || address.city || address.state || address.postalCode);
}

function looksLikeEmail(value: string): boolean {
  return value.length >= 6 && value.length <= 254 && !/\s/.test(value) && /^[^@]+@[^@.]+\.[^@]{2,}$/.test(value);
}

function checkAddress(address: CustomerAddress, which: string): string | null {
  if (!hasAddress(address)) return null;
  if (!address.line1) return `The ${which} address needs a street.`;
  if (!address.city) return `The ${which} address needs a town or city.`;
  if (address.state && !isUsStateCode(address.state.toUpperCase())) return `The ${which} address's state should be the two-letter code, like CA.`;
  if (address.postalCode && !/^\d{5}(-\d{4})?$/.test(address.postalCode)) return `The ${which} address's ZIP should be five digits.`;
  return null;
}

export type DetailsCheck = { ok: true; details: CustomerDetails } | { ok: false; reason: string; field?: string };

/** Whether a full set of details can be saved, with them tidied (phone in E.164, state upper-case). */
export function checkCustomerDetails(input: CustomerDetails): DetailsCheck {
  const details: CustomerDetails = {
    ...input,
    personalAddress: { ...input.personalAddress, state: input.personalAddress.state.toUpperCase() },
    businessAddress: { ...input.businessAddress, state: input.businessAddress.state.toUpperCase() },
    email: input.email.toLowerCase(),
  };
  if (!details.firstName && !details.lastName && !details.businessName) return { ok: false, reason: "Give a name or a business name.", field: "firstName" };
  if (details.phone) {
    const phone = toE164(details.phone);
    if (!phone) return { ok: false, reason: "That phone number could not be read. Use 10 digits, like 209-555-0100.", field: "phone" };
    details.phone = phone;
  }
  if (details.email && !looksLikeEmail(details.email)) return { ok: false, reason: "That email address doesn't look right.", field: "email" };
  if (details.preferredContact === "sms" && !details.phone) return { ok: false, reason: "Texting needs a phone number.", field: "preferredContact" };
  if (details.preferredContact === "phone" && !details.phone) return { ok: false, reason: "Calling needs a phone number.", field: "preferredContact" };
  if (details.preferredContact === "email" && !details.email) return { ok: false, reason: "Email needs an email address.", field: "preferredContact" };

  const personal = checkAddress(details.personalAddress, "personal");
  if (personal) return { ok: false, reason: personal, field: "addressLine1" };
  const business = checkAddress(details.businessAddress, "business");
  if (business) return { ok: false, reason: business, field: "business_addressLine1" };
  if (!hasAddress(details.personalAddress) && !hasAddress(details.businessAddress)) {
    return { ok: false, reason: "Give at least one address, personal or business.", field: "addressLine1" };
  }
  if (details.billTo === "business" && !details.businessName) {
    return { ok: false, reason: "To send invoices and contracts to the business, give the business name.", field: "businessName" };
  }
  return { ok: true, details };
}

/** The columns to write for a checked set of details. */
export function detailsToRow(details: CustomerDetails): Row {
  const blank = (value: string) => value || null;
  return {
    first_name: blank(details.firstName),
    last_name: blank(details.lastName),
    company_name: blank(details.businessName),
    customer_type: details.businessName ? "commercial" : "residential",
    phone: blank(details.phone),
    email: blank(details.email),
    preferred_contact: blank(details.preferredContact),
    address_line_1: blank(details.personalAddress.line1),
    address_line_2: blank(details.personalAddress.line2),
    city: blank(details.personalAddress.city),
    state: blank(details.personalAddress.state),
    postal_code: blank(details.personalAddress.postalCode),
    business_address_line_1: blank(details.businessAddress.line1),
    business_address_line_2: blank(details.businessAddress.line2),
    business_city: blank(details.businessAddress.city),
    business_state: blank(details.businessAddress.state),
    business_postal_code: blank(details.businessAddress.postalCode),
    bill_to: details.billTo,
  };
}

/**
 * A partial change (from ChatGPT, which sends only what changes) laid over
 * what is saved. A field given as an empty string clears it; a field left out
 * stays as it is.
 */
export function mergeDetails(current: CustomerDetails, changes: Row): CustomerDetails {
  const pick = (key: string, fallback: string, max = 200) => (typeof changes[key] === "string" ? text(changes[key], max) : fallback);
  const address = (prefix: string, base: CustomerAddress): CustomerAddress => {
    const given = changes[prefix];
    if (given === null) return { ...EMPTY_ADDRESS };
    if (typeof given !== "object" || given === undefined) return base;
    const part = given as Row;
    const field = (key: string, fallback: string) => (typeof part[key] === "string" ? text(part[key]) : fallback);
    return {
      line1: field("line1", base.line1),
      line2: field("line2", base.line2),
      city: field("city", base.city),
      state: field("state", base.state),
      postalCode: field("postal_code", base.postalCode),
    };
  };
  const contact = pick("preferred_contact", current.preferredContact);
  const billTo = pick("bill_to", current.billTo);
  return {
    firstName: pick("first_name", current.firstName),
    lastName: pick("last_name", current.lastName),
    businessName: pick("business_name", current.businessName),
    phone: pick("phone", current.phone, 40),
    email: pick("email", current.email, 254),
    preferredContact: contact === "phone" || contact === "sms" || contact === "email" ? contact : "",
    personalAddress: address("personal_address", current.personalAddress),
    businessAddress: address("business_address", current.businessAddress),
    billTo: billTo === "business" ? "business" : "person",
  };
}

function addressLines(address: { line1: string; line2: string; city: string; state: string; postalCode: string }): string[] {
  return [
    address.line1,
    address.line2,
    [[address.city, address.state].filter(Boolean).join(", "), address.postalCode].filter(Boolean).join(" "),
  ].filter((line) => line.trim() !== "");
}

export type BillingParty = {
  billTo: BillTo;
  /** The name the invoice or contract is made out to. */
  name: string;
  /** For a business: the person it is for, when there is one. */
  attention: string;
  addressLines: string[];
};

/**
 * Who an invoice or contract is made out to, and where: the business (its name
 * and business address) or the person (their name and personal address), as
 * the customer is set. A missing address falls back to the other one, then to
 * the service address, so a document is never addressed to nowhere.
 */
export function billingParty(customer: Row | null, serviceAddress: Row | null): BillingParty {
  const details = detailsFromRow(customer ?? {});
  const person = [details.firstName, details.lastName].filter(Boolean).join(" ");
  const service = addressLines({
    line1: text(serviceAddress?.address_line_1),
    line2: text(serviceAddress?.address_line_2),
    city: text(serviceAddress?.city),
    state: text(serviceAddress?.state),
    postalCode: text(serviceAddress?.postal_code),
  });
  const personal = addressLines(details.personalAddress);
  const business = addressLines(details.businessAddress);
  if (details.billTo === "business" && details.businessName) {
    return {
      billTo: "business",
      name: details.businessName,
      attention: person,
      addressLines: business.length ? business : personal.length ? personal : service,
    };
  }
  return {
    billTo: "person",
    name: person || details.businessName || "Customer",
    attention: "",
    addressLines: personal.length ? personal : service.length ? service : business,
  };
}
