# Automatic arrival

An electrician standing at a customer's door has both hands full and no reason
to tell an app something it can work out. This is how the app works it out, what
it deliberately does not do, and what happens on every path where it fails.

## The shape of it

`startTrip` puts the job in `en_route` and starts watching. A circle is drawn
around the service address. When the phone is inside that circle and stays
inside it, the technician has arrived.

```
scheduled        nothing is watched
   ↓  Start trip
en_route         foreground watchPosition, this job only
   ↓  inside the radius for the dwell time
arrived          arrival_at recorded, watching stops, customer optionally texted
```

The three moving parts are in two files:

| Where | What |
| --- | --- |
| `src/lib/arrival.ts` | Distance, the dwell timer, the accuracy rule. Import-free and unit-tested. |
| `src/lib/job-workflow.ts` | Which states exist, what may follow what, and the one state that watches. |
| `src/components/job-workflow.tsx` | The `watchPosition` subscription and every fallback the screen shows. |

## Why a dwell timer

A bare geofence fires on the crossing. That happens at the end of the street, at
the neighbour's, and again on the way to the next job. `ARRIVAL_DWELL_SECONDS`
(45s) is the compromise between the two failures: shorter and a red light marks
somebody arrived and texts the customer, longer and an electrician who has
already knocked is holding a phone that says "on my way".

## Why the accuracy rule is strict

A reading counts as inside only when `distance + accuracy <= radius` — the whole
uncertainty circle within the geofence, not just the reported point.

The expensive mistake is not a late arrival. It is texting a customer that their
electrician has arrived while they are two streets away, so they go and stand at
the front door. Being slow costs one tap on **Mark arrived**; being wrong costs
somebody's afternoon. A fix too vague to satisfy the test at all — accuracy wider
than the whole geofence, which is what a phone reports in a garage or a canyon —
neither starts the timer nor cancels one already running.

## Radius

`service_settings.arrival_radius_meters`, default 120m (about 400ft), bounded
between 40m and 1600m. Per business, because the answer differs by the work: a
residential van wants the house across the road outside the circle; an outfit
working ranches needs the gate inside it. The bounds exist because a radius
smaller than a good GPS fix describes an arrival that can never happen, and the
app would quietly stop detecting anything with no way to tell why.

## Permission

Asked when it becomes useful — the first tap on **Start trip** — and never at
signup. The explainer says what the feature does rather than what the permission
is called:

> Volteira can mark you arrived when you reach the job.
> Your location is only checked while you are driving to this job, and stops the
> moment you get there. Nothing is kept but the time you arrived.

Both answers start the trip. A permission answer is not a condition of driving
to a job. The answer is stored per device (`volteira:auto-arrival:v1`) because it
is a decision about *this phone's* location: saying yes on your own phone has not
said yes on the shop tablet.

## What is stored

Four timestamps and a note about how one of them was decided, in
`job_technician_progress`: `trip_started_at`, `arrived_at`, `arrival_source`,
`work_started_at`, `completed_at`, plus `customer_en_route_notified_at` and
`customer_arrival_notified_at`.

No positions. No breadcrumb trail. There is no code path that reads the phone's
location while a job is scheduled, being worked on, or finished — the watch lives
in a `useEffect` that only exists in `en_route`, so leaving that state tears it
down. If route history is ever wanted it will be a separate, opted-into feature,
not a side effect of this one.

Per technician rather than per job, because two electricians on a panel change
arrive in two vans at two times. `jobs.status` is still written alongside, and is
still the job's overall state — the schedule, the dashboard and the invoice path
all read it.

## Telling the customer

Two moments send a text, and they are the two the customer is actually waiting
on: setting off (`job_en_route`) and turning up (`job_arrived`). Nothing else in
the workflow sends anything — starting work and finishing are the business's own
business.

Both reuse the existing automatic messages, so consent, STOP handling, quiet
hours and the per-business on/off switches at `/settings/messages` are the ones
that already exist rather than a second set of rules to keep in step. Either can
be switched off independently; a business that wants only "on the way" gets only
that.

Each is sent at most once per job, guarded on its own column across every
technician row — a second van setting off is not a second journey from the
customer's point of view, and a technician who steps out for a part and comes
back has not arrived twice. Someone texted twice about one visit is someone who
replies STOP.

The column records when the customer was *told*, so it is only stamped after a
send actually succeeds. Stamping a refused send would turn "the template is
switched off" into "they were told" on every report that reads it.

> **Note on the `job_en_route` template.** Its seeded wording is
> `your technician is on the way and should arrive within {{arrival_window}}`,
> which now renders as "…within Wed, Aug 12, 1:00 PM–3:00 PM". It reads a little
> oddly, and it is a business-owned row that an owner may already have edited, so
> it is left alone rather than rewritten underneath them. Editable at
> `/settings/messages`. A job with no arrival window sends nothing at all —
> `decideAutomaticSend` refuses rather than blanking the placeholder.

## Platform limits

This is a web app, so arrival detection is foreground only: `watchPosition` while
the job page is open. iOS suspends timers and JavaScript for a backgrounded tab,
and there is no web equivalent of `CLCircularRegion` monitoring or Android's
`GeofencingClient` that survives it.

The design assumes that rather than fighting it:

- The technician has the job open while driving to it — that is the screen with
  the Navigate button on it.
- Every automatic path has a tap behind it, and the manual tap is never more
  than one thumb-reach away.
- **Nothing about finishing a job depends on location.** No permission, no fix,
  no coordinates: a job can be started, worked and completed with location
  switched off entirely.

If a native shell is added later, background region monitoring slots in behind
the same state machine: it would call the same `advanceJob` transition with
`source=geofence`, and everything above stays as it is.

## When it does not work

Each of these is said on screen, in place, with the fallback next to it:

| Situation | What the technician sees |
| --- | --- |
| Permission denied | "Location is off for this site… Mark arrived when you get there." |
| No GPS fix, or timeout | "Your phone could not get a fix. Mark arrived when you get there." |
| Address never geocoded | "This address has not been placed on a map yet, so arrival will not be picked up automatically." |
| Browser has no geolocation | "This phone cannot share its location, so mark arrived when you get there." |
| Declined the explainer | "Automatic arrival is off on this phone" — with **Turn it on** beside it |
| Worked without starting a trip | "Already on site? Start work" → "Mark yourself arrived and start work?" |

The last one is the dead-end guard. Somebody who parked, walked in and got on
with it never tapped Start trip, and used to have no way to record work without
first pretending to drive there.
