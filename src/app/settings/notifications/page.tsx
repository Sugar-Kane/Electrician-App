import type { Metadata } from "next";

import { FieldPageShell } from "@/components/field-page-shell";
import { OwnerNotificationForm } from "@/components/owner-notification-form";
import { formatForDisplay } from "@/lib/phone-format";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Booking alerts | Volteira" };

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

/**
 * Where this business hears about a booking it did not take itself.
 *
 * Read through the caller's session so RLS decides which organization they can
 * see — the same rule the other settings pages follow. A member with no
 * organization gets the empty state rather than a form that cannot save.
 */
export default async function BookingAlertsSettingsPage() {
  const supabase = asFlexibleClient(await createClient());

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  const organizationId = text(membership?.organization_id);

  const { data: organization } = organizationId
    ? await supabase
        .from("organizations")
        .select("owner_notification_email, owner_notification_phone")
        .eq("id", organizationId)
        .maybeSingle()
    : { data: null };

  const { data: messaging } = organizationId
    ? await supabase
        .from("messaging_settings")
        .select("a2p_registered_at")
        .eq("organization_id", organizationId)
        .maybeSingle()
    : { data: null };

  return (
    <FieldPageShell
      title="Booking alerts"
      eyebrow="Notifications"
      description="How you find out when the phone assistant books a job for you."
      active="More"
    >
      {organizationId ? (
        <OwnerNotificationForm
          organizationId={organizationId}
          email={text(organization?.owner_notification_email)}
          phone={formatForDisplay(text(organization?.owner_notification_phone))}
          textingBlocked={!messaging?.a2p_registered_at}
        />
      ) : (
        <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5 sm:p-6">
          <h2 className="text-lg font-semibold">No business workspace yet</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Finish setting up your business and this is where booking alerts are
            configured.
          </p>
        </section>
      )}
    </FieldPageShell>
  );
}
