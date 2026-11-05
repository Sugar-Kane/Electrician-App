"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { filesInBusinessFolder, isDeletableKind } from "@/lib/admin-removal-rules";
import { DOCUMENTS_BUCKET } from "@/lib/document-storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Deleting a business's data from the admin console.
 *
 * The database does the deleting and decides who may: every function refuses
 * anybody who is not a platform owner, needs a reason, and writes to the
 * admin audit log. It returns the paths of the files it orphaned, which are
 * deleted here through Storage (SQL cannot), only from inside the business's
 * own folder. Any older leftovers in that folder go at the same time.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(formData: FormData, name: string, max = 200): string {
  return String(formData.get(name) ?? "").trim().slice(0, max);
}

function back(organizationId: string, outcome: Record<string, string>): string {
  return `/admin/organizations/${organizationId}?${new URLSearchParams({ tab: "data", ...outcome }).toString()}#data`;
}

/** Delete these files and any other file in the business's folder with no record. Returns how many went. */
async function removeFiles(organizationId: string, paths: unknown): Promise<number> {
  const supabase = asFlexibleClient(await createClient());
  const { data: strays } = await supabase.rpc("admin_stray_document_files", { p_organization_id: organizationId });
  const files = filesInBusinessFolder(organizationId, [
    ...(Array.isArray(paths) ? paths : []),
    ...(Array.isArray(strays) ? strays : []),
  ]);
  if (files.length === 0) return 0;

  const bucket = getSupabaseAdmin().storage.from(DOCUMENTS_BUCKET);
  let removed = 0;
  for (let start = 0; start < files.length; start += 100) {
    const batch = files.slice(start, start + 100);
    const { data, error } = await bucket.remove(batch);
    if (error) console.error("admin removal: files not deleted", { organizationId, message: error.message });
    removed += data?.length ?? 0;
  }
  return removed;
}

function refusal(message: string | undefined): string {
  if (!message) return "error";
  if (/platform owner/i.test(message)) return "owner";
  if (/business name/i.test(message)) return "name";
  if (/why/i.test(message)) return "reason";
  if (/not found/i.test(message)) return "missing";
  return "error";
}

export async function deleteOneRecord(formData: FormData): Promise<void> {
  const organizationId = field(formData, "organizationId", 36);
  const kind = field(formData, "kind", 20);
  const recordId = field(formData, "recordId", 36);
  if (!UUID.test(organizationId)) return;
  if (!isDeletableKind(kind) || !UUID.test(recordId)) redirect(back(organizationId, { done: "error" }));

  const reason = field(formData, "reason");
  if (reason.length < 3) redirect(back(organizationId, { done: "reason" }));

  const supabase = asFlexibleClient(await createClient());
  const { data, error } = await supabase.rpc("admin_delete_record", {
    p_organization_id: organizationId,
    p_kind: kind,
    p_record_id: recordId,
    p_reason: reason,
  });
  if (error) redirect(back(organizationId, { done: refusal(error.message) }));

  const files = await removeFiles(organizationId, data);
  revalidatePath(`/admin/organizations/${organizationId}`);
  redirect(back(organizationId, { done: "deleted", kind, files: String(files) }));
}

export async function wipeBusinessData(formData: FormData): Promise<void> {
  const organizationId = field(formData, "organizationId", 36);
  if (!UUID.test(organizationId)) return;
  const reason = field(formData, "reason");
  if (reason.length < 3) redirect(back(organizationId, { done: "reason" }));

  const supabase = asFlexibleClient(await createClient());
  const { data, error } = await supabase.rpc("admin_wipe_organization_data", {
    p_organization_id: organizationId,
    p_confirm_name: field(formData, "confirmName"),
    p_reason: reason,
  });
  if (error) redirect(back(organizationId, { done: refusal(error.message) }));

  const files = await removeFiles(organizationId, data);
  revalidatePath(`/admin/organizations/${organizationId}`);
  redirect(back(organizationId, { done: "wiped", files: String(files) }));
}

export async function deleteBusiness(formData: FormData): Promise<void> {
  const organizationId = field(formData, "organizationId", 36);
  if (!UUID.test(organizationId)) return;
  const reason = field(formData, "reason");
  if (reason.length < 3) redirect(back(organizationId, { done: "reason" }));

  const supabase = asFlexibleClient(await createClient());
  // Leftover files are listed first: once the business is gone, nothing can
  // say which folder was its.
  const { data: strays } = await supabase.rpc("admin_stray_document_files", { p_organization_id: organizationId });
  const { data, error } = await supabase.rpc("admin_delete_organization", {
    p_organization_id: organizationId,
    p_confirm_name: field(formData, "confirmName"),
    p_reason: reason,
  });
  if (error) redirect(back(organizationId, { done: refusal(error.message) }));

  const files = filesInBusinessFolder(organizationId, [
    ...(Array.isArray(data) ? data : []),
    ...(Array.isArray(strays) ? strays : []),
  ]);
  const bucket = getSupabaseAdmin().storage.from(DOCUMENTS_BUCKET);
  for (let start = 0; start < files.length; start += 100) {
    const { error: storageError } = await bucket.remove(files.slice(start, start + 100));
    if (storageError) console.error("admin removal: files not deleted", { organizationId, message: storageError.message });
  }

  revalidatePath("/admin/organizations");
  revalidatePath("/admin/overview");
  redirect(`/admin/overview?deleted=${encodeURIComponent(field(formData, "confirmName"))}`);
}

export async function removeStrayFiles(formData: FormData): Promise<void> {
  const organizationId = field(formData, "organizationId", 36);
  if (!UUID.test(organizationId)) return;
  const files = await removeFiles(organizationId, []);
  revalidatePath(`/admin/organizations/${organizationId}`);
  redirect(back(organizationId, { done: "files", files: String(files) }));
}
