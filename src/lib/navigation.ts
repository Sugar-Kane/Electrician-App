/**
 * The one description of where you can go.
 *
 * There used to be twenty menu entries pointing at about ten pages. Six were
 * query strings on a page already in the list — "Jobs" was `/schedule?view=jobs`
 * sitting directly under "Schedule", "Reports" was `/invoices?status=paid`
 * under "Invoices" — and one was an anchor. A menu that lists the same page
 * three times is not a menu, it is a set of bookmarks, and it leaves you unable
 * to tell where you are because two entries light up at once.
 *
 * Those are gone. What is left is destinations, grouped by the part of the
 * business they belong to. Views within a page are the page's own tabs, which
 * is where a filter belongs.
 *
 * Import-free so the grouping and the "where am I" logic can be tested without
 * rendering anything.
 */

export type NavItem = {
  label: string;
  href: string;
  /** Lucide icon name, resolved by the component that renders it. */
  icon: string;
  description: string;
};

export type NavSection = {
  /** Shown above the group. Empty means the group carries no heading. */
  title: string;
  items: NavItem[];
};

/**
 * The menu, in the order an electrician's day runs.
 *
 * Section names are the trade's, not the software's. "Work" held Stock and
 * "Field" held Materials, which are the same parts; "Money" and "Setup" are
 * categories nobody says out loud.
 *
 * Two duplicate pairs are gone. Crew and Team were the same people behind two
 * labels, and Stock and Materials were the same parts — /materials already
 * linked to /inventory for its own data. One destination each.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: "",
    items: [
      {
        label: "Home",
        href: "/",
        icon: "LayoutDashboard",
        description: "Today at a glance",
      },
    ],
  },
  {
    title: "Work",
    items: [
      {
        label: "Jobs",
        href: "/schedule",
        icon: "CalendarDays",
        description: "Today, this week, and the calendar",
      },
      {
        label: "Booking requests",
        href: "/booking-requests",
        icon: "Inbox",
        description: "What customers have asked for",
      },
      {
        label: "Route",
        href: "/route",
        icon: "Route",
        description: "Today's driving order",
      },
      {
        label: "Materials",
        href: "/materials",
        icon: "Package",
        description: "What is on the van, and what to buy",
      },
    ],
  },
  {
    title: "Customers",
    items: [
      {
        label: "Messages",
        href: "/messages",
        icon: "MessagesSquare",
        description: "Texts to and from customers",
      },
      {
        label: "Search",
        href: "/search",
        icon: "Search",
        description: "Find a customer, job or invoice",
      },
      /*
       * The assistant was reachable only from a sheet behind the centre button,
       * so it was in the app and not in the menu — and moving it under the thumb
       * made that a contradiction the bottom-bar test catches: every permanent
       * tab has to be somewhere a person can find it a second way.
       */
      {
        label: "Chat",
        href: "/assistant",
        icon: "MessageCircle",
        description: "Ask about jobs, invoices, stock and code",
      },
    ],
  },
  {
    title: "Business",
    items: [
      {
        label: "Reports",
        href: "/reports",
        icon: "ChartNoAxesColumn",
        description: "Money in, money owed, activity",
      },
      {
        label: "Invoices",
        href: "/invoices",
        icon: "ReceiptText",
        description: "Billing and what is owed",
      },
      {
        label: "Electricians",
        href: "/technicians",
        icon: "UsersRound",
        description: "Who is working, their hours and time off",
      },
      {
        label: "Files",
        href: "/files",
        icon: "FolderOpen",
        description: "Documents and photos",
      },
    ],
  },
];

/**
 * What lives behind the avatar, top right.
 *
 * Settings and Your account used to be a "Setup" section at the bottom of the
 * menu, which put them in the same list as the work — Schedule, Invoices,
 * Stock. They are not work. They are the two things somebody goes looking for
 * *about themselves and their business*, and every other app on the phone puts
 * those behind the picture of your face in the corner.
 *
 * Same shape as a nav item, and rendered through the same icon resolver, so
 * there is one description of a destination rather than two.
 */
export const ACCOUNT_MENU_ITEMS: NavItem[] = [
  {
    label: "Profile",
    href: "/account?section=profile#profile",
    icon: "UserRound",
    description: "Name, photo, email",
  },
  {
    label: "App preferences",
    href: "/account?section=preferences#preferences",
    icon: "Settings2",
    description: "Notifications, maps, display",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: "Settings",
    description: "How the business runs",
  },
  {
    label: "Your account",
    href: "/account",
    icon: "CreditCard",
    description: "Your sign-in and plan",
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

/** Everywhere a person can get to from the chrome, menu and avatar together. */
export const ALL_DESTINATIONS: NavItem[] = [...ALL_NAV_ITEMS, ...ACCOUNT_MENU_ITEMS];

/**
 * Which menu entry the page you are on belongs to.
 *
 * Matched on pathname alone. A query string picks a view within a page, and
 * highlighting nothing while somebody is on /invoices?status=overdue would be
 * worse than highlighting Invoices. Deeper paths fall back to their parent, so
 * a job opened from the schedule still reads as Schedule and a single thread
 * still reads as Messages.
 *
 * Returns the href rather than an index, so a caller compares like with like.
 */
export function activeNavHref(
  pathname: string,
  items: NavItem[] = ALL_NAV_ITEMS,
): string | null {
  if (!pathname) return null;

  // usePathname() hands over a bare path, but this is a pure function and a
  // caller with a full href should not silently match nothing.
  const path = pathname.split(/[?#]/)[0] ?? "";
  if (!path) return null;

  const exact = items.find((item) => item.href === path);
  if (exact) return exact.href;

  // Longest match wins, so /settings/team picks Settings rather than anything
  // shorter that also happens to prefix it.
  const nested = items
    .filter((item) => item.href !== "/" && path.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (nested) return nested.href;

  // Records opened from a list belong to that list, even though their URL does
  // not sit underneath it.
  if (path.startsWith("/jobs/")) return "/schedule";
  if (path.startsWith("/booking/")) return "/booking-requests";

  return null;
}

/**
 * The four destinations that get a permanent place under the thumb.
 *
 * Everything else lives behind More. Kept here rather than in the component so
 * the bottom bar and the "am I somewhere in the menu" test cannot drift apart.
 */
export const BOTTOM_NAV_HREFS = ["/", "/schedule", "/assistant", "/messages"] as const;

/**
 * Whether the current page is one of the permanent four.
 *
 * When it is not, More is lit — because the page you are on did come from that
 * menu, and a bottom bar with nothing highlighted reads as "you are nowhere".
 */
export function isBeyondBottomNav(pathname: string): boolean {
  const active = activeNavHref(pathname);
  if (!active) return false;
  return !BOTTOM_NAV_HREFS.includes(active as (typeof BOTTOM_NAV_HREFS)[number]);
}

/** The entry itself, for a header that wants to name where you are. */
export function activeNavItem(pathname: string): NavItem | null {
  const href = activeNavHref(pathname);
  return href ? (ALL_NAV_ITEMS.find((item) => item.href === href) ?? null) : null;
}

/**
 * Settings, grouped by who changes them and how often.
 *
 * The split that matters is business versus person. "Business timezone" used to
 * live on the account page next to the owner's own password, which is how an
 * electrician ends up hunting through their profile for the setting that
 * decides what time the phone assistant offers customers.
 */
export type SettingsLink = {
  label: string;
  href: string;
  icon: string;
  description: string;
};

export type SettingsGroup = {
  title: string;
  blurb: string;
  links: SettingsLink[];
};

export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    title: "Your business",
    blurb: "How the business runs, for everybody in it.",
    links: [
      {
        label: "Business details",
        href: "/settings/business",
        icon: "Building2",
        description: "Name, phone, timezone and where you work from",
      },
      {
        label: "Electricians",
        href: "/technicians",
        icon: "UsersRound",
        description: "Who is working, hours and access",
      },
      {
        label: "Booking alerts",
        href: "/settings/notifications",
        icon: "BellRing",
        description: "Where a booked job reaches you",
      },
      {
        label: "Contract",
        href: "/settings/contract",
        icon: "FileText",
        description: "The agreement customers sign, filled in per job",
      },
    ],
  },
  {
    title: "Customer messaging",
    blurb: "What customers receive, and the pages carriers check.",
    links: [
      {
        label: "Automatic messages",
        href: "/settings/messages",
        icon: "MessagesSquare",
        description: "What gets texted, and when",
      },
      {
        label: "Legal pages",
        href: "/settings/legal",
        icon: "ScrollText",
        description: "Privacy policy and text message terms",
      },
    ],
  },
  {
    title: "Connections",
    blurb: "Other services this business uses.",
    links: [
      {
        label: "Suppliers",
        href: "/settings/integrations",
        icon: "PlugZap",
        description: "Lowe's and Home Depot programs",
      },
      {
        // Anchored at Square because that is where this lands. It used to say
        // "Square and subscription billing" while jumping to Square alone, so
        // somebody sent here to change their Volteira plan arrived at a card
        // about taking customer payments and had to go looking.
        label: "Card payments",
        href: "/account?section=square",
        icon: "CreditCard",
        description: "Square, for taking money from customers",
      },
      {
        label: "Your Volteira plan",
        href: "/account?section=subscription",
        icon: "Sparkles",
        description: "Premium billing and invoices",
      },
    ],
  },
];

export const ALL_SETTINGS_LINKS: SettingsLink[] = SETTINGS_GROUPS.flatMap(
  (group) => group.links,
);
