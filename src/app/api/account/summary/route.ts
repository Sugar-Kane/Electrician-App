import { getAccountSnapshot } from "@/lib/account";

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
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
