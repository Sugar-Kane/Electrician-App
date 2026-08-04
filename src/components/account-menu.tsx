"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  CreditCard,
  LogOut,
  Settings2,
  Store,
  UserRound,
} from "lucide-react";

import { signOut } from "@/app/account/actions";

type AccountSummary = {
  displayName: string;
  email: string;
  role: string;
  plan: string;
  initials: string;
  avatarUrl: string | null;
};

const fallbackSummary: AccountSummary = {
  displayName: "Adam Kane",
  email: "Account settings",
  role: "owner",
  plan: "starter",
  initials: "AK",
  avatarUrl: null,
};

let accountSummaryRequest: Promise<AccountSummary | null> | null = null;

function loadAccountSummary() {
  accountSummaryRequest ??= fetch("/api/account/summary", {
    cache: "no-store",
  })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  return accountSummaryRequest;
}

const accountLinks = [
  { label: "Profile", description: "Name, photo, email", href: "/account?section=profile#profile", icon: UserRound },
  { label: "Premium plan", description: "Subscription and billing", href: "/account?section=subscription#subscription", icon: CreditCard },
  { label: "App settings", description: "Notifications, maps, display", href: "/account?section=preferences#preferences", icon: Settings2 },
  { label: "Square", description: "Merchant and location details", href: "/account?section=square#square", icon: Store },
];

function label(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AccountMenu({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<AccountSummary>(fallbackSummary);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    loadAccountSummary()
      .then((data: AccountSummary | null) => {
        if (active && data?.displayName) setSummary(data);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  const avatarStyle = summary.avatarUrl
    ? { backgroundImage: `url(${JSON.stringify(summary.avatarUrl).slice(1, -1)})` }
    : undefined;
  const light = tone === "light";

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`tap-target flex min-h-11 items-center rounded-xl border transition ${
          light
            ? "border-slate-200 bg-white px-1.5 text-slate-900 hover:border-slate-300"
            : "border-white/10 bg-white/[0.04] px-1.5 text-white hover:bg-white/[0.08]"
        }`}
        aria-label="Open user profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#ffc21c] bg-cover bg-center text-xs font-bold text-[#071723]"
          style={avatarStyle}
          aria-hidden
        >
          {summary.avatarUrl ? null : summary.initials}
        </span>
        <span className="hidden min-w-0 px-2 text-left xl:block">
          <span className="block max-w-28 truncate text-xs font-semibold">{summary.displayName}</span>
          <span className={`block text-[9px] ${light ? "text-slate-500" : "text-slate-400"}`}>
            {label(summary.role)}
          </span>
        </span>
        <ChevronDown className={`hidden h-4 w-4 xl:block ${light ? "text-slate-400" : "text-slate-500"}`} aria-hidden />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+8px)] z-[65] w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-2xl border border-white/10 bg-[#0a1a26] p-2 text-white shadow-2xl shadow-black/40"
        >
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.035] p-3">
            <span
              className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#ffc21c] bg-cover bg-center text-sm font-bold text-[#071723]"
              style={avatarStyle}
              aria-hidden
            >
              {summary.avatarUrl ? null : summary.initials}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{summary.displayName}</span>
              <span className="block truncate text-[11px] text-slate-400">{summary.email}</span>
            </span>
            <span className="rounded-full bg-[#ffc21c]/10 px-2 py-1 text-[9px] font-semibold text-[#ffc21c]">
              {label(summary.plan)}
            </span>
          </div>

          <div className="mt-2 space-y-1">
            {accountLinks.map(({ label: itemLabel, description, href, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="tap-row flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 hover:bg-white/[0.06]"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-[#ffc21c]">
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{itemLabel}</span>
                  <span className="block text-[10px] text-slate-400">{description}</span>
                </span>
              </Link>
            ))}
          </div>

          <form action={signOut} className="mt-2 border-t border-white/10 pt-2">
            <button
              type="submit"
              role="menuitem"
              className="tap-row flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-300 hover:bg-red-400/[0.07] hover:text-red-200"
            >
              <LogOut className="h-[18px] w-[18px]" aria-hidden /> Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
