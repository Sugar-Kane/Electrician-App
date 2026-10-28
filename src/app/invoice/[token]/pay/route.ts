import { headers } from "next/headers";

import { originFromHeaders } from "@/lib/booking-checkout";
import { startInvoiceCheckout } from "@/lib/invoice-online-pay";

/**
 * The Pay button on a customer's invoice.
 *
 * A POST from the invoice page, so a link previewer fetching the URL never
 * opens a checkout. Sends the customer to Stripe to pay what is owed, by bank
 * or card; anything that stops that lands them back on their invoice with a
 * word about why.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const origin = originFromHeaders(await headers());
  const back = (why: string) =>
    Response.redirect(`${origin || ""}/invoice/${encodeURIComponent(token)}${why ? `?pay=${why}` : ""}`, 303);

  if (!UUID.test(token) || !origin) return back("unavailable");

  const checkout = await startInvoiceCheckout({ token, origin });
  if ("error" in checkout) return back(checkout.error);
  return Response.redirect(checkout.url, 303);
}
