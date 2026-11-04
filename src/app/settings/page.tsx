import type { Metadata } from "next";

import { FieldPageShell } from "@/components/field-page-shell";
import { SettingsDirectory, type SettingsBadge } from "@/components/settings-directory";
import { SETTINGS_GROUPS } from "@/lib/navigation";
import { currentContext } from "@/lib/request-context";
import { paymentAccountFor } from "@/lib/stripe-connect";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const metadata: Metadata = { title: "Settings | Volteira" };

/**
 * One way in to everything you can change, in plain words.
 *
 * Grouped by what an electrician is trying to do (get paid, run the business,
 * text customers, hook up another app, change their own login), with a search
 * box over the lot, so nothing takes more than a few seconds to find.
 */
export default async function SettingsPage() {
  const context = await currentContext();
  const badges: Record<string, SettingsBadge> = {};

  if (context) {
    const account = await paymentAccountFor(context.organizationId, getSupabaseAdmin());
    badges["/settings/payments"] = account?.ready
      ? { text: "On", tone: "good" }
      : account
        ? { text: "Finish setup", tone: "warn" }
        : { text: "Not set up", tone: "warn" };
  }

  return (
    <FieldPageShell title="Settings" eyebrow="Setup" description="Everything you can change, in one place.">
      <SettingsDirectory groups={SETTINGS_GROUPS} badges={badges} />
    </FieldPageShell>
  );
}
