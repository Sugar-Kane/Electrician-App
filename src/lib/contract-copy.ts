import "server-only";

import { emailButton } from "@/lib/email-layout";

import { createElement, type ReactElement } from "react";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";

import { emailSender, looksLikeEmail } from "@/lib/booking-confirmation";
import { sendEmail } from "@/lib/email";
import { consentIsActive } from "@/lib/messaging-rules";
import { ContractDocument, contractFileName, documentWord } from "@/lib/pdf/contract-document";
import { loadContractDocument } from "@/lib/pdf/contract-data";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { sendSms } from "@/lib/twilio";

/**
 * The customer's copy of what they just signed.
 *
 * By email with the signed PDF attached, when there is an address on file, and
 * by text with the link to the signed contract, when the customer has active
 * texting consent (the same ledger every automatic text checks; a STOP is
 * final). Best effort and never throws: the signature has already happened,
 * and a copy that fails to send must not undo or fail it.
 */

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function one(value: unknown): Record<string, unknown> {
  return ((Array.isArray(value) ? value[0] : value) ?? {}) as Record<string, unknown>;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function sendSignedContractCopy(input: {
  organizationId: string;
  contractId: string;
  token: string;
  timeZone: string;
}): Promise<{ email: string; sms: string }> {
  const outcome = { email: "not sent", sms: "not sent" };
  try {
    const database = getSupabaseAdmin();
    const { data: row } = await database
      .from("contracts")
      .select("id, jobs ( job_number, customer_id, customers ( first_name, email, phone ) ), organizations ( name, phone )")
      .eq("id", input.contractId)
      .eq("organization_id", input.organizationId)
      .maybeSingle();
    if (!row) return { email: "contract not found", sms: "contract not found" };

    const job = one((row as Record<string, unknown>).jobs);
    const customer = one(job.customers);
    const organization = one((row as Record<string, unknown>).organizations);
    const businessName = text(organization.name) || "Your electrician";
    const firstName = text(customer.first_name);
    const jobNumber = job.job_number ? String(job.job_number) : "";
    const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
    const link = origin ? `${origin}/contract/${input.token}` : "";
    const what = jobNumber ? `your contract for job #${jobNumber}` : "your contract";

    // Email, with the signed PDF: the copy to keep.
    const email = text(customer.email).trim();
    if (looksLikeEmail(email)) {
      let attachment: { filename: string; content: string } | null = null;
      const loaded = await loadContractDocument({
        database: asFlexibleClient(database),
        organizationId: input.organizationId,
        contractId: input.contractId,
        timeZone: input.timeZone,
      });
      if (loaded) {
        const pdf = await renderToBuffer(
          createElement(ContractDocument, { data: loaded.document }) as unknown as ReactElement<DocumentProps>,
        );
        if (pdf.byteLength <= 10 * 1024 * 1024) {
          attachment = {
            filename: contractFileName(jobNumber ? `job-${jobNumber}` : "", loaded.document.business.name, loaded.document.kind),
            content: Buffer.from(pdf).toString("base64"),
          };
        }
      }
      const word = loaded ? documentWord(loaded.document.kind).toLowerCase() : "contract";
      const greeting = firstName ? `Hi ${firstName},` : "Hello,";
      const lines = [
        greeting,
        "",
        `Thank you for signing ${what.replace("contract", word)} with ${businessName}.`,
        attachment ? "Your signed copy is attached." : "",
        link ? `You can also view it any time: ${link}` : "",
        "",
        businessName,
      ].filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""));
      const sent = await sendEmail({
        organizationId: input.organizationId,
        to: email,
        subject: `Your signed ${word} with ${businessName}`,
        text: lines.join("\n"),
        html: [
          `<p>${escapeHtml(greeting)}</p>`,
          `<p style="font-size:20px;margin:0 0 8px"><strong>Your signed ${escapeHtml(word)}</strong></p>`,
          `<p>Thank you for signing ${escapeHtml(what.replace("contract", word))} with <strong>${escapeHtml(businessName)}</strong>.</p>`,
          attachment ? `<p>Your signed copy is attached.</p>` : "",
          link ? `<p style="margin:20px 0">${emailButton(link, `View your signed ${word}`)}</p>` : "",
          `<p style="color:#475569">${escapeHtml(businessName)}</p>`,
        ].join(""),
        from: emailSender(businessName, process.env.BOOKING_EMAIL_FROM ?? ""),
        ...(attachment ? { attachments: [attachment] } : {}),
      });
      outcome.email = sent.ok ? "sent" : `${sent.errorCode}: ${sent.errorDetail}`;
    } else {
      outcome.email = "no email on file";
    }

    // Text, with the link: only with consent on the ledger.
    const phone = text(customer.phone);
    const customerId = text(job.customer_id);
    if (phone && customerId && link) {
      const [{ data: consent }, { data: settings }] = await Promise.all([
        database
          .from("messaging_consent")
          .select("opted_in_at, opted_out_at")
          .eq("organization_id", input.organizationId)
          .eq("customer_id", customerId)
          .eq("channel", "sms")
          .eq("scope", "transactional")
          .maybeSingle(),
        database
          .from("messaging_settings")
          .select("messaging_service_sid")
          .eq("organization_id", input.organizationId)
          .maybeSingle(),
      ]);
      const active = consentIsActive({
        optedInAt: consent?.opted_in_at ? String(consent.opted_in_at) : null,
        optedOutAt: consent?.opted_out_at ? String(consent.opted_out_at) : null,
      });
      const sid = text(settings?.messaging_service_sid);
      if (!active) outcome.sms = "no texting consent";
      else if (!sid) outcome.sms = "texting not set up";
      else {
        const body = `${businessName}: thank you for signing ${what}. Your signed copy: ${link}`;
        const result = await sendSms({ to: phone, body, messagingServiceSid: sid });
        outcome.sms = result.ok ? "sent" : `${result.errorCode}: ${result.errorDetail}`;
        if (result.ok) await recordText(database, input.organizationId, customerId, body, result.providerMessageId);
      }
    } else {
      outcome.sms = phone ? "no link to send" : "no phone on file";
    }
  } catch (error) {
    console.error("signed contract copy failed", { contractId: input.contractId, error });
  }
  return outcome;
}

/** The text, in the customer's conversation, so the business sees it was sent. */
export async function recordText(
  database: ReturnType<typeof getSupabaseAdmin>,
  organizationId: string,
  customerId: string,
  body: string,
  providerMessageId: string,
) {
  const { data: existing } = await database
    .from("conversations")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .eq("channel", "sms")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let conversationId = text(existing?.id);
  if (!conversationId) {
    const { data: created } = await database
      .from("conversations")
      .insert({ organization_id: organizationId, customer_id: customerId, channel: "sms", status: "open" })
      .select("id")
      .single();
    conversationId = text(created?.id);
  }
  if (!conversationId) return;
  const now = new Date().toISOString();
  await database.from("messages").insert({
    organization_id: organizationId,
    conversation_id: conversationId,
    direction: "outbound",
    body,
    status: "sent",
    provider_message_id: providerMessageId,
    sent_at: now,
  });
  await database.from("conversations").update({ last_message_at: now }).eq("id", conversationId);
}
