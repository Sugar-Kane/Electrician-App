import { notFound } from "next/navigation";

import { FieldPageShell } from "@/components/field-page-shell";
import { formatMoney } from "@/lib/invoice-messages";
import { resolveJobId } from "@/lib/job-line-data";
import { materialJobFacts } from "@/lib/material-list";
import { readMaterialList } from "@/lib/material-list-server";
import { cartAgentSteps, cartStore, storeCart } from "@/lib/store-cart";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * A job's materials as a Home Depot or Lowe's cart to fill, for ChatGPT's agent.
 *
 * The agent opens this page in its own browser, signed in to Volteira as the
 * electrician, reads the steps and the lines, and fills the cart on the store's
 * site in the same browser. It is a plain page on purpose: numbered lines with
 * the link, item number and count in text, so nothing has to be opened or
 * guessed at. A person can use it the same way.
 *
 * Signed in only, through the person's own session: the job and its list are
 * read under the same policies as the job page.
 */

export const metadata = { title: "Store cart" };

export default async function StoreCartPage({ params }: { params: Promise<{ jobId: string; store: string }> }) {
  const { jobId: jobNumber, store: slug } = await params;
  const store = cartStore(slug);
  if (!store) notFound();
  const jobId = await resolveJobId(jobNumber);
  if (!jobId) notFound();

  const supabase = asFlexibleClient(await createClient());
  const [saved, job] = await Promise.all([
    readMaterialList(supabase, jobId),
    supabase
      .from("jobs")
      .select("category, customer_description, technician_notes, properties ( city, state ), customers ( customer_type )")
      .eq("id", jobId)
      .maybeSingle(),
  ]);
  const { label, lines, unmatched } = storeCart(saved.list, store);
  // What the work is, for sizing quantities the list leaves out. The town, not
  // the address, and no customer name: the page names parts, not people.
  const row = (job.data as Record<string, unknown> | null) ?? {};
  const place = ((Array.isArray(row.properties) ? row.properties[0] : row.properties) ?? {}) as Record<string, unknown>;
  const facts = materialJobFacts({
        customerType: (Array.isArray(row.customers) ? (row.customers as Record<string, unknown>[])[0] : (row.customers as Record<string, unknown> | null | undefined))?.customer_type,
    category: row.category,
    customerDescription: row.customer_description,
    technicianNotes: row.technician_notes,
    city: place.city,
    state: place.state,
  });

  return (
    <FieldPageShell
      title={`${label} cart`}
      eyebrow={`Job #${jobNumber}`}
      description={`The job's materials list, matched to ${label} products, ready to add to a cart.`}
      backHref={`/jobs/${jobNumber}`}
    >
      <section className="rounded-panel border border-line bg-surface p-5 sm:p-6" aria-labelledby="cart-steps">
        <h2 id="cart-steps" className="font-semibold">
          Instructions for the assistant filling this cart
        </h2>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6">
          {cartAgentSteps(store).map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </section>

      {facts.length > 0 ? (
        <section className="mt-3 rounded-panel border border-line bg-surface p-5 sm:p-6" aria-labelledby="cart-job">
          <h2 id="cart-job" className="font-semibold">
            The job (for recommending products and quantities)
          </h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6">
            {facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-3 rounded-panel border border-line bg-surface p-5 sm:p-6" aria-labelledby="cart-lines">
        <h2 id="cart-lines" className="font-semibold">
          Add to cart ({lines.length} {lines.length === 1 ? "product" : "products"})
        </h2>
        {lines.length === 0 ? (
          <p className="mt-2 text-sm leading-6 text-ink-muted">
            Nothing on this job&apos;s materials list is matched to a {label} product yet. Price the list in the
            job&apos;s Materials chat first.
          </p>
        ) : (
          <ol className="mt-3 divide-y divide-line">
            {lines.map((line, index) => (
              <li key={`${line.url}-${index}`} className="py-3 text-sm leading-6">
                <p className="font-semibold">
                  {index + 1}. {line.product}
                </p>
                <p>
                  {line.needsQty ? (
                    <>
                      Needed: <strong>no quantity on the list. Recommend one</strong> (list says “{line.listed}”)
                    </>
                  ) : (
                    <>
                      Needed: <strong>{line.qty}</strong> (list says “{line.listed}”)
                    </>
                  )}
                </p>
                {line.sku ? (
                  <p>
                    {label} item number: {line.sku}
                  </p>
                ) : null}
                <p>
                  Matched price: {formatMoney(line.cents / 100)} per {line.per}
                </p>
                {line.note ? <p className="text-ink-muted">Note: {line.note}</p> : null}
                <p>
                  Link:{" "}
                  <a className="break-all font-semibold text-brand underline" href={line.url} rel="noreferrer">
                    {line.url}
                  </a>
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {unmatched.length > 0 ? (
        <section className="mt-3 rounded-panel border border-line bg-surface p-5 sm:p-6" aria-labelledby="cart-unmatched">
          <h2 id="cart-unmatched" className="font-semibold">
            Not matched at {label}: find and recommend a product for each
          </h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6">
            {unmatched.map((item, index) => (
              <li key={`${item.listed}-${index}`}>
                {item.listed}
                {item.note ? ` (${item.note})` : ""}
                {item.needsQty ? ": no quantity on the list. Recommend one" : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </FieldPageShell>
  );
}
