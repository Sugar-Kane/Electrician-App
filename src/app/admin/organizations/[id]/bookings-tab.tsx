import Link from "next/link";

import { AdminTime } from "@/components/admin-time";
import { Card, Empty, Pill } from "@/components/admin-ui";
import {
  bookingHideable,
  listBookings,
  listOperations,
  type AdminBooking,
  type OperationRow,
  type OrganizationDetail,
} from "@/lib/admin-console";
import { maskContacts, maskEmail, maskPhone } from "@/lib/admin-mask";
import { duplicateGroups, hideRefusal, keepOne, NOT_SERVICE, notServiceLabel } from "@/lib/booking-duplicates";

import { checkEmailDelivery, supportHideBooking, supportKeepOneBooking, supportRestoreBooking } from "./actions";

const PROBLEMS: Record<string, string> = {
  reason: "Say why. The reason goes on the record.",
  kind: "Say what it was: a sales call, spam, a test or something else.",
  keep: "Choose the one to keep.",
  changed: "That booking changed since the page was shown. Look again before going ahead.",
  already: "That was already done, or is being done now.",
  role: "A support admin can look and check, not change.",
  missing: "That booking isn't in this business.",
  refused: "That was refused.",
};

const STATUS_WORDS: Record<string, string> = {
  new: "waiting",
  needs_review: "waiting",
  awaiting_payment: "waiting on payment",
  safety_escalated: "safety escalated",
  scheduled: "scheduled",
  confirmed: "booked and paid",
  dismissed: "dismissed",
  canceled: "canceled",
  expired: "expired",
};

/** What a booking operation came to, in one sentence. */
function outcome(operation: OperationRow): { text: string; good: boolean } {
  const result = operation.result;
  if (operation.state !== "verified") return { text: `Not done: ${String(result.stopped ?? "refused").replace(/[.\s]+$/, "")}.`, good: false };
  if (operation.tool === "classify_booking")
    return { text: `Hidden as ${notServiceLabel(String(result.kind)).toLowerCase() || "not a service request"}. Not deleted; nobody was told.`, good: true };
  if (operation.tool === "restore_booking")
    return { text: `Brought back, ${STATUS_WORDS[String(result.status_after)] ?? String(result.status_after)}.`, good: true };
  if (operation.tool === "merge_duplicates") {
    const hidden = Number(result.hidden ?? 0);
    return { text: `Kept one; hid ${hidden === 1 ? "the other" : `the other ${hidden}`} as its duplicate${hidden === 1 ? "" : "s"}. Nobody was told.`, good: true };
  }
  return { text: "Done.", good: true };
}

const inputClass =
  "min-h-11 w-full rounded-control border border-line bg-raised px-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand/70";

/** Recent bookings, whether anybody was told about each, and the owner's tidy-up tools. */
export async function BookingsTab({
  organization,
  revealed,
  checked,
  done,
  problem,
  why,
  owner,
}: {
  organization: OrganizationDetail;
  revealed: boolean;
  /** The Check delivery just run, to show its answer beside its email. */
  checked: string;
  /** The booking tool just run, to say how it went. */
  done: string;
  problem: string;
  why: string;
  owner: boolean;
}) {
  const [bookings, operations] = await Promise.all([
    listBookings(organization.id, 40),
    checked || done ? listOperations({ organizationId: organization.id }) : Promise.resolve([]),
  ]);
  const answer = operations.find((operation) => operation.id === checked);
  const finished = operations.find((operation) => operation.id === done);
  const zone = organization.timeZone;
  const base = `/admin/organizations/${organization.id}`;
  const byId = new Map(bookings.map((booking) => [booking.id, booking]));
  const groups = duplicateGroups(bookings.map(bookingHideable)).map((group) => group.map((entry) => byId.get(entry.id)!));
  const contact = (booking: AdminBooking) => (revealed ? booking.phone : maskPhone(booking.phone));

  return (
    <>
      {problem ? (
        <p className="rounded-control border border-critical/30 bg-critical-bg p-3 text-sm text-critical">
          {problem === "refused" && why ? why : PROBLEMS[problem] ?? PROBLEMS.refused}
        </p>
      ) : null}
      {finished ? (
        <p
          role="status"
          className={`rounded-control border p-3 text-sm ${finished && outcome(finished).good ? "border-positive/25 bg-positive-bg text-positive" : "border-critical/30 bg-critical-bg text-critical"}`}
        >
          {outcome(finished).text}
        </p>
      ) : null}

      {groups.length > 0 ? (
        <Card title="Same person twice?" aside={`${groups.length} ${groups.length === 1 ? "set" : "sets"}`}>
          <p className="text-sm text-ink-muted">
            Bookings from the same phone number or email within three days of each other. Keeping one hides the others
            as its duplicates: not deleted, nobody texted, and the business can bring any back from its History. One
            with a job or money behind it can only be the one kept.
          </p>
          <ul className="mt-3 space-y-3">
            {groups.map((group) => {
              const choices = group.map((booking) => ({ booking, choice: keepOne(group.map(bookingHideable), booking.id) }));
              const keepable = choices.filter((entry) => entry.choice.ok);
              return (
                <li key={group.map((booking) => booking.id).join("-")} className="rounded-control border border-line p-3">
                  {owner && keepable.length > 0 ? (
                    <form action={supportKeepOneBooking} className="space-y-2">
                      <input type="hidden" name="organizationId" value={organization.id} />
                      <input type="hidden" name="seen" value={group.map((booking) => booking.updatedAt).join("|")} />
                      {group.map((booking) => (
                        <input key={booking.id} type="hidden" name="groupId" value={booking.id} />
                      ))}
                      <fieldset className="space-y-2">
                        <legend className="text-xs font-semibold text-ink-muted">Keep which one?</legend>
                        {choices.map(({ booking, choice }) => (
                          <label key={booking.id} className="flex min-h-11 items-start gap-2 text-sm">
                            <input type="radio" name="keepId" value={booking.id} disabled={!choice.ok} required className="mt-1 h-4 w-4" />
                            <span>
                              <span className="font-semibold">{booking.contactName || "No name"}</span> · {contact(booking)} ·{" "}
                              {STATUS_WORDS[booking.status] ?? booking.status} · <AdminTime iso={booking.createdAt} timeZone={zone} />
                              {choice.ok ? null : <span className="block text-xs text-ink-faint">{choice.refusal}</span>}
                            </span>
                          </label>
                        ))}
                      </fieldset>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <input name="reason" required minLength={3} maxLength={300} placeholder="Why, e.g. owner asked us to tidy the list" className={inputClass} />
                        <button type="submit" className="tap-target shrink-0 rounded-control bg-brand px-4 text-sm font-bold text-on-brand">
                          Keep it, hide the rest
                        </button>
                      </div>
                    </form>
                  ) : (
                    <ul className="space-y-1 text-sm">
                      {group.map((booking) => (
                        <li key={booking.id}>
                          <a href={`#booking-${booking.id}`} className="font-semibold text-brand">
                            {booking.contactName || "No name"}
                          </a>{" "}
                          · {contact(booking)} · {STATUS_WORDS[booking.status] ?? booking.status} ·{" "}
                          <AdminTime iso={booking.createdAt} timeZone={zone} />
                        </li>
                      ))}
                      <li className="text-xs text-ink-faint">
                        {owner ? "Each of these has work or money behind it, so none can be hidden." : "A support admin can look and check, not change."}
                      </li>
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      <Card title="Recent bookings" aside={`${bookings.length} shown`}>
        {bookings.length === 0 ? (
          <Empty>No bookings.</Empty>
        ) : (
          <ul className="space-y-3">
            {bookings.map((booking) => {
              const refusal = hideRefusal(bookingHideable(booking));
              const hidden = Boolean(booking.archivedAt);
              return (
                <li key={booking.id} id={`booking-${booking.id}`} className="scroll-mt-28 rounded-control border border-line p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-semibold">
                      {booking.contactName || "No name"} · {hidden ? "hidden" : STATUS_WORDS[booking.status] ?? booking.status}
                    </p>
                    <p className="text-xs text-ink-faint">
                      <AdminTime iso={booking.createdAt} timeZone={zone} />
                    </p>
                  </div>
                  {hidden ? (
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                      <Pill>
                        {booking.duplicateOf ? "Hidden as a duplicate" : `Hidden · ${notServiceLabel(booking.classification) || "not a service request"}`}
                      </Pill>
                      <span>
                        <AdminTime iso={booking.archivedAt} timeZone={zone} />
                        {booking.archivedByEmail ? ` by ${booking.archivedByEmail}` : ""} · was {STATUS_WORDS[booking.archivedStatus] ?? booking.archivedStatus}
                        {booking.duplicateOf ? (
                          <>
                            {" · "}
                            <a href={`#booking-${booking.duplicateOf}`} className="font-semibold text-brand">
                              the one kept
                            </a>
                          </>
                        ) : null}
                      </span>
                    </p>
                  ) : null}
                  <p className="mt-1 text-sm text-ink-muted">
                    {contact(booking)}
                    {booking.email ? ` · ${revealed ? booking.email : maskEmail(booking.email)}` : ""}
                  </p>
                  <p className="mt-1 text-sm text-ink-muted">{revealed ? booking.description : maskContacts(booking.description)}</p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {booking.windowStart ? (
                      <>
                        Window <AdminTime iso={booking.windowStart} timeZone={zone} />
                      </>
                    ) : (
                      "No window"
                    )}{" "}
                    · {booking.intakeAnswerCount} intake answers
                    {booking.jobId ? " · became a job" : ""}
                    {booking.paymentCount > 0 || booking.depositPaidAt ? " · money taken" : ""}
                  </p>

                  {booking.notifications.length > 0 ? (
                    <ul className="mt-3 space-y-1">
                      {booking.notifications.map((attempt, index) => (
                        <li
                          key={`${booking.id}-${index}`}
                          className={`rounded-chip px-3 py-2 text-xs ${attempt.ok ? "bg-positive-bg text-positive" : "bg-critical-bg text-critical"}`}
                        >
                          <span className="font-semibold">
                            {attempt.audience} {attempt.channel}
                          </span>
                          {attempt.to ? ` → ${revealed ? attempt.to : maskContacts(attempt.to)}` : ""} ·{" "}
                          {attempt.ok ? "sent" : "failed"}
                          {attempt.detail ? ` — ${revealed ? attempt.detail : maskContacts(attempt.detail)}` : ""}
                          {attempt.at ? (
                            <>
                              {" · "}
                              <AdminTime iso={attempt.at} timeZone={zone} />
                            </>
                          ) : null}
                          {attempt.channel === "email" && attempt.ok ? (
                            <form action={checkEmailDelivery} className="mt-1">
                              <input type="hidden" name="organizationId" value={organization.id} />
                              <input type="hidden" name="bookingId" value={booking.id} />
                              <input type="hidden" name="index" value={index} />
                              <button type="submit" className="min-h-11 font-semibold underline underline-offset-2">
                                Check delivery
                              </button>
                              {answer && answer.targetId === booking.id && Number(answer.result.attempt) === index ? (
                                <span className="ml-2 text-ink">
                                  {answer.state === "verified"
                                    ? `The provider says: ${String(answer.result.last_event)}.`
                                    : `Couldn't tell: ${String(answer.result.why)}`}
                                </span>
                              ) : null}
                            </form>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-xs text-ink-faint">
                      No notification record — this booking predates the tracking, or nothing was attempted.
                    </p>
                  )}

                  {owner && hidden ? (
                    <details className="mt-3 rounded-control border border-line">
                      <summary className="tap-target flex cursor-pointer list-none items-center px-3 text-xs font-semibold text-ink-muted">
                        Bring it back
                      </summary>
                      <form action={supportRestoreBooking} className="flex flex-col gap-2 px-3 pb-3 sm:flex-row">
                        <input type="hidden" name="organizationId" value={organization.id} />
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <input type="hidden" name="updatedAt" value={booking.updatedAt} />
                        <input name="reason" required minLength={3} maxLength={300} placeholder="Why, e.g. owner says it was a real customer" className={inputClass} />
                        <button type="submit" className="tap-target shrink-0 rounded-control border border-line px-4 text-sm font-semibold">
                          Bring it back
                        </button>
                      </form>
                    </details>
                  ) : owner && !refusal ? (
                    <details className="mt-3 rounded-control border border-line">
                      <summary className="tap-target flex cursor-pointer list-none items-center px-3 text-xs font-semibold text-ink-muted">
                        Not a service request?
                      </summary>
                      <form action={supportHideBooking} className="space-y-2 px-3 pb-3">
                        <input type="hidden" name="organizationId" value={organization.id} />
                        <input type="hidden" name="bookingId" value={booking.id} />
                        <input type="hidden" name="updatedAt" value={booking.updatedAt} />
                        <fieldset className="flex flex-wrap gap-2">
                          <legend className="sr-only">What was it?</legend>
                          {NOT_SERVICE.map((kind, index) => (
                            <label key={kind.value} className="inline-flex min-h-11 items-center gap-2 rounded-chip border border-line px-3 text-xs font-semibold">
                              <input type="radio" name="kind" value={kind.value} required={index === 0} className="h-4 w-4" />
                              {kind.label}
                            </label>
                          ))}
                        </fieldset>
                        <p className="text-xs text-ink-faint">
                          It leaves the business&rsquo;s waiting list and Today, with a note in its history that Volteira
                          support hid it. Not deleted; nobody is texted.
                        </p>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input name="reason" required minLength={3} maxLength={300} placeholder="Why, e.g. owner says it's a sales call" className={inputClass} />
                          <button type="submit" className="tap-target shrink-0 rounded-control border border-line px-4 text-sm font-semibold">
                            Hide it
                          </button>
                        </div>
                      </form>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-4 text-xs text-ink-faint">
          Looking for a job a booking became? <Link href={`${base}?tab=jobs`} className="font-semibold text-brand">Jobs</Link>
        </p>
      </Card>
    </>
  );
}
