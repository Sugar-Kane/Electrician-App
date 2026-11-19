/**
 * Who may decide whether a new caller or texter becomes a customer.
 *
 * The owner and admins. A technician sees jobs, not the business's contact
 * list, and Delete archives the contact and their conversation.
 */
export function mayReviewContacts(role: string): boolean {
  return role === "owner" || role === "admin";
}

/** What the review buttons may do, and nothing else. */
export function readReviewChoice(value: unknown): "keep" | "delete" | null {
  return value === "keep" || value === "delete" ? value : null;
}
