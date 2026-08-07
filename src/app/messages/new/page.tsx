import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ShieldCheck, UserRoundX } from "lucide-react";

import { startConversation } from "@/app/messages/actions";
import { FieldPageShell } from "@/components/field-page-shell";
import { getMessagingContext, listStartableCustomers } from "@/lib/messaging";

export const metadata: Metadata = { title: "New message | Volteira" };

export default async function NewMessagePage() {
  const context = await getMessagingContext();
  const customers = context ? await listStartableCustomers(context) : [];

  return (
    <FieldPageShell
      title="New message"
      eyebrow="Start a conversation"
      description="Customers who agreed to receive text messages."
      active="Messages"
    >
      <Link
        href="/messages"
        className="tap-target mb-4 inline-flex min-h-11 items-center gap-2 text-sm text-slate-300 hover:text-white"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> All messages
      </Link>

      {customers.length === 0 ? (
        <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-8 text-center">
          <UserRoundX className="mx-auto h-8 w-8 text-slate-600" aria-hidden />
          <h2 className="mt-4 font-semibold">Nobody to start with yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
            This lists customers who ticked the text message box when they booked and do
            not already have a thread. Customers who never opted in, or who replied STOP,
            are deliberately not shown — they cannot be texted.
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#0b1b27]">
          <ul>
            {customers.map((customer, index) => (
              <li key={customer.id}>
                <form action={startConversation}>
                  <input type="hidden" name="customerId" value={customer.id} />
                  <button
                    type="submit"
                    className={`tap-row flex w-full min-h-[72px] items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.03] ${index > 0 ? "border-t border-white/[0.06]" : ""}`}
                  >
                    <span
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white/[0.06] text-sm font-bold text-slate-300"
                      aria-hidden
                    >
                      {customer.initials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-100">
                        {customer.name}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {customer.phone}
                      </span>
                    </span>
                    <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </FieldPageShell>
  );
}
