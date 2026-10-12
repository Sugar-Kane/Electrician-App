/**
 * Hiding a business's private details in the support console.
 *
 * Support reads a business's records to fix their problems, which reaches the
 * phone numbers, email addresses and texts of customers who never agreed to be
 * seen by the platform. So the console shows enough to recognise a record — the
 * last four digits, the first letter and the domain, how long a text was — and
 * the whole thing only after an admin gives a reason, which is recorded.
 *
 * Import-free so the rules can be tested without a database.
 */

const DOT = "•••";

/** "••• 0142", or "" when there is no number. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = (phone ?? "").replace(/\D+/g, "");
  if (!digits) return "";
  return `${DOT} ${digits.slice(-4)}`;
}

/** "s•••@example.com", or "" when there is no address. */
export function maskEmail(email: string | null | undefined): string {
  const value = (email ?? "").trim();
  if (!value) return "";
  const at = value.lastIndexOf("@");
  if (at <= 0) return DOT;
  return `${value[0]}${DOT}${value.slice(at)}`;
}

/** "Hidden · 42 characters", so a blank text can still be told from a long one. */
export function maskBody(body: string | null | undefined): string {
  const length = (body ?? "").length;
  if (length === 0) return "Empty";
  return `Hidden · ${length} character${length === 1 ? "" : "s"}`;
}

/**
 * Free text with every phone number and email address in it hidden.
 *
 * For text that is mostly about the system rather than the customer, such as a
 * phone assistant's tool result, where hiding the whole thing would hide the
 * diagnosis too. Seven or more digits in a row (with the usual separators)
 * count as a phone number.
 */
export function maskContacts(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (email) => maskEmail(email))
    .replace(/\+?\d[\d\s().-]{5,}\d/g, (match) => {
      const digits = match.replace(/\D+/g, "");
      return digits.length >= 7 ? maskPhone(digits) : match;
    });
}
