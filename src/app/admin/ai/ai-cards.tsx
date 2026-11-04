import { Card, Pill } from "@/components/admin-ui";
import { aiUsageSummary } from "@/lib/ai-allowance";
import { DEFAULT_MONTHLY_AI_USES, monthlyAiLimit, paidPlanActive } from "@/lib/ai-allowance-rules";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { setBusinessAiAllowance, setDefaultAiLimit } from "./actions";

/**
 * The built-in AI allowance in the admin console: what a business has used
 * this month and what it is allowed, and, for a platform owner, the setting.
 */

const FIELD =
  "min-h-11 w-full rounded-control border border-line bg-raised px-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand/70";

const NOTICES: Record<string, { text: string; bad: boolean }> = {
  saved: { text: "Saved. It applies to the next AI use.", bad: false },
  reason: { text: "Say why it is changing. The reason goes on the audit log.", bad: true },
  number: { text: "Enter a whole number of uses, 0 or more.", bad: true },
  refused: { text: "That wasn't saved. Only a platform owner can change AI allowances.", bad: true },
  error: { text: "That wasn't saved. Try again.", bad: true },
};

function Notice({ code }: { code: string }) {
  const notice = NOTICES[code];
  if (!notice) return null;
  return <p className={`mt-3 text-sm ${notice.bad ? "text-critical" : "text-positive"}`}>{notice.text}</p>;
}

function deploymentDefault(): number {
  return monthlyAiLimit(process.env.AI_MONTHLY_LIMIT);
}

export async function BusinessAiCard({
  organizationId,
  owner,
  notice,
}: {
  organizationId: string;
  owner: boolean;
  notice: string;
}) {
  const database = getSupabaseAdmin();
  const [summary, own, subscription] = await Promise.all([
    aiUsageSummary(organizationId),
    database.from("organization_ai_allowances").select("monthly_limit, unlimited").eq("organization_id", organizationId).maybeSingle(),
    database.from("organization_subscriptions").select("status").eq("organization_id", organizationId).maybeSingle(),
  ]);
  const row = (own.data ?? {}) as Record<string, unknown>;
  const mode = row.unlimited === true ? "unlimited" : typeof row.monthly_limit === "number" ? "custom" : "default";
  const paid = paidPlanActive(typeof subscription.data?.status === "string" ? subscription.data.status : null);
  const limitText = summary.limit === "unlimited" ? "unlimited" : String(summary.limit);
  const why = mode === "unlimited" ? "set here" : paid ? "Premium plan" : mode === "custom" ? "set here" : "platform default";

  return (
    <Card title="Built-in AI" id="ai" aside={`${summary.used} of ${limitText} this month`}>
      <p className="text-sm leading-6 text-ink-muted">
        Volteira pays for the built-in AI (Materials chat, estimates, contract scope, assistant, receipts, journal). Allowance:{" "}
        <span className="font-semibold text-ink">{limitText}</span> a month ({why}). ChatGPT and Claude never count, and
        neither do customer texts, website requests or calls.
      </p>
      {paid ? <p className="mt-2"><Pill tone="good">Premium: unlimited</Pill></p> : null}

      {owner ? (
        <form action={setBusinessAiAllowance} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <input type="hidden" name="organizationId" value={organizationId} />
          <label className="text-xs text-ink-muted">
            Allowance
            <select name="mode" defaultValue={mode} className={`${FIELD} mt-1`}>
              <option value="default">Platform default</option>
              <option value="custom">A number a month</option>
              <option value="unlimited">Unlimited</option>
            </select>
          </label>
          <label className="text-xs text-ink-muted">
            Uses a month (for &ldquo;A number a month&rdquo;)
            <input
              name="limit"
              inputMode="numeric"
              defaultValue={typeof row.monthly_limit === "number" ? String(row.monthly_limit) : ""}
              placeholder="e.g. 500"
              className={`${FIELD} mt-1`}
            />
          </label>
          <label className="text-xs text-ink-muted sm:col-span-2">
            Reason
            <input name="reason" required minLength={3} maxLength={200} placeholder="Why, e.g. pilot customer" className={`${FIELD} mt-1`} />
          </label>
          <div className="sm:col-span-2">
            <button type="submit" className="tap-target min-h-11 rounded-control border border-brand/50 px-5 text-sm font-bold text-brand">
              Save allowance
            </button>
          </div>
        </form>
      ) : (
        <p className="mt-3 text-xs text-ink-faint">Only a platform owner can change this.</p>
      )}
      <Notice code={notice} />
    </Card>
  );
}

export async function DefaultAiCard({ owner, notice }: { owner: boolean; notice: string }) {
  const { data } = await getSupabaseAdmin().from("platform_settings").select("ai_default_monthly_limit").eq("id", true).maybeSingle();
  const stored = typeof data?.ai_default_monthly_limit === "number" ? data.ai_default_monthly_limit : null;
  const fallback = deploymentDefault();
  const effective = stored ?? fallback;

  return (
    <Card title="Built-in AI allowance" id="ai" aside={`${effective} a month`}>
      <p className="text-sm leading-6 text-ink-muted">
        How many built-in AI uses each business gets a month, unless it has its own setting or is on Premium (unlimited).
        {stored === null ? ` Using the deployment default (${fallback}${fallback === DEFAULT_MONTHLY_AI_USES ? "" : ", from AI_MONTHLY_LIMIT"}).` : ""}
      </p>
      {owner ? (
        <form action={setDefaultAiLimit} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            name="limit"
            inputMode="numeric"
            defaultValue={stored === null ? "" : String(stored)}
            placeholder={`Blank = ${fallback}`}
            aria-label="Uses a month"
            className={`${FIELD} sm:w-40`}
          />
          <input name="reason" required minLength={3} maxLength={200} placeholder="Reason" aria-label="Reason" className={`${FIELD} sm:flex-1`} />
          <button type="submit" className="tap-target min-h-11 shrink-0 rounded-control border border-brand/50 px-5 text-sm font-bold text-brand">
            Save
          </button>
        </form>
      ) : (
        <p className="mt-3 text-xs text-ink-faint">Only a platform owner can change this.</p>
      )}
      <Notice code={notice} />
    </Card>
  );
}
