import "server-only";

import { sendJobEventMessage } from "@/lib/automatic-messages";
import { emailSender } from "@/lib/booking-confirmation";
import { DOCUMENTS_BUCKET } from "@/lib/document-storage";
import { sendEmail } from "@/lib/email";
import { escapeHtml, invoiceViewUrl } from "@/lib/invoice-messages";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Telling the customer the work is done, the way the person finishing chose:
 * a short "work is complete", or that with the notes and the photos from the
 * visit, by text, by email, or both.
 *
 * A text goes through sendJobEventMessage, so consent, the STOP ledger and
 * quiet hours decide exactly as they do for every text. Never throws: the job
 * is already finished, and a message that fails must not undo that.
 */

export type CompletionNotice = {
  mode: "none" | "notice" | "details";
  sms: boolean;
  email: boolean;
};

/** Photo links that still work when the customer opens the message a week later. */
const PHOTO_LINK_SECONDS = 14 * 24 * 3600;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function sendWorkCompleteNotice(jobId: string, notice: CompletionNotice): Promise<string> {
  if (notice.mode === "none" || (!notice.sms && !notice.email)) return "The customer was not sent anything.";
  try {
    const database = getSupabaseAdmin();
    const { data: jobRow } = await database
      .from("jobs")
      .select("id, job_number, organization_id, technician_notes, customers ( first_name, email ), organizations ( name, phone )")
      .eq("id", jobId)
      .maybeSingle();
    const job = jobRow as Record<string, unknown> | null;
    if (!job) return "The customer could not be told: the job was not found.";
    const customer = (job.customers ?? null) as Record<string, unknown> | null;
    const organization = (job.organizations ?? null) as Record<string, unknown> | null;
    const organizationId = text(job.organization_id);
    const businessName = text(organization?.name) || "Your electrician";
    const jobNumber = String(job.job_number ?? "");
    const details = notice.mode === "details";
    const notes = details ? text(job.technician_notes).trim() : "";

    // The visit's photos, after ones first, signed for a fortnight.
    let photos: { url: string; stage: string }[] = [];
    if (details) {
      const { data: rows } = await database
        .from("documents")
        .select("storage_path, document_type, created_at")
        .eq("organization_id", organizationId)
        .eq("job_id", jobId)
        .in("document_type", ["photo_before", "photo_after"])
        .order("created_at", { ascending: true });
      const list = ((rows ?? []) as Record<string, unknown>[])
        .sort((a, b) => (a.document_type === b.document_type ? 0 : a.document_type === "photo_after" ? -1 : 1))
        .slice(0, 12);
      if (list.length > 0) {
        const { data: signed } = await database.storage
          .from(DOCUMENTS_BUCKET)
          .createSignedUrls(list.map((row) => text(row.storage_path)), PHOTO_LINK_SECONDS);
        const byPath = new Map((signed ?? []).filter((entry) => entry.path && entry.signedUrl).map((entry) => [entry.path as string, entry.signedUrl]));
        photos = list
          .map((row) => ({ url: byPath.get(text(row.storage_path)) ?? "", stage: row.document_type === "photo_after" ? "After" : "Before" }))
          .filter((photo) => photo.url);
      }
    }

    const told: string[] = [];
    const missed: string[] = [];

    if (notice.sms) {
      const sent = await sendJobEventMessage({
        jobId,
        trigger: "job_completed",
        chosen: true,
        append: notes ? `What we did: ${notes.slice(0, 900)}` : "",
        // A text carries the after photos, at most five, as pictures.
        mediaUrls: photos.slice(0, 5).map((photo) => photo.url),
      });
      if (sent.sent) told.push("text");
      else missed.push(`no text (${sent.reason.replace(/\.$/, "").toLowerCase()})`);
    }

    if (notice.email) {
      const to = text(customer?.email);
      if (!to) {
        missed.push("no email (none on file)");
      } else {
        const { data: invoice } = await database
          .from("invoices")
          .select("preview_token")
          .eq("organization_id", organizationId)
          .eq("job_id", jobId)
          .neq("status", "void")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
        const token = text(invoice?.preview_token);
        const invoiceLink = origin && token ? invoiceViewUrl(origin, token) ?? "" : "";
        const firstName = text(customer?.first_name);
        const hello = firstName && firstName !== "Text" ? `Hi ${firstName},` : "Hi,";
        const heading = `Work is complete on job #${jobNumber}`;
        const lines = [
          hello,
          "",
          `${heading}. Thank you for choosing ${businessName}.`,
          notes ? `\nWhat we did:\n${notes}` : "",
          photos.length > 0 ? `\nPhotos:\n${photos.map((photo) => `${photo.stage}: ${photo.url}`).join("\n")}` : "",
          invoiceLink ? `\nYour invoice: ${invoiceLink}` : "",
          text(organization?.phone) ? `\nQuestions? Call ${text(organization?.phone)}.` : "",
        ].filter(Boolean);
        const html = [
          `<p>${escapeHtml(hello)}</p>`,
          `<p style="font-size:18px;margin:0 0 12px"><strong>${escapeHtml(heading)}</strong></p>`,
          `<p>Thank you for choosing ${escapeHtml(businessName)}.</p>`,
          notes ? `<p><strong>What we did</strong></p><p style="white-space:pre-line">${escapeHtml(notes)}</p>` : "",
          photos.length > 0
            ? `<p><strong>Photos</strong></p>${photos
                .map(
                  (photo) =>
                    `<p style="margin:0 0 12px"><span style="font-size:12px;color:#666">${photo.stage}</span><br><a href="${escapeHtml(photo.url)}"><img src="${escapeHtml(photo.url)}" alt="${photo.stage} photo" width="320" style="max-width:100%;border-radius:8px"></a></p>`,
                )
                .join("")}`
            : "",
          invoiceLink ? `<p><a href="${escapeHtml(invoiceLink)}">View your invoice</a></p>` : "",
          text(organization?.phone) ? `<p>Questions? Call ${escapeHtml(text(organization?.phone))}.</p>` : "",
        ]
          .filter(Boolean)
          .join("");
        const sent = await sendEmail({
          to,
          subject: `${heading} · ${businessName}`,
          text: lines.join("\n"),
          html,
          from: emailSender(businessName, process.env.BOOKING_EMAIL_FROM ?? ""),
        });
        if (sent.ok) told.push("email");
        else missed.push("no email (it could not be sent)");
      }
    }

    const sentence = told.length > 0 ? `The customer was told by ${told.join(" and ")}.` : "The customer was not told.";
    return missed.length > 0 ? `${sentence} ${missed.join("; ").replace(/^./, (c) => c.toUpperCase())}.` : sentence;
  } catch {
    return "The customer could not be told.";
  }
}
