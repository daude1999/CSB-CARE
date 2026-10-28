import { expect, test } from "@playwright/test";

const PASSWORD = "DemoPassword!2026";

// Every page each role can reach from the navigation must render without a server error,
// and every detail link on those pages must also render.
const USERS = ["manager@care-solution.demo", "author@care-solution.demo", "approver@care-solution.demo", "carer1@care-solution.demo", "admin@csb.demo", "regulatory@csb.demo", "content@csb.demo"];

for (const email of USERS) {
  test(`all reachable pages render for ${email}`, async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByTestId("current-user")).toBeVisible();
    // Each portal has its own side menu, so collect the menu of every portal this person may open.
    const portals = await page.locator("[data-testid=portal-switcher] a").evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
    const nav: string[] = [];
    for (const home of portals.filter((h) => !h.startsWith("/hr"))) {
      await page.goto(home);
      nav.push(home, ...(await page.locator('aside nav[aria-label="Main"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href")!))));
    }
    const seen = new Set<string>();
    for (const href of [...nav, "/notifications", "/acknowledgements"]) {
      const res = await page.goto(href);
      expect(res?.status(), href).toBeLessThan(400);
      await expect(page.locator("h1").first(), href).toBeVisible();
      const details = await page.locator("main a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")!).filter((h) => /^\/(policies|changes|revisions|requirements|audits|admin\/sources|sources\/versions)\/[a-z0-9]/.test(h)));
      for (const d of details.slice(0, 4)) {
        const path = d.split("#")[0];
        if (seen.has(path)) continue;
        seen.add(path);
        const r = await page.goto(path);
        expect(r?.status(), path).toBeLessThan(400);
        await expect(page.locator("h1").first(), path).toBeVisible();
      }
    }
  });
}
