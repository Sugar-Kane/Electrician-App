import { getAccountSnapshot } from "@/lib/account";
import { isPlatformAdmin } from "@/lib/admin-console";
import { currentBusinesses, currentContext } from "@/lib/request-context";

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
      // Only for someone in more than one business: which ones, and which this
      // session acts for. Choosing one is checked again on the server.
      businesses: await (async () => {
        const [businesses, context] = await Promise.all([currentBusinesses(), currentContext()]);
        return businesses.length > 1
          ? businesses.map((business) => ({ id: business.id, name: business.name, current: business.id === context?.organizationId }))
          : [];
      })(),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
