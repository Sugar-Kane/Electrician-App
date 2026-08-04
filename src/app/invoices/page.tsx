import Link from "next/link";
import { CheckCircle2, ChevronRight, CircleDollarSign, Clock3, ReceiptText, TriangleAlert } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { getInvoices } from "@/lib/job-data";

const filters = [
  { label: "All", value: "all" },
  { label: "Paid", value: "paid" },
  { label: "Unpaid", value: "unpaid" },
  { label: "Overdue", value: "overdue" },
];

const statusStyles = {
  Paid: "bg-emerald-400/10 text-emerald-300",
  Unpaid: "bg-blue-400/10 text-blue-300",
  Overdue: "bg-red-400/10 text-red-300",
};

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status = "all" } = await searchParams;
  const { invoices: allInvoices } = await getInvoices();
  const visible = status === "all" ? allInvoices : allInvoices.filter((invoice) => invoice.status.toLowerCase() === status);
  const total = visible.reduce((sum, invoice) => sum + invoice.amount, 0);

  return (
    <FieldPageShell title={status === "paid" ? "Paid invoices" : status === "unpaid" ? "Unpaid invoices" : status === "overdue" ? "Overdue invoices" : "Invoices"} eyebrow="Revenue and collections" description="Tap an invoice to open its related job and customer context." active="More">
      <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-4 sm:p-6">
        <div className="grid grid-cols-4 gap-1.5">
          {filters.map((filter) => <Link key={filter.value} href={`/invoices?status=${filter.value}`} className={`tap-target flex min-h-11 items-center justify-center rounded-xl text-xs font-semibold ${status === filter.value || (status === "all" && filter.value === "all") ? "bg-[#ffc21c] text-[#071723]" : "border border-white/10 text-slate-300"}`}>{filter.label}</Link>)}
        </div>
        <div className="mt-5 flex items-end justify-between rounded-3xl bg-white/[0.035] p-4"><div><p className="text-xs text-slate-500">Visible total</p><p className="mt-1 text-3xl font-semibold">${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p></div><CircleDollarSign className="h-7 w-7 text-[#ffc21c]" aria-hidden /></div>
        <div className="mt-4 space-y-2">
          {visible.map((invoice) => (
            <Link key={invoice.id} href={`/jobs/${invoice.jobId}`} className="tap-row flex min-h-[76px] items-center gap-3 rounded-2xl border border-white/10 px-4 py-3 active:bg-white/5">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/5"><ReceiptText className="h-5 w-5 text-[#ffc21c]" aria-hidden /></span>
              <span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="font-semibold">{invoice.id}</span><span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold ${statusStyles[invoice.status]}`}>{invoice.status}</span></span><span className="mt-1 block truncate text-xs text-slate-400">{invoice.customer} · {invoice.due}</span></span>
              <span className="shrink-0 text-right"><span className="block text-sm font-semibold">${invoice.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span><ChevronRight className="ml-auto mt-1 h-4 w-4 text-slate-500" aria-hidden /></span>
            </Link>
          ))}
        </div>
      </section>
      <div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-3xl border border-white/10 bg-[#0b1b27] p-4"><CheckCircle2 className="h-5 w-5 text-emerald-400" aria-hidden /><p className="mt-3 text-sm font-semibold">Paid</p><p className="mt-1 text-xs text-slate-400">Revenue received and ready for reporting.</p></div><div className="rounded-3xl border border-white/10 bg-[#0b1b27] p-4"><Clock3 className="h-5 w-5 text-blue-400" aria-hidden /><p className="mt-3 text-sm font-semibold">Unpaid</p><p className="mt-1 text-xs text-slate-400">Open balances that are not past due.</p></div><div className="rounded-3xl border border-white/10 bg-[#0b1b27] p-4"><TriangleAlert className="h-5 w-5 text-red-400" aria-hidden /><p className="mt-3 text-sm font-semibold">Overdue</p><p className="mt-1 text-xs text-slate-400">Accounts that need collection follow-up.</p></div></div>
    </FieldPageShell>
  );
}
