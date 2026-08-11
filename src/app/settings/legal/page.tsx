import type { Metadata } from "next";
import { ShieldCheck, TriangleAlert } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { TenantLegalForm } from "@/components/tenant-legal-form";
import { getOwnTenantLegalPage } from "@/lib/tenant-legal";

export const metadata: Metadata = { title: "Legal pages | Volteira" };

export default async function TenantLegalSettingsPage() {
  const page = await getOwnTenantLegalPage();

  return (
    <FieldPageShell
      backHref="/settings"
      title="Legal pages"
      eyebrow="Messaging compliance"
      description="The Privacy Policy and Text Message Terms customers and mobile carriers read."
    >
      {page ? (
        <>
          <section
            className={`mb-4 rounded-3xl border p-5 sm:p-6 ${page.published ? "border-emerald-400/20 bg-emerald-400/[0.045]" : "border-amber-300/25 bg-amber-300/[0.06]"}`}
          >
            <div className="flex items-start gap-3">
              {page.published ? (
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden />
              ) : (
                <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />
              )}
              <div>
                <h2 className="font-semibold">
                  {page.published ? "Your pages are live" : "Your pages are not published yet"}
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  {page.published
                    ? "Anyone with the link can read them, including a carrier reviewing your text message campaign."
                    : "We filled in what we know from your signup so you can check it. Nothing is public until you publish, and a text message campaign cannot be approved until these pages open without signing in."}
                </p>
              </div>
            </div>
          </section>

          <TenantLegalForm page={page} />
        </>
      ) : (
        <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-6 text-center">
          <TriangleAlert className="mx-auto h-7 w-7 text-slate-600" aria-hidden />
          <h2 className="mt-3 font-semibold">No legal pages yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
            These are created with your business workspace. Finish onboarding — business
            name, phone, and address — and they will appear here ready to review.
          </p>
        </section>
      )}
    </FieldPageShell>
  );
}
