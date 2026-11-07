import { appTaskActor } from "@/lib/task-actor";
import { tasksFingerprint } from "@/lib/tasks-service";

/**
 * Whether the tasks on screen are still current. `?job=<id>` answers for one
 * job's Tasks section. Only a hash-like string of rows the caller can already
 * see, for the signed-in member's own business.
 */

const NO_STORE = { "Cache-Control": "private, no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const session = await appTaskActor();
  if (!session) return Response.json({ error: "Authentication required." }, { status: 401, headers: NO_STORE });
  const job = new URL(request.url).searchParams.get("job");
  if (job !== null && !UUID.test(job)) return Response.json({ error: "Unknown job." }, { status: 404, headers: NO_STORE });
  const fingerprint = await tasksFingerprint(session.db, session.actor, job ?? undefined);
  return Response.json({ fingerprint }, { headers: NO_STORE });
}
