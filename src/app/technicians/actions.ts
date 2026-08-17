"use server";

import { revalidatePath } from "next/cache";

import { buildBusinessHours } from "@/lib/business-hours";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { describeWeek, parseHourRange, WEEKDAYS, type DayHours } from "@/lib/electrician-hours";

/**
 * Who is working, when, and who is not.
 *
 * Every one of these changes what the public booking page will offer a
 * customer, which is why they are all owner-only and none of them is a
 * preference stored for display. Turning somebody off takes them out of the
 * availability count the moment it is saved; a blackout removes them for those
 * hours; hours narrow them to the days they actually work.
 *
 * The owner is not automatically an electrician. Plenty of them run the office
 * and never carry a ladder, so it is a decision they make rather than a row
 * created behind them — but a one-person business needs it in one tap.
 */

export type ElectricianState = { error: string; notice?: string };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The caller, their business, and whether they are allowed to change it. */
async function ownerContext() {
  const supabase = asFlexibleClient(await createClient());

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? "";
  if (!userId) return null;

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .limit(1)
    .maybeSingle();

  const organizationId = text(membership?.organization_id);
  if (!organizationId) return null;

  return {
    supabase,
    userId,
    organizationId,
    email: auth.user?.email ?? "",
    metadata: (auth.user?.user_metadata ?? {}) as Record<string, unknown>,
    canManage: ["owner", "admin"].includes(text(membership?.role)),
  };
}

/**
 * Confirm an electrician belongs to the caller's business before touching them.
 *
 * RLS would refuse the write anyway. This turns that into a sentence rather
 * than a silent no-op, and it is the difference between "that person is not on
 * your crew" and a toggle that flips back with no explanation.
 */
async function ownedTechnician(
  context: NonNullable<Awaited<ReturnType<typeof ownerContext>>>,
  technicianId: string,
): Promise<boolean> {
  if (!technicianId) return false;

  const { data } = await context.supabase
    .from("technicians")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("id", technicianId)
    .maybeSingle();

  return Boolean(data?.id);
}

export async function setElectricianWorking(
  _previous: ElectricianState,
  formData: FormData,
): Promise<ElectricianState> {
  const technicianId = String(formData.get("technicianId") ?? "").trim();
  // The checkbox is absent from the form when it is off, which is how HTML has
  // always reported an unchecked box.
  const working = String(formData.get("working") ?? "") === "yes";

  const context = await ownerContext();
  if (!context) return { error: "You are not signed in." };
  if (!context.canManage) return { error: "Only an owner can change who is working." };
  if (!(await ownedTechnician(context, technicianId))) {
    return { error: "That person is not on your crew." };
  }

  const { error } = await context.supabase
    .from("technicians")
    .update({ is_active: working })
    .eq("organization_id", context.organizationId)
    .eq("id", technicianId);

  if (error) {
    console.error("electricians: could not change working state", error);
    return { error: "That change could not be saved. Try again." };
  }

  revalidatePath("/technicians");
  revalidatePath("/");
  return { error: "" };
}

/** Put the owner on the crew, so they can be assigned work like anybody else. */
export async function addSelfAsElectrician(
  _previous: ElectricianState,
  _formData: FormData,
): Promise<ElectricianState> {
  const context = await ownerContext();
  if (!context) return { error: "You are not signed in." };
  if (!context.canManage) return { error: "Only an owner can add themselves." };

  const { data: existing } = await context.supabase
    .from("technicians")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("user_id", context.userId)
    .maybeSingle();

  if (existing?.id) {
    return { error: "", notice: "You are already on the crew." };
  }

  // Their own name if they have set one, and the part of their email before the
  // @ if they have not. Never blank: display_name is not null, and "Unnamed"
  // on a schedule helps nobody.
  const named =
    text(context.metadata.display_name).trim() ||
    text(context.metadata.full_name).trim() ||
    text(context.metadata.name).trim() ||
    context.email.split("@")[0] ||
    "Owner";

  const { error } = await context.supabase.from("technicians").insert({
    organization_id: context.organizationId,
    user_id: context.userId,
    display_name: named,
    // The two the booking page looks for. Without them the owner is on the crew
    // and still never offered to a customer, which reads as the button having
    // done nothing.
    skills: ["general_service", "diagnostics"],
    is_active: true,
  });

  if (error) {
    console.error("electricians: could not add the owner", error);
    return { error: "You could not be added to the crew. Try again." };
  }

  revalidatePath("/technicians");
  revalidatePath("/");
  return { error: "", notice: `Added ${named} to the crew.` };
}

/**
 * The week as the calendar posts it, validated.
 *
 * One reader for both actions. The calendar is a single component serving an
 * electrician and the business, so the two actions have to agree on the field
 * names down to the last character — a second copy of this loop is a second
 * chance to drift.
 */
function readWeek(formData: FormData): { days: DayHours[] } | { error: string } {
  const days: DayHours[] = [];

  for (const day of WEEKDAYS) {
    if (String(formData.get(`enabled-${day.value}`) ?? "") !== "yes") continue;

    const parsed = parseHourRange(
      String(formData.get(`start-${day.value}`) ?? ""),
      String(formData.get(`end-${day.value}`) ?? ""),
    );

    if (!parsed.ok) return { error: `${day.label}: ${parsed.error}` };

    days.push({ weekday: day.value, start: parsed.start, end: parsed.end });
  }

  return { days };
}

/**
 * Replace one electrician's whole week.
 *
 * Written as a delete and an insert rather than a diff. The form posts the
 * complete week every time, so the rows that survive a diff would be the ones
 * that happened to match — and a half-applied week is a person the booking page
 * thinks works Sunday.
 */
export async function saveElectricianHours(
  _previous: ElectricianState,
  formData: FormData,
): Promise<ElectricianState> {
  const technicianId = String(formData.get("technicianId") ?? "").trim();

  const context = await ownerContext();
  if (!context) return { error: "You are not signed in." };
  if (!context.canManage) return { error: "Only an owner can set hours." };
  if (!(await ownedTechnician(context, technicianId))) {
    return { error: "That person is not on your crew." };
  }

  const week = readWeek(formData);
  if ("error" in week) return { error: week.error };

  const rows = week.days.map((day) => ({
    weekday: day.weekday,
    starts_at: day.start,
    ends_at: day.end,
  }));

  const { error: cleared } = await context.supabase
    .from("technician_hours")
    .delete()
    .eq("organization_id", context.organizationId)
    .eq("technician_id", technicianId);

  if (cleared) {
    console.error("electricians: could not clear hours", cleared);
    return { error: "Those hours could not be saved. Try again." };
  }

  if (rows.length > 0) {
    const { error } = await context.supabase.from("technician_hours").insert(
      rows.map((row) => ({
        organization_id: context.organizationId,
        technician_id: technicianId,
        ...row,
      })),
    );

    if (error) {
      console.error("electricians: could not save hours", error);
      return { error: "Those hours could not be saved. Try again." };
    }
  }

  revalidatePath("/technicians");

  return {
    error: "",
    notice:
      rows.length === 0
        ? "Hours cleared. Available whenever the business is open."
        : `Hours saved for ${rows.length} ${rows.length === 1 ? "day" : "days"}.`,
  };
}

/**
 * When the business itself is open.
 *
 * These were set once during onboarding and there has never been a screen that
 * changed them, so a business that started opening Saturdays had no way to say
 * so. They matter more than any one person's hours: `list_public_booking_slots`
 * skips a closed day outright, before it counts a single electrician, so this
 * is the setting that can empty the booking page.
 *
 * Zero days is allowed. It means the business is shut, which is a real thing an
 * owner might be saying, and refusing it would be inventing a rule. The
 * calendar warns before the tap rather than the action refusing after it.
 */
export async function saveBusinessHours(
  _previous: ElectricianState,
  formData: FormData,
): Promise<ElectricianState> {
  const context = await ownerContext();
  if (!context) return { error: "You are not signed in." };
  if (!context.canManage) return { error: "Only an owner can change business hours." };

  const week = readWeek(formData);
  if ("error" in week) return { error: week.error };

  // Read before writing so the days being switched off keep the times they had.
  // The whole object is rewritten either way — it is one JSONB column, not a
  // row per day — so without this a Saturday turned off and on again would come
  // back as eight-to-five instead of the nine-to-one it was.
  const { data: existing, error: unreadable } = await context.supabase
    .from("service_settings")
    .select("business_hours")
    .eq("organization_id", context.organizationId)
    .maybeSingle();

  if (unreadable) {
    console.error("electricians: could not read business hours", unreadable);
    return { error: "Those hours could not be saved. Try again." };
  }

  const { error } = await context.supabase
    .from("service_settings")
    .update({ business_hours: buildBusinessHours(week.days, existing?.business_hours) })
    .eq("organization_id", context.organizationId);

  if (error) {
    console.error("electricians: could not save business hours", error);
    return { error: "Those hours could not be saved. Try again." };
  }

  revalidatePath("/technicians");
  revalidatePath("/settings/business");

  return {
    error: "",
    // The red block above the button already spells out what no days means, and
    // it is still on screen. This only has to confirm the write landed.
    notice:
      week.days.length === 0
        ? "Saved. The business is now closed every day."
        : `Open ${describeWeek(week.days)}.`,
  };
}

/**
 * Book time out — a holiday, a morning off, a day at the wholesaler.
 *
 * With no electrician named it closes the whole business, which is a null
 * `technician_id`. That saves adding a row per person for a public holiday and,
 * more to the point, saves the business from selling an appointment on Christmas
 * Day because somebody joined the crew in November and nobody went back to
 * block them out too.
 */
export async function addBlackout(
  _previous: ElectricianState,
  formData: FormData,
): Promise<ElectricianState> {
  const technicianId = String(formData.get("technicianId") ?? "").trim();
  const startDate = String(formData.get("startDate") ?? "").trim();
  const endDate = String(formData.get("endDate") ?? "").trim() || startDate;
  const allDay = String(formData.get("allDay") ?? "") === "yes";
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 120);

  const context = await ownerContext();
  if (!context) return { error: "You are not signed in." };
  if (!context.canManage) return { error: "Only an owner can block out time." };
  if (technicianId && !(await ownedTechnician(context, technicianId))) {
    return { error: "That person is not on your crew." };
  }
  if (!startDate) return { error: "Pick a day to block out." };

  const startTime = allDay ? "00:00" : String(formData.get("startTime") ?? "").trim();
  const endTime = allDay ? "23:59" : String(formData.get("endTime") ?? "").trim();

  if (!allDay) {
    const parsed = parseHourRange(startTime, endTime);
    if (!parsed.ok) return { error: parsed.error };
  }

  // Read in the business's own clock. A blackout typed as "Friday" by somebody
  // in California must not start on Thursday afternoon because the server
  // stores UTC.
  const { data: organization } = await context.supabase
    .from("organizations")
    .select("timezone")
    .eq("id", context.organizationId)
    .maybeSingle();

  const timeZone = text(organization?.timezone) || "America/Los_Angeles";
  const startsAt = zonedTimestamp(startDate, startTime || "00:00", timeZone);
  const endsAt = zonedTimestamp(endDate, endTime || "23:59", timeZone);

  if (!startsAt || !endsAt) return { error: "That date could not be read." };
  if (endsAt <= startsAt) return { error: "The end has to come after the start." };

  const { error } = await context.supabase.from("blackout_periods").insert({
    organization_id: context.organizationId,
    // Null is the whole business, which is why this is not `|| null` on a value
    // that could arrive as a stray empty string from somewhere else.
    technician_id: technicianId || null,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    block_type: "hard",
    reason: reason || null,
    created_by: context.userId,
  });

  if (error) {
    console.error("electricians: could not add a blackout", error);
    return { error: "That time off could not be saved. Try again." };
  }

  revalidatePath("/technicians");
  return {
    error: "",
    notice: technicianId ? "Time off saved." : "The business is closed for that time.",
  };
}

export async function removeBlackout(
  _previous: ElectricianState,
  formData: FormData,
): Promise<ElectricianState> {
  const blackoutId = String(formData.get("blackoutId") ?? "").trim();

  const context = await ownerContext();
  if (!context) return { error: "You are not signed in." };
  if (!context.canManage) return { error: "Only an owner can change time off." };
  if (!blackoutId) return { error: "That time off could not be found." };

  const { error } = await context.supabase
    .from("blackout_periods")
    .delete()
    .eq("organization_id", context.organizationId)
    .eq("id", blackoutId);

  if (error) {
    console.error("electricians: could not remove a blackout", error);
    return { error: "That time off could not be removed. Try again." };
  }

  revalidatePath("/technicians");
  return { error: "", notice: "Time off removed." };
}

/**
 * A wall-clock date and time in a named zone, as an instant.
 *
 * `new Date("2026-08-20T09:00")` is parsed in the server's zone, which on Vercel
 * is UTC and is never the zone the electrician is standing in. This works out
 * what the offset actually was on that date — so a blackout set in August and
 * one set in December are both right, across the daylight-saving boundary that
 * a fixed offset would get wrong.
 */
function zonedTimestamp(date: string, time: string, timeZone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [hour = "0", minute = "0"] = time.split(":");

  const naive = new Date(`${date}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;

  // What that instant reads as on the wall in the target zone, and therefore
  // how far out it is.
  const asSeen = new Date(naive.toLocaleString("en-US", { timeZone }));
  const asUtc = new Date(naive.toLocaleString("en-US", { timeZone: "UTC" }));
  const offset = asSeen.getTime() - asUtc.getTime();

  return new Date(naive.getTime() - offset);
}
