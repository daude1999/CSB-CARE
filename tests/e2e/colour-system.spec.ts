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
  // Harbour module colours (docs/design/harbour, 13 Nov 2026). Daily Rota keeps its layout under a plain header and the
  // Care-colour bar above its board, so it is checked on its own below.
  ["/", "Policy & Compliance", "Compliance Dashboard", "rgb(46, 91, 207)"],
  ["/workforce/absences", "HR & Workforce", "Time Off & Availability", "rgb(180, 83, 42)"],
  ["/analytics", "Reporting & Analytics", "Analytics", "rgb(14, 116, 144)"],
  ["/settings", "Administration & Settings", "Settings", "rgb(91, 94, 150)"],
];

test.describe("shared page frame", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("every module draws the same Harbour page header with its own colour tile, a breadcrumb and no Back link", async ({ page }) => {
    await signIn(page);
    for (const [path, module, title, colour] of MODULES) {
      await page.goto(path);
      const header = page.locator("[data-module-header]").first();
      await expect(header, path).toBeVisible();
      const band = header.getByTestId("title-bar");
      // Harbour (13 Nov 2026): a light blue strip across the page, with the module colour on the icon tile.
      expect(await band.evaluate((el) => getComputedStyle(el).backgroundColor), path).toBe("rgb(233, 240, 250)");
      expect(await band.locator(".mh-chip").evaluate((el) => getComputedStyle(el).backgroundColor), path).toBe(colour);
      expect(await band.evaluate((el) => getComputedStyle(el).borderRadius), path).toBe("0px");
      const crumbs = header.getByRole("navigation", { name: "Breadcrumb" });
      await expect(crumbs, path).toContainText(module);
      await expect(header.getByRole("heading", { level: 1 }), path).toContainText(title);
      await expect(band.getByRole("link", { name: /^Back$/ }), path).toHaveCount(0);
      // Exactly one h1 on the page: no second in-page title repeats the header.
      await expect(page.locator("main h1"), path).toHaveCount(1);
      // The page frame behind the cards.
      expect(await page.locator("main#main-content").evaluate((el) => getComputedStyle(el).backgroundColor), path).toBe("rgb(244, 246, 249)");
    }
  });

  test("Rota Home uses the Harbour page header: light blue band, Care-colour icon tile, 20px title", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    const header = page.getByTestId("page-header");
    expect(await header.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(233, 240, 250)");
    expect(await header.locator(".hb-fh-ic").evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(15, 118, 110)");
    await expect(header.getByRole("heading", { level: 1 })).toHaveText("Rota Home");
    expect(await header.getByRole("heading", { level: 1 }).evaluate((el) => getComputedStyle(el).fontSize)).toBe("20px");
    await expect(page.locator("main h1")).toHaveCount(1);
  });

  test("Daily Rota keeps its layout, with a plain header and the Care-colour bar above the board", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/visits");
    await expect(page.locator("[data-module-header]").first()).toHaveAttribute("data-variant", "plain");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Daily Rota");
    await expect(page.locator("main h1")).toHaveCount(1);
  });

  test("the main action in the header is the navy Harbour button with white text", async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    const create = page.getByTestId("title-bar").getByRole("link", { name: "Create policy" });
    await expect(create).toBeVisible();
    expect(await create.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(31, 58, 104)");
    expect(await create.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(255, 255, 255)");
  });

  test("tabs are one underline style: grey when inactive, module colour when active", async ({ page }) => {
    await signIn(page);
    await page.goto("/analytics");
    const active = page.locator(".tab-line[aria-current=page], .tab-line[aria-selected=true]").first();
    await expect(active).toBeVisible();
    expect(await active.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(14, 116, 144)");
    expect(await active.evaluate((el) => getComputedStyle(el).height)).toBe("38px");
    const inactive = page.locator(".tab-line:not([aria-current=page]):not([aria-selected=true])").first();
    expect(await inactive.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(71, 84, 103)");
  });

  test("the AI CSB Coordinator launcher is the icon rail's AI button and opens the same panel", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    // Harbour reference (13 Nov 2026): no AI button on the top bar; the rail's AI button, pinned near the bottom, opens it.
    const launcher = page.getByTestId("icon-rail").getByTestId("ai-launcher-button");
    await expect(launcher).toBeVisible();
    await expect(launcher).toHaveAccessibleName("AI CSB Coordinator");
    await expect(page.locator("header.hb-hd").getByTestId("ai-launcher-button")).toHaveCount(0);
    const settings = page.getByTestId("icon-rail").getByRole("link", { name: "Settings" });
    const [l, st] = [await launcher.boundingBox(), await settings.boundingBox()];
    expect(l && st && l.y < st.y).toBe(true);
    await launcher.click();
    await expect(launcher).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("dialog", { name: /AI CSB Coordinator/ })).toBeVisible();
    // The panel survives moving to another page.
    await page.getByTestId("rota-tabs-home").getByRole("link", { name: "The Monitor" }).click();
    await expect(page).toHaveURL(/\/rota\/monitor/);
    await expect(page.getByTestId("ai-launcher-button")).toBeVisible();
  });
});

test.describe("menu and AI Coordinator", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a module picked on the rail shows only that module's pages, and Show all modules brings the rest back", async ({ page }) => {
    await signIn(page);
    await page.goto("/overview");
    await page.locator('[data-rail="rota"]').click();
    const menu = page.getByTestId("harbour-menu");
    await expect(menu).toHaveAttribute("data-open", "");
    await expect(menu.getByTestId("module-menu")).toContainText("Care & Rostering");
    await expect(menu.getByTestId("portal-pages").getByRole("link", { name: "Daily Rota", exact: true })).toBeVisible();
    await expect(menu.getByTestId("portal-switcher")).toHaveCount(0);
    await expect(menu.locator('[data-module-toggle="policy"]')).toHaveCount(0);
    // Another module on the rail swaps the list for that module's pages.
    await page.locator('[data-rail="policy"]').click();
    await expect(menu.getByTestId("module-menu")).toContainText("Policy & Compliance");
    await expect(menu.getByTestId("portal-pages").getByRole("link", { name: "Daily Rota", exact: true })).toHaveCount(0);
    await menu.getByTestId("menu-show-all").click();
    await expect(menu.getByTestId("portal-switcher")).toBeVisible();
    await expect(menu.locator('[data-module-toggle="rota"]')).toBeVisible();
  });

  test("a floating AI CSB Coordinator button sits at the bottom right of every page and opens the panel", async ({ page }) => {
    await signIn(page);
    for (const path of ["/overview", "/rota", "/policies"]) {
      await page.goto(path);
      const fab = page.getByTestId("ai-float-button");
      await expect(fab, path).toBeVisible();
      await expect(fab).toHaveAccessibleName("AI CSB Coordinator");
      const box = (await fab.boundingBox())!;
      expect(1440 - (box.x + box.width)).toBeLessThanOrEqual(24);
      expect(900 - (box.y + box.height)).toBeLessThanOrEqual(24);
    }
    await page.getByTestId("ai-float-button").click();
    await expect(page.getByRole("dialog", { name: /AI CSB Coordinator/ })).toBeVisible();
    await expect(page.getByTestId("ai-float-button")).toHaveCount(0);
    await page.getByTestId("ai-minimise").click();
    await expect(page.getByTestId("ai-float-button")).toBeFocused();
  });
});

test.describe("icon rail", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("each module in the rail has its own colour, the same as its page header tile", async ({ page }) => {
    await signIn(page);
    await page.goto("/overview");
    const rail = page.getByTestId("icon-rail");
    const tiles: Record<string, string> = {};
    for (const [id, path] of [["rota", "/rota/service-users"], ["hr", "/workforce/absences"], ["policy", "/"], ["reporting", "/analytics"], ["admin", "/settings"]] as const) {
      tiles[id] = await rail.locator(`[data-rail="${id}"] .hb-rail-i`).evaluate((el) => getComputedStyle(el).backgroundColor);
      await page.goto(path);
      const chip = await page.locator(".mh-chip").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(tiles[id], `${id} rail tile matches its page header`).toBe(chip);
      await page.goto("/overview");
    }
    // Five different colours, and the icon on each is white.
    expect(new Set(Object.values(tiles)).size).toBe(5);
    await expect(rail.locator('[data-rail="policy"] .hb-rail-i')).toHaveCSS("color", "rgb(255, 255, 255)");
    // Alerts and All pages are not modules, so they stay plain.
    expect(await rail.locator('[data-rail="all"] .hb-rail-i').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(0, 0, 0, 0)");
  });
});

test.describe("phone width", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the header runs edge to edge with a 16px inner gutter and the page never scrolls sideways", async ({ page }) => {
    // Sign in at desktop width (the signed-in name sits in the phone menu), then narrow the window.
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [path] of MODULES) {
      await page.goto(path);
      const band = page.getByTestId("title-bar").first();
      await expect(band, path).toBeVisible();
      expect(Math.round((await band.boundingBox())!.x), path).toBe(0);
      expect(Math.round((await band.getByRole("heading", { level: 1 }).boundingBox())!.x), path).toBe(16);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
    }
  });
});

test.describe("Rota Home count tiles", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("each tile is a Harbour count tile: a solid status-colour icon square and the figure, linking to the visits behind it", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    const tiles: [string, string][] = [["card-completed", "rgb(46, 154, 99)"], ["card-late", "rgb(217, 144, 31)"]];
    for (const [id, colour] of tiles) {
      const tile = page.getByTestId(id);
      await expect(tile).toBeVisible();
      expect(await tile.evaluate((el) => el.tagName)).toBe("A");
      const chip = tile.locator(".hb-tile-ic");
      expect(await chip.evaluate((el) => getComputedStyle(el).backgroundColor), id).toBe(colour);
      expect(await tile.locator("[data-value]").evaluate((el) => getComputedStyle(el).fontSize), id).toBe("22px");
      // The full figure (with its share of the day's visits) is kept for screen readers and as the tooltip.
      expect(await tile.getAttribute("title"), id).toMatch(/%/);
    }
  });
});
