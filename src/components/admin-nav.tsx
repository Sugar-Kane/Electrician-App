"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The console's sections. The older addresses still work and light up the
 * section they belong to: a business page is under Companies, the people list
 * under Access & audit.
 */
const SECTIONS = [
  { href: "/admin/overview", label: "Overview", match: (path: string) => path.startsWith("/admin/overview") },
  {
    href: "/admin",
    label: "Companies",
    match: (path: string) => path === "/admin" || path.startsWith("/admin/organizations") || path.startsWith("/admin/search"),
  },
  { href: "/admin/cases", label: "Cases", match: (path: string) => path.startsWith("/admin/cases") },
  { href: "/admin/recovery", label: "Operations", match: (path: string) => path.startsWith("/admin/recovery") },
  {
    href: "/admin/audit",
    label: "Access & audit",
    match: (path: string) => path.startsWith("/admin/audit") || path.startsWith("/admin/users"),
  },
  { href: "/admin/front-page", label: "Front page", match: (path: string) => path.startsWith("/admin/front-page") },
];

export function AdminNav() {
  const path = usePathname() ?? "";
  return (
    <nav aria-label="Support console" className="flex flex-wrap gap-2 text-sm">
      {SECTIONS.map((section) => {
        const current = section.match(path);
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={current ? "page" : undefined}
            className={`tap-target rounded-chip px-3 py-2 font-semibold ${current ? "bg-brand text-on-brand" : "border border-line"}`}
          >
            {section.label}
          </Link>
        );
      })}
      <Link href="/" className="tap-target rounded-chip border border-line px-3 py-2 font-semibold">
        Exit
      </Link>
    </nav>
  );
}
