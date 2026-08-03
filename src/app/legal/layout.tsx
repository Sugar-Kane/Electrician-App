import Link from "next/link";
import { Zap } from "lucide-react";

// Public shell for the legal pages. Deliberately does NOT use FieldPageShell:
// these must render for signed-out visitors (carrier reviewers), so there is
// no dashboard chrome, no back-to-app nav, and nothing that assumes a session.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#06131d] px-4 py-10 text-white sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sm font-bold">
          <Zap className="h-5 w-5 fill-[#ffbf18] text-[#ffbf18]" aria-hidden /> VOLTERRA
        </Link>
        <article className="legal-prose mt-6 rounded-3xl border border-white/10 bg-[#0b1b27] p-6 sm:p-8">
          {children}
        </article>
        <nav className="mt-6 flex gap-4 text-sm text-slate-400">
          <Link href="/legal/privacy" className="hover:text-white">Privacy Policy</Link>
          <Link href="/legal/terms" className="hover:text-white">Terms &amp; Conditions</Link>
        </nav>
      </div>
    </main>
  );
}
