import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";

export type AccountSnapshot = {
  source: "demo" | "supabase";
  requiresLogin: boolean;
  userId: string | null;
  organizationId: string | null;
  organizationName: string;
  displayName: string;
  email: string;
  phone: string;
  jobTitle: string;
  avatarUrl: string | null;
  timezone: string;
  role: string;
  initials: string;
  canManageBusiness: boolean;
  preferences: {
    theme: "system" | "light" | "dark";
    textSize: "standard" | "large" | "extra_large";
    compactMode: boolean;
    emailNotifications: boolean;
    smsNotifications: boolean;
    pushNotifications: boolean;
    defaultMapApp: "system" | "google_maps" | "apple_maps";
    defaultLandingPage: "dashboard" | "schedule" | "jobs" | "route";
  };
  subscription: {
    plan: string;
    status: string;
    seats: number;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    stripeCustomerId: string | null;
  };
  square: {
    status: string;
    environment: "sandbox" | "production";
    merchantId: string;
    defaultLocationId: string;
    businessName: string;
    accountEmail: string;
    currency: string;
    lastVerifiedAt: string | null;
  };
};

const defaultPreferences: AccountSnapshot["preferences"] = {
  theme: "system",
  textSize: "standard",
  compactMode: false,
  emailNotifications: true,
  smsNotifications: true,
  pushNotifications: true,
  defaultMapApp: "system",
  defaultLandingPage: "dashboard",
};

const demoAccount: AccountSnapshot = {
  source: "demo",
  requiresLogin: false,
  userId: null,
  organizationId: null,
  organizationName: "Pacific Plains Electric",
  displayName: "Adam Kane",
  email: "adam@pacificplainselectric.com",
  phone: "(805) 555-0148",
  jobTitle: "Owner",
  avatarUrl: null,
  timezone: "America/Los_Angeles",
  role: "owner",
  initials: "AK",
  canManageBusiness: true,
  preferences: defaultPreferences,
  subscription: {
    plan: "starter",
    status: "inactive",
    seats: 1,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    stripeCustomerId: null,
  },
  square: {
    status: "not_connected",
    environment: "production",
    merchantId: "",
    defaultLocationId: "",
    businessName: "Pacific Plains Electric",
    accountEmail: "",
    currency: "USD",
    lastVerifiedAt: null,
  },
};

function initialsFor(name: string, email: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return initials || email[0]?.toUpperCase() || "U";
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" ? value : fallback;
}

function hasSupabaseEnvironment() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export async function getAccountSnapshot(): Promise<AccountSnapshot> {
  if (!hasSupabaseEnvironment()) return demoAccount;

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) return { ...demoAccount, source: "supabase", requiresLogin: true };

  const database = asFlexibleClient(supabase);
  const membershipResult = await database
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  const membership = membershipResult.data;
  const organizationId = text(membership?.organization_id) || null;
  const role = text(membership?.role, "member");

  const [profileResult, organizationResult, preferencesResult, subscriptionResult, squareResult] =
    await Promise.all([
      database.from("user_profiles").select("*").eq("user_id", user.id).maybeSingle(),
      organizationId
        ? database.from("organizations").select("name").eq("id", organizationId).maybeSingle()
        : Promise.resolve({ data: null }),
      organizationId
        ? database
            .from("user_preferences")
            .select("*")
            .eq("user_id", user.id)
            .eq("organization_id", organizationId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      organizationId
        ? database
            .from("organization_subscriptions")
            .select("*")
            .eq("organization_id", organizationId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      organizationId
        ? database
            .from("square_payment_accounts")
            .select("*")
            .eq("organization_id", organizationId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const metadataName = text(user.user_metadata.full_name) || text(user.user_metadata.name);
  const email = user.email ?? "Signed-in account";
  const profile = profileResult.data as Record<string, unknown> | null;
  const organization = organizationResult.data as Record<string, unknown> | null;
  const preference = preferencesResult.data as Record<string, unknown> | null;
  const subscription = subscriptionResult.data as Record<string, unknown> | null;
  const square = squareResult.data as Record<string, unknown> | null;
  const displayName =
    text(profile?.display_name) ||
    metadataName ||
    email.split("@")[0] ||
    "Account user";
  const organizationName = text(organization?.name, "Your business");
  let avatarUrl = text(profile?.avatar_url) || null;
  const avatarPath = text(profile?.avatar_path);
  if (avatarPath) {
    try {
      const signedAvatar = await getSupabaseAdmin().storage
        .from("profile-avatars")
        .createSignedUrl(avatarPath, 60 * 60);
      avatarUrl = signedAvatar.data?.signedUrl ?? avatarUrl;
    } catch {
      // Initials remain available when private avatar storage is not configured.
    }
  }

  return {
    source: "supabase",
    requiresLogin: false,
    userId: user.id,
    organizationId,
    organizationName,
    displayName,
    email,
    phone: text(profile?.phone),
    jobTitle: text(profile?.job_title, role === "owner" ? "Owner" : "Team member"),
    avatarUrl,
    timezone: text(profile?.timezone, "America/Los_Angeles"),
    role,
    initials: initialsFor(displayName, email),
    canManageBusiness: role === "owner" || role === "admin",
    preferences: {
      theme: text(preference?.theme, defaultPreferences.theme) as AccountSnapshot["preferences"]["theme"],
      textSize: text(preference?.text_size, defaultPreferences.textSize) as AccountSnapshot["preferences"]["textSize"],
      compactMode: bool(preference?.compact_mode, defaultPreferences.compactMode),
      emailNotifications: bool(
        preference?.email_notifications,
        defaultPreferences.emailNotifications,
      ),
      smsNotifications: bool(
        preference?.sms_notifications,
        defaultPreferences.smsNotifications,
      ),
      pushNotifications: bool(
        preference?.push_notifications,
        defaultPreferences.pushNotifications,
      ),
      defaultMapApp: text(
        preference?.default_map_app,
        defaultPreferences.defaultMapApp,
      ) as AccountSnapshot["preferences"]["defaultMapApp"],
      defaultLandingPage: text(
        preference?.default_landing_page,
        defaultPreferences.defaultLandingPage,
      ) as AccountSnapshot["preferences"]["defaultLandingPage"],
    },
    subscription: {
      plan: text(subscription?.plan, "starter"),
      status: text(subscription?.status, "inactive"),
      seats: numberValue(subscription?.seats, 1),
      currentPeriodEnd: text(subscription?.current_period_end) || null,
      cancelAtPeriodEnd: bool(subscription?.cancel_at_period_end, false),
      stripeCustomerId: text(subscription?.stripe_customer_id) || null,
    },
    square: {
      status: text(square?.status, "not_connected"),
      environment: text(square?.environment, "production") as "sandbox" | "production",
      merchantId: text(square?.merchant_id),
      defaultLocationId: text(square?.default_location_id),
      businessName: text(square?.business_name, organizationName),
      accountEmail: text(square?.account_email),
      currency: text(square?.currency, "USD"),
      lastVerifiedAt: text(square?.last_verified_at) || null,
    },
  };
}

export function getDemoAccountSnapshot() {
  return demoAccount;
}
