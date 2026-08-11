import type { Metadata } from "next";
import "./globals.css";

import { ImpersonationBanner } from "@/components/impersonation-banner";

export const metadata: Metadata = {
  title: "Volteira | Electrical Business Operations",
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
      {/*
        The banner lives here rather than in a page shell so that a page cannot
        render without it. Acting inside somebody else's business must never be
        a state you can be in without being told.
      */}
      <body className="min-h-full bg-canvas text-ink">
        <ImpersonationBanner />
        {children}
      </body>
    </html>
  );
}
