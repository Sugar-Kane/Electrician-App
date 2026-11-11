import { TriangleAlert } from "lucide-react";

import { Card, Empty } from "@/components/admin-ui";
import type { OrganizationDetail } from "@/lib/admin-console";
import { formatCents } from "@/lib/job-lines";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { deleteBusiness, deleteOneRecord, removeStrayFiles, wipeBusinessData } from "./data-actions";
import { invoiceLabel } from "@/lib/invoice-label";

/**
 * Deleting a business's data: one record, everything customer-side, or the
 * whole business. Platform owners only; the database refuses anyone else.
 *
 * Nothing here can be undone. Each form asks for a reason, which goes on the
 * admin audit log, and the two big ones ask for the business's name.
 */

const FIELD =
  "min-h-10 w-full rounded-control border border-line bg-raised px-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand/70";

const OUTCOMES: Record<string, { text: string; bad: boolean }> = {
  deleted: { text: "Deleted.", bad: false },
  wiped: { text: "All customer records were deleted. The business, its people and its settings are still here.", bad: false },
  files: { text: "Leftover files removed.", bad: false },
  reason: { text: "Nothing was deleted: say why. The reason goes on the audit log.", bad: true },
  name: { text: "Nothing was deleted: type the business name exactly.", bad: true },
  owner: { text: "Nothing was deleted: only a platform owner can delete data.", bad: true },
  missing: { text: "Nothing was deleted: that record is already gone.", bad: true },
  error: { text: "Nothing was deleted. Try again.", bad: true },
};

type Row = { id: string; title: string; detail: string };

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function person(row: Record<string, unknown> | null | undefined): string {
  if (!row) return "";
  return text(row.company_name) || [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ");
}

function one(value: unknown): Record<string, unknown> | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "object" && first !== null ? (first as Record<string, unknown>) : null;
}

async function records(organizationId: string, query: string) {
  const db = getSupabaseAdmin();
  const [customers, jobs, invoices, bookings, contracts] = await Promise.all([
    db.from("customers").select("id, first_name, last_name, company_name, phone, email, created_at, jobs(count)").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(200),
    db.from("jobs").select("id, job_number, status, category, customer_description, customers(first_name,last_name,company_name)").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(200),
    db.from("invoices").select("id, invoice_number, number_label, status, total_cents, jobs(job_number)").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(200),
    db.from("booking_requests").select("id, source, status, contact_name, phone, description, created_at").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(200),
    db.from("contracts").select("id, status, kind, jobs(job_number)").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(200),
  ]);

  const needle = query.toLowerCase();
  const keep = (row: Row) => !needle || `${row.title} ${row.detail}`.toLowerCase().includes(needle);
  const rows = (data: unknown) => (Array.isArray(data) ? (data as Record<string, unknown>[]) : []);

  return {
    customer: rows(customers.data).map((row) => {
      const count = Number(one(row.jobs)?.count ?? 0);
      return {
        id: text(row.id),
        title: person(row) || "Unnamed customer",
        detail: [text(row.phone), text(row.email), `${count} ${count === 1 ? "job" : "jobs"}`].filter(Boolean).join(" · "),
      };
    }).filter(keep),
    job: rows(jobs.data).map((row) => ({
      id: text(row.id),
      title: `Job #${text(row.job_number)}`,
      detail: [person(one(row.customers)), text(row.status).replace(/_/g, " "), text(row.customer_description).slice(0, 80)].filter(Boolean).join(" · "),
    })).filter(keep),
    invoice: rows(invoices.data).map((row) => ({
      id: text(row.id),
      title: `INV-${invoiceLabel(row)}`,
      detail: [formatCents(Number(row.total_cents ?? 0)), text(row.status), one(row.jobs)?.job_number ? `job #${text(one(row.jobs)?.job_number)}` : ""].filter(Boolean).join(" · "),
    })).filter(keep),
    booking: rows(bookings.data).map((row) => ({
      id: text(row.id),
      title: text(row.contact_name) || text(row.phone) || "Booking request",
      detail: [text(row.source), text(row.status), text(row.created_at).slice(0, 10), text(row.description).slice(0, 80)].filter(Boolean).join(" · "),
    })).filter(keep),
    contract: rows(contracts.data).map((row) => ({
      id: text(row.id),
      title: `${text(row.kind) === "change_order" ? "Change order" : "Agreement"}${one(row.jobs)?.job_number ? ` · job #${text(one(row.jobs)?.job_number)}` : ""}`,
      detail: text(row.status),
    })).filter(keep),
  };
}

const SECTIONS = [
  { kind: "customer", title: "Customers", note: "Deleting a customer also deletes their addresses, jobs (with invoices, contracts and files), booking requests, texts and calls." },
  { kind: "job", title: "Jobs", note: "Deleting a job also deletes its invoices, payments, contracts, materials list and files." },
  { kind: "invoice", title: "Invoices", note: "The invoice and its PDF go; the job's items go back to not billed." },
  { kind: "booking", title: "Booking requests", note: "Only the request; a job made from it stays." },
  { kind: "contract", title: "Contracts", note: "The contract and its PDF, signed or not." },
] as const;

function DeleteRow({ organizationId, kind, row }: { organizationId: string; kind: string; row: Row }) {
  return (
    <li className="rounded-control border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{row.title}</p>
          {row.detail ? <p className="mt-0.5 truncate text-xs text-ink-muted">{row.detail}</p> : null}
        </div>
        <details className="group">
          <summary className="tap-target inline-flex min-h-9 cursor-pointer list-none items-center rounded-control border border-critical/40 px-3 text-xs font-semibold text-critical">
            Delete…
          </summary>
          <form action={deleteOneRecord} className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="recordId" value={row.id} />
            <input name="reason" required minLength={3} maxLength={200} placeholder="Why, e.g. test data" aria-label="Reason" className={FIELD} />
            <button type="submit" className="tap-target min-h-10 shrink-0 rounded-control bg-critical px-4 text-xs font-bold text-white">
              Delete for good
            </button>
          </form>
        </details>
      </div>
    </li>
  );
}

export async function DataTab({
  organization,
  owner,
  query,
  done,
  files,
}: {
  organization: OrganizationDetail;
  owner: boolean;
  query: string;
  done: string;
  files: string;
}) {
  const id = organization.id;
  if (!owner) {
    return (
      <Card title="Delete data" id="data">
        <p className="text-sm text-ink-muted">Only a platform owner can delete a business&apos;s data.</p>
      </Card>
    );
  }

  const [lists, strays] = await Promise.all([
    records(id, query),
    // As the signed-in owner: the database decides who may see this.
    createClient().then((client) => asFlexibleClient(client).rpc("admin_stray_document_files", { p_organization_id: id })).then(
      (result) => (Array.isArray(result.data) ? result.data.length : 0),
      () => 0,
    ),
  ]);
  const outcome = OUTCOMES[done];
  const removedFiles = Number(files) > 0 ? ` ${files} ${files === "1" ? "file" : "files"} removed.` : "";

  return (
    <>
      <div id="data" className="scroll-mt-28" />
      {outcome ? (
        <p className={`rounded-control border px-3 py-2 text-sm ${outcome.bad ? "border-critical/30 bg-critical-bg text-critical" : "border-positive/30 bg-positive-bg text-positive"}`}>
          {outcome.text}
          {outcome.bad ? "" : removedFiles}
        </p>
      ) : null}

      <p className="flex items-start gap-2 rounded-control border border-caution/25 bg-caution-bg px-3 py-2 text-sm text-caution">
        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        Deleting is permanent. There is no undo, and customers&apos; payment links, contracts and texts stop working. Every
        deletion is written to the audit log with your reason. To change a record instead, use &ldquo;Make changes as this
        business&rdquo; on the Summary tab.
      </p>

      <form className="flex gap-2" action={`/admin/organizations/${id}`}>
        <input type="hidden" name="tab" value="data" />
        <input name="q" defaultValue={query} placeholder="Find by name, phone, job or invoice number" aria-label="Find" className={FIELD} />
        <button type="submit" className="tap-target min-h-10 shrink-0 rounded-control border border-line px-4 text-xs font-semibold">Find</button>
      </form>

      {SECTIONS.map((section) => {
        const rows = lists[section.kind];
        return (
          <Card key={section.kind} title={section.title} aside={`${rows.length}`}>
            <p className="text-xs text-ink-faint">{section.note}</p>
            {rows.length === 0 ? (
              <div className="mt-3"><Empty>{query ? "Nothing matches." : "None."}</Empty></div>
            ) : (
              <ul className="mt-3 space-y-2">
                {rows.map((row) => <DeleteRow key={row.id} organizationId={id} kind={section.kind} row={row} />)}
              </ul>
            )}
          </Card>
        );
      })}

      {strays > 0 ? (
        <Card title="Leftover files" aside={`${strays}`}>
          <p className="text-sm text-ink-muted">Stored files that no record points at any more. Nobody can open them from the app.</p>
          <form action={removeStrayFiles} className="mt-3">
            <input type="hidden" name="organizationId" value={id} />
            <button type="submit" className="tap-target min-h-10 rounded-control border border-critical/40 px-4 text-xs font-bold text-critical">
              Remove {strays} leftover {strays === 1 ? "file" : "files"}
            </button>
          </form>
        </Card>
      ) : null}

      <Card title="Wipe all customer records">
        <p className="text-sm leading-6 text-ink-muted">
          Deletes every customer, address, job, estimate, invoice, payment, contract, booking request, text, call, the files
          filed against them, the activity log and the assistant&apos;s notes. Keeps {organization.name} itself: its people
          and logins, settings, hours, templates, saved signature, texting number, stock list, and Stripe and Google
          connections.
        </p>
        <form action={wipeBusinessData} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="organizationId" value={id} />
          <input name="confirmName" required placeholder={`Type ${organization.name}`} aria-label="Business name" className={FIELD} autoComplete="off" />
          <input name="reason" required minLength={3} maxLength={200} placeholder="Why" aria-label="Reason" className={FIELD} />
          <button type="submit" className="tap-target min-h-10 rounded-control bg-critical px-4 text-sm font-bold text-white sm:col-span-2 sm:justify-self-start">
            Wipe all customer records
          </button>
        </form>
      </Card>

      <Card title="Delete this business">
        <p className="text-sm leading-6 text-ink-muted">
          Deletes {organization.name} entirely: all of the above, plus its settings, people&apos;s access to it, its texting
          and website setup, and its Stripe and Google links in Volteira. People&apos;s logins stay, belonging to no business.
          Its Stripe account itself is not closed; do that in Stripe if needed.
        </p>
        <form action={deleteBusiness} className="mt-3 grid gap-2 sm:grid-cols-2">
          <input type="hidden" name="organizationId" value={id} />
          <input name="confirmName" required placeholder={`Type ${organization.name}`} aria-label="Business name" className={FIELD} autoComplete="off" />
          <input name="reason" required minLength={3} maxLength={200} placeholder="Why" aria-label="Reason" className={FIELD} />
          <button type="submit" className="tap-target min-h-10 rounded-control bg-critical px-4 text-sm font-bold text-white sm:col-span-2 sm:justify-self-start">
            Delete {organization.name} for good
          </button>
        </form>
      </Card>
    </>
  );
}
