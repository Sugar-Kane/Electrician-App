import { FieldPageShell } from "@/components/field-page-shell";
import { NewJobForm } from "@/components/new-job-form";
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
 */
export default async function NewJobPage() {
  const timeZone = await getOrganizationTimezone();

  return (
    <FieldPageShell
      title="New job"
      eyebrow="Add work"
      description="For work booked any way other than through the phone line."
      backHref="/schedule"
    >
      <NewJobForm timeZoneLabel={timezoneLabel(timeZone)} />
    </FieldPageShell>
  );
}
