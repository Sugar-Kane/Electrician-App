import { getAccountSnapshot } from "@/lib/account";
import { isPlatformAdmin } from "@/lib/admin-console";

export async function GET() {
  const account = await getAccountSnapshot();
  if (account.requiresLogin) {
    return Response.json(
      { error: "Authentication required." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  return Response.json(
    {
      displayName: account.displayName,
      email: account.email,
      role: account.role,
      plan: account.subscription.plan,
      initials: account.initials,
      avatarUrl: account.avatarUrl,
      // Decides only whether the menu shows a link. The console itself refuses
      // in the database, so a tampered response buys nothing.
      isPlatformAdmin: await isPlatformAdmin(),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
