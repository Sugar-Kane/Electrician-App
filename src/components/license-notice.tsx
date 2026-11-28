import Link from "next/link";

import { Banner } from "@/components/ui/banner";
import { businessLicenseWarning } from "@/lib/license-status-server";
import { currentContext } from "@/lib/request-context";

/**
 * The contractor license reminder on every page, for owners and admins
 * (compliance CSLB-001-002): a reminder when it hasn't been entered or checked
 * in 90 days, and a plain warning when it is recorded as lapsed (billing waits
 * for an acknowledgement in Settings → Business).
 */
export async function LicenseNotice() {
  const context = await currentContext();
  if (!context || (context.role !== "owner" && context.role !== "admin")) return null;
  const warning = await businessLicenseWarning(context.organizationId);
  if (warning.level === "none") return null;
  const blocking = warning.level === "lapsed" && !warning.acknowledged;
  return (
    <div className="mb-2">
      <Banner tone={blocking ? "critical" : "caution"}>
        {warning.message}
        {blocking ? " Invoices and pay links wait until you update or acknowledge it. " : " "}
        <Link href="/settings/business" className="font-semibold underline">
          {blocking ? "Review it" : "Update it"}
        </Link>
      </Banner>
    </div>
  );
}
