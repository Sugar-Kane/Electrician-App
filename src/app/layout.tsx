import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Volterra | Electrical Business Operations",
  description:
    "A field-first operating system for electrical contractors to run scheduling, jobs, estimates, invoices, and inventory.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" data-scroll-behavior="smooth">
      <body className="min-h-full bg-[#06131d] text-slate-950">{children}</body>
    </html>
  );
}
