import { expect, test, type Page } from "@playwright/test";
import { routeCatalog } from "./helpers";

// localStorage flag of the panel tour (TUTORIAL_STORAGE_KEY in src/components/catalog/PanelBrowser.tsx).
const DONE_KEY = "gesplan-tutorial-panels-v1";
const STEPS = 4;

const trigger = (page: Page) => page.getByRole("button", { name: /^Nasıl çalışır\?/ });
const tourStep = (page: Page, n?: number) => page.getByRole("dialog", { name: n ? new RegExp(`^Adım ${n} / ${STEPS}`) : /^Adım \d+ \// });
const doneFlag = (page: Page) => page.evaluate((key) => window.localStorage.getItem(key), DONE_KEY);

test.describe("panel tutorial on /paneller", () => {
  test.beforeEach(async ({ page }) => {
    await routeCatalog(page);
    await page.goto("/paneller");
    await expect(page.getByRole("list", { name: "Paneller" })).toBeVisible();
  });

  test("starts, steps with İleri, closes on Esc and can be replayed", async ({ page }) => {
    // A browser that has not finished the tour gets a "not watched yet" hint on the button.
    await expect(trigger(page)).toHaveAccessibleName("Nasıl çalışır? (henüz izlenmedi)");
    await trigger(page).click();
    await expect(tourStep(page, 1)).toBeVisible();
    await expect(tourStep(page, 1)).toBeFocused();

    await tourStep(page, 1).getByRole("button", { name: "İleri" }).click();
    await expect(tourStep(page, 2)).toBeVisible();
    await expect(tourStep(page, 2)).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(tourStep(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
    expect(await doneFlag(page), "dismissing is not finishing").toBeNull();

    // Replay starts from the first step again.
    await trigger(page).click();
    await expect(tourStep(page, 1)).toBeVisible();
  });

  test("finishing stores the completion flag", async ({ page }) => {
    await trigger(page).click();
    await expect(tourStep(page, 1)).toBeVisible();
    for (let n = 2; n <= STEPS; n++) {
      await tourStep(page, n - 1).getByRole("button", { name: "İleri" }).click();
      await expect(tourStep(page, n)).toBeVisible();
    }
    await tourStep(page, STEPS).getByRole("button", { name: "Bitir" }).click();
    await expect(tourStep(page)).toHaveCount(0);
    await expect(trigger(page)).toBeFocused();
    expect(await doneFlag(page)).toBe("done");
    await expect(trigger(page)).toHaveAccessibleName("Nasıl çalışır?");

    // Still replayable after it was finished, and the flag survives a reload.
    await trigger(page).click();
    await expect(tourStep(page, 1)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("list", { name: "Paneller" })).toBeVisible();
    expect(await doneFlag(page)).toBe("done");
    await expect(trigger(page)).toHaveAccessibleName("Nasıl çalışır?");
  });
});
