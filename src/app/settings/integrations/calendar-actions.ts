"use server";
import { revalidatePath } from "next/cache";
import { currentContext } from "@/lib/request-context";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { syncUpcomingPaidBookings } from "@/lib/google-booking-calendar";

export async function saveCalendarAccount(form: FormData) {
  const context = await currentContext();
  if (!context || !["owner", "admin"].includes(context.role)) throw new Error("Owner access required");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Enter a valid Google account email");
  const db = getSupabaseAdmin();
  const { data: current, error: readError } = await db.from("booking_calendar_connections").select("account_email").eq("organization_id", context.organizationId).maybeSingle();
  if (readError) throw new Error("Calendar settings unavailable");
  if (current?.account_email !== email) {
    const { error } = await db.from("booking_calendar_connections").upsert({ organization_id: context.organizationId, account_email: email, encrypted_refresh_token: null, connected_at: null, last_error: null });
    if (error) throw new Error("Could not save calendar account");
  }
  revalidatePath("/settings/integrations");
}
export async function retryCalendarSync() {
  const context = await currentContext();
  if (!context || !["owner", "admin"].includes(context.role)) throw new Error("Owner access required");
  try { await syncUpcomingPaidBookings(context.organizationId); }
  finally { revalidatePath("/settings/integrations"); }
}
export async function disconnectCalendar() {
  const context = await currentContext();
  if (!context || !["owner", "admin"].includes(context.role)) throw new Error("Owner access required");
  const { error } = await getSupabaseAdmin().from("booking_calendar_connections").update({ encrypted_refresh_token: null, connected_at: null, last_error: null }).eq("organization_id", context.organizationId);
  if (error) throw new Error("Could not disconnect calendar");
  revalidatePath("/settings/integrations");
}
