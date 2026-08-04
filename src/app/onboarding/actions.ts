"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import type { Json } from "@/lib/database.types";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export type OnboardingActionState = {
  error: string;
};

const dayKeys = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

function getText(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function isValidTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function buildBusinessHours(
  workingDays: Set<string>,
  start: string,
  end: string,
): Json {
  return Object.fromEntries(
    dayKeys.map((day) => [
      day,
      { enabled: workingDays.has(day), start, end },
    ]),
  );
}

export async function createOwnerWorkspace(
  _previousState: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const businessName = getText(formData, "businessName");
  const ownerName = getText(formData, "ownerName");
  const phone = getText(formData, "phone");
  const address = getText(formData, "address");
  const city = getText(formData, "city");
  const state = getText(formData, "state").toUpperCase();
  const postalCode = getText(formData, "postalCode");
  const startTime = getText(formData, "startTime");
  const endTime = getText(formData, "endTime");
  const radius = Number(getText(formData, "serviceRadius"));
  const workingDays = new Set(
    formData
      .getAll("workingDays")
      .map(String)
      .filter((day) => dayKeys.includes(day as (typeof dayKeys)[number])),
  );

  if (businessName.length < 2 || businessName.length > 120) {
    return { error: "Enter the electrical business name." };
  }
  if (ownerName.length < 2 || ownerName.length > 120) {
    return { error: "Enter the owner’s full name." };
  }
  if (phone.replace(/\D/g, "").length < 7 || phone.length > 30) {
    return { error: "Enter a valid business phone number." };
  }
  if (address.length < 3 || address.length > 160) {
    return { error: "Enter the street address used as the route starting point." };
  }
  if (city.length < 2 || city.length > 80) {
    return { error: "Enter a valid city." };
  }
  if (!/^[A-Z]{2}$/.test(state)) {
    return { error: "Use the two-letter state abbreviation." };
  }
  if (!/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
    return { error: "Enter a valid ZIP code." };
  }
  if (!Number.isInteger(radius) || radius < 1 || radius > 100) {
    return { error: "Choose a service radius between 1 and 100 miles." };
  }
  if (workingDays.size === 0) {
    return { error: "Select at least one normal working day." };
  }
  if (!isValidTime(startTime) || !isValidTime(endTime) || startTime >= endTime) {
    return { error: "Choose working hours with an end time after the start time." };
  }

  try {
    const supabase = await createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser();

    if (authError || !authData.user) {
      return { error: "Your session expired. Sign in again to finish setup." };
    }

    const { error } = await supabase.rpc("create_owner_workspace", {
      p_automatic_booking_radius_miles: radius,
      p_base_address_line_1: address,
      p_base_city: city,
      p_base_postal_code: postalCode,
      p_base_state: state,
      p_business_hours: buildBusinessHours(workingDays, startTime, endTime),
      p_business_name: businessName,
      p_owner_display_name: ownerName,
      p_phone: phone,
      p_standard_pricing_radius_miles: radius,
    });

    if (error) {
      return {
        error:
          "We couldn’t create the business workspace. Your information was not partially saved—please try again.",
      };
    }

    await asFlexibleClient(supabase).from("user_profiles").upsert(
      {
        user_id: authData.user.id,
        display_name: ownerName,
        phone,
        job_title: "Owner",
        timezone: "America/Los_Angeles",
      },
      { onConflict: "user_id" },
    );
  } catch {
    return {
      error:
        "We couldn’t create the business workspace. Check your connection and try again.",
    };
  }

  revalidatePath("/");
  redirect("/");
}
