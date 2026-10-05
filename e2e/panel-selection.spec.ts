import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  L450,
  L600,
  LPERC,
  LSERIES,
  moduleSection,
  openDesigner,
  parseTr,
  pickButton,
  readTotals,
  roofButton,
  routeCatalog,
  seedDesign,
  stubTiles,
  summaryTable,
  totalsOverlay,
  trNumber,
} from "./helpers";

const W450 = 450;

const sheet = (page: Page) => page.getByRole("dialog", { name: "Panel seçimi" });
const compareDialog = (page: Page) => page.getByRole("dialog", { name: "Panel karşılaştırması" });
const card = (page: Page, label: string) => sheet(page).getByRole("article", { name: label, exact: true });
/** "Karşılaştır" in the bar that appears once a record is ticked for comparison. */
const openCompareButton = (page: Page) =>
  sheet(page).getByRole("region", { name: "Karşılaştırma" }).getByRole("button", { name: "Karşılaştır", exact: true });
/** One candidate's block under "Bu tasarımda" in the comparison. */
const candidate = (page: Page, label: string) =>
  compareDialog(page)
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: label }) });

/**
 * Neither the page nor an open sheet or drawer may scroll sideways. A fixed dialog's overflow
 * never widens the document, so the dialogs and their scroll areas are checked on their own. The
 * comparison table sits in a focusable region that is meant to scroll by itself and is skipped.
 */
async function expectNoHorizontalScroll(page: Page) {
  const width = page.viewportSize()?.width ?? 0;
  const { pageWidth, offenders } = await page.evaluate(() => {
    const scrollsSideways = (el: HTMLElement) => {
      const x = getComputedStyle(el).overflowX;
      return (x === "auto" || x === "scroll") && el.scrollWidth > el.clientWidth + 1;
    };
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"], [role="dialog"] *'));
    return {
      pageWidth: document.documentElement.scrollWidth,
      offenders: candidates
        .filter((el) => !el.matches('[role="region"][tabindex="0"]') && scrollsSideways(el))
        .map((el) => `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""}`),
    };
  });
  expect(pageWidth, "page must not scroll sideways").toBeLessThanOrEqual(width);
  expect(offenders, "no sheet or drawer may scroll sideways").toEqual([]);
}

/** The designer moves focus into the sheet in an effect, so this waits for it. */
async function expectFocusInSheet(page: Page) {
  await expect.poll(() => sheet(page).evaluate((el) => el.contains(document.activeElement)), { message: "focus moves into the sheet" }).toBe(true);
}

/** Presses Tab until `target` has focus: proves it is reachable by keyboard, in order. */
async function tabTo(page: Page, target: Locator, maxPresses = 120) {
  await expect(target).toBeAttached();
  for (let i = 0; i < maxPresses; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${target.toString()}`);
}

/** "189 modül · 113,4 kWp" from a candidate block under "Bu tasarımda". */
async function comparedCount(page: Page, label: string): Promise<number> {
  const summary = candidate(page, label).getByText(/^[\d.]+ modül · [\d.,]+ kWp$/);
  await expect(summary).toBeVisible();
  const text = (await summary.textContent()) ?? "";
  return parseTr(text.split(" modül")[0]);
}

/** Module count in a roof's row of the designer's "Özet" table (columns: Yüzey, Modül, kWp, Yön). */
async function tableCount(page: Page, roof: string): Promise<number> {
  const row = summaryTable(page)
    .getByRole("row")
    .filter({ has: page.getByRole("button", { name: roof, exact: true }) });
  return parseTr((await row.getByRole("cell").nth(1).textContent()) ?? "");
}

/** Per-face module count in a candidate's "Bu tasarımda" table (row header = roof name). */
async function comparedFaceCount(page: Page, label: string, roof: string): Promise<number> {
  const row = candidate(page, label).getByRole("row").filter({ has: page.getByRole("rowheader", { name: roof, exact: true }) });
  return parseTr((await row.getByRole("cell").first().textContent()) ?? "");
}

async function expectSelected450(page: Page, before: { count: number; kwpText: string }, count450: number) {
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(moduleSection(page).getByText(L450, { exact: true })).toBeVisible();
  // count x 0,45 kW, multiplied the way the app does it (count x W / 1000) so rounding agrees.
  const expected = `${trNumber(count450)} modül · ${trNumber((count450 * W450) / 1000, 1)} kWp`;
  await expect(totalsOverlay(page)).toHaveText(expected);
  const after = await readTotals(page);
  expect(after.count).toBe(count450);
  expect(`${after.count} ${after.kwpText}`).not.toBe(`${before.count} ${before.kwpText}`);
  await expect(page.getByText(`Panel değişti: ${L450}. Tüm yüzeyler yeniden yerleştirildi.`, { exact: true })).toBeAttached();
  await expect(pickButton(page)).toBeFocused();
}

test.describe("panel selection in the designer", () => {
  test("filter, compare on this roof, select and repack (mouse)", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop project only");
    await openDesigner(page);

    // With the fixture catalogue the default is its most powerful usable TOPCon record.
    await expect(moduleSection(page).getByText(L600, { exact: true })).toBeVisible();
    await expect(moduleSection(page).getByText("veri doğrulanmadı")).toBeVisible();
    const before = await readTotals(page);
    expect(before.count).toBeGreaterThan(0);

    await pickButton(page).click();
    await expect(sheet(page)).toBeVisible();
    await expectFocusInSheet(page);

    // A series record without dimensions is listed but cannot drive the packer.
    await expect(card(page, LSERIES).getByText("Boyut ve güç verisi yok; yerleşim hesaplanamaz.")).toBeVisible();
    await expect(card(page, LSERIES).getByRole("button", { name: /^Bu paneli seç/ })).toBeDisabled();
    await expect(card(page, L600).getByRole("button", { name: "Tasarımda kullanılıyor" })).toBeDisabled();

    await sheet(page).getByRole("button", { name: /^Filtreler/ }).click();
    await sheet(page).getByRole("checkbox", { name: "TOPCon", exact: true }).check();
    await expect(card(page, LPERC)).toHaveCount(0);
    await expect(card(page, LSERIES)).toHaveCount(0);
    await expect(card(page, L600)).toBeVisible();
    await expect(card(page, L450)).toBeVisible();

    await sheet(page).getByRole("checkbox", { name: `Karşılaştır: ${L600}`, exact: true }).check();
    await sheet(page).getByRole("checkbox", { name: `Karşılaştır: ${L450}`, exact: true }).check();
    await openCompareButton(page).click();
    await expect(compareDialog(page)).toBeVisible();

    // "Bu tasarımda" packs the same roofs: the active module's count is today's total.
    expect(await comparedCount(page, L600)).toBe(before.count);
    const count450 = await comparedCount(page, L450);
    expect(count450).toBeGreaterThan(0);
    expect(count450).not.toBe(before.count);
    const face1 = await comparedFaceCount(page, L450, "Çatı 1");
    const face2 = await comparedFaceCount(page, L450, "Çatı 2");
    expect(face1 + face2).toBe(count450);

    await candidate(page, L450).getByRole("button", { name: `Bu paneli seç: ${L450}`, exact: true }).click();
    await expectSelected450(page, before, count450);
    // Every face was repacked with the new module.
    expect(await tableCount(page, "Çatı 1")).toBe(face1);
    expect(await tableCount(page, "Çatı 2")).toBe(face2);
  });

  test("Esc closes the sheet, focus returns and designer shortcuts stay off meanwhile", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop project only");
    await openDesigner(page);
    await roofButton(page, "Çatı 2").click();
    await pickButton(page).click();
    await expect(sheet(page)).toBeVisible();

    // The designer would switch to roof drawing on R and delete the selected roof on Backspace.
    await sheet(page).press("r");
    await sheet(page).press("Backspace");
    await sheet(page).press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    await expect(pickButton(page)).toBeFocused();
    await expect(page.getByRole("button", { name: /^Çatı yüzeyi çiz/ })).toHaveAttribute("aria-pressed", "false");
    await expect(roofButton(page, "Çatı 2")).toBeVisible();
  });

  test("Esc in the detail drawer closes only the drawer; the attribution is shown on both", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop project only");
    const attribution = "Ürün verileri üreticinin yayınladığı teknik dokümanlardan alınmıştır; doğrulanana kadar bilgi amaçlıdır.";
    await openDesigner(page);
    await pickButton(page).click();
    await expect(sheet(page).getByText(attribution, { exact: true })).toBeVisible();

    const details = card(page, L450).getByRole("button", { name: `Ayrıntılar: ${L450}`, exact: true });
    await details.click();
    const drawer = page.getByRole("dialog", { name: L450, exact: true });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(attribution, { exact: true })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(sheet(page)).toBeVisible();
    await expect(details).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(sheet(page)).toHaveCount(0);
    await expect(pickButton(page)).toBeFocused();
  });

  test("a catalogue error keeps the placeholder and offers a retry", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop project only");
    let fail = true;
    await stubTiles(page);
    await routeCatalog(page);
    // Registered last, so it is consulted first; falls back to the fixture once `fail` is off.
    await page.route(
      (url) => url.pathname === "/api/catalog/modules",
      (route) => (fail ? route.fulfill({ status: 500, json: { error: "Katalog şu anda yüklenemiyor." } }) : route.fallback()),
    );
    await seedDesign(page);
    await page.goto("/");
    await expect(roofButton(page, "Çatı 1")).toBeVisible({ timeout: 30_000 });

    // React Query retries twice before it reports the error.
    const retry = moduleSection(page).getByRole("button", { name: "Tekrar dene" });
    await expect(retry).toBeVisible({ timeout: 20_000 });
    await expect(moduleSection(page).getByText("Katalog şu anda yüklenemiyor.", { exact: false })).toBeVisible();
    await expect(moduleSection(page).getByText("Yer tutucu modül", { exact: true })).toBeVisible();
    await expect(moduleSection(page).getByText("Yer tutucu", { exact: true })).toBeVisible();

    fail = false;
    await retry.click();
    await expect(moduleSection(page).getByText(L600, { exact: true })).toBeVisible();
    await expect(retry).toHaveCount(0);
  });

  test("/paneller at phone width: list, detail and comparison without sideways scrolling", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile project only");
    await routeCatalog(page);
    await page.goto("/paneller");
    await expect(page.getByRole("list", { name: "Paneller" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    // Page mode has nothing to select into, so no card offers "Bu paneli seç".
    await expect(page.getByRole("button", { name: /^Bu paneli seç/ })).toHaveCount(0);
    await page.getByRole("button", { name: `Ayrıntılar: ${LSERIES}`, exact: true }).click();
    await expect(page.getByRole("dialog", { name: LSERIES, exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.keyboard.press("Escape");

    for (const label of [L600, LSERIES]) await page.getByRole("checkbox", { name: `Karşılaştır: ${label}`, exact: true }).check();
    await page.getByRole("region", { name: "Karşılaştırma" }).getByRole("button", { name: "Karşılaştır", exact: true }).click();
    await expect(compareDialog(page)).toBeVisible();
    await expect(compareDialog(page).getByText("Çatınıza kaç panel sığacağını görmek için", { exact: false })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test("keyboard only at phone width, without sideways scrolling", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile project only");
    await openDesigner(page);
    await expect(moduleSection(page).getByText(L600, { exact: true })).toBeVisible();
    const before = await readTotals(page);
    await expectNoHorizontalScroll(page);

    await tabTo(page, pickButton(page));
    await page.keyboard.press("Enter");
    await expect(sheet(page)).toBeVisible();
    await expectFocusInSheet(page);
    await expectNoHorizontalScroll(page);

    await expect(card(page, LSERIES).getByRole("button", { name: /^Bu paneli seç/ })).toBeDisabled();

    const filtersToggle = sheet(page).getByRole("button", { name: /^Filtreler/ });
    await tabTo(page, filtersToggle);
    await page.keyboard.press("Enter");
    await expect(filtersToggle).toHaveAttribute("aria-expanded", "true");
    const topcon = sheet(page).getByRole("checkbox", { name: "TOPCon", exact: true });
    await tabTo(page, topcon);
    await page.keyboard.press("Space");
    await expect(topcon).toBeChecked();
    await expect(card(page, LSERIES)).toHaveCount(0);

    for (const label of [L600, L450]) {
      const box = sheet(page).getByRole("checkbox", { name: `Karşılaştır: ${label}`, exact: true });
      await tabTo(page, box);
      await page.keyboard.press("Space");
      await expect(box).toBeChecked();
    }
    await tabTo(page, openCompareButton(page));
    await page.keyboard.press("Enter");
    await expect(compareDialog(page)).toBeVisible();
    await expectNoHorizontalScroll(page);

    expect(await comparedCount(page, L600)).toBe(before.count);
    const count450 = await comparedCount(page, L450);
    expect(count450).toBeGreaterThan(0);

    await tabTo(page, candidate(page, L450).getByRole("button", { name: `Bu paneli seç: ${L450}`, exact: true }));
    await page.keyboard.press("Enter");
    await expectSelected450(page, before, count450);
    await expectNoHorizontalScroll(page);
  });
});
