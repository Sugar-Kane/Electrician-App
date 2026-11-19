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
/** The next quarter hour from now: "Repair now" starts then. */
function nextQuarterHour(): Date {
  const quarter = 15 * 60_000;
  return new Date(Math.ceil(Date.now() / quarter) * quarter);
}

export default async function NewJobPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; plan?: string; next?: string; start?: string; end?: string }>;
}) {
  const [{ from, plan, next, start: startParam, end: endParam }, timeZone, customers, stock] = await Promise.all([
    searchParams,
    getOrganizationTimezone(),
    getCustomerChoices(),
    getStockOptions(),
  ]);
  const followUp = from ? await getFollowUpStart(from) : null;
  const intent = plan === "estimate" ? ("quote" as const) : ("agreed" as const);
  let values = followUp?.values;
  if (followUp && values && plan === "now") {
    const start = nextQuarterHour();
    values = {
      ...values,
      startLocal: isoToZonedWallClock(start.toISOString(), timeZone),
      arrivalEndLocal: isoToZonedWallClock(new Date(start.getTime() + 60 * 60_000).toISOString(), timeZone),
    };
  } else if (followUp && values && plan) {
    values = { ...values, startLocal: "", arrivalEndLocal: "" };
  }
  // A follow-up set up from a job's "Need to come back" panel: what the next
  // job is for and when, as typed there. Wall-clock values only.
  const wallClock = (value?: string) => (value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? value : "");
  if (followUp && values && !followUp.fromDiagnostic) {
    values = {
      ...values,
      description: (next ?? "").slice(0, 2000),
      startLocal: wallClock(startParam),
      arrivalEndLocal: wallClock(startParam) ? wallClock(endParam) : "",
    };
  }
  const followUpTitle = followUp && !followUp.fromDiagnostic ? "Follow-up job" : null;

  return (
    <FieldPageShell
      title={followUpTitle ?? (followUp ? (plan === "estimate" ? "Repair estimate" : plan === "now" ? "Repair now" : plan === "return" ? "Schedule the bigger job" : "Book work order") : "New job")}
      eyebrow={followUp ? `From ${followUp.fromDiagnostic ? "diagnostic" : "job"} #${followUp.jobNumber}` : "Add work"}
      description={
        followUp
          ? followUp.fromDiagnostic
            ? `${followUp.customer} · the work diagnostic #${followUp.jobNumber} found.`
            : `${followUp.customer} · more work after job #${followUp.jobNumber}, as a new job with its own estimate, contract and invoice.`
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
                fromDiagnostic: followUp.fromDiagnostic,
              }
            : undefined
        }
      />
    </FieldPageShell>
  );
}
