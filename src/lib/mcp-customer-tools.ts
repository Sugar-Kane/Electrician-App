import "server-only";

import { billingParty, detailsFromRow, mergeDetails, type CustomerDetails } from "@/lib/customer-details";
import { CUSTOMER_DETAIL_COLUMNS, saveCustomerDetails } from "@/lib/customer-details-save";
import type { McpTool, ToolResult } from "@/lib/mcp-protocol";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Customer details from ChatGPT or Claude: read them, and change them (names,
 * phone, email, personal address, business name and address, and whether
 * invoices and contracts go to the person or the business). The same rules
 * and save as the customer page.
 */

const str = (description: string) => ({ type: "string", description });
const address = (what: string) => ({
  type: "object",
  description: `${what}. Give only the parts that change; an empty string clears a part (clear every part to remove the address).`,
  properties: {
    line1: str("Street"),
    line2: str("Apartment, suite or unit"),
    city: str("Town or city"),
    state: str("Two-letter state, like CA"),
    postal_code: str("ZIP"),
  },
  additionalProperties: false,
});

const findBy = {
  customer_id: str("The customer's id, from search_customers or get_customer_details."),
  customer: str("Or the customer's name, phone or email. If several match you'll be told; ask the user which."),
};

export const CUSTOMER_MCP_TOOLS: McpTool[] = [
  {
    name: "get_customer_details",
    title: "Get customer details",
    description:
      "A customer's saved details: name, phone, email, personal address, business name and address, and who invoices and contracts are made out to (the person or the business), with the name and address that will print on them.",
    inputSchema: { type: "object", properties: findBy, additionalProperties: false },
  },
  {
    name: "update_customer",
    title: "Update customer",
    description:
      "Change a customer's details. Send only what changes. At least one address (personal or business) must remain. bill_to 'business' makes invoices and contracts out to the business name and business address (needs a business name); 'person' uses their name and personal address. Do not invent details the user did not give. Call once without confirmed to get the proposal, show it to the user, then again with confirmed true only if they say yes.",
    inputSchema: {
      type: "object",
      properties: {
        ...findBy,
        first_name: str("First name"),
        last_name: str("Last name"),
        business_name: str("Business name. Empty string removes it."),
        phone: str("Phone number"),
        email: str("Email address"),
        preferred_contact: { type: "string", enum: ["", "phone", "sms", "email"] },
        personal_address: address("The customer's own (mailing) address"),
        business_address: address("The business's mailing address"),
        bill_to: { type: "string", enum: ["person", "business"], description: "Who invoices and contracts are made out to." },
        confirmed: {
          type: "boolean",
          description: "Set true only after the user approved exactly these changes in this conversation.",
        },
      },
      additionalProperties: false,
    },
  },
];

const NAMES = new Set(CUSTOMER_MCP_TOOLS.map((tool) => tool.name));
export function isCustomerTool(name: string): boolean {
  return NAMES.has(name);
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function personName(row: Row): string {
  return [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ");
}

function label(row: Row): string {
  return text(row.company_name) || personName(row) || "Customer";
}

async function findCustomer(db: FlexibleSupabaseClient, organizationId: string, args: Row): Promise<{ row: Row } | { problem: string }> {
  const id = text(args.customer_id);
  if (id) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { problem: "That customer id could not be read." };
    const { data } = await db.from("customers").select(CUSTOMER_DETAIL_COLUMNS).eq("organization_id", organizationId).eq("id", id).maybeSingle();
    return data ? { row: data as Row } : { problem: "That customer was not found." };
  }
  const query = text(args.customer).toLowerCase();
  if (!query) return { problem: "Say which customer (customer_id, or their name, phone or email)." };
  const digits = query.replace(/\D/g, "");
  const { data } = await db.from("customers").select(CUSTOMER_DETAIL_COLUMNS).eq("organization_id", organizationId).is("archived_at", null).limit(500);
  const matches = ((data ?? []) as Row[]).filter((row) => {
    const haystack = `${label(row)} ${personName(row)} ${text(row.email)}`.toLowerCase();
    return haystack.includes(query) || (digits.length >= 7 && text(row.phone).replace(/\D/g, "").endsWith(digits.slice(-10)));
  });
  if (matches.length === 0) return { problem: `No customer matches "${text(args.customer)}".` };
  if (matches.length > 1) {
    return {
      problem: `More than one customer matches: ${matches
        .slice(0, 8)
        .map((row) => `${label(row)} (${text(row.phone) || "no phone"}, id ${text(row.id)})`)
        .join("; ")}. Ask the user which, then use its customer_id.`,
    };
  }
  return { row: matches[0]! };
}

function addressText(address: CustomerDetails["personalAddress"]): string {
  const lines = [address.line1, address.line2, [[address.city, address.state].filter(Boolean).join(", "), address.postalCode].filter(Boolean).join(" ")].filter(Boolean);
  return lines.length ? lines.join(", ") : "none";
}

function describe(details: CustomerDetails, row: Row): string {
  const party = billingParty({ ...row, ...detailsToColumns(details) }, null);
  return [
    `Name: ${[details.firstName, details.lastName].filter(Boolean).join(" ") || "none"}`,
    `Business: ${details.businessName || "none"}`,
    `Phone: ${details.phone || "none"} | Email: ${details.email || "none"} | Prefers: ${details.preferredContact || "no preference"}`,
    `Personal address: ${addressText(details.personalAddress)}`,
    `Business address: ${addressText(details.businessAddress)}`,
    `Invoices and contracts go to: ${details.billTo === "business" ? "the business" : "the person"}: ${party.name}${party.attention ? ` (Attn: ${party.attention})` : ""}${party.addressLines.length ? `, ${party.addressLines.join(", ")}` : " (no address; the service address is used)"}`,
  ].join("\n");
}

function detailsToColumns(details: CustomerDetails): Row {
  return {
    first_name: details.firstName,
    last_name: details.lastName,
    company_name: details.businessName,
    address_line_1: details.personalAddress.line1,
    address_line_2: details.personalAddress.line2,
    city: details.personalAddress.city,
    state: details.personalAddress.state,
    postal_code: details.personalAddress.postalCode,
    business_address_line_1: details.businessAddress.line1,
    business_address_line_2: details.businessAddress.line2,
    business_city: details.businessAddress.city,
    business_state: details.businessAddress.state,
    business_postal_code: details.businessAddress.postalCode,
    bill_to: details.billTo,
  };
}

export async function runCustomerTool(input: { database: FlexibleSupabaseClient; organizationId: string; name: string; args: Row }): Promise<ToolResult> {
  const { database: db, organizationId, args } = input;
  const found = await findCustomer(db, organizationId, args);
  if ("problem" in found) return { isError: true, text: `${found.problem}${input.name === "update_customer" ? " Nothing was changed." : ""}` };
  const row = found.row;
  const current = detailsFromRow(row);

  if (input.name === "get_customer_details") {
    return { text: `${label(row)} (id ${text(row.id)})\n${describe(current, row)}`, structured: { customer_id: text(row.id), details: current, bill_to_party: billingParty(row, null) } };
  }

  if (input.name === "update_customer") {
    const next = mergeDetails(current, args);
    if (JSON.stringify(next) === JSON.stringify(current)) return { text: "Nothing to change: those are already the saved details." };
    if (args.confirmed !== true) {
      return {
        text: `CONFIRMATION REQUIRED. Nothing was changed. Proposed details for ${label(row)}:\n${describe(next, row)}\nShow these to the user and ask them to confirm.`,
        structured: { customer_id: text(row.id), proposed: next },
      };
    }
    const saved = await saveCustomerDetails(db, { organizationId, customerId: text(row.id), details: next, via: "chatgpt" });
    if (!saved.ok) return { isError: true, text: `${saved.reason} Nothing was changed.` };
    return { text: `Saved.\n${describe(saved.details, row)}`, structured: { customer_id: text(row.id), details: saved.details } };
  }

  return { isError: true, text: `Unknown tool: ${input.name}` };
}
