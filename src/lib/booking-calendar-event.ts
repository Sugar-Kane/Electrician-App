/** Stable Google IDs make duplicate payment webhooks create only one event. */
export function paidCalendarEvent(row: Record<string, unknown>) {
  if (!row.deposit_paid_at || !row.created_job_id || !["scheduled", "confirmed"].includes(String(row.status))) return null;
  const jobId = String(row.created_job_id);
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const start = new Date(String(row.arrival_window_start));
  const end = new Date(String(row.arrival_window_end));
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return null;
  const intake = Array.isArray(row.intake_answers) ? row.intake_answers.map((a) => `${a.question}: ${a.answer}`).join("\n") : "";
  return {
    id: `v${jobId.replaceAll("-", "").toLowerCase()}`,
    summary: `Electrical visit - ${String(row.contact_name || "Customer")} (paid)`,
    location: [row.address_line_1, row.city, row.state, row.postal_code].filter(Boolean).join(", "),
    description: [`Diagnostic fee paid. Arrival window shown.`, String(row.description || ""), `Customer: ${row.phone || ""}`, intake].filter(Boolean).join("\n\n"),
    start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() },
    extendedProperties: { private: { volteira_job_id: jobId, volteira_booking_id: String(row.id) } },
  };
}
