import { FieldPageShell } from "@/components/field-page-shell";
import { NewJobForm } from "@/components/new-job-form";
import { getCustomerChoices, getFollowUpStart } from "@/lib/job-data";
import { getStockOptions } from "@/lib/job-line-data";
import { getOrganizationTimezone } from "@/lib/organization-timezone";
import { timezoneLabel } from "@/lib/timezones";

/**
 * A job entered by hand.
 *
 * Until this page existed, the only way work got into the app was a customer
 * phoning the voice assistant or texting the number. Everything booked any
 * other way — at the door, by email, by a landlord who called the mobile — was
 * written down somewhere else, which is why the schedule was never the whole
 * business.
 *
 * Everybody the business already has is offered under Returning customer, so
 * somebody booked before is a pick rather than their details typed again.
 *
 * `?from=25` books the work diagnostic #25 found: the same form, started from
 * that customer and address as a work order, and linked back to it so the fee
 * the customer paid for the diagnostic comes off this one's invoice. A number
 * that is not a diagnostic of this business's is ignored, and the form starts
 * empty as it always did.
 */
export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const [{ from }, timeZone, customers, stock] = await Promise.all([
    searchParams,
    getOrganizationTimezone(),
    getCustomerChoices(),
    getStockOptions(),
  ]);
  const followUp = from ? await getFollowUpStart(from) : null;

  return (
    <FieldPageShell
      title={followUp ? "Book work order" : "New job"}
      eyebrow={followUp ? `From diagnostic #${followUp.jobNumber}` : "Add work"}
      description={
        followUp
          ? `${followUp.customer} · the work diagnostic #${followUp.jobNumber} found.`
          : "For work booked any way other than through the phone line."
      }
      backHref={followUp ? `/jobs/${followUp.jobNumber}` : "/schedule"}
    >
      <NewJobForm
        timeZone={timeZone}
        timeZoneLabel={timezoneLabel(timeZone)}
        customers={customers}
        stock={stock}
        followUp={
          followUp
            ? {
                jobNumber: followUp.jobNumber,
                values: followUp.values,
                creditCents: followUp.creditCents,
              }
            : undefined
        }
      />
    </FieldPageShell>
  );
}
