import { defineConfig, devices } from "@playwright/test";

/**
 * Browser checks for the designer and the panel catalogue. One worker and no retries: the map
 * runs WebGL in software on the test browser, which is heavy, and a flaky test should show up as
 * a failure rather than pass on a second try. `npm run test:e2e` reuses a dev server that is
 * already running on port 3000.
 */
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      // Phone width is only checked for the panel flow (full-screen sheet, keyboard only).
      name: "mobile",
      testMatch: /panel-selection\.spec\.ts$/,
      use: { browserName: "chromium", viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
  ],
});
