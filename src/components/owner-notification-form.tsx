"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2, LoaderCircle, TriangleAlert } from "lucide-react";

import {
  saveOwnerNotifications,
  type NotificationActionState,
} from "@/app/settings/notifications/actions";

const initialState: NotificationActionState = { error: "" };
const inputClass =
  "mt-2 min-h-12 w-full rounded-control border border-line bg-raised px-4 text-base text-white outline-none placeholder:text-ink-faint focus:border-brand/70";

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-bold text-on-brand disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : null}
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

export function OwnerNotificationForm({
  organizationId,
  email,
  phone,
  textingBlocked,
}: {
  organizationId: string;
  email: string;
  phone: string;
  /** True while the messaging campaign is not yet approved. */
  textingBlocked: boolean;
}) {
  const [state, formAction] = useActionState(saveOwnerNotifications, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="organizationId" value={organizationId} />

      <section className="rounded-panel border border-line bg-surface p-5 sm:p-6">
        <h2 className="text-lg font-semibold">When a booking comes in</h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          Where you hear about a job booked by the phone assistant while you were on a
          roof. You get the arrival window, the address, the customer&rsquo;s number, and
          everything they said when asked.
        </p>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-sm font-medium text-ink">Email</span>
            <input
              name="ownerEmail"
              type="email"
              inputMode="email"
              autoComplete="email"
              defaultValue={email}
              placeholder="you@yourbusiness.com"
              className={inputClass}
            />
            <span className="mt-2 block text-xs leading-5 text-ink-faint">
              The full job, enough to plan the day from without opening the app.
            </span>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-ink">Mobile number</span>
            <input
              name="ownerPhone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              defaultValue={phone}
              placeholder="(805) 555-0142"
              className={inputClass}
            />
            <span className="mt-2 block text-xs leading-5 text-ink-faint">
              A short text you can read on a lock screen, then a second one with the
              answers. Use your own mobile, not the business line the assistant answers.
            </span>
          </label>
        </div>

        {textingBlocked ? (
          <p className="mt-5 flex items-start gap-2 rounded-control border border-amber-300/25 bg-amber-300/[0.06] p-4 text-sm leading-6 text-amber-100">
            <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            <span>
              Texts are not being delivered yet — your messaging campaign is still
              awaiting carrier approval. Email arrives normally, so set that one for now.
            </span>
          </p>
        ) : null}

        {state.error ? (
          <p className="mt-4 flex items-start gap-2 text-sm text-rose-300">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {state.error}
          </p>
        ) : null}
        {state.saved ? (
          <p className="mt-4 flex items-start gap-2 text-sm text-emerald-300">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            Saved. The next booking will go here.
          </p>
        ) : null}

        <div className="mt-5">
          <SaveButton />
        </div>
      </section>
    </form>
  );
}
