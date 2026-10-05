import { expect, type Page } from "@playwright/test";
import catalogFixture from "./fixtures/catalog-fixture.json";
import designFixture from "./fixtures/design.json";

/** Same key the designer reads (it predates the v2 save format). */
export const STORAGE_KEY = "gesplan-prototype-v1";

/**
 * Fake catalogue (brand TEST-FIXTURE). Tests that need records that can drive the packer use it,
 * because the real seed only has series-level records without dimensions.
 */
export const FIXTURE = catalogFixture;
export const DESIGN = designFixture;

// Labels of the fake fixture records (brand TEST-FIXTURE), never real products.
export const L600 = "Fixture TOPCon FX-600T";
export const L450 = "Fixture TOPCon FX-450T";
export const LPERC = "Fixture PERC FX-500P";
export const LSERIES = "Fixture Series";

/** `{ id, version }` of a fixture record, the way a saved design refers to it. */
export function fixtureRef(id: string): { id: string; version: string } {
  const record = FIXTURE.modules.find((m) => m.id === id);
  if (!record) throw new Error(`No fixture record ${id}`);
  return { id: record.id, version: record.version };
}

/** What the designer has written to localStorage, parsed; null when nothing is stored. */
export async function storedDesign(page: Page): Promise<Record<string, unknown> | null> {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

/** The designer's "Modül" section in the sidebar. */
export function moduleSection(page: Page) {
  return page.locator("section").filter({ has: page.getByRole("heading", { name: "Modül", exact: true }) });
}

export function pickButton(page: Page) {
  return moduleSection(page).getByRole("button", { name: "Panel seç", exact: true });
}

/** Turkish number text the way the app's fmt() writes it: dot thousands, comma decimals. */
export function trNumber(value: number, digits = 0): string {
  const [int, frac] = value.toFixed(digits).split(".");
  const sign = int.startsWith("-") ? "-" : "";
  const grouped = int.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return frac ? `${sign}${grouped},${frac}` : `${sign}${grouped}`;
}

/** Parses Turkish number text back ("1.234,5" -> 1234.5). */
export function parseTr(text: string): number {
  return Number(text.trim().replace(/\./g, "").replace(",", "."));
}

/**
 * Puts the two-roof Konya OSB design into localStorage before the page's own scripts run. Seeded
 * once per tab, so a reload inside a test keeps whatever the test changed.
 */
export async function seedDesign(page: Page, design: unknown = DESIGN): Promise<void> {
  await page.addInitScript(
    ({ key, value }) => {
      if (window.sessionStorage.getItem("e2e-seeded")) return;
      window.localStorage.setItem(key, value);
      window.sessionStorage.setItem("e2e-seeded", "1");
    },
    { key: STORAGE_KEY, value: JSON.stringify(design) },
  );
}

/** Answers this app's catalogue routes from the fixture, so tests do not depend on the seed or env. */
export async function routeCatalog(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/catalog/modules",
    (route) => route.fulfill({ json: { catalog_version: FIXTURE.catalog_version, source: "static", modules: FIXTURE.modules } }),
  );
  await page.route(
    (url) => url.pathname.startsWith("/api/catalog/modules/"),
    (route) => {
      const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
      const record = FIXTURE.modules.find((m) => m.id === id);
      return record
        ? route.fulfill({ json: { module: record } })
        : route.fulfill({ status: 404, json: { error: "Panel bulunamadı." } });
    },
  );
}

// 1 x 1 transparent PNG.
const BLANK_TILE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

/** Serves blank satellite tiles: the checks do not need imagery and should not need the network. */
export async function stubTiles(page: Page): Promise<void> {
  await page.route(/server\.arcgisonline\.com\//, (route) => route.fulfill({ contentType: "image/png", body: BLANK_TILE }));
}

/** The "Özet" table; the designer has no other table. */
export function summaryTable(page: Page) {
  return page.getByRole("table");
}

/** The table's button for a roof, which is what keyboards and screen readers use to select it. */
export function roofButton(page: Page, name: string) {
  return summaryTable(page).getByRole("button", { name, exact: true });
}

/** Map overlay with the design totals, e.g. "189 modül · 113,4 kWp". */
export function totalsOverlay(page: Page) {
  return page.getByText(/^[\d.]+ modül · [\d.]+(,\d)? kWp$/);
}

export async function readTotals(page: Page): Promise<{ count: number; kwpText: string }> {
  const text = (await totalsOverlay(page).textContent()) ?? "";
  const m = /^([\d.]+) modül · ([\d.,]+) kWp$/.exec(text.trim());
  if (!m) throw new Error(`Unexpected totals text: ${text}`);
  return { count: parseTr(m[1]), kwpText: m[2] };
}

/**
 * Opens the designer with the fixture design and waits until the map has loaded and restored
 * both roofs (the table rows only appear after Terra Draw has the shapes back).
 */
export async function openDesigner(page: Page, opts: { catalog?: boolean } = {}): Promise<void> {
  await stubTiles(page);
  if (opts.catalog !== false) await routeCatalog(page);
  await seedDesign(page);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Tasarım haritası" })).toBeVisible({ timeout: 30_000 });
  await expect(roofButton(page, "Çatı 1")).toBeVisible({ timeout: 30_000 });
  await expect(roofButton(page, "Çatı 2")).toBeVisible();
  await expect(totalsOverlay(page)).toBeVisible();
}
