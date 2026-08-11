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

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "",
    items: [
      {
        label: "Dashboard",
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
        label: "Assistant",
        href: "/assistant",
        icon: "Sparkles",
        description: "Ask about jobs and invoices",
      },
      {
        label: "Schedule",
        href: "/schedule",
        icon: "CalendarDays",
        description: "Calendar, jobs, and today's route",
      },
      {
        label: "Booking requests",
        href: "/booking-requests",
        icon: "Inbox",
        description: "What customers have asked for",
      },
      {
        label: "Crew",
        href: "/technicians",
        icon: "UsersRound",
        description: "Who is out, and what they are on",
      },
      {
        label: "Route",
        href: "/route",
        icon: "Route",
        description: "Order the day before you drive it",
      },
    ],
  },
  {
    title: "Customers",
    items: [
      {
        label: "Customers",
        href: "/search",
        icon: "UsersRound",
        description: "People, properties, and estimates",
      },
      {
        label: "Messages",
        href: "/messages",
        icon: "MessagesSquare",
        description: "Texts with customers",
      },
    ],
  },
  {
    title: "Money",
    items: [
      {
        label: "Invoices",
        href: "/invoices",
        icon: "ReceiptText",
        description: "Paid, unpaid, and overdue",
      },
    ],
  },
  {
    title: "Field",
    items: [
      {
        label: "Materials",
        href: "/materials",
        icon: "Boxes",
        description: "Truck stock, needs, and orders",
      },
      {
        label: "Files",
        href: "/files",
        icon: "FolderOpen",
        description: "Job documents and cloud sync",
      },
    ],
  },
  {
    title: "Setup",
    items: [
      {
        label: "Settings",
        href: "/settings",
        icon: "Settings",
        description: "Business, messaging, team, and alerts",
      },
      {
        label: "Your account",
        href: "/account",
        icon: "UserRound",
        description: "Profile, password, and app preferences",
      },
    ],
  },
];

/** Every destination, flattened. */
export const ALL_NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

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
        description: "Name, address, timezone, and working hours",
      },
      {
        label: "Team",
        href: "/settings/team",
        icon: "UsersRound",
        description: "Who can open this business, and invitations",
      },
      {
        label: "Booking alerts",
        href: "/settings/notifications",
        icon: "BellRing",
        description: "Where a booked job reaches you",
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
        label: "Payments",
        href: "/account?section=square",
        icon: "CreditCard",
        description: "Square and subscription billing",
      },
    ],
  },
];

export const ALL_SETTINGS_LINKS: SettingsLink[] = SETTINGS_GROUPS.flatMap(
  (group) => group.links,
);
