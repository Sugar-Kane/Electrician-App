"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertCircle,
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
  "mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-[#0d202d] px-4 text-base text-white outline-none placeholder:text-slate-600 focus:border-[#ffc21c]/60";

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#ffc21c] px-5 text-sm font-semibold text-[#071723] shadow-lg shadow-yellow-500/10 disabled:cursor-wait disabled:opacity-70"
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
      <section className="rounded-[24px] border border-white/10 bg-[#081925] p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-[#ffc21c]/10 text-[#ffc21c]">
            <Building2 className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-white">Business details</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              These details identify the company and your first owner account.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <UserRound className="h-4 w-4 text-slate-500" aria-hidden /> Your name
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
            <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <Phone className="h-4 w-4 text-slate-500" aria-hidden /> Business phone
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
            <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <Zap className="h-4 w-4 text-slate-500" aria-hidden /> Business name
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
        <p className="mt-4 text-xs text-slate-500">Signed in as {email}</p>
      </section>

      <section className="rounded-[24px] border border-white/10 bg-[#081925] p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-sky-400/10 text-sky-300">
            <MapPin className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-white">Route starting point</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              Used for the service area and future route optimization. Customers never see a private home address.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-[1fr_92px_120px]">
          <label className="block sm:col-span-3">
            <span className="text-sm font-medium text-slate-200">Street address</span>
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
            <span className="text-sm font-medium text-slate-200">City</span>
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
            <span className="text-sm font-medium text-slate-200">State</span>
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
            <span className="text-sm font-medium text-slate-200">ZIP</span>
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
            <span className="text-sm font-medium text-slate-200">Standard service radius</span>
            <span className="mt-2 flex min-h-12 items-center gap-3 rounded-2xl border border-white/10 bg-[#0d202d] px-4">
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
              <span className="text-sm text-slate-400">miles</span>
            </span>
          </label>
        </div>
      </section>

      <section className="rounded-[24px] border border-white/10 bg-[#081925] p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-300">
            <CalendarDays className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-white">Normal working schedule</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              This creates the first bookable schedule. Blackout hours can override it later.
            </p>
          </div>
        </div>

        <fieldset className="mt-5">
          <legend className="text-sm font-medium text-slate-200">Working days</legend>
          <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-7">
            {weekdays.map(([value, label]) => {
              const selected = workingDays.has(value);
              return (
                <label
                  key={value}
                  className={`tap-target flex min-h-12 cursor-pointer items-center justify-center rounded-2xl border text-sm font-semibold transition ${selected ? "border-[#ffc21c] bg-[#ffc21c] text-[#071723]" : "border-white/10 bg-[#0d202d] text-slate-400"}`}
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
            <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <Clock3 className="h-4 w-4 text-slate-500" aria-hidden /> Start time
            </span>
            <input type="time" name="startTime" required defaultValue="08:00" className={inputClass} />
          </label>
          <label className="block">
            <span className="flex items-center gap-2 text-sm font-medium text-slate-200">
              <Clock3 className="h-4 w-4 text-slate-500" aria-hidden /> End time
            </span>
            <input type="time" name="endTime" required defaultValue="17:00" className={inputClass} />
          </label>
        </div>
      </section>

      <section className="rounded-[24px] border border-[#ffc21c]/25 bg-[#ffc21c]/[0.06] p-4 sm:p-5">
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#ffc21c]" aria-hidden />
          <div>
            <h2 className="text-sm font-semibold text-white">Pilot rules ready to use</h2>
            <ul className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2">
              {["$100 one-hour diagnostic", "$100 credited toward repair", "$150 after-hours visit", "$200 emergency visit", "$50 late cancellation", "Payment required to confirm"].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden /> {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {state.error ? (
        <p role="alert" className="flex items-start gap-2 rounded-2xl border border-red-400/20 bg-red-400/[0.07] p-4 text-sm leading-6 text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {state.error}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
