import { expect, test, type Page } from "@playwright/test";

/**
 * One typeface across the platform: every module's headings, body text, tables, buttons, form controls, sidebar and
 * panels render in Inter Variable (owner's request, 1 Nov 2026). Checks computed styles in the browser, not pixels.
 */
const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@care-solution.demo");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

const PAGES = [
  "/overview",
  "/",
  "/policies",
  "/compliance/regulatory",
  "/staff",
  "/compliance/improvements",
  "/compliance/reports",
  "/hr/dashboard",
  "/hr/people",
  "/rota",
  "/rota/visits",
  "/rota/templates",
  "/rota/unassigned",
  "/settings",
];

test("every module renders its text in Inter Variable", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1672, height: 941 });
  await signIn(page);
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const offenders = await page.evaluate(async () => {
      await document.fonts.ready;
      const found = new Set<string>();
      for (const el of document.querySelectorAll<HTMLElement>("body *")) {
        const ownText = [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
        if (!ownText && !el.matches("input, select, textarea, button")) continue;
        if (!el.getClientRects().length || el.closest("canvas, svg, .textLayer")) continue;
        const first = getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "").trim();
        if (first !== "Inter Variable") found.add(`${el.tagName.toLowerCase()}: ${first}`);
      }
      return [...found];
    });
    expect(offenders, `fonts other than Inter Variable on ${path}`).toEqual([]);
    expect(await page.evaluate(() => document.fonts.check('16px "Inter Variable"')), `Inter Variable loaded on ${path}`).toBe(true);
  }
});
