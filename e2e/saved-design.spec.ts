import { expect, test } from "@playwright/test";
import {
  DESIGN,
  L450,
  L600,
  fixtureRef,
  moduleSection,
  readTotals,
  roofButton,
  routeCatalog,
  seedDesign,
  storedDesign,
  stubTiles,
  totalsOverlay,
  trNumber,
} from "./helpers";

// How the designer reads and writes the saved design around the catalogue (format v2).
test.describe("saved design and the catalogue", () => {
  test("a v1 save keeps its roofs and gap and drops the hand-typed module", async ({ page }) => {
    const v1 = {
      version: 1,
      features: DESIGN.features,
      roofs: DESIGN.roofs,
      obstacles: {},
      module: { name: "Elle girilen modül", wp: 400, lengthM: 1.7, widthM: 1, gapM: 0.05 },
    };
    await stubTiles(page);
    await routeCatalog(page);
    await seedDesign(page, v1);
    await page.goto("/");
    await expect(roofButton(page, "Çatı 1")).toBeVisible({ timeout: 30_000 });
    await expect(roofButton(page, "Çatı 2")).toBeVisible();

    // The catalogue default replaces the hand-typed module; the gap carries over.
    await expect(moduleSection(page).getByText(L600, { exact: true })).toBeVisible();
    await expect(page.getByText("Elle girilen modül")).toHaveCount(0);
    await expect(moduleSection(page).getByRole("textbox", { name: /^Modül arası boşluk/ })).toHaveValue("0,05");

    await expect.poll(async () => (await storedDesign(page))?.version).toBe(2);
    const saved = await storedDesign(page);
    expect(saved).toMatchObject({ moduleRef: null, gapM: 0.05 });
    expect(saved).not.toHaveProperty("module");
  });

  test("a saved panel choice survives a slow catalogue", async ({ page }) => {
    const ref450 = fixtureRef("fixture-topcon-450");
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await stubTiles(page);
    await routeCatalog(page);
    // Registered last, so it is consulted first: holds the list back until the test lets it go.
    await page.route(
      (url) => url.pathname === "/api/catalog/modules",
      async (route) => {
        await gate;
        await route.fallback();
      },
    );
    // The marker is not part of the format, so it disappears with the designer's first save.
    await seedDesign(page, { ...DESIGN, moduleRef: ref450, e2eMarker: true });
    await page.goto("/");
    await expect(roofButton(page, "Çatı 2")).toBeVisible({ timeout: 30_000 });

    // While the list loads, the placeholder packs the roofs...
    await expect(moduleSection(page).getByText("Yer tutucu modül", { exact: true })).toBeVisible();
    await expect(moduleSection(page).getByText("Panel kataloğu yükleniyor…")).toBeVisible();
    // ...and the save written meanwhile still names the chosen panel, not the fallback.
    await expect.poll(async () => (await storedDesign(page))?.e2eMarker ?? "saved").toBe("saved");
    expect((await storedDesign(page))?.moduleRef).toEqual(ref450);

    release();
    await expect(moduleSection(page).getByText(L450, { exact: true })).toBeVisible();
    const { count } = await readTotals(page);
    expect(count).toBeGreaterThan(0);
    await expect(totalsOverlay(page)).toHaveText(`${trNumber(count)} modül · ${trNumber((count * 450) / 1000, 1)} kWp`);
  });

  test("a saved panel that left the catalogue falls back to the default and keeps the choice", async ({ page }) => {
    const gone = { id: "fixture-removed", version: "1" };
    await stubTiles(page);
    await routeCatalog(page);
    await seedDesign(page, { ...DESIGN, moduleRef: gone, e2eMarker: true });
    await page.goto("/");
    await expect(roofButton(page, "Çatı 1")).toBeVisible({ timeout: 30_000 });

    await expect(moduleSection(page).getByText(L600, { exact: true })).toBeVisible();
    await expect(moduleSection(page).getByText("Kayıtlı panel katalogda yok ya da kullanılamıyor; varsayılan panel kullanılıyor.")).toBeVisible();
    // The fallback is not written back, so the choice returns if the record does.
    await expect.poll(async () => (await storedDesign(page))?.e2eMarker ?? "saved").toBe("saved");
    expect((await storedDesign(page))?.moduleRef).toEqual(gone);
  });

  test("a gap change made just before opening Tüm paneller is kept", async ({ page }) => {
    await stubTiles(page);
    await routeCatalog(page);
    await seedDesign(page);
    await page.goto("/");
    await expect(roofButton(page, "Çatı 1")).toBeVisible({ timeout: 30_000 });

    const gap = moduleSection(page).getByRole("textbox", { name: /^Modül arası boşluk/ });
    await gap.fill("0,03");
    await gap.press("Enter");
    await expect(gap).toHaveValue("0,03");
    // Straight away, inside the designer's save delay: leaving must still write the change.
    await moduleSection(page).getByRole("link", { name: "Tüm paneller" }).click();
    await expect(page).toHaveURL(/\/paneller$/);
    await expect(page.getByRole("list", { name: "Paneller" })).toBeVisible();
    await expect(page.getByText("Ürün verileri üreticinin yayınladığı teknik dokümanlardan alınmıştır; doğrulanana kadar bilgi amaçlıdır.").first()).toBeVisible();

    await page.getByRole("link", { name: "Tasarıma dön" }).click();
    await expect(roofButton(page, "Çatı 2")).toBeVisible({ timeout: 30_000 });
    await expect(moduleSection(page).getByRole("textbox", { name: /^Modül arası boşluk/ })).toHaveValue("0,03");
  });
});
