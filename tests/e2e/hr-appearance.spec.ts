import { expect, test, type Page } from "@playwright/test";

/**
 * HR & Workforce in light and dark appearance: Checks & Training > Training & Readiness and an employee's Overview.
 * Regression (5 Nov 2026): in dark mode the training table kept a white heading row and dark names on dark rows, the
 * Work profile card stayed white, and the employee's key-check cards overlapped their labels.
 */
async function signIn(page: Page, mode: "light" | "dark") {
  await page.context().addCookies([{ name: "csb-mode", value: mode, url: "http://localhost:3100" }]);
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@care-solution.demo");
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

/** Relative luminance (0 black, 1 white) of a computed `rgb()` colour. */
async function luminance(page: Page, selector: string, prop: "color" | "backgroundColor") {
  const value = await page.locator(selector).first().evaluate((el, p) => getComputedStyle(el)[p], prop);
  const [r, g, b] = (value.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
  const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
}

const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

for (const mode of ["light", "dark"] as const) {
  test.describe(`HR appearance: ${mode}`, () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("training table heading, names and Due this week are readable", async ({ page }) => {
      await signIn(page, mode);
      await page.goto("/hr/training");
      await expect(page.getByTestId("training-matrix")).toBeVisible();
      const head = await luminance(page, ".hrv-table--matrix th", "backgroundColor");
      const headInk = await luminance(page, ".hrv-table--matrix th", "color");
      const row = await luminance(page, ".hrv-table--matrix td", "backgroundColor").catch(() => head);
      const name = await luminance(page, ".hrv-table--matrix .hrv-name", "color");
      const panel = await luminance(page, "section[aria-labelledby='tm-week']", "backgroundColor");
      if (mode === "dark") {
        expect(head, "heading row is not white").toBeLessThan(0.1);
        expect(panel, "Due this week is dark").toBeLessThan(0.1);
      } else {
        expect(head).toBeGreaterThan(0.85);
      }
      expect(contrast(head, headInk)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(name, mode === "dark" ? panel : Math.max(row, 0.9))).toBeGreaterThanOrEqual(4.5);
      // The matrix scrolls inside its own box; the page never scrolls sideways.
      await expect(page.getByRole("region", { name: "Employee training table (scrolls sideways)" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    });

    test("employee Overview: the checks chart never overlaps and the cards follow the appearance", async ({ page }) => {
      await signIn(page, mode);
      await page.goto("/hr/people/emp-1?branch=all");
      // Harbour employee record (13 Nov 2026): one row per required check, with its name, a bar and its status.
      const rows = page.getByTestId("record-checks").getByTestId("record-check");
      await expect(rows.first()).toBeVisible();
      for (const width of [1440, 1024, 834, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const n = await rows.count();
        for (let i = 0; i < n; i++) {
          const [name, track, status] = await Promise.all([0, 1, 2].map((k) => rows.nth(i).locator("> div").nth(k).boundingBox()));
          expect(name && track && status).toBeTruthy();
          // Name, bar and status sit side by side and never cover each other.
          expect(name!.x + name!.width, `row ${i} name at ${width}px`).toBeLessThanOrEqual(track!.x + 0.5);
          expect(track!.x + track!.width, `row ${i} status at ${width}px`).toBeLessThanOrEqual(status!.x + 0.5);
        }
        // The chart scrolls inside its own box; the page never scrolls sideways.
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      const header = await luminance(page, ".hb-pid", "backgroundColor");
      const nameInk = await luminance(page, ".hb-pid-n", "color");
      expect(contrast(header, nameInk)).toBeGreaterThanOrEqual(4.5);
      if (mode === "dark") expect(header).toBeLessThan(0.1);
    });
  });
}
