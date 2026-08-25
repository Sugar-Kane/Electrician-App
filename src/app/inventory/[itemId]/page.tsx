import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, MapPin, Truck } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { StockAdjust } from "@/components/stock-adjust";
import { StockPhoto } from "@/components/stock-photo";
import { getInventoryItem } from "@/lib/job-data";
import { movementLabel } from "@/lib/inventory-movement";

export const dynamic = "force-dynamic";

/**
 * One part.
 *
 * The photo sits top right where you look for it, the number sits beside it,
 * and underneath is the history that explains the number. That history is the
 * point of the whole feature: "seventeen" on its own is a claim, and "twenty in
 * on the 3rd, three out on job 1045" is something somebody can argue with —
 * which is what makes a stock list worth keeping.
 */
export default async function StockItemPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = await params;
  const item = await getInventoryItem(itemId);
  if (!item) notFound();

  const money = (cents: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

  const low = item.quantity <= 0;

  return (
    <FieldPageShell title={item.name} eyebrow="Stock" backHref="/inventory">
      <section className="rounded-panel border border-line bg-surface p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-ink">{item.name}</h2>
            {item.partNumber ? (
              <p className="mt-0.5 font-mono text-xs text-ink-muted">{item.partNumber}</p>
            ) : null}

            <p className="mt-3 flex items-baseline gap-2">
              <span
                className={`text-3xl font-semibold ${low ? "text-critical" : "text-brand"}`}
              >
                {item.quantity}
              </span>
              <span className="text-sm text-ink-muted">{item.unit} on hand</span>
            </p>

            <dl className="mt-3 grid gap-1 text-xs text-ink-muted">
              {item.unitCost !== null ? (
                <div className="flex gap-2">
                  <dt className="text-ink-faint">Each</dt>
                  <dd>{money(Math.round(item.unitCost * 100))}</dd>
                </div>
              ) : null}
              {item.location ? (
                <div className="flex items-center gap-2">
                  <dt className="sr-only">Where it is</dt>
                  <dd className="flex items-center gap-1">
                    <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                    {item.location}
                  </dd>
                </div>
              ) : null}
              {item.supplier ? (
                <div className="flex items-center gap-2">
                  <dt className="sr-only">Supplier</dt>
                  <dd className="flex items-center gap-1">
                    <Truck className="h-3 w-3 shrink-0" aria-hidden />
                    {item.supplier}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>

          {/* Top right, where a picture of a thing belongs. */}
          <StockPhoto itemId={item.id} photoUrl={item.photoUrl} name={item.name} />
        </div>

        {item.notes ? (
          <p className="mt-4 rounded-control border border-line bg-raised p-3 text-sm text-ink-muted">
            {item.notes}
          </p>
        ) : null}
      </section>

      <div className="mt-3">
        <StockAdjust itemId={item.id} unit={item.unit} />
      </div>

      <section className="mt-3 rounded-panel border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-muted">
            Where it went
          </h2>
          {item.spentCents > 0 ? (
            <p className="text-xs text-ink-faint">
              {money(item.spentCents)} of this part has gone out on jobs
            </p>
          ) : null}
        </div>

        {item.movements.length === 0 ? (
          <p className="mt-3 text-sm text-ink-muted">
            Nothing has moved yet. Adding this part to a job takes it off the shelf on its own.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {item.movements.map((movement) => {
              const out = movement.quantity < 0;
              return (
                <li key={movement.id} className="flex items-center gap-3 py-2.5">
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-chip ${
                      out ? "bg-critical/10 text-critical" : "bg-positive/10 text-positive"
                    }`}
                  >
                    {out ? (
                      <ArrowDownRight className="h-4 w-4" aria-hidden />
                    ) : (
                      <ArrowUpRight className="h-4 w-4" aria-hidden />
                    )}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">
                      {movementLabel(movement.reason)}
                      {movement.jobNumber ? (
                        <>
                          {" · "}
                          <Link
                            href={`/jobs/${movement.jobNumber}`}
                            className="text-brand hover:underline"
                          >
                            Job {movement.jobNumber}
                          </Link>
                        </>
                      ) : null}
                    </span>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {movement.whenLabel}
                      {movement.note ? ` · ${movement.note}` : ""}
                    </span>
                  </span>

                  <span
                    className={`shrink-0 text-sm font-semibold ${
                      out ? "text-critical" : "text-positive"
                    }`}
                  >
                    {out ? "" : "+"}
                    {movement.quantity}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </FieldPageShell>
  );
}
