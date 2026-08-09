"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { asFlexibleClient } from "@/lib/supabase/flexible";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function queueUrl(parameter: string, message: string) {
  return `/booking-requests?${new URLSearchParams({ [parameter]: message }).toString()}`;
}

/**
 * Turn a texted request into a real job.
 *
 * The insert, the customer match, and the property are all done by
 * `schedule_sms_booking_request`, which re-checks membership — so a request
 * belonging to another business cannot be scheduled by guessing its id.
 */
export async function scheduleBookingRequest(formData: FormData) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login?next=/booking-requests");

  const requestId = value(formData, "requestId");
  if (!requestId) redirect(queueUrl("error", "That request could not be found."));

  const { error } = await asFlexibleClient(supabase).rpc("schedule_sms_booking_request", {
    p_request_id: requestId,
  });

  if (error) {
    redirect(queueUrl("error", "The job could not be created. Try again."));
  }

  revalidatePath("/booking-requests");
  revalidatePath("/schedule");
  revalidatePath("/");
  redirect(queueUrl("saved", "Job created. It is on the schedule now."));
}

export async function dismissBookingRequest(formData: FormData) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login?next=/booking-requests");

  const requestId = value(formData, "requestId");
  if (!requestId) redirect(queueUrl("error", "That request could not be found."));

  const { error } = await asFlexibleClient(supabase)
    .from("sms_booking_requests")
    .update({
      status: "dismissed",
      handled_by: authData.user.id,
      handled_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  if (error) {
    redirect(queueUrl("error", "That request could not be dismissed."));
  }

  revalidatePath("/booking-requests");
  redirect(queueUrl("saved", "Request dismissed."));
}
