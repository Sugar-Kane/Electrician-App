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
    .from("booking_requests")
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

/** The database's own refusal when it is one meant for people, else a plain fallback. */
function refusal(error: { code?: string; message?: string } | null, fallback: string): string {
  if (error && ["40001", "22023", "23505"].includes(error.code ?? "") && error.message) return error.message;
  return fallback;
}

function revalidateQueue() {
  revalidatePath("/booking-requests");
  revalidatePath("/booking-requests/history");
  revalidatePath("/booking-requests/duplicates");
  revalidatePath("/");
}

/**
 * Hide a request that isn't a request for work: a sales call, spam, a test.
 *
 * Not deleted, and nothing is sent to anybody. The database refuses one that
 * became a job or has money behind it.
 */
export async function hideNotService(formData: FormData) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login?next=/booking-requests");

  const requestId = value(formData, "requestId");
  const kind = value(formData, "kind");
  if (!requestId) redirect(queueUrl("error", "That request could not be found."));
  if (!kind) redirect(queueUrl("error", "Say what it was: a sales call, spam, a test or something else."));

  const { error } = await asFlexibleClient(supabase).rpc("hide_booking_not_service", {
    p_request_id: requestId,
    p_classification: kind,
  });
  if (error) redirect(queueUrl("error", refusal(error, "That request could not be hidden.")));

  revalidateQueue();
  redirect(`/booking-requests?${new URLSearchParams({ hidden: requestId }).toString()}`);
}

/** Bring a hidden request back to where it was. */
export async function restoreRequest(formData: FormData) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login?next=/booking-requests/history");

  const requestId = value(formData, "requestId");
  const back = value(formData, "back") === "history" ? "/booking-requests/history" : "/booking-requests";
  const to = (key: string, message: string) => `${back}?${new URLSearchParams({ [key]: message }).toString()}`;
  if (!requestId) redirect(to("error", "That request could not be found."));

  const { data, error } = await asFlexibleClient(supabase).rpc("restore_booking", { p_request_id: requestId });
  if (error) redirect(to("error", refusal(error, "That request could not be brought back.")));

  revalidateQueue();
  redirect(
    to(
      "saved",
      ["new", "needs_review", "safety_escalated"].includes(String(data))
        ? "Brought back. It's waiting on you again."
        : "Brought back, under Already handled.",
    ),
  );
}

/**
 * Keep one of a set of requests from the same person, and hide the others as
 * its duplicates. All or nothing; nobody is texted.
 */
export async function keepOneRequest(formData: FormData) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login?next=/booking-requests/duplicates");

  const keepId = value(formData, "keepId");
  const others = formData.getAll("otherId").map((entry) => String(entry)).filter(Boolean);
  const to = (key: string, message: string) =>
    `/booking-requests/duplicates?${new URLSearchParams({ [key]: message }).toString()}`;
  if (!keepId || others.length === 0) redirect(to("error", "Choose the one to keep."));

  const { error } = await asFlexibleClient(supabase).rpc("hide_duplicate_bookings", {
    p_keep_id: keepId,
    p_duplicate_ids: others,
  });
  if (error) redirect(to("error", refusal(error, "Those requests could not be tidied up.")));

  revalidateQueue();
  redirect(
    to(
      "saved",
      others.length === 1
        ? "Kept one. The other is hidden as its duplicate, in History, not deleted."
        : `Kept one. The other ${others.length} are hidden as its duplicates, in History, not deleted.`,
    ),
  );
}

/** "These are different requests": stop suggesting them as duplicates. */
export async function markDistinct(formData: FormData) {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) redirect("/login?next=/booking-requests/duplicates");

  const ids = formData.getAll("requestId").map((entry) => String(entry)).filter(Boolean);
  const to = (key: string, message: string) =>
    `/booking-requests/duplicates?${new URLSearchParams({ [key]: message }).toString()}`;
  if (ids.length < 2) redirect(to("error", "Those requests could not be found."));

  const { error } = await asFlexibleClient(supabase).rpc("mark_bookings_distinct", { p_request_ids: ids });
  if (error) redirect(to("error", "Those requests could not be updated."));

  revalidateQueue();
  redirect(to("saved", "Noted. They won't be suggested as duplicates again."));
}
