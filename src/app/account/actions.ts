"use server";

import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { isSupportedTimezone, timezoneLabel } from "@/lib/timezones";

type AccountContext = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  database: ReturnType<typeof asFlexibleClient>;
  user: User;
  organizationId: string | null;
  role: string;
};

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function checkbox(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function accountUrl(section: string, parameter: string, message: string) {
  const query = new URLSearchParams({ section, [parameter]: message });
  return `/account?${query.toString()}#${section}`;
}

function appUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return configured && /^https?:\/\//.test(configured)
    ? configured
    : "http://localhost:3000";
}

async function getAccountContext(): Promise<AccountContext | null> {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return null;

  const database = asFlexibleClient(supabase);
  const { data: membership } = await database
    .from("organization_members")
    .select("organization_id,role")
    .eq("user_id", authData.user.id)
    .limit(1)
    .maybeSingle();

  return {
    supabase,
    database,
    user: authData.user,
    organizationId:
      typeof membership?.organization_id === "string" ? membership.organization_id : null,
    role: typeof membership?.role === "string" ? membership.role : "member",
  };
}

function canManageBusiness(context: AccountContext) {
  return context.role === "owner" || context.role === "admin";
}

export async function updateProfile(formData: FormData) {
  const context = await getAccountContext();
  if (!context) redirect("/login?next=/account");

  const displayName = value(formData, "displayName");
  const email = value(formData, "email").toLowerCase();
  const phone = value(formData, "phone");
  const jobTitle = value(formData, "jobTitle");

  if (displayName.length < 2 || displayName.length > 120) {
    redirect(accountUrl("profile", "error", "Enter a name between 2 and 120 characters."));
  }
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) {
    redirect(accountUrl("profile", "error", "Enter a valid email address."));
  }
  if (phone && (phone.replace(/\D/g, "").length < 7 || phone.length > 30)) {
    redirect(accountUrl("profile", "error", "Enter a valid phone number."));
  }
  if (jobTitle && (jobTitle.length < 2 || jobTitle.length > 80)) {
    redirect(accountUrl("profile", "error", "Enter a job title between 2 and 80 characters."));
  }

  if (email !== context.user.email?.toLowerCase()) {
    const { error } = await context.supabase.auth.updateUser({ email });
    if (error) {
      redirect(accountUrl("profile", "error", "We couldn’t start the email change. Try again."));
    }
  }

  const { error } = await context.database.from("user_profiles").upsert(
    {
      user_id: context.user.id,
      display_name: displayName,
      phone: phone || null,
      job_title: jobTitle || null,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    redirect(accountUrl("profile", "error", "Your profile could not be saved."));
  }

  await context.supabase.auth.updateUser({
    data: { ...context.user.user_metadata, full_name: displayName },
  });
  if (context.organizationId) {
    await context.database
      .from("technicians")
      .update({ display_name: displayName })
      .eq("organization_id", context.organizationId)
      .eq("user_id", context.user.id);
  }

  revalidatePath("/");
  revalidatePath("/account");
  const message =
    email !== context.user.email?.toLowerCase()
      ? "Profile saved. Check both email addresses to confirm the email change."
      : "Profile saved.";
  redirect(accountUrl("profile", "saved", message));
}

/**
 * Set the business timezone.
 *
 * `organizations.timezone` is what quiet hours, arrival windows, message
 * timestamps and the schedule are rendered in, so this is a business setting
 * rather than a personal one — a crew that disagreed about what "today" means
 * would send customers conflicting arrival times. The user's own
 * `user_profiles.timezone` is kept in step so the two never drift apart.
 */
export async function updateTimezone(formData: FormData) {
  const context = await getAccountContext();
  if (!context) redirect("/login?next=/account");
  if (!context.organizationId || !canManageBusiness(context)) {
    redirect(accountUrl("timezone", "error", "Only an owner or administrator can change the business timezone."));
  }

  const timezone = value(formData, "timezone");
  if (!isSupportedTimezone(timezone)) {
    redirect(accountUrl("timezone", "error", "Choose a timezone from the list."));
  }

  const { error } = await context.database
    .from("organizations")
    .update({ timezone })
    .eq("id", context.organizationId);
  if (error) {
    redirect(accountUrl("timezone", "error", "The business timezone could not be saved."));
  }

  // An update rather than an upsert: user_profiles.display_name is required, and
  // a personal timezone is not worth inventing a profile row for.
  await context.database
    .from("user_profiles")
    .update({ timezone })
    .eq("user_id", context.user.id);

  // Every dated screen reads this, so none of them may keep a stale render.
  revalidatePath("/", "layout");
  redirect(
    accountUrl("timezone", "saved", `Business timezone set to ${timezoneLabel(timezone)}.`),
  );
}

export async function uploadAvatar(formData: FormData) {
  const context = await getAccountContext();
  if (!context) redirect("/login?next=/account");

  const avatar = formData.get("avatar");
  if (!(avatar instanceof File) || avatar.size === 0) {
    redirect(accountUrl("profile", "error", "Choose a profile photo first."));
  }

  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const extension = extensions[avatar.type];
  if (!extension || avatar.size > 5 * 1024 * 1024) {
    redirect(accountUrl("profile", "error", "Use a JPG, PNG, or WebP image under 5 MB."));
  }

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch {
    redirect(accountUrl("profile", "error", "Photo storage is not configured yet."));
  }

  const bucketName = "profile-avatars";
  const bucketResult = await admin.storage.getBucket(bucketName);
  if (!bucketResult.data) {
    const created = await admin.storage.createBucket(bucketName, {
      public: false,
      fileSizeLimit: 5 * 1024 * 1024,
      allowedMimeTypes: Object.keys(extensions),
    });
    if (created.error && !created.error.message.toLowerCase().includes("already exists")) {
      redirect(accountUrl("profile", "error", "The profile photo bucket could not be prepared."));
    }
  }

  const path = `${context.user.id}/${randomUUID()}.${extension}`;
  const uploadResult = await admin.storage
    .from(bucketName)
    .upload(path, Buffer.from(await avatar.arrayBuffer()), {
      contentType: avatar.type,
      upsert: false,
    });
  if (uploadResult.error) {
    redirect(accountUrl("profile", "error", "The profile photo could not be uploaded."));
  }

  const existing = await context.database
    .from("user_profiles")
    .select("avatar_path,display_name")
    .eq("user_id", context.user.id)
    .maybeSingle();
  const candidateName =
    typeof existing.data?.display_name === "string"
      ? existing.data.display_name
      : context.user.email?.split("@")[0] || "Account user";
  const displayName = candidateName.length >= 2 ? candidateName : "Account user";
  const saved = await context.database.from("user_profiles").upsert(
    {
      user_id: context.user.id,
      display_name: displayName,
      avatar_url: null,
      avatar_path: path,
    },
    { onConflict: "user_id" },
  );
  if (saved.error) {
    await admin.storage.from(bucketName).remove([path]);
    redirect(accountUrl("profile", "error", "The profile photo could not be attached to your account."));
  }

  if (typeof existing.data?.avatar_path === "string") {
    await admin.storage.from(bucketName).remove([existing.data.avatar_path]);
  }

  revalidatePath("/account");
  revalidatePath("/");
  redirect(accountUrl("profile", "saved", "Profile photo updated."));
}

export async function removeAvatar() {
  const context = await getAccountContext();
  if (!context) redirect("/login?next=/account");

  const existing = await context.database
    .from("user_profiles")
    .select("avatar_path")
    .eq("user_id", context.user.id)
    .maybeSingle();
  const updated = await context.database
    .from("user_profiles")
    .update({ avatar_url: null, avatar_path: null })
    .eq("user_id", context.user.id);
  if (updated.error) {
    redirect(accountUrl("profile", "error", "The profile photo could not be removed."));
  }

  if (typeof existing.data?.avatar_path === "string") {
    try {
      await getSupabaseAdmin().storage
        .from("profile-avatars")
        .remove([existing.data.avatar_path]);
    } catch {
      // The database change is complete even if an old object cannot be cleaned up.
    }
  }

  revalidatePath("/account");
  revalidatePath("/");
  redirect(accountUrl("profile", "saved", "Profile photo removed."));
}

export async function updatePreferences(formData: FormData) {
  const context = await getAccountContext();
  if (!context) redirect("/login?next=/account");
  if (!context.organizationId) {
    redirect(accountUrl("preferences", "error", "Finish business setup before saving app settings."));
  }

  const theme = value(formData, "theme");
  const textSize = value(formData, "textSize");
  const defaultMapApp = value(formData, "defaultMapApp");
  const defaultLandingPage = value(formData, "defaultLandingPage");
  if (!["system", "light", "dark"].includes(theme)) {
    redirect(accountUrl("preferences", "error", "Choose a valid appearance setting."));
  }
  if (!["standard", "large", "extra_large"].includes(textSize)) {
    redirect(accountUrl("preferences", "error", "Choose a valid text size."));
  }
  if (!["system", "google_maps", "apple_maps"].includes(defaultMapApp)) {
    redirect(accountUrl("preferences", "error", "Choose a valid maps preference."));
  }
  if (!["dashboard", "schedule", "jobs", "route"].includes(defaultLandingPage)) {
    redirect(accountUrl("preferences", "error", "Choose a valid starting screen."));
  }

  const { error } = await context.database.from("user_preferences").upsert(
    {
      user_id: context.user.id,
      organization_id: context.organizationId,
      theme,
      text_size: textSize,
      compact_mode: checkbox(formData, "compactMode"),
      email_notifications: checkbox(formData, "emailNotifications"),
      sms_notifications: checkbox(formData, "smsNotifications"),
      push_notifications: checkbox(formData, "pushNotifications"),
      default_map_app: defaultMapApp,
      default_landing_page: defaultLandingPage,
    },
    { onConflict: "user_id,organization_id" },
  );
  if (error) {
    redirect(accountUrl("preferences", "error", "Your app settings could not be saved."));
  }

  revalidatePath("/account");
  redirect(accountUrl("preferences", "saved", "App settings saved."));
}

export async function updateSquareAccount(formData: FormData) {
  const context = await getAccountContext();
  if (!context) redirect("/login?next=/account");
  if (!context.organizationId || !canManageBusiness(context)) {
    redirect(accountUrl("square", "error", "Only an owner or administrator can change Square settings."));
  }

  const merchantId = value(formData, "merchantId");
  const defaultLocationId = value(formData, "defaultLocationId");
  const businessName = value(formData, "businessName");
  const accountEmail = value(formData, "accountEmail").toLowerCase();
  const environment = value(formData, "environment");
  const currency = value(formData, "currency").toUpperCase();
  const squareIdPattern = /^[A-Za-z0-9_-]{3,128}$/;

  if (merchantId && !squareIdPattern.test(merchantId)) {
    redirect(accountUrl("square", "error", "Enter a valid Square merchant ID."));
  }
  if (defaultLocationId && !squareIdPattern.test(defaultLocationId)) {
    redirect(accountUrl("square", "error", "Enter a valid Square location ID."));
  }
  if (businessName.length > 160) {
    redirect(accountUrl("square", "error", "Square business name is too long."));
  }
  if (accountEmail && (!/^\S+@\S+\.\S+$/.test(accountEmail) || accountEmail.length > 254)) {
    redirect(accountUrl("square", "error", "Enter a valid Square account email."));
  }
  if (!["sandbox", "production"].includes(environment) || !/^[A-Z]{3}$/.test(currency)) {
    redirect(accountUrl("square", "error", "Check the Square environment and currency."));
  }

  const status = merchantId || defaultLocationId ? "pending" : "not_connected";
  const { error } = await context.database.from("square_payment_accounts").upsert(
    {
      organization_id: context.organizationId,
      status,
      environment,
      merchant_id: merchantId || null,
      default_location_id: defaultLocationId || null,
      business_name: businessName || null,
      account_email: accountEmail || null,
      currency,
      connected_by: context.user.id,
      last_verified_at: null,
      last_error: null,
    },
    { onConflict: "organization_id" },
  );
  if (error) {
    redirect(accountUrl("square", "error", "Square information could not be saved."));
  }

  revalidatePath("/account");
  redirect(accountUrl("square", "saved", "Square information saved for verification."));
}

export async function startPremiumCheckout() {
  const context = await getAccountContext();
  if (!context) redirect("/login?next=/account");
  if (!context.organizationId || !canManageBusiness(context)) {
    redirect(accountUrl("subscription", "error", "Only an owner or administrator can manage the subscription."));
  }

  const stripe = getStripe();
  const priceId = process.env.STRIPE_PREMIUM_PRICE_ID;
  if (!stripe || !priceId) {
    redirect(accountUrl("subscription", "error", "Premium checkout is not configured yet."));
  }

  const existing = await context.database
    .from("organization_subscriptions")
    .select("status,stripe_customer_id")
    .eq("organization_id", context.organizationId)
    .maybeSingle();
  const customerId =
    typeof existing.data?.stripe_customer_id === "string"
      ? existing.data.stripe_customer_id
      : undefined;

  if (
    customerId &&
    ["active", "trialing", "past_due", "paused", "unpaid"].includes(
      typeof existing.data?.status === "string" ? existing.data.status : "",
    )
  ) {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl()}/account?section=subscription`,
    });
    redirect(portal.url);
  }

  const checkout = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    customer_email: customerId ? undefined : context.user.email,
    client_reference_id: context.organizationId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${appUrl()}/account?section=subscription&checkout=success#subscription`,
    cancel_url: `${appUrl()}/account?section=subscription&checkout=canceled#subscription`,
    metadata: {
      purpose: "volterra_subscription",
      organization_id: context.organizationId,
    },
    subscription_data: {
      metadata: { organization_id: context.organizationId },
    },
  });
  if (!checkout.url) {
    redirect(accountUrl("subscription", "error", "Stripe did not return a checkout page."));
  }
  redirect(checkout.url);
}

export async function openBillingPortal() {
  const context = await getAccountContext();
  if (!context) redirect("/login?next=/account");
  if (!context.organizationId || !canManageBusiness(context)) {
    redirect(accountUrl("subscription", "error", "Only an owner or administrator can manage the subscription."));
  }

  const stripe = getStripe();
  if (!stripe) {
    redirect(accountUrl("subscription", "error", "Stripe billing is not configured yet."));
  }
  const { data: subscription } = await context.database
    .from("organization_subscriptions")
    .select("stripe_customer_id")
    .eq("organization_id", context.organizationId)
    .maybeSingle();
  if (typeof subscription?.stripe_customer_id !== "string") {
    redirect(accountUrl("subscription", "error", "Start Premium before opening the billing portal."));
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: subscription.stripe_customer_id,
    return_url: `${appUrl()}/account?section=subscription`,
  });
  redirect(portal.url);
}

export async function updatePassword(formData: FormData) {
  const context = await getAccountContext();
  if (!context) redirect("/login?next=/account");

  const currentPassword = value(formData, "currentPassword");
  const password = value(formData, "password");
  const confirmation = value(formData, "passwordConfirmation");
  if (password.length < 10) {
    redirect(accountUrl("security", "error", "Use at least 10 characters for the new password."));
  }
  if (password !== confirmation) {
    redirect(accountUrl("security", "error", "The new passwords do not match."));
  }
  if (!currentPassword) {
    redirect(accountUrl("security", "error", "Enter your current password."));
  }

  const { error } = await context.supabase.auth.updateUser({
    current_password: currentPassword,
    password,
  });
  if (error) {
    redirect(accountUrl("security", "error", "The password was not changed. Check your current password."));
  }
  redirect(accountUrl("security", "saved", "Password updated."));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
