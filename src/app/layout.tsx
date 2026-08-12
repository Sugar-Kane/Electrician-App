import type { Metadata, Viewport } from "next";
import "./globals.css";

import { ImpersonationBanner } from "@/components/impersonation-banner";

export const metadata: Metadata = {
  title: "Volteira | Electrical Business Operations",
  description:
    "A field-first operating system for electrical contractors to run scheduling, jobs, estimates, invoices, and inventory.",
};

/**
 * The viewport, which until now was Next's default.
 *
 * `viewportFit: "cover"` is the load-bearing line. Four places in this app pad
 * themselves with `env(safe-area-inset-bottom)` to clear the iPhone home
 * indicator — the bottom bar, the create sheet, the menu drawer and the job
 * page. Every one of those resolves to 0 without this, because the safe-area
 * variables only report anything once the viewport is told to cover the
 * display. So the guards were written, reviewed and shipped, and none of them
 * had ever run.
 *
 * No `maximumScale` or `userScalable: false`. Pinch-zoom is how somebody reads
 * a part number in bad light, and taking it away to stop an input zooming is
 * fixing the wrong thing — the inputs are 16px, which is what stops it.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The browser chrome matches the app rather than showing a white bar above it.
  themeColor: "#06131d",
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
        {/*
          First thing in the tab order, invisible until it has focus.

          Every page puts the sidebar and the chrome before its content, so
          reaching the first thing that matters meant tabbing past twenty
          links — on every page, every time. That is the whole day for somebody
          navigating by keyboard.
        */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-control focus:bg-brand focus:px-4 focus:py-3 focus:text-sm focus:font-semibold focus:text-on-brand"
        >
          Skip to content
        </a>
        <ImpersonationBanner />
        {children}
      </body>
    </html>
  );
}
