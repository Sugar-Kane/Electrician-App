/**
 * Picking a customer the business already has, on New job.
 *
 * Everybody who has ever booked — by phone, by text, on the booking page, or
 * typed in here — is already a customer record, with the addresses they were
 * seen at. New job made the owner type them all again: the name, the number,
 * the street, the gate code. These are the rules for offering them instead.
 *
 * The matching is Search's (customer-search.ts), so a customer found one way is
 * found the same way the other. What is added here is what a form needs: one
 * choice per customer and address, the most recent people before anything has
 * been typed, and the values a pick fills in.
 *
 * Nothing here touches the database, so every rule can be tested on its own.
 */

import { rankCustomers } from "./customer-search.ts";
import { keepPhoneDigits, keepZipDigits } from "./digits-input.ts";
import { formatForDisplay } from "./phone-format.ts";

export type CustomerAddress = {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  accessNotes: string;
};

/** A customer at one of their addresses. */
export type CustomerChoice = {
  /**
   * The customer and the address together. A landlord with two buildings is
   * two choices, because the job is at one of them.
   */
  key: string;
  customerId: string;
  name: string;
  /** As stored: "+18055550118" or "(805) 555-0118". */
  phone: string;
  email: string;
  /** Null for a customer nobody has been out to yet. */
  address: CustomerAddress | null;
  /** When they last had a job, or were added: the order with nothing typed. */
  lastSeen: string;
};

/** "155 Juniper Ln, Nipomo", or nothing for a customer with no address. */
export function addressLabel(address: CustomerAddress | null): string {
  if (!address) return "";
  const street = [address.line1, address.line2].map((part) => part.trim()).filter(Boolean).join(", ");
  return [street, address.city.trim()].filter(Boolean).join(", ");
}

/** The line under the name in the list: how to reach them, and where. */
export function choiceDetail(choice: CustomerChoice): string {
  const phone = choice.phone ? formatForDisplay(choice.phone) : "";
  return [phone || choice.email.trim(), addressLabel(choice.address)].filter(Boolean).join(" · ");
}

/**
 * The choices to show for what was typed.
 *
 * Nothing typed is the people seen most recently, so the list is useful the
 * moment it opens — the customer being booked again is usually one who had
 * work done lately. Anything typed is ranked the way Search ranks it.
 */
export function findCustomerChoices(
  choices: CustomerChoice[],
  query: string,
  limit = 8,
): CustomerChoice[] {
  if (!query.trim()) {
    return [...choices]
      .sort((a, b) => (Date.parse(b.lastSeen) || 0) - (Date.parse(a.lastSeen) || 0))
      .slice(0, limit);
  }

  const byKey = new Map(choices.map((choice) => [choice.key, choice]));
  return rankCustomers(
    choices.map((choice) => ({
      id: choice.key,
      name: choice.name,
      phone: choice.phone,
      email: choice.email,
      address: addressLabel(choice.address),
    })),
    query,
    limit,
  )
    .map((found) => byKey.get(found.id))
    .filter((choice): choice is CustomerChoice => Boolean(choice));
}

/**
 * What a picked customer fills in on New job.
 *
 * The same boxes, in the same shapes the form keeps them in: ten digits for the
 * phone, two letters for the state, five for the ZIP. A customer with no
 * address empties the address rather than leaving whoever was there before.
 */
export function choiceFill(choice: CustomerChoice) {
  const address = choice.address;
  return {
    customerName: choice.name.trim(),
    phone: keepPhoneDigits(choice.phone),
    email: choice.email.trim(),
    addressLine1: address?.line1.trim() ?? "",
    addressLine2: address?.line2.trim() ?? "",
    city: address?.city.trim() ?? "",
    state: address?.state.trim().toUpperCase() ?? "",
    postalCode: keepZipDigits(address?.postalCode ?? ""),
    accessNotes: address?.accessNotes ?? "",
  };
}
