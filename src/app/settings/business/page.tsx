import { BusinessDetailsForm, type BusinessDetails } from "@/components/business-details-form";
import { FieldPageShell } from "@/components/field-page-shell";
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

  if (context) {
    const supabase = asFlexibleClient(await createClient());
    const { data } = await supabase
      .from("organizations")
      .select("name, phone, base_address_line_1, base_city, base_state, base_postal_code, timezone")
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
  }

  return (
    <FieldPageShell
      title="Business details"
      eyebrow="Settings"
      description="Name, phone, timezone and where you work from."
      backHref="/settings"
    >
      <BusinessDetailsForm details={details} />
    </FieldPageShell>
  );
}
