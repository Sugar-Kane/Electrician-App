import { CrewWeekView } from "@/components/crew-week-view";
import { FieldPageShell } from "@/components/field-page-shell";
import { ScheduleBoard } from "@/components/schedule-board";
import { crewWeek } from "@/lib/crew-week";
import { fullWeekOf, isIsoDate, todayInZone } from "@/lib/calendar";
import { getCrewWeek, getJobs } from "@/lib/job-data";
import { getOrganizationTimezone } from "@/lib/organization-timezone";
import { asScheduleView } from "@/lib/schedule-view";

// The schedule is a view of "now", so it must never be cached into showing a
// week that has already passed.
export const dynamic = "force-dynamic";

/**
 * The jobs page.
 *
 * Everything that used to be here — the tabs, the arrows, the day strip and the
 * three views — is now in `ScheduleBoard`, on the client, because day, week and
 * month are three readings of one list of jobs and that list arrives once. This
 * file's job is to fetch it and to work out what day it is where the business
 * is, which is the one thing a browser cannot be trusted with.
 */
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>;
}) {
  const [query, timeZone] = await Promise.all([searchParams, getOrganizationTimezone()]);

  // Today in the business's timezone — not the server's, which is UTC in
  // production and would roll the schedule over in the middle of the evening.
  const today = todayInZone(timeZone);
  const requested = query.date ?? "";
  const selectedDate = isIsoDate(requested) ? requested : today;
  const view = asScheduleView(query.view ?? "");

  // The crew tab needs the roster as well as the jobs, and its reader returns
  // both — so it is one fetch either way rather than two on that tab.
  const week = fullWeekOf(selectedDate, today);
  const crew =
    view === "crew"
      ? await getCrewWeek(week[0]?.date ?? selectedDate, week[week.length - 1]?.date ?? selectedDate)
      : null;
  const allJobs = crew ? crew.jobs : (await getJobs()).jobs;

  return (
    <FieldPageShell title="Jobs" eyebrow="Work">
      <ScheduleBoard
        jobs={allJobs}
        today={today}
        initialDate={selectedDate}
        initialView={view}
        crew={
          crew ? (
            <CrewWeekView
              days={week}
              crew={crewWeek(
                week.map((day) => day.date),
                crew.people,
                crew.business,
                crew.timeZone,
              )}
              jobs={allJobs}
            />
          ) : null
        }
      />
    </FieldPageShell>
  );
}
