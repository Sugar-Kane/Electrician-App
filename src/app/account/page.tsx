import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BellRing,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  CreditCard,
  ExternalLink,
  KeyRound,
  LockKeyhole,
  MapPinned,
  MonitorSmartphone,
  ShieldCheck,
  Store,
  Upload,
  UserRound,
  Zap,
} from "lucide-react";

import {
  openBillingPortal,
  removeAvatar,
  startPremiumCheckout,
  updatePassword,
  updatePreferences,
  updateProfile,
  updateSquareAccount,
  updateTimezone,
  uploadAvatar,
} from "@/app/account/actions";
import { FieldPageShell } from "@/components/field-page-shell";
import { getAccountSnapshot } from "@/lib/account";
import { currentTimeIn, timezoneLabel, TIMEZONE_OPTIONS } from "@/lib/timezones";

export const metadata: Metadata = { title: "Account | Volteira" };

const sections = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "timezone", label: "Timezone", icon: Clock3 },
  { id: "subscription", label: "Premium", icon: CreditCard },
  { id: "preferences", label: "App settings", icon: MonitorSmartphone },
  { id: "square", label: "Square", icon: Store },
  { id: "security", label: "Security", icon: LockKeyhole },
];

const inputClass =
  "mt-2 min-h-12 w-full rounded-xl border border-white/10 bg-[#0d202d] px-3.5 text-base text-white outline-none placeholder:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "block text-xs font-semibold text-slate-300";
const cardClass = "scroll-mt-24 rounded-3xl border border-white/10 bg-[#0b1b27] p-5 sm:p-6";

function titleCase(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function SettingToggle({
  name,
  title,
  description,
  defaultChecked,
}: {
  name: string;
  title: string;
  description: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-slate-400">{description}</span>
      </span>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-6 w-6 shrink-0 accent-[#ffc21c]"
      />
    </label>
  );
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{
    section?: string;
    saved?: string;
    error?: string;
    checkout?: string;
  }>;
}) {
  const [account, query] = await Promise.all([getAccountSnapshot(), searchParams]);
  if (account.requiresLogin) redirect("/login?next=/account");

  const activeSection = sections.some((section) => section.id === query.section)
    ? query.section
    : "profile";
  const subscriptionActive = ["active", "trialing", "past_due", "paused", "unpaid"].includes(
    account.subscription.status,
  );
  const avatarStyle = account.avatarUrl
    ? { backgroundImage: `url(${JSON.stringify(account.avatarUrl).slice(1, -1)})` }
    : undefined;
  const businessClock =
    currentTimeIn(account.businessTimezone) || timezoneLabel(account.businessTimezone);
  const periodEnd = account.subscription.currentPeriodEnd
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
        new Date(account.subscription.currentPeriodEnd),
      )
    : null;

  return (
    <FieldPageShell
      title="Account"
      eyebrow="User and business settings"
      description="Update your profile, control the app experience, manage Premium, and maintain payment-provider information."
      active="More"
    >
      <section className="mb-4 rounded-3xl border border-[#ffc21c]/20 bg-[#ffc21c]/[0.045] p-4 sm:p-5">
        <div className="flex items-center gap-4">
          <span
            className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-[#ffc21c] bg-cover bg-center text-xl font-bold text-[#071723] sm:h-20 sm:w-20"
            style={avatarStyle}
            role="img"
            aria-label={`${account.displayName} profile photo`}
          >
            {account.avatarUrl ? null : account.initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-semibold sm:text-2xl">{account.displayName}</p>
            <p className="mt-1 truncate text-sm text-slate-400">{account.email}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-slate-300">
                {titleCase(account.role)}
              </span>
              <span className="rounded-full bg-[#ffc21c]/10 px-2.5 py-1 text-[10px] font-semibold text-[#ffc21c]">
                {titleCase(account.subscription.plan)} plan
              </span>
            </div>
          </div>
        </div>
      </section>

      {query.saved ? (
        <p role="status" className="mb-4 flex items-start gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.07] p-4 text-sm text-emerald-200">
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {query.saved}
        </p>
      ) : null}
      {query.error ? (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-red-400/20 bg-red-400/[0.07] p-4 text-sm text-red-200">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {query.error}
        </p>
      ) : null}
      {query.checkout === "success" ? (
        <p role="status" className="mb-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.07] p-4 text-sm text-emerald-200">
          Premium checkout completed. Stripe is confirming the subscription now.
        </p>
      ) : null}

      <nav className="mb-4 flex gap-2 overflow-x-auto pb-1" aria-label="Account sections">
        {sections.map(({ id, label, icon: Icon }) => (
          <Link
            key={id}
            href={`/account?section=${id}#${id}`}
            className={`tap-target inline-flex shrink-0 items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold ${
              activeSection === id
                ? "border-[#ffc21c]/40 bg-[#ffc21c]/10 text-[#ffc21c]"
                : "border-white/10 bg-[#0b1b27] text-slate-300"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden /> {label}
          </Link>
        ))}
      </nav>

      <div className="space-y-4">
        <section id="profile" className={cardClass}>
          <div className="flex items-start gap-3">
            <CircleUserRound className="mt-0.5 h-5 w-5 shrink-0 text-[#ffc21c]" aria-hidden />
            <div>
              <h2 className="font-semibold">Profile details</h2>
              <p className="mt-1 text-xs leading-5 text-slate-400">Your name appears on assignments, activity, and customer-facing technician updates.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 border-b border-white/10 pb-5 lg:grid-cols-[1fr_auto] lg:items-end">
            <form action={uploadAvatar} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className={`${labelClass} flex-1`}>
                Profile photo
                <input
                  type="file"
                  name="avatar"
                  accept="image/jpeg,image/png,image/webp"
                  className={`${inputClass} cursor-pointer py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-[#ffc21c] file:px-3 file:py-2 file:text-xs file:font-semibold file:text-[#071723]`}
                  required
                />
              </label>
              <button type="submit" className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white/10 px-4 text-sm font-semibold hover:bg-white/15">
                <Upload className="h-4 w-4" aria-hidden /> Upload
              </button>
            </form>
            {account.avatarUrl ? (
              <form action={removeAvatar}>
                <button type="submit" className="tap-target min-h-12 rounded-xl border border-white/10 px-4 text-sm font-semibold text-slate-300">
                  Remove photo
                </button>
              </form>
            ) : null}
          </div>

          <form action={updateProfile} className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className={labelClass}>
              Full name
              <input className={inputClass} name="displayName" defaultValue={account.displayName} autoComplete="name" minLength={2} maxLength={120} required />
            </label>
            <label className={labelClass}>
              Job title
              <input className={inputClass} name="jobTitle" defaultValue={account.jobTitle} autoComplete="organization-title" maxLength={80} placeholder="Owner, dispatcher, electrician…" />
            </label>
            <label className={labelClass}>
              Email address
              <input className={inputClass} name="email" defaultValue={account.email} autoComplete="email" type="email" inputMode="email" maxLength={254} required />
              <span className="mt-2 block text-[10px] font-normal leading-4 text-slate-500">Changing email can require confirmation from both addresses.</span>
            </label>
            <label className={labelClass}>
              Phone
              <input className={inputClass} name="phone" defaultValue={account.phone} autoComplete="tel" inputMode="tel" maxLength={30} placeholder="(805) 555-0100" />
            </label>
            <div className="sm:col-span-2 sm:flex sm:justify-end">
              <button type="submit" className="tap-target min-h-12 w-full rounded-xl bg-[#ffc21c] px-5 text-sm font-semibold text-[#071723] sm:w-auto">
                Save profile
              </button>
            </div>
          </form>
        </section>

        <section id="timezone" className={cardClass}>
          <div className="flex items-start gap-3">
            <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-[#ffc21c]" aria-hidden />
            <div>
              <h2 className="font-semibold">Business timezone</h2>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                Schedules, arrival windows, message timestamps, and text-message quiet hours are all shown and sent in this timezone. It applies to everyone in the business.
              </p>
            </div>
          </div>

          <form action={updateTimezone} className="mt-5 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className={labelClass}>
              Timezone
              <select
                className={inputClass}
                name="timezone"
                defaultValue={account.businessTimezone}
                disabled={!account.canManageBusiness}
              >
                {TIMEZONE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="mt-2 block text-[10px] font-normal leading-4 text-slate-500">
                It is currently {businessClock} for the business.
              </span>
            </label>
            <button
              type="submit"
              disabled={!account.canManageBusiness}
              className="tap-target min-h-12 w-full rounded-xl bg-[#ffc21c] px-5 text-sm font-semibold text-[#071723] disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              Save timezone
            </button>
          </form>
          {!account.canManageBusiness ? (
            <p className="mt-4 text-xs text-slate-400">Only an owner or administrator can change the business timezone.</p>
          ) : null}
        </section>

        <section id="subscription" className={cardClass}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-[#ffc21c]" aria-hidden />
              <div>
                <h2 className="font-semibold">Premium subscription</h2>
                <p className="mt-1 text-xs leading-5 text-slate-400">Billing for Volteira is handled securely through Stripe. Square remains available for your customer payments.</p>
              </div>
            </div>
            <span className={`self-start rounded-full px-3 py-1.5 text-[10px] font-semibold ${subscriptionActive ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-slate-300"}`}>
              {titleCase(account.subscription.status)}
            </span>
          </div>

          <div className="mt-5 rounded-2xl border border-[#ffc21c]/20 bg-[#ffc21c]/[0.045] p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#ffc21c]">Current plan</p>
                <p className="mt-2 text-3xl font-semibold">{titleCase(account.subscription.plan)}</p>
                <p className="mt-2 text-xs text-slate-400">
                  {periodEnd ? `${account.subscription.cancelAtPeriodEnd ? "Access ends" : "Renews"} ${periodEnd}` : `${account.subscription.seats} user seat${account.subscription.seats === 1 ? "" : "s"}`}
                </p>
              </div>
              {account.canManageBusiness ? (
                account.subscription.stripeCustomerId ? (
                  <form action={openBillingPortal}>
                    <button type="submit" className="tap-target min-h-12 w-full rounded-xl bg-[#ffc21c] px-5 text-sm font-semibold text-[#071723] sm:w-auto">
                      Manage billing
                    </button>
                  </form>
                ) : (
                  <form action={startPremiumCheckout}>
                    <button type="submit" className="tap-target min-h-12 w-full rounded-xl bg-[#ffc21c] px-5 text-sm font-semibold text-[#071723] sm:w-auto">
                      Start Premium
                    </button>
                  </form>
                )
              ) : (
                <p className="max-w-xs text-xs leading-5 text-slate-400">Ask an owner or administrator to change the company subscription.</p>
              )}
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {["AI-assisted intake", "Route optimization", "Advanced automation"].map((feature) => (
              <p key={feature} className="flex min-h-11 items-center gap-2 rounded-xl bg-white/[0.03] px-3 text-xs text-slate-300">
                <Zap className="h-4 w-4 shrink-0 fill-[#ffc21c] text-[#ffc21c]" aria-hidden /> {feature}
              </p>
            ))}
          </div>
        </section>

        <section id="preferences" className={cardClass}>
          <div className="flex items-start gap-3">
            <MonitorSmartphone className="mt-0.5 h-5 w-5 shrink-0 text-[#ffc21c]" aria-hidden />
            <div>
              <h2 className="font-semibold">App settings</h2>
              <p className="mt-1 text-xs leading-5 text-slate-400">These preferences follow your login without changing settings for coworkers.</p>
            </div>
          </div>

          <form action={updatePreferences} className="mt-5 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={labelClass}>
                Appearance
                <select className={inputClass} name="theme" defaultValue={account.preferences.theme}>
                  <option value="system">Match device</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </label>
              <label className={labelClass}>
                Text size
                <select className={inputClass} name="textSize" defaultValue={account.preferences.textSize}>
                  <option value="standard">Standard</option>
                  <option value="large">Large</option>
                  <option value="extra_large">Extra large</option>
                </select>
              </label>
              <label className={labelClass}>
                Preferred maps app
                <select className={inputClass} name="defaultMapApp" defaultValue={account.preferences.defaultMapApp}>
                  <option value="system">Ask each time</option>
                  <option value="apple_maps">Apple Maps</option>
                  <option value="google_maps">Google Maps</option>
                </select>
              </label>
              <label className={labelClass}>
                Starting screen
                <select className={inputClass} name="defaultLandingPage" defaultValue={account.preferences.defaultLandingPage}>
                  <option value="dashboard">Dashboard</option>
                  <option value="schedule">Schedule</option>
                  <option value="jobs">Jobs</option>
                  <option value="route">Route builder</option>
                </select>
              </label>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-slate-300"><BellRing className="h-4 w-4 text-[#ffc21c]" aria-hidden /> Notifications</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <SettingToggle name="emailNotifications" title="Email" description="Billing, jobs, and account notices" defaultChecked={account.preferences.emailNotifications} />
                <SettingToggle name="smsNotifications" title="Text messages" description="Schedule and customer updates" defaultChecked={account.preferences.smsNotifications} />
                <SettingToggle name="pushNotifications" title="Push alerts" description="Urgent work and route changes" defaultChecked={account.preferences.pushNotifications} />
              </div>
            </div>

            <SettingToggle name="compactMode" title="Compact dashboard" description="Show more jobs and business information on each screen." defaultChecked={account.preferences.compactMode} />

            <div className="sm:flex sm:justify-end">
              <button type="submit" className="tap-target min-h-12 w-full rounded-xl bg-[#ffc21c] px-5 text-sm font-semibold text-[#071723] sm:w-auto">Save app settings</button>
            </div>
          </form>
        </section>

        <section id="square" className={cardClass}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <Store className="mt-0.5 h-5 w-5 shrink-0 text-[#ffc21c]" aria-hidden />
              <div>
                <h2 className="font-semibold">Square information</h2>
                <p className="mt-1 text-xs leading-5 text-slate-400">Choose the Square business and location Volteira should use when Square payment support is activated.</p>
              </div>
            </div>
            <span className={`self-start rounded-full px-3 py-1.5 text-[10px] font-semibold ${account.square.status === "connected" ? "bg-emerald-400/10 text-emerald-300" : account.square.status === "pending" ? "bg-amber-400/10 text-amber-300" : "bg-white/5 text-slate-300"}`}>
              {titleCase(account.square.status)}
            </span>
          </div>

          <div className="mt-4 rounded-2xl border border-blue-400/15 bg-blue-400/[0.045] p-4 text-xs leading-5 text-slate-300">
            Enter identifiers only—never paste a Square access token here. A future OAuth connection will verify the merchant and retrieve selectable locations securely.
          </div>

          <form action={updateSquareAccount} className="mt-5">
            <fieldset disabled={!account.canManageBusiness} className="grid gap-4 sm:grid-cols-2 disabled:opacity-65">
              <label className={labelClass}>
                Square business name
                <input className={inputClass} name="businessName" defaultValue={account.square.businessName} maxLength={160} placeholder={account.organizationName} />
              </label>
              <label className={labelClass}>
                Square account email
                <input className={inputClass} name="accountEmail" defaultValue={account.square.accountEmail} type="email" inputMode="email" maxLength={254} placeholder="owner@company.com" />
              </label>
              <label className={labelClass}>
                Merchant ID
                <input className={inputClass} name="merchantId" defaultValue={account.square.merchantId} maxLength={128} autoCapitalize="characters" placeholder="Square merchant ID" />
              </label>
              <label className={labelClass}>
                Default location ID
                <input className={inputClass} name="defaultLocationId" defaultValue={account.square.defaultLocationId} maxLength={128} autoCapitalize="characters" placeholder="Main Square location" />
              </label>
              <label className={labelClass}>
                Environment
                <select className={inputClass} name="environment" defaultValue={account.square.environment}>
                  <option value="production">Production</option>
                  <option value="sandbox">Sandbox testing</option>
                </select>
              </label>
              <label className={labelClass}>
                Currency
                <select className={inputClass} name="currency" defaultValue={account.square.currency}>
                  <option value="USD">USD — US Dollar</option>
                  <option value="CAD">CAD — Canadian Dollar</option>
                  <option value="AUD">AUD — Australian Dollar</option>
                  <option value="GBP">GBP — British Pound</option>
                </select>
              </label>
              <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                <a href="https://squareup.com/dashboard" target="_blank" rel="noreferrer" className="tap-target inline-flex min-h-12 items-center gap-2 text-sm font-semibold text-slate-300">
                  Open Square Dashboard <ExternalLink className="h-4 w-4" aria-hidden />
                </a>
                <button type="submit" className="tap-target min-h-12 rounded-xl bg-[#ffc21c] px-5 text-sm font-semibold text-[#071723]">Save Square information</button>
              </div>
            </fieldset>
          </form>
          {!account.canManageBusiness ? <p className="mt-4 text-xs text-slate-400">Only an owner or administrator can change Square information.</p> : null}
        </section>

        <section id="security" className={cardClass}>
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-[#ffc21c]" aria-hidden />
            <div>
              <h2 className="font-semibold">Password and security</h2>
              <p className="mt-1 text-xs leading-5 text-slate-400">Changing your password requires the current password for this login.</p>
            </div>
          </div>
          <form action={updatePassword} className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className={`${labelClass} sm:col-span-2`}>
              Current password
              <input className={inputClass} name="currentPassword" type="password" autoComplete="current-password" required />
            </label>
            <label className={labelClass}>
              New password
              <input className={inputClass} name="password" type="password" autoComplete="new-password" minLength={10} required />
            </label>
            <label className={labelClass}>
              Confirm new password
              <input className={inputClass} name="passwordConfirmation" type="password" autoComplete="new-password" minLength={10} required />
            </label>
            <div className="sm:col-span-2 sm:flex sm:justify-between sm:gap-4">
              <p className="flex items-center gap-2 text-xs leading-5 text-slate-400"><LockKeyhole className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden /> Passwords are managed by Supabase Auth and are never stored in the app database.</p>
              <button type="submit" className="tap-target mt-3 min-h-12 w-full rounded-xl border border-white/10 px-5 text-sm font-semibold sm:mt-0 sm:w-auto">Update password</button>
            </div>
          </form>
        </section>

        <Link href="/settings/integrations" className="tap-row flex min-h-16 items-center gap-3 rounded-2xl border border-white/10 bg-[#0b1b27] px-4 py-3">
          <MapPinned className="h-5 w-5 shrink-0 text-[#ffc21c]" aria-hidden />
          <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">Business integrations</span><span className="block truncate text-[11px] text-slate-400">Lowe’s, Home Depot, cloud storage, and future connections</span></span>
          <ChevronRight className="h-5 w-5 shrink-0 text-slate-500" aria-hidden />
        </Link>
      </div>
    </FieldPageShell>
  );
}
