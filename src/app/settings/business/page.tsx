import Link from "next/link";
import { ChevronRight, Clock } from "lucide-react";

import { BookingPageSettings, type BookingDomain } from "@/components/booking-page-settings";
import { BusinessDetailsForm, type BusinessDetails } from "@/components/business-details-form";
import { FieldPageShell } from "@/components/field-page-shell";
import { logoUrl } from "@/lib/branding-storage";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { DEFAULT_TIMEZONE } from "@/lib/timezones";

export const dynamic = "force-dynamic";

/**
 * The business's own details.
 *
 * The settings menu has linked here since the menu was built, and the page did
 * not exist — so the one visible route to correcting a business name or phone
 * number was a 404, and those could only ever be set during onboarding.
 */
export default async function BusinessSettingsPage() {
  const context = await currentContext();

  const empty: BusinessDetails = {
    name: "",
    phone: "",
    addressLine1: "",
    city: "",
    state: "",
    postalCode: "",
    timezone: DEFAULT_TIMEZONE,
  };

  let details = empty;
  let logo = "";
  let brandColor = "";
  let domains: BookingDomain[] = [];
  let bookingUrl = "";

  // The same rule the account page has always used. RLS is what actually
  // refuses the write; this only stops somebody filling in a form that was
  // never going to save.
  const canManage = context?.role === "owner" || context?.role === "admin";

  if (context) {
    const supabase = asFlexibleClient(await createClient());
    const { data } = await supabase
      .from("organizations")
      .select(
        "name, phone, base_address_line_1, base_city, base_state, base_postal_code, timezone, slug, logo_path, brand_color",
      )
      .eq("id", context.organizationId)
      .maybeSingle();

    const row = (data ?? {}) as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === "string" ? value : "");

    details = {
      name: text(row.name),
      phone: text(row.phone),
      addressLine1: text(row.base_address_line_1),
      city: text(row.base_city),
      state: text(row.base_state),
      postalCode: text(row.base_postal_code),
      timezone: text(row.timezone) || DEFAULT_TIMEZONE,
    };

    logo = logoUrl(text(row.logo_path));
    brandColor = text(row.brand_color);

    const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
    const slug = text(row.slug);
    bookingUrl = origin && slug ? `${origin}/book/${slug}` : "";

    const { data: domainRows } = await supabase
      .from("organization_domains")
      .select("id, hostname, verified_at")
      .eq("organization_id", context.organizationId)
      .order("created_at", { ascending: true });

    domains = ((domainRows ?? []) as Record<string, unknown>[]).map((domainRow) => ({
      id: text(domainRow.id),
      hostname: text(domainRow.hostname),
      verifiedAt: text(domainRow.verified_at),
    }));
  }

  return (
    <FieldPageShell
      title="Business details"
      eyebrow="Settings"
      description="Name, phone, timezone and where you work from."
      backHref="/settings"
    >
      <BusinessDetailsForm details={details} canManage={canManage} />

      {/*
        A pointer, not a second copy of the form. Opening hours change what
        customers are offered, so they live with everything else that does —
        beside the crew, their hours and the days the business is shut.
      */}
      {canManage ? (
        <Link
          href="/technicians"
          className="tap-row mt-3 flex min-h-14 items-center gap-3 rounded-panel border border-line bg-surface px-4"
        >
          <Clock className="h-5 w-5 shrink-0 text-brand" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Opening hours and closures</span>
            <span className="block truncate text-xs text-ink-muted">
              On the Electricians page, with the crew&rsquo;s hours
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
        </Link>
      ) : null}

      {canManage ? (
        <div className="mt-3">
          <BookingPageSettings
            logo={logo}
            brandColor={brandColor}
            domains={domains}
            bookingUrl={bookingUrl}
          />
        </div>
      ) : null}
    </FieldPageShell>
  );
}
