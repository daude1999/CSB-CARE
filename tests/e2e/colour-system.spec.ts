import { expect, test, type Page } from "@playwright/test";

/**
 * Approved colour redesign, PR 1 (owner's brief of 10 Nov 2026): one module header band on every page, one tab style,
 * the module colour on the main action, and the AI CSB Coordinator launcher in the top bar.
 */
const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

const MODULES: [string, string, string, string][] = [
  // [address, module name, page title, module colour as rgb()]
  ["/", "Policy & Compliance", "Compliance Dashboard", "rgb(31, 95, 209)"],
  ["/rota", "Rostering & Care Management", "Rota Dashboard", "rgb(107, 70, 201)"],
  ["/rota/visits", "Rostering & Care Management", "Daily Rota", "rgb(107, 70, 201)"],
  ["/workforce/absences", "HR & Workforce", "Time Off & Availability", "rgb(194, 65, 12)"],
  ["/analytics", "Reporting & Analytics", "Analytics", "rgb(11, 111, 153)"],
  ["/settings", "Administration & Settings", "Settings", "rgb(75, 86, 102)"],
];

test.describe("shared page frame", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("every module draws the same header band in its own colour, with a breadcrumb and no Back link", async ({ page }) => {
    await signIn(page);
    for (const [path, module, title, colour] of MODULES) {
      await page.goto(path);
      const header = page.locator("[data-module-header]").first();
      await expect(header, path).toBeVisible();
      const band = header.getByTestId("title-bar");
      expect(await band.evaluate((el) => getComputedStyle(el).backgroundColor), path).toBe(colour);
      expect(await band.evaluate((el) => getComputedStyle(el).borderRadius), path).toBe("12px");
      const crumbs = header.getByRole("navigation", { name: "Breadcrumb" });
      await expect(crumbs, path).toContainText(module);
      await expect(header.getByRole("heading", { level: 1 }), path).toContainText(title);
      await expect(band.getByRole("link", { name: /^Back$/ }), path).toHaveCount(0);
      // Exactly one h1 on the page: no second in-page title repeats the header.
      await expect(page.locator("main h1"), path).toHaveCount(1);
      // The page frame behind the cards.
      expect(await page.locator("main .page-frame, main[data-module=policy]").first().evaluate((el) => getComputedStyle(el).backgroundColor), path).toBe("rgb(246, 247, 250)");
    }
  });

  test("the main action in the band is white with module-colour text", async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    const create = page.getByTestId("title-bar").getByRole("link", { name: "Create policy" });
    await expect(create).toBeVisible();
    expect(await create.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
    expect(await create.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(31, 95, 209)");
  });

  test("tabs are one underline style: grey when inactive, module colour when active", async ({ page }) => {
    await signIn(page);
    await page.goto("/analytics");
    const active = page.locator(".tab-line[aria-current=page], .tab-line[aria-selected=true]").first();
    await expect(active).toBeVisible();
    expect(await active.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(11, 111, 153)");
    expect(await active.evaluate((el) => getComputedStyle(el).height)).toBe("38px");
    const inactive = page.locator(".tab-line:not([aria-current=page]):not([aria-selected=true])").first();
    expect(await inactive.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(71, 84, 103)");
  });

  test("the AI CSB Coordinator launcher sits in the top bar before the bell and opens the same panel", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    const launcher = page.getByTestId("ai-launcher-button");
    await expect(launcher).toBeVisible();
    await expect(launcher).toHaveAccessibleName("AI CSB Coordinator");
    expect(await launcher.evaluate((el) => getComputedStyle(el).position)).not.toBe("fixed");
    expect(await launcher.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(10, 79, 87)");
    expect(await launcher.evaluate((el) => el.getBoundingClientRect().height)).toBe(34);
    // To the left of the notifications bell, on the same row.
    const bell = page.getByTestId("notifications-link").first();
    const [l, b] = [await launcher.boundingBox(), await bell.boundingBox()];
    expect(l && b && l.x < b.x && Math.abs(l.y + l.height / 2 - (b.y + b.height / 2)) < 4).toBe(true);
    await launcher.click();
    await expect(launcher).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("dialog", { name: /AI CSB Coordinator/ })).toBeVisible();
    // The panel survives moving to another page.
    await page.getByRole("link", { name: "Daily Rota" }).first().click();
    await expect(page).toHaveURL(/\/rota\/visits/);
    await expect(page.getByTestId("ai-launcher-button")).toBeVisible();
  });
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the band and page keep a 16px gutter and the page never scrolls sideways", async ({ page }) => {
    await signIn(page);
    for (const [path] of MODULES) {
      await page.goto(path);
      const band = page.getByTestId("title-bar").first();
      await expect(band, path).toBeVisible();
      expect(Math.round((await band.boundingBox())!.x), path).toBe(16);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
    }
  });
});
