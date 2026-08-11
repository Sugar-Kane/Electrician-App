import { ContractTemplateForm } from "@/components/contract-template-form";
import { FieldPageShell } from "@/components/field-page-shell";
import { STARTER_TEMPLATE } from "@/lib/contract-template";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The business's contract, as a template.
 *
 * A business that has not saved one gets a starter rather than an empty box —
 * an empty textarea labelled "your contract" is a screen people leave.
 */
export default async function ContractSettingsPage() {
  const context = await currentContext();
  let body = STARTER_TEMPLATE;

  if (context) {
    const supabase = asFlexibleClient(await createClient());
    const { data } = await supabase
      .from("contract_templates")
      .select("body")
      .eq("organization_id", context.organizationId)
      .maybeSingle();

    if (typeof data?.body === "string" && data.body.trim()) body = data.body;
  }

  return (
    <FieldPageShell
      title="Contract"
      eyebrow="Business settings"
      description="The agreement your customers sign, with the job details filled in for you."
      backHref="/settings"
    >
      <ContractTemplateForm body={body} />
    </FieldPageShell>
  );
}
