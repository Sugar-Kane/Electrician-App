import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests for navigation: that every menu option and button on a page
 * leads somewhere, and that the left menu says where you are.
 *
 * These run against the dev server with whatever `.env.local` holds. Signed
 * out, the app serves its demo workspace, which is enough to exercise every
 * route and control without a database.
 *
 * The sandboxed Chromium that ships with this environment lives outside the
 * usual download path, so PLAYWRIGHT_CHROMIUM_PATH points at it when set.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
