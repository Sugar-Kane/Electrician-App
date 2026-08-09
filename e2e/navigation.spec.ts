import { expect, test, type Page } from "@playwright/test";

/**
 * The pages a signed-out visitor can reach. Signed out, the app serves its demo
 * workspace, so every route renders without a database.
 */
const PAGES = [
  "/",
  "/schedule",
  "/jobs/1045",
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

/** Menu options and the page each one must open. */
const MENU_DESTINATIONS: [label: string, pathname: string][] = [
  ["Dashboard", "/"],
  ["Schedule", "/schedule"],
  ["Jobs", "/schedule"],
  ["Messages", "/messages"],
  ["Booking requests", "/booking-requests"],
  ["Customers", "/search"],
  ["Estimates", "/search"],
  ["Invoices", "/invoices"],
  ["Reports", "/invoices"],
  ["Files", "/files"],
  ["Materials", "/materials"],
  ["Purchase orders", "/materials"],
  ["Route builder", "/route"],
  ["Supplier connections", "/settings/integrations"],
  ["Automatic messages", "/settings/messages"],
  ["Legal pages", "/settings/legal"],
  ["Account settings", "/account"],
];

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

      // Nothing a visitor can press should already be dead on arrival.
      const buttons = page.locator("button:visible");
      for (let index = 0; index < (await buttons.count()); index += 1) {
        const button = buttons.nth(index);
        const label =
          (await button.getAttribute("aria-label")) ??
          (await button.innerText()).replace(/\s+/g, " ").trim();
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
    await expect(nav.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");

    await open(page, "/invoices");
    await expect(nav.getByRole("link", { name: "Invoices", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current", "page");

    // A job opened from a list still belongs to the schedule.
    await open(page, "/jobs/1045");
    await expect(nav.getByRole("link", { name: "Schedule" })).toHaveAttribute("aria-current", "page");

    await open(page, "/settings/messages");
    await expect(nav.getByRole("link", { name: "Automatic messages" })).toHaveAttribute("aria-current", "page");
  });

  test("takes you where each option says it will", async ({ page }) => {
    test.skip(!isDesktop(page), "the sidebar is a desktop layout; mobile uses the drawer");
    const nav = page.getByRole("navigation", { name: "Primary navigation" });

    for (const [label, pathname] of MENU_DESTINATIONS) {
      await open(page, "/schedule");
      await nav.getByRole("link", { name: label, exact: true }).click();
      await page.waitForURL((url) => url.pathname === pathname || url.pathname === "/login", {
        timeout: 15_000,
      });
      // Account settings is behind sign-in; landing on the login page is the
      // correct destination for a signed-out visitor.
      const landed = new URL(page.url()).pathname;
      expect([pathname, "/login"], `"${label}" opened ${landed}`).toContain(landed);
    }
  });
});

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
  ["Booking requests", "/booking-requests"],
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
    await page.getByRole("button", { name: /Build optimized route/ }).click();
    // Building the route is what unlocks navigation, so the panel has to change.
    await expect(page.getByRole("heading", { name: "Optimized route ready" })).toBeVisible();
  });

  test("the schedule moves a week at a time and comes back to today", async ({ page }) => {
    await open(page, "/schedule");
    const heading = page.getByRole("heading", { level: 2 }).first();
    const week = await heading.innerText();

    await page.getByRole("link", { name: "Next week" }).click();
    await expect(heading).not.toHaveText(week);

    await page.getByRole("link", { name: "Back to today" }).click();
    await expect(heading).toHaveText(week);
  });
});
