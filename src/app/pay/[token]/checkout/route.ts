import { headers } from "next/headers";

import { originFromHeaders } from "@/lib/booking-checkout";
import { startPlanCheckout } from "@/lib/job-prepayment-pay";

/**
 * The Pay button on a deposit or installment's pay link.
 *
 * A POST from the pay page, so a link previewer fetching the URL never opens a
 * checkout. Sends the customer to Stripe; anything that stops that lands them
 * back on the pay page with a word about why.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = originFromHeaders(await headers());
  const back = (why: string) => Response.redirect(`${origin || ""}/pay/${encodeURIComponent(token)}${why ? `?pay=${why}` : ""}`, 303);

  if (!UUID.test(token) || !origin) return back("unavailable");
  const checkout = await startPlanCheckout({ token, origin });
  if ("error" in checkout) return back(checkout.error);
  return Response.redirect(checkout.url, 303);
}
