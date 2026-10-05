import { expect, test, type Page } from "@playwright/test";
import { openDesigner, roofButton, summaryTable } from "./helpers";

// Designer behaviour that was checked by hand before the catalogue work and must keep working.
test.describe("designer regressions", () => {
  test.beforeEach(async ({ page }) => {
    await openDesigner(page);
  });

  const map = (page: Page) => page.getByRole("region", { name: "Tasarım haritası" });
  // Header row plus one row per roof.
  const expectRoofRows = (page: Page, n: number) => expect(summaryTable(page).getByRole("row")).toHaveCount(n + 1);

  // The fixture roofs are fitted into the middle of the map (zoom capped at 19), so the band above
  // them is empty; these points are far enough apart that none closes or snaps onto another.
  const TRIANGLE: [number, number][] = [
    [120, 110],
    [320, 150],
    [200, 250],
  ];

  test("map region and zoom buttons are labelled in Turkish", async ({ page }) => {
    await expect(map(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Yakınlaştır" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Uzaklaştır" })).toBeVisible();
  });

  test("Esc cancels a roof being drawn", async ({ page }) => {
    await page.getByRole("button", { name: /^Çatı yüzeyi çiz/ }).click();
    await expect(page.getByText("Çatı çiziliyor · Enter bitirir, Esc iptal")).toBeVisible();
    for (const [x, y] of TRIANGLE) await map(page).click({ position: { x, y } });
    await page.keyboard.press("Escape");
    // With the drawing gone, Enter has nothing to finish; without the cancel it would add Çatı 3.
    await page.keyboard.press("Enter");
    await expectRoofRows(page, 2);
    await expect(roofButton(page, "Çatı 3")).toHaveCount(0);

    // Control: the same clicks do draw a roof, so the check above was not vacuous.
    for (const [x, y] of TRIANGLE) await map(page).click({ position: { x, y } });
    await page.keyboard.press("Enter");
    await expect(roofButton(page, "Çatı 3")).toBeVisible();
    await expectRoofRows(page, 3);
  });

  test("a roof whose edges cross cannot be closed and the notice says why", async ({ page }) => {
    await page.getByRole("button", { name: /^Çatı yüzeyi çiz/ }).click();
    // Corners in Z order: the edge back to the first point crosses the second edge.
    const bowTie: [number, number][] = [
      [120, 110],
      [320, 110],
      [120, 250],
      [320, 250],
      [120, 110],
    ];
    for (const [x, y] of bowTie) await map(page).click({ position: { x, y } });
    await expect(page.getByText("Kenarlar kesişiyor. Köşeleri kenar boyunca sırayla tıklayın ya da Esc ile iptal edin.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expectRoofRows(page, 2);
  });

  for (const key of ["Backspace", "Delete"]) {
    test(`${key} deletes the roof picked in the table, once`, async ({ page }) => {
      await roofButton(page, "Çatı 2").click();
      await expect(roofButton(page, "Çatı 2")).toHaveAttribute("aria-current", "true");
      await page.keyboard.press(key);
      await expect(roofButton(page, "Çatı 2")).toHaveCount(0);
      await expect(roofButton(page, "Çatı 1")).toBeVisible();

      // Nothing is selected any more, so a second press must not take Çatı 1 as well.
      await page.keyboard.press(key);
      await roofButton(page, "Çatı 1").click();
      await expect(roofButton(page, "Çatı 1")).toHaveAttribute("aria-current", "true");
      await expectRoofRows(page, 1);
    });
  }

  test("Backspace while typing only edits the text", async ({ page }) => {
    await roofButton(page, "Çatı 1").click();
    const name = page.getByRole("textbox", { name: "Ad", exact: true });
    await name.click();
    await name.press("End");
    await name.press("Backspace");
    await expect(name).toHaveValue("Çatı ");
    await expectRoofRows(page, 2);
  });

  test("the selected table button has aria-current", async ({ page }) => {
    await roofButton(page, "Çatı 1").click();
    await expect(roofButton(page, "Çatı 1")).toHaveAttribute("aria-current", "true");
    await expect(roofButton(page, "Çatı 2")).not.toHaveAttribute("aria-current");
    await roofButton(page, "Çatı 2").click();
    await expect(roofButton(page, "Çatı 2")).toHaveAttribute("aria-current", "true");
    await expect(roofButton(page, "Çatı 1")).not.toHaveAttribute("aria-current");
  });

  test("pitched roof tilt accepts a typed unit and clamps above 60", async ({ page }) => {
    await roofButton(page, "Çatı 2").click();
    const tilt = page.getByRole("textbox", { name: /^Çatı eğimi/ });
    await tilt.fill("12°");
    await tilt.press("Enter");
    await expect(tilt).toHaveValue("12");

    await tilt.fill("65");
    await tilt.press("Enter");
    await expect(tilt).toHaveValue("60");
    await expect(page.getByText("En fazla 60 olabilir; 60 kullanıldı.")).toBeVisible();
  });

  test("azimuth out of range is rejected and the old value kept", async ({ page }) => {
    await roofButton(page, "Çatı 2").click();
    const azimuth = page.getByRole("textbox", { name: /^Yön \(azimut\)/ });
    await expect(azimuth).toHaveValue("180");
    await azimuth.fill("-90");
    await azimuth.press("Enter");
    await expect(page.getByText("0 ile 359,9 arasında bir değer girin.")).toBeVisible();
    await expect(azimuth).toHaveValue("180");
  });

  test("flat roof rack tilt clamps above 40", async ({ page }) => {
    await roofButton(page, "Çatı 1").click();
    const rack = page.getByRole("textbox", { name: /^Konstrüksiyon eğimi/ });
    await rack.fill("65");
    await rack.press("Enter");
    await expect(rack).toHaveValue("40");
    await expect(page.getByText("En fazla 40 olabilir; 40 kullanıldı.")).toBeVisible();
  });
});
