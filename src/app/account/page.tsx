import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BellRing,
  CircleUserRound,
  CreditCard,
  KeyRound,
  LockKeyhole,
  MonitorSmartphone,
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
  uploadAvatar,
} from "@/app/account/actions";
import { Banner } from "@/components/ui/banner";
import { SelectField } from "@/components/ui/select-field";
import { FieldPageShell } from "@/components/field-page-shell";
import { getAccountSnapshot } from "@/lib/account";
import { aiUsageSummary } from "@/lib/ai-allowance";
import { premiumPriceLabel } from "@/lib/premium-price";

export const metadata: Metadata = { title: "My account | Volteira" };

// Only what is about you. Business settings (timezone, payments, apps) live
// in Settings, one tap away, rather than repeated here.
const sections = [
  { id: "profile", label: "Profile", icon: UserRound },
  { id: "preferences", label: "Look and alerts", icon: MonitorSmartphone },
  { id: "security", label: "Password", icon: LockKeyhole },
  { id: "subscription", label: "Plan", icon: CreditCard },
];

const inputClass =
  "mt-2 min-h-12 w-full rounded-chip border border-line bg-raised px-3.5 text-base text-white outline-none placeholder:text-ink-faint disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "block text-xs font-semibold text-ink-muted";
const cardClass = "scroll-mt-24 rounded-panel border border-line bg-surface p-5 sm:p-6";

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
    <label className="flex min-h-16 cursor-pointer items-center gap-3 rounded-control border border-line bg-white/[0.025] px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-ink-muted">{description}</span>
      </span>
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="h-6 w-6 shrink-0 accent-brand"
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
  // Membership is free until a monthly price is set in Stripe and named in
  // STRIPE_PREMIUM_PRICE_ID; then the Start Premium button charges it.
  const membershipPriced = Boolean(process.env.STRIPE_PREMIUM_PRICE_ID);
  const [aiUsage, premiumPrice] = await Promise.all([
    account.organizationId ? aiUsageSummary(account.organizationId) : Promise.resolve(null),
    membershipPriced ? premiumPriceLabel() : Promise.resolve(null),
  ]);
  const subscriptionActive = ["active", "trialing", "past_due", "paused", "unpaid"].includes(
    account.subscription.status,
  );
  const avatarStyle = account.avatarUrl
    ? { backgroundImage: `url(${JSON.stringify(account.avatarUrl).slice(1, -1)})` }
    : undefined;
  const periodEnd = account.subscription.currentPeriodEnd
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(
        new Date(account.subscription.currentPeriodEnd),
      )
    : null;

  return (
    <FieldPageShell
      title="My account"
      eyebrow="Just for you"
      description="Your profile, how the app looks, your password and your Volteira plan."
    >
      <section className="mb-4 rounded-panel border border-brand/20 bg-brand/[0.045] p-4 sm:p-5">
        <div className="flex items-center gap-4">
          <span
            className="grid h-16 w-16 shrink-0 place-items-center rounded-control bg-brand bg-cover bg-center text-xl font-bold text-on-brand sm:h-20 sm:w-20"
            style={avatarStyle}
            role="img"
            aria-label={`${account.displayName} profile photo`}
          >
            {account.avatarUrl ? null : account.initials}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-semibold sm:text-2xl">{account.displayName}</p>
            <p className="mt-1 truncate text-sm text-ink-muted">{account.email}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-ink-muted">
                {titleCase(account.role)}
              </span>
              <span className="rounded-full bg-brand/10 px-2.5 py-1 text-[10px] font-semibold text-brand">
                {titleCase(account.subscription.plan)} plan
              </span>
            </div>
          </div>
        </div>
      </section>

      {query.saved ? (
        <Banner tone="positive" className="mb-4">
          {query.saved}
        </Banner>
      ) : null}
      {query.error ? (
        <Banner tone="critical" className="mb-4">
          {query.error}
        </Banner>
      ) : null}
      {query.checkout === "success" ? (
        <Banner tone="positive" icon={false} className="mb-4">
          Premium checkout completed. Stripe is confirming the subscription now.
        </Banner>
      ) : null}

      <nav className="mb-4 flex gap-2 overflow-x-auto pb-1" aria-label="Account sections">
        {sections.map(({ id, label, icon: Icon }) => (
          <Link
            key={id}
            href={`/account?section=${id}#${id}`}
            className={`tap-target inline-flex shrink-0 items-center gap-2 rounded-chip border px-3.5 text-xs font-semibold ${
              activeSection === id
                ? "border-brand/40 bg-brand/10 text-brand"
                : "border-line bg-surface text-ink-muted"
            }`}
          >
            <Icon className="h-4 w-4" aria-hidden /> {label}
          </Link>
        ))}
      </nav>

      <div className="space-y-4">
        <section id="profile" className={cardClass}>
          <div className="flex items-start gap-3">
            <CircleUserRound className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
            <div>
              <h2 className="font-semibold">My profile</h2>
              <p className="mt-1 text-xs leading-5 text-ink-muted">Your name appears on assignments, activity, and customer-facing technician updates.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 border-b border-line pb-5 lg:grid-cols-[1fr_auto] lg:items-end">
            <form action={uploadAvatar} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className={`${labelClass} flex-1`}>
                Profile photo
                <input
                  type="file"
                  name="avatar"
                  accept="image/jpeg,image/png,image/webp"
                  className={`${inputClass} cursor-pointer py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand file:px-3 file:py-2 file:text-xs file:font-semibold file:text-on-brand`}
                  required
                />
              </label>
              <button type="submit" className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-chip bg-white/10 px-4 text-sm font-semibold hover:bg-white/15">
                <Upload className="h-4 w-4" aria-hidden /> Upload
              </button>
            </form>
            {account.avatarUrl ? (
              <form action={removeAvatar}>
                <button type="submit" className="tap-target min-h-12 rounded-chip border border-line px-4 text-sm font-semibold text-ink-muted">
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
              <span className="mt-2 block text-[10px] font-normal leading-4 text-ink-faint">Changing email can require confirmation from both addresses.</span>
            </label>
            <label className={labelClass}>
              Phone
              <input className={inputClass} name="phone" defaultValue={account.phone} autoComplete="tel" inputMode="tel" maxLength={30} placeholder="(805) 555-0100" />
            </label>
            <div className="sm:col-span-2 sm:flex sm:justify-end">
              <button type="submit" className="tap-target min-h-12 w-full rounded-chip bg-brand px-5 text-sm font-semibold text-on-brand sm:w-auto">
                Save profile
              </button>
            </div>
          </form>
        </section>

        <section id="subscription" className={cardClass}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <CreditCard className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
              <div>
                <h2 className="font-semibold">Volteira plan</h2>
                <p className="mt-1 text-xs leading-5 text-ink-muted">What you pay for Volteira itself. To take payments from customers, go to Settings → Get paid online.</p>
              </div>
            </div>
            <span className={`self-start rounded-full px-3 py-1.5 text-[10px] font-semibold ${subscriptionActive ? "bg-positive-bg text-positive" : "bg-white/5 text-ink-muted"}`}>
              {titleCase(account.subscription.status)}
            </span>
          </div>

          <div className="mt-5 rounded-control border border-brand/20 bg-brand/[0.045] p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">Current plan</p>
                <p className="mt-2 text-3xl font-semibold">
                  {!membershipPriced && !subscriptionActive ? "Free" : titleCase(account.subscription.plan)}
                </p>
                <p className="mt-2 text-xs text-ink-muted">
                  {!membershipPriced && !subscriptionActive
                    ? "Everything is included at no charge, with a monthly allowance of built-in AI."
                    : periodEnd
                      ? `${account.subscription.cancelAtPeriodEnd ? "Access ends" : "Renews"} ${periodEnd}`
                      : `${account.subscription.seats} user seat${account.subscription.seats === 1 ? "" : "s"}`}
                </p>
              </div>
              {!membershipPriced && !account.subscription.stripeCustomerId ? null : account.canManageBusiness ? (
                account.subscription.stripeCustomerId ? (
                  <form action={openBillingPortal}>
                    <button type="submit" className="tap-target min-h-12 w-full rounded-chip bg-brand px-5 text-sm font-semibold text-on-brand sm:w-auto">
                      Manage billing
                    </button>
                  </form>
                ) : (
                  <form action={startPremiumCheckout}>
                    <button type="submit" className="tap-target min-h-12 w-full rounded-chip bg-brand px-5 text-sm font-semibold text-on-brand sm:w-auto">
                      {premiumPrice ? `Start Premium · ${premiumPrice}` : "Start Premium"}
                    </button>
                  </form>
                )
              ) : (
                <p className="max-w-xs text-xs leading-5 text-ink-muted">Ask an owner or administrator to change the company subscription.</p>
              )}
            </div>
          </div>

          {aiUsage ? (
            <div className="mt-4 rounded-control border border-line p-4">
              <p className="text-sm font-semibold">Built-in AI this month</p>
              <p className="mt-1 text-sm text-ink-muted">
                {aiUsage.limit === "unlimited"
                  ? `${aiUsage.used} used. Unlimited on your plan.`
                  : `${aiUsage.used} of ${aiUsage.limit} used. Resets on the 1st.`}
              </p>
              {aiUsage.limit !== "unlimited" ? (
                <p className="mt-2 text-xs leading-5 text-ink-muted">
                  {membershipPriced
                    ? `Premium${premiumPrice ? ` (${premiumPrice})` : ""} includes unlimited built-in AI. `
                    : ""}
                  Using Volteira in ChatGPT or Claude is always unlimited and free:{" "}
                  <Link href="/settings/chatgpt" className="font-semibold text-brand">Settings → Use in ChatGPT</Link>.
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {["Unlimited built-in AI", "Route optimization", "Advanced automation"].map((feature) => (
              <p key={feature} className="flex min-h-11 items-center gap-2 rounded-chip bg-white/[0.03] px-3 text-xs text-ink-muted">
                <Zap className="h-4 w-4 shrink-0 fill-brand text-brand" aria-hidden /> {feature}
              </p>
            ))}
          </div>
        </section>

        <section id="preferences" className={cardClass}>
          <div className="flex items-start gap-3">
            <MonitorSmartphone className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
            <div>
              <h2 className="font-semibold">Look and alerts</h2>
              <p className="mt-1 text-xs leading-5 text-ink-muted">These preferences follow your login without changing settings for coworkers.</p>
            </div>
          </div>

          <form action={updatePreferences} className="mt-5 space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={labelClass}>
                Appearance
                <span className="mt-2 block">
                  <SelectField name="theme" defaultValue={account.preferences.theme} label="Appearance" choices={[{ value: "system", label: "Match device" }, { value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
                </span>
              </label>
              <label className={labelClass}>
                Text size
                <span className="mt-2 block">
                  <SelectField name="textSize" defaultValue={account.preferences.textSize} label="Text size" choices={[{ value: "standard", label: "Standard" }, { value: "large", label: "Large" }, { value: "extra_large", label: "Extra large" }]} />
                </span>
              </label>
              <label className={labelClass}>
                Preferred maps app
                <span className="mt-2 block">
                  <SelectField name="defaultMapApp" defaultValue={account.preferences.defaultMapApp} label="Preferred maps app" choices={[{ value: "system", label: "Ask each time" }, { value: "apple_maps", label: "Apple Maps" }, { value: "google_maps", label: "Google Maps" }]} />
                </span>
              </label>
              <label className={labelClass}>
                Starting screen
                <span className="mt-2 block">
                  <SelectField name="defaultLandingPage" defaultValue={account.preferences.defaultLandingPage} label="Starting screen" choices={[{ value: "dashboard", label: "Dashboard" }, { value: "schedule", label: "Schedule" }, { value: "jobs", label: "Jobs" }, { value: "route", label: "Today's route" }]} />
                </span>
              </label>
            </div>

            <div>
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink-muted"><BellRing className="h-4 w-4 text-brand" aria-hidden /> Notifications</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <SettingToggle name="emailNotifications" title="Email" description="Billing, jobs, and account notices" defaultChecked={account.preferences.emailNotifications} />
                <SettingToggle name="smsNotifications" title="Text messages" description="Schedule and customer updates" defaultChecked={account.preferences.smsNotifications} />
                <SettingToggle name="pushNotifications" title="Push alerts" description="Urgent work and route changes" defaultChecked={account.preferences.pushNotifications} />
              </div>
            </div>

            <SettingToggle name="compactMode" title="Compact dashboard" description="Show more jobs and business information on each screen." defaultChecked={account.preferences.compactMode} />

            <div className="sm:flex sm:justify-end">
              <button type="submit" className="tap-target min-h-12 w-full rounded-chip bg-brand px-5 text-sm font-semibold text-on-brand sm:w-auto">Save</button>
            </div>
          </form>
        </section>

        <section id="security" className={cardClass}>
          <div className="flex items-start gap-3">
            <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
            <div>
              <h2 className="font-semibold">Password</h2>
              <p className="mt-1 text-xs leading-5 text-ink-muted">Changing your password requires the current password for this login.</p>
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
              <p className="flex items-center gap-2 text-xs leading-5 text-ink-muted"><LockKeyhole className="h-4 w-4 shrink-0 text-positive" aria-hidden /> At least 10 characters.</p>
              <button type="submit" className="tap-target mt-3 min-h-12 w-full rounded-chip border border-line px-5 text-sm font-semibold sm:mt-0 sm:w-auto">Update password</button>
            </div>
          </form>
        </section>

      </div>
    </FieldPageShell>
  );
}
