"use server";

import { revalidatePath } from "next/cache";

import { isSupplyStopKind } from "@/lib/supply-stops";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Where this business stops on the way to a job.
 *
 * The route builder offered two: a Lowe's and a Home Depot in Santa Maria,
 * hardcoded with their store numbers. Right for the pilot business and wrong
 * for everyone else — and wrong for the pilot business too, the moment they
 * want their own storage unit on the route, which is where most of an
 * electrician's stock actually lives.
 *
 * Written through the caller's session, so RLS decides whose stops these are.
 */

export type SupplyStopState = { error: string; notice?: string };

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

async function callerContext() {
  const supabase = asFlexibleClient(await createClient());

  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id ?? "";

  const { data } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  const organizationId =
    typeof data?.organization_id === "string" ? data.organization_id : "";
  if (!organizationId) return null;

  return { supabase, organizationId, userId };
}

export async function saveSupplyStop(
  _previous: SupplyStopState,
  formData: FormData,
): Promise<SupplyStopState> {
  const id = field(formData, "id");
  const name = field(formData, "name");
  const line1 = field(formData, "addressLine1");

  if (!name) return { error: "Give the stop a name — whatever you call it out loud." };
  if (!line1) return { error: "A stop needs an address to route to." };

  const kind = field(formData, "kind");
  const context = await callerContext();
  if (!context) return { error: "You are not a member of a business." };

  const row = {
    organization_id: context.organizationId,
    name,
    kind: isSupplyStopKind(kind) ? kind : "supplier",
    address_line_1: line1,
    city: field(formData, "city"),
    state: field(formData, "state"),
    postal_code: field(formData, "postalCode"),
    notes: field(formData, "notes") || null,
  };

  const { data: saved, error } = id
    ? await context.supabase
        .from("supply_stops")
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("organization_id", context.organizationId)
        .select("id")
        .maybeSingle()
    : await context.supabase
        .from("supply_stops")
        .insert({ ...row, created_by: context.userId || null })
        .select("id")
        .maybeSingle();

  if (error || !saved) {
    console.error("supply stops: could not be saved", error);
    return { error: "That stop could not be saved." };
  }

  revalidatePath("/supply-stops");
  revalidatePath("/route");
  revalidatePath("/materials");
  return { error: "", notice: id ? `${name} updated.` : `${name} added.` };
}

/**
 * The one offered first.
 *
 * Cleared across the business before it is set, because the unique index that
 * enforces one default would otherwise refuse the second half of the swap and
 * leave the old one still marked.
 */
export async function makeDefaultSupplyStop(
  _previous: SupplyStopState,
  formData: FormData,
): Promise<SupplyStopState> {
  const id = field(formData, "id");
  if (!id) return { error: "That stop could not be found." };

  const context = await callerContext();
  if (!context) return { error: "You are not a member of a business." };

  const { error: cleared } = await context.supabase
    .from("supply_stops")
    .update({ is_default: false })
    .eq("organization_id", context.organizationId)
    .eq("is_default", true);

  if (cleared) {
    console.error("supply stops: could not clear the default", cleared);
    return { error: "That could not be changed." };
  }

  const { data: updated, error } = await context.supabase
    .from("supply_stops")
    .update({ is_default: true })
    .eq("id", id)
    .eq("organization_id", context.organizationId)
    .select("name")
    .maybeSingle();

  if (error || !updated) {
    console.error("supply stops: could not set the default", error);
    return { error: "That could not be changed." };
  }

  revalidatePath("/supply-stops");
  revalidatePath("/route");
  return { error: "", notice: `Routing through ${String(updated.name)} first.` };
}

export async function removeSupplyStop(
  _previous: SupplyStopState,
  formData: FormData,
): Promise<SupplyStopState> {
  const id = field(formData, "id");
  if (!id) return { error: "That stop could not be found." };

  const context = await callerContext();
  if (!context) return { error: "You are not a member of a business." };

  // Archived rather than deleted, like stock and customers. A place removed by
  // a mistyped tap is recoverable; a deleted row is not.
  const { error } = await context.supabase
    .from("supply_stops")
    .update({ archived_at: new Date().toISOString(), is_default: false })
    .eq("id", id)
    .eq("organization_id", context.organizationId);

  if (error) return { error: "That stop could not be removed." };

  revalidatePath("/supply-stops");
  revalidatePath("/route");
  return { error: "", notice: "Removed." };
}
