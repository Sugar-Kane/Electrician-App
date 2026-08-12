import "server-only";

import { arrivalRadiusMeters, DEFAULT_ARRIVAL_RADIUS_METERS } from "@/lib/arrival";
import { hasCoordinates, type Coordinates } from "@/lib/coordinates";
import { workflowStateOf, type WorkflowState } from "@/lib/job-workflow";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Everything the job screen needs to know what to offer next.
 *
 * Separate from `getJobControls`, which returns wall-clock strings for the edit
 * form. This returns the state, the point on the ground and the times — the
 * three things the contextual action is built from — so the screen never has to
 * reason about a status string.
 *
 * Null for the signed-out demo view. There is no job to advance and no
 * technician to place, and a Start trip button that silently saves nothing is
 * worse than one that is not there.
 */

export type JobWorkflow = {
  jobNumber: string;
  state: WorkflowState;
  cancellationReason: string;
  /** Null until the address has been geocoded. Never 0,0. */
  destination: Coordinates | null;
  /** The business's geofence, already clamped to something achievable. */
  radiusMeters: number;
  tripStartedLabel: string;
  arrivedLabel: string;
  workStartedLabel: string;
  /** How the arrival was decided, so the screen can say "automatically". */
  arrivalSource: "geofence" | "manual" | "";
  /** Whether the customer has already been texted that the trip started. */
  customerEnRouteNotified: boolean;
  /** Whether the customer has already been texted about this arrival. */
  customerArrivalNotified: boolean;
  /** Which of the two messages this business sends at all. */
  customerEnRouteMessages: boolean;
  customerArrivalMessages: boolean;
  /** Whether there is a number to text, so the screen can stop promising one. */
  customerReachable: boolean;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A time of day in the business's zone, never the server's. */
function clockLabel(iso: unknown, timeZone: string): string {
  const value = str(iso);
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(at);
}

export async function getJobWorkflow(jobNumber: string): Promise<JobWorkflow | null> {
  const context = await currentContext();
  if (!context) return null;

  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return null;

  const database = asFlexibleClient(await createClient());

  const { data } = await database
    .from("jobs")
    .select(
      `id, job_number, status, cancellation_reason,
       properties ( latitude, longitude ),
       customers ( phone )`,
    )
    .eq("organization_id", context.organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  if (!data) return null;

  const row = data as Record<string, unknown>;
  const jobId = str(row.id);
  const property = (row.properties ?? null) as Record<string, unknown> | null;
  const customer = (row.customers ?? null) as Record<string, unknown> | null;

  // Three reads that do not depend on each other, so they do not queue.
  const [{ data: progress }, { data: settings }, { data: templates }] = await Promise.all([
    database
      .from("job_technician_progress")
      .select(
        `trip_started_at, arrived_at, arrival_source, work_started_at,
         customer_en_route_notified_at, customer_arrival_notified_at`,
      )
      .eq("organization_id", context.organizationId)
      .eq("job_id", jobId)
      // Whoever got there first. With one technician this is the only row; with
      // two, the job arrived when the first van did.
      .order("arrived_at", { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    database
      .from("service_settings")
      .select("arrival_radius_meters")
      .eq("organization_id", context.organizationId)
      .maybeSingle(),
    // The business-level switches for telling customers, which already exist as
    // the automatic messages at /settings/messages rather than as a second set
    // of settings that could disagree with them.
    database
      .from("message_templates")
      .select("trigger_event, is_active")
      .eq("organization_id", context.organizationId)
      .eq("channel", "sms")
      .in("trigger_event", ["job_en_route", "job_arrived"]),
  ]);

  const progressRow = (progress ?? null) as Record<string, unknown> | null;

  const active = new Set(
    ((templates ?? []) as Record<string, unknown>[])
      .filter((row) => row.is_active === true)
      .map((row) => String(row.trigger_event)),
  );

  const latitude = property?.latitude === null || property?.latitude === undefined
    ? null
    : Number(property.latitude);
  const longitude = property?.longitude === null || property?.longitude === undefined
    ? null
    : Number(property.longitude);
  const point = { lat: latitude, lng: longitude };

  const source = str(progressRow?.arrival_source);

  return {
    jobNumber: String(row.job_number ?? jobNumber),
    state: workflowStateOf(str(row.status)),
    cancellationReason: str(row.cancellation_reason),
    destination: hasCoordinates(point) ? { lat: point.lat, lng: point.lng } : null,
    radiusMeters: settings?.arrival_radius_meters === undefined || settings?.arrival_radius_meters === null
      ? DEFAULT_ARRIVAL_RADIUS_METERS
      : arrivalRadiusMeters(settings.arrival_radius_meters),
    tripStartedLabel: clockLabel(progressRow?.trip_started_at, context.timeZone),
    arrivedLabel: clockLabel(progressRow?.arrived_at, context.timeZone),
    workStartedLabel: clockLabel(progressRow?.work_started_at, context.timeZone),
    arrivalSource: source === "geofence" || source === "manual" ? source : "",
    customerEnRouteNotified: Boolean(progressRow?.customer_en_route_notified_at),
    customerArrivalNotified: Boolean(progressRow?.customer_arrival_notified_at),
    customerEnRouteMessages: active.has("job_en_route"),
    customerArrivalMessages: active.has("job_arrived"),
    customerReachable: str(customer?.phone) !== "",
  };
}
