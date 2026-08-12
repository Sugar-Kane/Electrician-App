import { DashboardShell } from "@/components/dashboard-shell";
import { todayInZone } from "@/lib/calendar";
import { getDashboardSnapshot } from "@/lib/dashboard";
import { attentionItems, openBookingRequests, unassignedToday } from "@/lib/dashboard-focus";
import { getBookingRequests } from "@/lib/booking-requests";
import { getInventory, getInvoices, getJobs } from "@/lib/job-data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [snapshot, { jobs }, { invoices }, stock, bookings] = await Promise.all([
    getDashboardSnapshot(),
    getJobs(),
    getInvoices(),
    getInventory(),
    getBookingRequests(),
  ]);

  const today = todayInZone(snapshot.timezone);

  // Counted here rather than inside the shell so the component stays a
  // rendering concern and the arithmetic stays testable.
  const attention = attentionItems({
    bookingRequests: openBookingRequests(bookings.requests),
    overdueInvoices: invoices.filter((invoice) => invoice.status === "Overdue").length,
    unsentInvoices: invoices.filter(
      (invoice) => invoice.status !== "Paid" && !invoice.sentLabel,
    ).length,
    // Reorder point is what the business itself said "low" means.
    lowStock: stock.filter((item) => item.quantity <= 0).length,
    // Only work that still needs somebody sent to it. A job finished by
    // whoever happened to be there, with the technician field never filled in,
    // used to sit here in amber until midnight with nothing that could clear it.
    unassignedToday: unassignedToday(jobs, today),
  });

  return <DashboardShell snapshot={snapshot} jobs={jobs} attention={attention} />;
}
