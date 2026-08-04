"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  Home,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  MessageSquare,
  PhoneCall,
  ShieldCheck,
  UserRound,
  Zap,
} from "lucide-react";

import {
  startPublicBooking,
  type BookingActionState,
} from "@/app/book/[slug]/actions";
import {
  evaluateSafety,
  getAdaptiveSafetyQuestions,
  type SafetyAnswerMap,
} from "@/lib/booking-safety";
import type { PublicBookingPage, PublicBookingSlot } from "@/lib/public-booking";
import { smsConsentDisclosure } from "@/lib/sms-consent";

const initialActionState: BookingActionState = { error: "" };
const inputClass =
  "mt-2 min-h-12 w-full rounded-2xl border border-white/10 bg-[#0d202d] px-4 text-base text-white outline-none placeholder:text-slate-600 focus:border-[#ffc21c]/70";

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function dateKey(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

function formatDay(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));
}

function formatTime(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function CheckoutButton({ amount, disabled }: { amount: number; disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="tap-target flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#ffc21c] px-5 text-sm font-bold text-[#071723] shadow-lg shadow-yellow-500/10 disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? (
        <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
      ) : (
        <LockKeyhole className="h-5 w-5" aria-hidden />
      )}
      {pending ? "Starting secure checkout…" : `Continue to pay ${formatCurrency(amount)}`}
      {!pending ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
    </button>
  );
}

export function PublicBookingFlow({
  bookingPage,
  messagingBusinessName,
  slots,
  checkoutCanceled,
}: {
  bookingPage: PublicBookingPage;
  messagingBusinessName: string;
  slots: PublicBookingSlot[];
  checkoutCanceled: boolean;
}) {
  const action = startPublicBooking.bind(null, bookingPage.slug);
  const [actionState, formAction] = useActionState(action, initialActionState);
  const [step, setStep] = useState(1);
  const [stepError, setStepError] = useState("");
  const [customerType, setCustomerType] = useState("residential");
  const [description, setDescription] = useState("");
  const [answers, setAnswers] = useState<SafetyAnswerMap>({});
  const [contact, setContact] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "CA",
    postalCode: "",
    accessNotes: "",
  });
  const [selectedSlot, setSelectedSlot] = useState("");
  const [acceptedPolicy, setAcceptedPolicy] = useState(false);
  // Never pre-checked: active, affirmative consent is required for A2P 10DLC.
  const [smsConsent, setSmsConsent] = useState(false);
  const smsDisclosure = smsConsentDisclosure(messagingBusinessName);

  const questions = useMemo(
    () => getAdaptiveSafetyQuestions(description, answers),
    [description, answers],
  );
  const safety = useMemo(
    () => evaluateSafety(description, answers),
    [description, answers],
  );
  const selected = slots.find(
    (slot) => `${slot.slot_start}|${slot.slot_end}` === selectedSlot,
  );
  const checkoutAmount =
    safety.outcome === "urgent_review"
      ? bookingPage.emergency_fee_cents
      : bookingPage.diagnostic_fee_cents;

  const slotsByDay = useMemo(() => {
    const groups = new Map<string, PublicBookingSlot[]>();
    slots.forEach((slot) => {
      const key = dateKey(slot.slot_start, bookingPage.timezone);
      groups.set(key, [...(groups.get(key) ?? []), slot]);
    });
    return [...groups.entries()].slice(0, 7);
  }, [bookingPage.timezone, slots]);

  useEffect(() => {
    if (actionState.checkoutUrl) window.location.assign(actionState.checkoutUrl);
  }, [actionState.checkoutUrl]);

  function nextStep() {
    setStepError("");
    if (step === 1 && description.trim().length < 10) {
      setStepError("Tell us a little more about what is happening.");
      return;
    }
    if (step === 2 && questions.some((question) => answers[question.id] === undefined)) {
      setStepError("Answer each safety question before continuing.");
      return;
    }
    if (step === 3) {
      if (!contact.firstName.trim() || !contact.lastName.trim()) {
        setStepError("Enter your first and last name.");
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contact.email)) {
        setStepError("Enter a valid email address.");
        return;
      }
      if (contact.phone.replace(/\D/g, "").length < 7) {
        setStepError("Enter a valid phone number.");
        return;
      }
      if (
        contact.addressLine1.trim().length < 3 ||
        contact.city.trim().length < 2 ||
        !/^[A-Za-z]{2}$/.test(contact.state) ||
        !/^\d{5}(?:-\d{4})?$/.test(contact.postalCode)
      ) {
        setStepError("Enter the complete service address.");
        return;
      }
    }
    setStep((current) => Math.min(4, current + 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function previousStep() {
    setStepError("");
    setStep((current) => Math.max(1, current - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function updateContact(key: keyof typeof contact, value: string) {
    setContact((current) => ({ ...current, [key]: value }));
  }

  if (actionState.outcome === "needs_review") {
    return (
      <section className="rounded-[28px] border border-emerald-400/20 bg-[#081925] p-5 text-center sm:p-8">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-400/10 text-emerald-300">
          <CheckCircle2 className="h-8 w-8" aria-hidden />
        </span>
        <h2 className="mt-5 text-2xl font-semibold text-white">Your request is with the team.</h2>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-400">
          The address is outside the automatic booking area or could not be confirmed. {bookingPage.display_name} will review the details and contact you before charging anything.
        </p>
        {actionState.distanceMiles !== null && actionState.distanceMiles !== undefined ? (
          <p className="mt-3 text-xs text-slate-500">
            Estimated distance from the normal service area: {actionState.distanceMiles} miles.
          </p>
        ) : null}
        {bookingPage.business_phone ? (
          <a
            href={`tel:${bookingPage.business_phone}`}
            className="tap-target mx-auto mt-6 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 px-5 text-sm font-semibold text-white"
          >
            <PhoneCall className="h-4 w-4 text-[#ffc21c]" aria-hidden /> Call {bookingPage.business_phone}
          </a>
        ) : null}
      </section>
    );
  }

  const blockedSafetyOutcome =
    safety.outcome === "emergency_services" || safety.outcome === "utility_referral";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="customerType" value={customerType} />
      <input type="hidden" name="description" value={description} />
      <input type="hidden" name="safetyAnswers" value={JSON.stringify(answers)} />
      {Object.entries(contact).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
      <input type="hidden" name="slotStart" value={selected?.slot_start ?? ""} />
      <input type="hidden" name="slotEnd" value={selected?.slot_end ?? ""} />
      <input type="hidden" name="acceptedPolicy" value={acceptedPolicy ? "yes" : "no"} />
      <input type="hidden" name="smsConsent" value={smsConsent ? "yes" : "no"} />

      <div className="grid grid-cols-4 gap-2" aria-label={`Booking step ${step} of 4`}>
        {["Issue", "Safety", "Details", "Time"].map((label, index) => {
          const number = index + 1;
          const active = number === step;
          const complete = number < step;
          return (
            <div key={label} className="min-w-0">
              <div
                className={`h-1.5 rounded-full ${complete || active ? "bg-[#ffc21c]" : "bg-white/10"}`}
              />
              <p className={`mt-2 truncate text-[11px] ${active ? "font-semibold text-white" : "text-slate-500"}`}>
                {label}
              </p>
            </div>
          );
        })}
      </div>

      <section className="min-h-[420px] rounded-[28px] border border-white/10 bg-[#081925] p-4 sm:p-6">
        {checkoutCanceled ? (
          <p className="mb-4 rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] p-3 text-sm text-amber-100">
            Checkout was canceled. Your appointment is not confirmed; choose a time and try again.
          </p>
        ) : null}

        {step === 1 ? (
          <div>
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#ffc21c]/10 text-[#ffc21c]">
              <Zap className="h-6 w-6" aria-hidden />
            </span>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-[#ffc21c]">Step 1</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">What can we help with?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Describe what you see, hear, or need installed. This helps prepare the electrician; it is not an online diagnosis.
            </p>

            <div className="mt-5 grid grid-cols-2 gap-2">
              {[
                { value: "residential", label: "Home", icon: Home },
                { value: "commercial", label: "Business", icon: Building2 },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setCustomerType(option.value)}
                  className={`tap-target flex min-h-14 items-center justify-center gap-2 rounded-2xl border text-sm font-semibold ${customerType === option.value ? "border-[#ffc21c] bg-[#ffc21c]/10 text-white" : "border-white/10 bg-[#0d202d] text-slate-400"}`}
                >
                  <option.icon className="h-5 w-5" aria-hidden /> {option.label}
                </button>
              ))}
            </div>

            <label className="mt-5 block">
              <span className="text-sm font-medium text-slate-200">Describe the electrical issue or project</span>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value.slice(0, 2_000))}
                rows={6}
                autoFocus
                placeholder="Example: Three kitchen outlets stopped working this morning. The breaker does not look tripped."
                className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-[#0d202d] p-4 text-base leading-6 text-white outline-none placeholder:text-slate-600 focus:border-[#ffc21c]/70"
              />
              <span className="mt-2 block text-right text-xs text-slate-600">{description.length}/2000</span>
            </label>
          </div>
        ) : null}

        {step === 2 ? (
          <div>
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-sky-400/10 text-sky-300">
              <ShieldCheck className="h-6 w-6" aria-hidden />
            </span>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-[#ffc21c]">Step 2</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">A quick safety check</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              These questions adapt to your description and determine the safest next step. They do not diagnose the problem.
            </p>

            <div className="mt-5 space-y-4">
              {questions.map((question) => (
                <fieldset key={question.id} className="rounded-2xl border border-white/10 bg-[#0d202d] p-4">
                  <legend className="px-1 text-sm font-medium leading-6 text-white">{question.label}</legend>
                  {question.help ? <p className="mt-1 text-xs leading-5 text-slate-500">{question.help}</p> : null}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {[false, true].map((value) => (
                      <button
                        key={String(value)}
                        type="button"
                        onClick={() => setAnswers((current) => ({ ...current, [question.id]: value }))}
                        className={`tap-target min-h-12 rounded-xl border text-sm font-semibold ${answers[question.id] === value ? "border-[#ffc21c] bg-[#ffc21c] text-[#071723]" : "border-white/10 text-slate-300"}`}
                      >
                        {value ? "Yes" : "No"}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>

            {safety.outcome === "emergency_services" ? (
              <div role="alert" className="mt-5 rounded-2xl border border-red-400/30 bg-red-400/[0.08] p-4 text-sm leading-6 text-red-100">
                <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-5 w-5" aria-hidden /> Stop and address the immediate hazard.</p>
                <p className="mt-2">Leave the affected area and call 911 for fire, smoke, or injury. For a downed power line, stay well away and call the utility. Do not touch wet or energized equipment.</p>
              </div>
            ) : null}

            {safety.outcome === "utility_referral" ? (
              <div role="alert" className="mt-5 rounded-2xl border border-amber-300/25 bg-amber-300/[0.07] p-4 text-sm leading-6 text-amber-100">
                <p className="font-semibold">Contact the electric utility first.</p>
                <p className="mt-2">An outage affecting nearby properties is usually handled by the utility. Once service is restored, return here if the property still has an electrical problem.</p>
              </div>
            ) : null}

            {safety.outcome === "urgent_review" ? (
              <div className="mt-5 rounded-2xl border border-[#ffc21c]/25 bg-[#ffc21c]/[0.06] p-4 text-sm leading-6 text-slate-300">
                <p className="font-semibold text-white">Urgent review recommended</p>
                <p className="mt-1">If there is no active fire, injury, water contact, or downed line, you can continue to request the {formatCurrency(bookingPage.emergency_fee_cents)} emergency diagnostic.</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div>
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-300">
              <UserRound className="h-6 w-6" aria-hidden />
            </span>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-[#ffc21c]">Step 3</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Where should we send the electrician?</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Addresses inside {bookingPage.automatic_booking_radius_miles} miles of {bookingPage.base_city}, {bookingPage.base_state} can book automatically.
            </p>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-slate-200">First name</span>
                <input autoComplete="given-name" value={contact.firstName} onChange={(event) => updateContact("firstName", event.target.value)} className={inputClass} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-200">Last name</span>
                <input autoComplete="family-name" value={contact.lastName} onChange={(event) => updateContact("lastName", event.target.value)} className={inputClass} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-200">Mobile phone</span>
                <input type="tel" inputMode="tel" autoComplete="tel" value={contact.phone} onChange={(event) => updateContact("phone", event.target.value)} className={inputClass} placeholder="(805) 555-0123" />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-200">Email</span>
                <input type="email" inputMode="email" autoComplete="email" value={contact.email} onChange={(event) => updateContact("email", event.target.value)} className={inputClass} />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-sm font-medium text-slate-200">Service address</span>
                <input autoComplete="address-line1" value={contact.addressLine1} onChange={(event) => updateContact("addressLine1", event.target.value)} className={inputClass} placeholder="Street address" />
              </label>
              <label className="block sm:col-span-2">
                <span className="text-sm font-medium text-slate-200">Unit, suite, or apartment <span className="text-slate-600">(optional)</span></span>
                <input autoComplete="address-line2" value={contact.addressLine2} onChange={(event) => updateContact("addressLine2", event.target.value)} className={inputClass} />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-slate-200">City</span>
                <input autoComplete="address-level2" value={contact.city} onChange={(event) => updateContact("city", event.target.value)} className={inputClass} />
              </label>
              <div className="grid grid-cols-[88px_1fr] gap-3">
                <label className="block">
                  <span className="text-sm font-medium text-slate-200">State</span>
                  <input autoComplete="address-level1" maxLength={2} value={contact.state} onChange={(event) => updateContact("state", event.target.value.toUpperCase())} className={`${inputClass} uppercase`} />
                </label>
                <label className="block">
                  <span className="text-sm font-medium text-slate-200">ZIP</span>
                  <input inputMode="numeric" autoComplete="postal-code" maxLength={10} value={contact.postalCode} onChange={(event) => updateContact("postalCode", event.target.value)} className={inputClass} />
                </label>
              </div>
              <label className="block sm:col-span-2">
                <span className="text-sm font-medium text-slate-200">Gate, parking, pets, or access notes <span className="text-slate-600">(optional)</span></span>
                <textarea rows={3} value={contact.accessNotes} onChange={(event) => updateContact("accessNotes", event.target.value.slice(0, 500))} className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-[#0d202d] p-4 text-base text-white outline-none placeholder:text-slate-600 focus:border-[#ffc21c]/70" placeholder="Gate code, where to park, pets to secure…" />
              </label>
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div>
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-400/10 text-violet-300">
              <CalendarDays className="h-6 w-6" aria-hidden />
            </span>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.16em] text-[#ffc21c]">Step 4</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Choose an arrival window</h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Travel time, existing jobs, and technician blackout hours are already removed from these options.
            </p>

            {slotsByDay.length ? (
              <div className="mt-5 space-y-4">
                {slotsByDay.map(([day, daySlots]) => (
                  <fieldset key={day}>
                    <legend className="mb-2 text-sm font-semibold text-white">
                      {formatDay(daySlots[0].slot_start, bookingPage.timezone)}
                    </legend>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {daySlots.map((slot) => {
                        const value = `${slot.slot_start}|${slot.slot_end}`;
                        const active = selectedSlot === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setSelectedSlot(value)}
                            className={`tap-target min-h-14 rounded-2xl border px-2 text-sm font-semibold ${active ? "border-[#ffc21c] bg-[#ffc21c] text-[#071723]" : "border-white/10 bg-[#0d202d] text-slate-300"}`}
                          >
                            {formatTime(slot.slot_start, bookingPage.timezone)}–{formatTime(slot.slot_end, bookingPage.timezone)}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-white/10 bg-[#0d202d] p-5 text-center">
                <CalendarDays className="mx-auto h-7 w-7 text-slate-600" aria-hidden />
                <p className="mt-3 text-sm font-semibold text-white">No online windows are open right now.</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">Call the business or check back after the schedule is updated.</p>
              </div>
            )}

            <div className="mt-5 rounded-2xl border border-[#ffc21c]/25 bg-[#ffc21c]/[0.06] p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {safety.outcome === "urgent_review" ? "Emergency diagnostic" : "Onsite diagnostic"}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    Includes {bookingPage.diagnostic_minutes} minutes onsite
                    {bookingPage.credit_diagnostic_to_repair ? " and is credited toward approved repair work" : ""}.
                  </p>
                </div>
                <p className="text-xl font-bold text-[#ffc21c]">{formatCurrency(checkoutAmount)}</p>
              </div>
            </div>

            <label className="tap-target mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-[#0d202d] p-4">
              <input
                type="checkbox"
                checked={acceptedPolicy}
                onChange={(event) => setAcceptedPolicy(event.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 accent-[#ffc21c]"
              />
              <span className="text-sm leading-6 text-slate-300">
                I understand payment confirms the diagnostic visit. Canceling or rescheduling inside {bookingPage.free_reschedule_hours} hours may retain {formatCurrency(bookingPage.cancellation_fee_cents)}.
                I agree that {bookingPage.display_name} may contact me by phone or email about this request.
              </span>
            </label>

            {/*
              Text message consent is a separate, optional, unchecked box. Carrier
              review rejects a campaign whose opt-in is pre-checked, bundled with
              another agreement, or required to complete a purchase, so this box
              never gates the checkout button and carries the full disclosure.
            */}
            <label className="tap-target mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border border-white/10 bg-[#0d202d] p-4">
              <input
                type="checkbox"
                checked={smsConsent}
                onChange={(event) => setSmsConsent(event.target.checked)}
                className="mt-1 h-5 w-5 shrink-0 accent-[#ffc21c]"
              />
              <span className="text-sm leading-6 text-slate-300">
                <span className="flex items-center gap-2 font-semibold text-white">
                  <MessageSquare className="h-4 w-4 text-[#ffc21c]" aria-hidden />
                  Text me about this appointment <span className="font-normal text-slate-500">(optional)</span>
                </span>
                <span className="mt-2 block">{smsDisclosure}</span>
                <span className="mt-2 block text-xs text-slate-500">
                  See the{" "}
                  <a href={`/legal/${bookingPage.slug}/terms`} target="_blank" rel="noreferrer" className="text-[#ffc21c] underline">
                    Text Message Terms
                  </a>{" "}
                  and{" "}
                  <a href={`/legal/${bookingPage.slug}/privacy`} target="_blank" rel="noreferrer" className="text-[#ffc21c] underline">
                    Privacy Policy
                  </a>
                  . We never share your mobile number or messaging consent with third parties for marketing.
                </span>
              </span>
            </label>

            <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-500">
              <CreditCard className="h-4 w-4" aria-hidden /> Secure test payment powered by Stripe
            </div>
          </div>
        ) : null}

        {stepError ? (
          <p role="alert" className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/[0.07] p-4 text-sm text-red-200">
            {stepError}
          </p>
        ) : null}
        {actionState.error ? (
          <p role="alert" className="mt-5 rounded-2xl border border-red-400/20 bg-red-400/[0.07] p-4 text-sm leading-6 text-red-200">
            {actionState.error}
          </p>
        ) : null}
      </section>

      <div className="flex gap-3">
        {step > 1 ? (
          <button
            type="button"
            onClick={previousStep}
            className="tap-target flex min-h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-[#081925] text-white"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" aria-hidden />
          </button>
        ) : null}

        {step < 4 ? (
          <button
            type="button"
            onClick={nextStep}
            disabled={step === 2 && blockedSafetyOutcome}
            className="tap-target flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[#ffc21c] px-5 text-sm font-bold text-[#071723] disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            Continue <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        ) : (
          <div className="flex-1">
            <CheckoutButton
              amount={checkoutAmount}
              disabled={!selected || !acceptedPolicy || slotsByDay.length === 0}
            />
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-4 py-2 text-[11px] text-slate-600">
        <span className="flex items-center gap-1"><LockKeyhole className="h-3.5 w-3.5" aria-hidden /> Private</span>
        <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden /> Service-area checked</span>
        <span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" aria-hidden /> Live availability</span>
      </div>
    </form>
  );
}
