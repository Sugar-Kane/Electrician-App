import { FieldPageShell } from "@/components/field-page-shell";
import { NewJobForm } from "@/components/new-job-form";
import { getCustomerChoices, getFollowUpStart } from "@/lib/job-data";
import { getStockOptions } from "@/lib/job-line-data";
import { getOrganizationTimezone } from "@/lib/organization-timezone";
import { timezoneLabel } from "@/lib/timezones";
import { isoToZonedWallClock } from "@/lib/schedule-labels";

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
 *
 * `&plan=` is the choice made on the diagnostic: `now` books the repair for
 * right now (an hour's window from the next quarter hour), `estimate` starts
 * it as a quote with no time, `return` books it for a time still to pick.
 */
export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; plan?: string }>;
}) {
  const [{ from, plan }, timeZone, customers, stock] = await Promise.all([
    searchParams,
    getOrganizationTimezone(),
    getCustomerChoices(),
    getStockOptions(),
  ]);
  const followUp = from ? await getFollowUpStart(from) : null;
  const intent = plan === "estimate" ? ("quote" as const) : ("agreed" as const);
  let values = followUp?.values;
  if (followUp && values && plan === "now") {
    const quarter = 15 * 60_000;
    const start = new Date(Math.ceil(Date.now() / quarter) * quarter);
    values = {
      ...values,
      startLocal: isoToZonedWallClock(start.toISOString(), timeZone),
      arrivalEndLocal: isoToZonedWallClock(new Date(start.getTime() + 60 * 60_000).toISOString(), timeZone),
    };
  } else if (followUp && values && plan) {
    values = { ...values, startLocal: "", arrivalEndLocal: "" };
  }

  return (
    <FieldPageShell
      title={followUp ? (plan === "estimate" ? "Repair estimate" : plan === "now" ? "Repair now" : plan === "return" ? "Schedule the bigger job" : "Book work order") : "New job"}
      eyebrow={followUp ? `From diagnostic #${followUp.jobNumber}` : "Add work"}
      description={
        followUp
          ? `${followUp.customer} · the work diagnostic #${followUp.jobNumber} found.`
          : "For work booked any way other than through the phone line."
      }
      backHref={followUp ? `/jobs/${followUp.jobNumber}` : "/jobs"}
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
                values: values ?? followUp.values,
                intent,
                creditCents: followUp.creditCents,
              }
            : undefined
        }
      />
    </FieldPageShell>
  );
}
