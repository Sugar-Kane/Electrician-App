import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardSnapshot } from "@/lib/dashboard";

export default async function Home() {
  const snapshot = await getDashboardSnapshot();

  return <DashboardShell snapshot={snapshot} />;
}
