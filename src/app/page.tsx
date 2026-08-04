import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard-shell";
import { getDashboardSnapshot } from "@/lib/dashboard";

export default async function Home() {
  const snapshot = await getDashboardSnapshot();

  if (snapshot.requiresOnboarding) redirect("/onboarding");

  return <DashboardShell snapshot={snapshot} />;
}
