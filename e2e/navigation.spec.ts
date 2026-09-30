import { expect, test, type Page } from "@playwright/test";

/**
 * The pages a signed-out visitor can reach. Signed out, the app serves its demo
 * workspace, so every route renders without a database.
 */
const PAGES = [
  "/",
  "/schedule",
  "/jobs/1045",
  // Editing and cancelling moved off the job page into their own screen, so
  // the route the ••• menu points at has to render like any other.
  "/jobs/1045/edit",
  "/invoices",
  "/files",
  "/materials",
  "/route",
  "/search",
  "/messages",
  "/settings/integrations",
  "/settings/messages",
  "/settings/legal",
];

/**
 * The left menu, in order, and the page each option must open.
 *
 * `src/lib/navigation.ts` cut the menu down to one entry per destination:
 * "Dashboard" became "Home", "Schedule" became "Jobs", the entries that were
 * query strings on a page already listed ("Customers", "Estimates", "Purchase
 * orders") went, and the settings pages moved behind the avatar. Those are
 * checked separately below, through the menu that now holds them.
 */
const MENU_DESTINATIONS: [label: string, pathname: string][] = [
  ["Home", "/"],
  ["Jobs", "/schedule"],
  ["Booking requests", "/booking-requests"],
  ["Route", "/route"],
  ["Materials", "/materials"],
  ["Messages", "/messages"],
  ["Search", "/search"],
  ["Chat", "/assistant"],
  ["Reports", "/reports"],
  ["Invoices", "/invoices"],
  ["Electricians", "/technicians"],
  ["Files", "/files"],
];

/** Settings pages that used to be left-menu entries, reached now from /settings. */
const SETTINGS_DESTINATIONS: [label: string, pathname: string][] = [
  ["Suppliers", "/settings/integrations"],
  ["Automatic messages", "/settings/messages"],
  ["Legal pages", "/settings/legal"],
];

/**
 * Controls that are disabled on arrival on purpose, and why.
 *
 * Each entry excuses exactly one disabled button, so a pattern cannot quietly
 * cover a second dead control. The tests further down prove each of these comes
 * alive once there is something for it to do.
 */
const DISABLED_ON_ARRIVAL: Record<string, { name: RegExp; why: string }[]> = {
  "/search": [{ name: /^Ask$/, why: "there is no question to ask until something is typed" }],
  "/route": [
    { name: /^Move .+ earlier$/, why: "the first stop after the start has nowhere earlier to go" },
    { name: /^Move .+ later$/, why: "the last stop has nowhere later to go" },
  ],
};

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1024;

/**
 * The Next.js dev-overlay badge floats over the bottom-left corner and swallows
 * clicks meant for the mobile bottom bar. It does not exist in a production
 * build, so hiding it here tests the app rather than the dev tooling.
 */
async function hideDevOverlay(page: Page) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
}

async function open(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `${path} should render`).toBeLessThan(400);
  await page.waitForLoadState("load");
  await hideDevOverlay(page);
}

test.describe("every page can be navigated", () => {
  for (const path of PAGES) {
    test(`${path} renders with working links`, async ({ page }) => {
      const crashes: string[] = [];
      page.on("pageerror", (error) => crashes.push(String(error)));
      await open(page, path);

      // A link with no destination, or one pointing at bare "#", is a button
      // painted to look like navigation. Anchors to a section on the same page
      // are fine as long as the section exists.
      const anchors = page.locator("a:visible");
      for (let index = 0; index < (await anchors.count()); index += 1) {
        const href = await anchors.nth(index).getAttribute("href");
        const label = (await anchors.nth(index).innerText()).replace(/\s+/g, " ").trim();
        expect(href, `link "${label}" on ${path} has no destination`).toBeTruthy();
        expect(href, `link "${label}" on ${path} goes nowhere`).not.toBe("#");
        if (href?.startsWith("#")) {
          await expect(
            page.locator(href),
            `link "${label}" on ${path} points at a section that does not exist`,
          ).toHaveCount(1);
        }
      }

      // Nothing a visitor can press should already be dead on arrival, apart
      // from the few controls that wait on purpose for something to act on.
      const allowances = [...(DISABLED_ON_ARRIVAL[path] ?? [])];
      const buttons = page.locator("button:visible");
      for (let index = 0; index < (await buttons.count()); index += 1) {
        const button = buttons.nth(index);
        const label =
          (await button.getAttribute("aria-label")) ??
          (await button.innerText()).replace(/\s+/g, " ").trim();
        const allowance = allowances.findIndex((entry) => entry.name.test(label));
        if (allowance >= 0 && (await button.isDisabled())) {
          allowances.splice(allowance, 1);
          continue;
        }
        await expect(button, `button "${label}" on ${path} is not clickable`).toBeEnabled();
      }

      expect(crashes, `${path} threw in the browser`).toEqual([]);
    });
  }
});

test.describe("the left menu", () => {
  test("is on every page, not only the dashboard", async ({ page }) => {
    test.skip(!isDesktop(page), "the sidebar is a desktop layout; mobile uses the drawer");
    for (const path of PAGES) {
      await open(page, path);
      await expect(
        page.getByRole("navigation", { name: "Primary navigation" }),
        `${path} is missing the left menu`,
      ).toBeVisible();
    }
  });

  test("marks the page you are on, not always the dashboard", async ({ page }) => {
    test.skip(!isDesktop(page), "the sidebar is a desktop layout; mobile uses the drawer");
    const nav = page.getByRole("navigation", { name: "Primary navigation" });

    await open(page, "/");
    await expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");

    await open(page, "/invoices");
    await expect(nav.getByRole("link", { name: "Invoices", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current", "page");

    // A job opened from a list still belongs to the jobs page.
    await open(page, "/jobs/1045");
    await expect(nav.getByRole("link", { name: "Jobs", exact: true })).toHaveAttribute("aria-current", "page");

    await open(page, "/route");
    await expect(nav.getByRole("link", { name: "Route", exact: true })).toHaveAttribute("aria-current", "page");

    // Settings live behind the avatar, not in this menu, so nothing here may
    // claim them — least of all Home.
    await open(page, "/settings/messages");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);
  });

  test("takes you where each option says it will", async ({ page }) => {
    test.skip(!isDesktop(page), "the sidebar is a desktop layout; mobile uses the drawer");
    const nav = page.getByRole("navigation", { name: "Primary navigation" });

    // The menu lists exactly these, so an option added or renamed without a
    // destination to check fails here rather than going untested.
    await open(page, "/schedule");
    const labels = (await nav.getByRole("link").allInnerTexts()).map((text) => text.trim());
    expect(labels).toEqual(MENU_DESTINATIONS.map(([label]) => label));

    for (const [label, pathname] of MENU_DESTINATIONS) {
      await open(page, "/schedule");
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expectToLand(page, label, pathname);
    }
  });

  test("the account menu reaches settings and each page settings lists", async ({ page }) => {
    test.skip(!isDesktop(page), "the avatar menu sits in the desktop header");
    const accountMenu = page.getByRole("button", { name: "Account menu" });

    await open(page, "/schedule");
    await accountMenu.click();
    await page.getByRole("menuitem", { name: /^Settings/ }).click();
    await expectToLand(page, "Settings", "/settings");

    for (const [label, pathname] of SETTINGS_DESTINATIONS) {
      await open(page, "/settings");
      await page.getByRole("link", { name: new RegExp(`^${label}`) }).click();
      await expectToLand(page, label, pathname);
    }

    await open(page, "/schedule");
    await accountMenu.click();
    await page.getByRole("menuitem", { name: /^Your account/ }).click();
    await expectToLand(page, "Your account", "/account");
  });
});

/**
 * Waits for a click to arrive where its label promised. A page behind sign-in
 * sends a signed-out visitor to the login page, which is the correct
 * destination for them.
 */
async function expectToLand(page: Page, label: string, pathname: string) {
  await page.waitForURL((url) => url.pathname === pathname || url.pathname === "/login", {
    timeout: 15_000,
  });
  const landed = new URL(page.url()).pathname;
  expect([pathname, "/login"], `"${label}" opened ${landed}`).toContain(landed);
}

test.describe("the mobile menu", () => {
  test("opens, lists the same options, and closes once one is chosen", async ({ page }) => {
    test.skip(isDesktop(page), "the drawer is the mobile layout; desktop uses the sidebar");

    await open(page, "/schedule");
    const drawer = page.getByRole("dialog", { name: "Main menu" });
    await expect(drawer).toBeHidden();

    await page.getByRole("button", { name: "Open main menu" }).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: /Invoices/ })).toBeVisible();

    await drawer.getByRole("link", { name: /Invoices/ }).click();
    await page.waitForURL((url) => url.pathname === "/invoices");
    // The menu must not stay open over the page it just opened.
    await expect(drawer).toBeHidden();
  });

  test("the bottom bar reaches the main sections", async ({ page }) => {
    test.skip(isDesktop(page), "the bottom bar is the mobile layout");
    await open(page, "/");
    const bar = page.getByRole("navigation", { name: "Mobile navigation" });
    for (const [label, pathname] of [
      ["Jobs", "/schedule"],
      ["Messages", "/messages"],
      ["Home", "/"],
    ] as const) {
      await bar.getByRole("link", { name: label, exact: true }).click();
      await page.waitForURL((url) => url.pathname === pathname);
    }
  });
});

test.describe("the buttons that are not links", () => {
  test("the route builder responds to every control", async ({ page }) => {
    await open(page, "/route");
    for (const label of ["My location", "Home address", "Shop"]) {
      await page.getByRole("button", { name: new RegExp(label) }).first().click();
      await expect(page.getByRole("button", { name: new RegExp(label) }).first()).toBeVisible();
    }

    // The first stop cannot move earlier — it is already next after the start —
    // but it can move later, and once it has, it can come back.
    const firstEarlier = page.getByRole("button", { name: /^Move .+ earlier$/ }).first();
    await expect(firstEarlier).toBeDisabled();
    const stop = (await firstEarlier.getAttribute("aria-label"))!.replace(/^Move | earlier$/g, "");
    await page.getByRole("button", { name: `Move ${stop} later`, exact: true }).click();
    await expect(page.getByRole("button", { name: `Move ${stop} earlier`, exact: true })).toBeEnabled();

    await page.getByRole("button", { name: /Lock this order and navigate/ }).click();
    // Building the route is what unlocks navigation, so the panel has to change.
    await expect(page.getByRole("heading", { name: "Route built" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Open full route in Google Maps" })).toBeVisible();
  });

  test("search's Ask waits for something to ask", async ({ page }) => {
    await open(page, "/search");
    const ask = page.getByRole("button", { name: "Ask", exact: true });
    await expect(ask).toBeDisabled();
    await page.getByRole("textbox", { name: /Search customers and jobs/ }).fill("Who owes me money?");
    await expect(ask).toBeEnabled();
  });

  test("the schedule moves a week at a time and comes back to today", async ({ page }) => {
    await open(page, "/schedule");
    // The jobs page opens on the day; paging by week is the Week tab's.
    const weekTab = page.getByRole("tab", { name: "Week" });
    await expect(async () => {
      await weekTab.click();
      await expect(weekTab).toHaveAttribute("aria-selected", "true", { timeout: 1_000 });
    }).toPass();

    const heading = page.getByRole("heading", { level: 2 }).first();
    const week = await heading.innerText();

    // Buttons, not links: the week view already holds every job, so paging it
    // stays on the page instead of going back to the server.
    await page.getByRole("button", { name: "Next week" }).click();
    await expect(heading).not.toHaveText(week);

    await page.getByRole("button", { name: "Back to today" }).click();
    await expect(heading).toHaveText(week);
  });
});
