import Link from "next/link";
import { redirect } from "next/navigation";

import { Banner } from "@/components/ui/banner";
import { MFA_REQUIRED_FROM } from "@/lib/mfa-policy";
import { currentMfaStep } from "@/lib/mfa-server";

const deadline = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "long", day: "numeric" }).format(new Date(MFA_REQUIRED_FROM));

/**
 * Two-step sign-in, on every signed-in page: someone who has it set up but
 * hasn't entered the code this session is sent to enter it; an owner or admin
 * without it is reminded before the deadline and told plainly after it (their
 * money and admin actions refuse until it is set up).
 */
export async function MfaNotice() {
  const step = await currentMfaStep();
  if (step === "verify") redirect("/mfa");
  if (step !== "enroll_soon" && step !== "enroll_now") return null;
  return (
    <div className="mb-2">
      <Banner tone={step === "enroll_now" ? "critical" : "caution"}>
        {step === "enroll_now" ? "Two-step sign-in is required for owners and admins. " : `Owners and admins need two-step sign-in from ${deadline}. `}
        <Link href="/settings/security" className="font-semibold underline">
          Set it up
        </Link>
      </Banner>
    </div>
  );
}
