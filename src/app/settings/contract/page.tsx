import { ContractSignerSection, type SavedSigner } from "@/components/contract-signer-form";
import { ContractTemplateForm } from "@/components/contract-template-form";
import { FieldPageShell } from "@/components/field-page-shell";
import { getAccountSnapshot } from "@/lib/account";
import { STARTER_TEMPLATE } from "@/lib/contract-template";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The business's contract, as a template, and the signature you sign it with.
 *
 * A business that has not saved one gets a starter rather than an empty box —
 * an empty textarea labelled "your contract" is a screen people leave.
 *
 * The signature is yours rather than the business's: whoever sends a contract
 * signs it for the business, each with the one they adopted here.
 */
export default async function ContractSettingsPage() {
  const context = await currentContext();
  let body = STARTER_TEMPLATE;
  let saved: SavedSigner | null = null;
  let businessName = "";
  let defaultName = "";

  if (context) {
    const supabase = asFlexibleClient(await createClient());
    const [template, signer, organization, account] = await Promise.all([
      supabase
        .from("contract_templates")
        .select("body")
        .eq("organization_id", context.organizationId)
        .maybeSingle(),
      supabase
        .from("contract_signers")
        .select("signer_name, signer_title, method, image, adopted_at")
        .eq("organization_id", context.organizationId)
        .eq("user_id", context.userId)
        .maybeSingle(),
      supabase.from("organizations").select("name").eq("id", context.organizationId).maybeSingle(),
      getAccountSnapshot(),
    ]);

    if (typeof template.data?.body === "string" && template.data.body.trim()) body = template.data.body;
    businessName = typeof organization.data?.name === "string" ? organization.data.name : "";
    defaultName = account.displayName;

    const row = (signer.data ?? null) as Record<string, unknown> | null;
    if (row && (row.method === "drawn" || row.method === "typed")) {
      saved = {
        name: typeof row.signer_name === "string" ? row.signer_name : "",
        title: typeof row.signer_title === "string" ? row.signer_title : "",
        method: row.method,
        image: typeof row.image === "string" ? row.image : "",
        adoptedLabel: new Intl.DateTimeFormat("en-US", {
          timeZone: context.timeZone,
          month: "short",
          day: "numeric",
          year: "numeric",
        }).format(new Date(String(row.adopted_at))),
      };
    }
  }

  return (
    <FieldPageShell
      title="Contract"
      eyebrow="Business settings"
      description="The agreement your customers sign, with the job details filled in for you."
      backHref="/settings"
    >
      <div className="space-y-4">
        {context ? (
          <ContractSignerSection saved={saved} defaultName={defaultName} businessName={businessName} />
        ) : null}
        <ContractTemplateForm body={body} />
      </div>
    </FieldPageShell>
  );
}
