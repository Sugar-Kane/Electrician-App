import { FieldPageShell } from "@/components/field-page-shell";
import { RouteOptimizer } from "@/components/route-optimizer";

export default async function RoutePage({ searchParams }: { searchParams: Promise<{ job?: string }> }) {
  const { job } = await searchParams;
  return (
    <FieldPageShell title="Route builder" eyebrow="Dispatch optimization" description="Volterra builds and locks the stop order first. Navigation opens only after you approve the route." active="More">
      <RouteOptimizer focusJobId={job} />
    </FieldPageShell>
  );
}
