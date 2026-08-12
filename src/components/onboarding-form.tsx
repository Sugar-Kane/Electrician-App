"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Banner } from "@/components/ui/banner";
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Check,
  Clock3,
  LoaderCircle,
  MapPin,
  Phone,
  ShieldCheck,
  UserRound,
  Zap,
} from "lucide-react";

import {
  createOwnerWorkspace,
  type OnboardingActionState,
} from "@/app/onboarding/actions";

const initialActionState: OnboardingActionState = { error: "" };
const weekdays = [
  ["monday", "Mon"],
  ["tuesday", "Tue"],
  ["wednesday", "Wed"],
  ["thursday", "Thu"],
  ["friday", "Fri"],
  ["saturday", "Sat"],
  ["sunday", "Sun"],
] as const;

const inputClass =
  "mt-2 min-h-12 w-full rounded-control border border-line bg-raised px-4 text-base text-white outline-none placeholder:text-ink-faint focus:border-brand/60";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-semibold text-on-brand shadow-lg shadow-yellow-500/10 disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? (
        <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
      ) : (
        <Zap className="h-5 w-5 fill-current" aria-hidden />
      )}
      {pending ? "Creating your workspace…" : "Create my business workspace"}
      {!pending ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
    </button>
  );
}

export function OnboardingForm({
  email,
  defaultOwnerName,
}: {
  email: string;
  defaultOwnerName: string;
}) {
  const [state, formAction] = useActionState(
    createOwnerWorkspace,
    initialActionState,
  );
  const [workingDays, setWorkingDays] = useState(
    () => new Set(["monday", "tuesday", "wednesday", "thursday", "friday"]),
  );

  function toggleDay(day: string) {
    setWorkingDays((current) => {
      const next = new Set(current);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  return (
    <form action={formAction} className="space-y-5">
      <section className="rounded-[24px] border border-line bg-[#081925] p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-brand/10 text-brand">
            <Building2 className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-white">Business details</h2>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              These details identify the company and your first owner account.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="flex items-center gap-2 text-sm font-medium text-ink">
              <UserRound className="h-4 w-4 text-ink-faint" aria-hidden /> Your name
            </span>
            <input
              name="ownerName"
              autoComplete="name"
              required
              maxLength={120}
              defaultValue={defaultOwnerName}
              placeholder="Adam Smith"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="flex items-center gap-2 text-sm font-medium text-ink">
              <Phone className="h-4 w-4 text-ink-faint" aria-hidden /> Business phone
            </span>
            <input
              type="tel"
              name="phone"
              autoComplete="tel"
              inputMode="tel"
              required
              maxLength={30}
              placeholder="(805) 555-0123"
              className={inputClass}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="flex items-center gap-2 text-sm font-medium text-ink">
              <Zap className="h-4 w-4 text-ink-faint" aria-hidden /> Business name
            </span>
            <input
              name="businessName"
              autoComplete="organization"
              required
              maxLength={120}
              placeholder="Pacific Plains Electric"
              className={inputClass}
            />
          </label>
        </div>
        <p className="mt-4 text-xs text-ink-faint">Signed in as {email}</p>
      </section>

      <section className="rounded-[24px] border border-line bg-[#081925] p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-sky-400/10 text-sky-300">
            <MapPin className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-white">Route starting point</h2>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              Used for the service area and future route optimization. Customers never see a private home address.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_92px_120px]">
          <label className="block sm:col-span-3">
            <span className="text-sm font-medium text-ink">Street address</span>
            <input
              name="address"
              autoComplete="street-address"
              required
              maxLength={160}
              placeholder="Business or home base address"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">City</span>
            <input
              name="city"
              autoComplete="address-level2"
              required
              maxLength={80}
              defaultValue="Nipomo"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">State</span>
            <input
              name="state"
              autoComplete="address-level1"
              required
              maxLength={2}
              defaultValue="CA"
              className={`${inputClass} uppercase`}
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">ZIP</span>
            <input
              name="postalCode"
              autoComplete="postal-code"
              inputMode="numeric"
              required
              maxLength={10}
              defaultValue="93444"
              className={inputClass}
            />
          </label>
          <label className="block sm:col-span-3">
            <span className="text-sm font-medium text-ink">Standard service radius</span>
            <span className="mt-2 flex min-h-12 items-center gap-3 rounded-control border border-line bg-raised px-4">
              <input
                type="number"
                name="serviceRadius"
                inputMode="numeric"
                min={1}
                max={100}
                defaultValue={50}
                required
                className="min-w-0 flex-1 bg-transparent text-base text-white outline-none"
              />
              <span className="text-sm text-ink-muted">miles</span>
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-[24px] border border-line bg-[#081925] p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-positive-bg text-positive">
            <CalendarDays className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-white">Normal working schedule</h2>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              This creates the first bookable schedule. Blackout hours can override it later.
            </p>
          </div>
        </div>

        <fieldset className="mt-5">
          <legend className="text-sm font-medium text-ink">Working days</legend>
          <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
            {weekdays.map(([value, label]) => {
              const selected = workingDays.has(value);
              return (
                <label
                  key={value}
                  className={`tap-target flex min-h-12 cursor-pointer items-center justify-center rounded-control border text-sm font-semibold transition ${selected ? "border-brand bg-brand text-on-brand" : "border-line bg-raised text-ink-muted"}`}
                >
                  <input
                    type="checkbox"
                    name="workingDays"
                    value={value}
                    checked={selected}
                    onChange={() => toggleDay(value)}
                    className="sr-only"
                  />
                  {label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="flex items-center gap-2 text-sm font-medium text-ink">
              <Clock3 className="h-4 w-4 text-ink-faint" aria-hidden /> Start time
            </span>
            <input type="time" name="startTime" required defaultValue="08:00" className={inputClass} />
          </label>
          <label className="block">
            <span className="flex items-center gap-2 text-sm font-medium text-ink">
              <Clock3 className="h-4 w-4 text-ink-faint" aria-hidden /> End time
            </span>
            <input type="time" name="endTime" required defaultValue="17:00" className={inputClass} />
          </label>
        </div>
      </section>

      <section className="rounded-[24px] border border-brand/25 bg-brand/[0.06] p-4 sm:p-5">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold text-white">Pilot rules ready to use</h2>
            <ul className="mt-3 grid gap-2 text-sm text-ink-muted sm:grid-cols-2">
              {["$100 one-hour diagnostic", "$100 credited toward repair", "$150 after-hours visit", "$200 emergency visit", "$50 late cancellation", "Payment required to confirm"].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-positive" aria-hidden /> {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {state.error ? (
        <Banner tone="critical">
          {state.error}
        </Banner>
      ) : null}

      <SubmitButton />
    </form>
  );
}
