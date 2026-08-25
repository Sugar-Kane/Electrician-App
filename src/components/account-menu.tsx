"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, LogOut, ShieldCheck, UserRound } from "lucide-react";

import { signOut } from "@/app/account/actions";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";
import { NavIcon } from "@/components/ui/nav-icon";
import { ACCOUNT_MENU_ITEMS } from "@/lib/navigation";

/**
 * The account menu.
 *
 * It carried its own open/close, outside-click and Escape handling, and was the
 * only dropdown in the app — so there was nothing for other menus to match. All
 * of that now lives in `Menu`, and this is just the contents.
 *
 * What belongs here is the person and the shape of their business: profile,
 * preferences, Settings, the plan, signing out. Settings and Your account used
 * to be a "Setup" section at the bottom of the left menu, in the same list as
 * Schedule and Invoices — which is a list of work, and neither of those is
 * work. Behind the picture of your face is where every other app on the phone
 * puts them, and it is where people look first.
 *
 * The list itself lives in `navigation.ts` beside the menu, so there is one
 * description of a destination rather than two.
 */

type AccountSummary = {
  displayName: string;
  email: string;
  role: string;
  plan: string;
  initials: string;
  avatarUrl: string | null;
  isPlatformAdmin?: boolean;
};

/**
 * Shown for the moment before the real summary arrives.
 *
 * Deliberately nobody: it used to be a hardcoded name and initials, which meant
 * a signed-in user briefly saw somebody else's name in their own account menu.
 */
const fallbackSummary: AccountSummary = {
  displayName: "Account",
  email: "Profile and preferences",
  role: "owner",
  plan: "starter",
  initials: "",
  avatarUrl: null,
};

let accountSummaryRequest: Promise<AccountSummary | null> | null = null;

function loadAccountSummary() {
  accountSummaryRequest ??= fetch("/api/account/summary", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .catch(() => null);
  return accountSummaryRequest;
}

function label(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function AccountMenu() {
  const [summary, setSummary] = useState<AccountSummary>(fallbackSummary);

  useEffect(() => {
    let active = true;
    loadAccountSummary().then((data: AccountSummary | null) => {
      if (active && data?.displayName) setSummary(data);
    });
    return () => {
      active = false;
    };
  }, []);

  const avatarStyle = summary.avatarUrl
    ? { backgroundImage: `url(${JSON.stringify(summary.avatarUrl).slice(1, -1)})` }
    : undefined;

  const avatar = (size: string) => (
    <span
      className={`grid ${size} shrink-0 place-items-center rounded-chip bg-brand bg-cover bg-center font-bold text-on-brand`}
      style={avatarStyle}
      aria-hidden
    >
      {summary.avatarUrl ? null : summary.initials || <UserRound className="h-4 w-4" />}
    </span>
  );

  return (
    <Menu
      label="Account menu"
      trigger={
        <>
          {avatar("h-9 w-9 text-xs")}
          <span className="hidden min-w-0 px-2 text-left xl:block">
            <span className="block max-w-28 truncate text-xs font-semibold">
              {summary.displayName}
            </span>
            <span className="block text-[9px] text-ink-muted">{label(summary.role)}</span>
          </span>
          <ChevronDown className="hidden h-4 w-4 text-ink-faint xl:block" aria-hidden />
        </>
      }
    >
      <div className="flex items-center gap-3 rounded-chip bg-white/[0.035] p-3">
        {avatar("h-11 w-11 text-sm")}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">
            {summary.displayName}
          </span>
          <span className="block truncate text-[11px] text-ink-muted">{summary.email}</span>
        </span>
        <span className="rounded-full bg-brand/10 px-2 py-1 text-[9px] font-semibold text-brand">
          {label(summary.plan)}
        </span>
      </div>

      <div className="mt-2 space-y-1">
        {ACCOUNT_MENU_ITEMS.map(({ label: itemLabel, description, href, icon }) => (
          <Link key={href} href={href} role="menuitem" prefetch>
            <MenuItem icon={<NavIcon name={icon} />} description={description}>
              {itemLabel}
            </MenuItem>
          </Link>
        ))}
      </div>

      {summary.isPlatformAdmin ? (
        <>
          <MenuSeparator />
          <Link href="/admin" role="menuitem">
            <MenuItem
              icon={<ShieldCheck className="h-[18px] w-[18px]" aria-hidden />}
              description="Every business on the platform"
            >
              Support console
            </MenuItem>
          </Link>
        </>
      ) : null}

      <MenuSeparator />
      <form action={signOut}>
        <button
          type="submit"
          role="menuitem"
          className="tap-row flex min-h-12 w-full items-center gap-3 rounded-chip px-3 text-left text-sm font-semibold text-ink-muted hover:bg-critical/[0.07] hover:text-critical"
        >
          <LogOut className="h-[18px] w-[18px]" aria-hidden /> Sign out
        </button>
      </form>
    </Menu>
  );
}
