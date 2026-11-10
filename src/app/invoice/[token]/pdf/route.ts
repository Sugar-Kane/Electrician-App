import { invoicePdfForLink } from "@/lib/invoice-pdf-file";

/**
 * The customer's invoice as a PDF, from their invoice link. Opens in the
 * browser; `?download=1` saves it instead. The link's token is the key, the
 * same one the invoice page uses.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const pdf = await invoicePdfForLink(token);
  if (!pdf) return new Response("This invoice could not be found.", { status: 404, headers: { "Cache-Control": "no-store" } });
  const download = new URL(request.url).searchParams.get("download") === "1";
  const name = pdf.fileName.replace(/[^\w.\- ]+/g, "").trim() || "invoice.pdf";
  return new Response(pdf.bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
