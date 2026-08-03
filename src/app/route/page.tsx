import { FieldPageShell } from "@/components/field-page-shell";
import { RouteOptimizer } from "@/components/route-optimizer";
import type { SupplierId } from "@/lib/pilot-data";

export default async function RoutePage({ searchParams }: { searchParams: Promise<{ job?: string; supplier?: string }> }) {
  const { job, supplier } = await searchParams;
  const initialSupplier: SupplierId = supplier === "home-depot" ? "home-depot" : "lowes";
  return (
    <FieldPageShell title="Route builder" eyebrow="Dispatch optimization" description="Volterra builds and locks the stop order first. Navigation opens only after you approve the route." active="More">
      <RouteOptimizer focusJobId={job} initialSupplier={initialSupplier} />
    </FieldPageShell>
  );
}
