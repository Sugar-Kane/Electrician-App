"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, LogOut, Settings2, ShieldCheck, UserRound } from "lucide-react";

import { signOut } from "@/app/account/actions";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu";

/**
 * The account menu.
 *
 * It carried its own open/close, outside-click and Escape handling, and was the
 * only dropdown in the app — so there was nothing for other menus to match. All
 * of that now lives in `Menu`, and this is just the contents.
 *
 * What belongs here is the person: their profile, their preferences, signing
 * out. Anything about the *business* belongs in Settings, which is why the
 * business timezone and Square are no longer in this list.
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

const ACCOUNT_LINKS = [
  {
    label: "Profile",
    description: "Name, photo, email",
    href: "/account?section=profile#profile",
    icon: UserRound,
  },
  {
    label: "App preferences",
    description: "Notifications, maps, display",
    href: "/account?section=preferences#preferences",
    icon: Settings2,
  },
];

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
        {ACCOUNT_LINKS.map(({ label: itemLabel, description, href, icon: Icon }) => (
          <Link key={href} href={href} role="menuitem">
            <MenuItem
              icon={<Icon className="h-[18px] w-[18px]" aria-hidden />}
              description={description}
            >
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
