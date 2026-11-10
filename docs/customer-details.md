# Customer details

Anyone in the business can change a customer's details at any time, on the customer's page (**Edit details**) or from ChatGPT/Claude.

- **Person:** first and last name, phone, email, and how they prefer to be reached.
- **Personal address:** where they get mail. If none is saved, the service address is offered to start from.
- **Business (optional):** business name and business address.
- **Send invoices and contracts to:**
  - **The person:** their name and personal address.
  - **The business:** the business name and business address, with "Attn:" and the person's name. This needs a business name.

## Rules

- One address is required: personal or business.
- An address needs at least a street and a town. The state is the two-letter code, and the ZIP is five digits.
- If the chosen address is empty, the other one is used, then the service address. A document is never addressed to nowhere.
- The phone number is saved in the format texting needs.
- Existing customers with a company name start out billed to the business, which is how documents already read.

The customer page shows who invoices and contracts go to now.

## Where it is used

The invoice PDF and the contract PDF ("Bill to" / customer block), and the contract text's party ("between … and {{customer_name}}"), for new and regenerated documents. Documents already sent keep what they said.

## ChatGPT / Claude

- `get_customer_details`: the saved details, and the name and address that will print on invoices and contracts.
- `update_customer`: send only what changes, such as `business_name`, `business_address`, `personal_address` or `bill_to`. It answers first with the proposed details, and saves only with `confirmed: true` after the user says yes. It uses the same rules as the page.

## Setup

Apply `supabase/migrations/20261110010000_customer_billing_details.sql` and record it in `schema_migrations`.
