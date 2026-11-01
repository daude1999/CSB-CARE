import { expect, test, type Page } from "@playwright/test";

/**
 * Navigation and motion: portal switching, the sidebar, page transitions, loading feedback, dialogs, the phone
 * menu, reduced motion and the HR Hub boundary. These check behaviour (what is current, what is announced, what
 * moves and what is kept), not pixels.
 */
const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Main" });
const portal = (page: Page, id: string) => sidebar(page).locator(`[data-portal="${id}"]`);
const currentPage = (page: Page) => sidebar(page).locator('a.shell-page[aria-current="page"]');

/** Slows every client navigation (React Server Component request) by `ms`. */
async function slowNavigations(page: Page, ms: number) {
  await page.route("**/*", async (route) => {
    if (route.request().headers()["rsc"] === "1") await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

const MODULES: { id: string; home: string; title: RegExp; colour: string }[] = [
  { id: "policy", home: "/", title: /Compliance Centre Dashboard/, colour: "rgb(31, 95, 209)" },
  { id: "rota", home: "/rota", title: /Rota Dashboard/, colour: "rgb(107, 70, 201)" },
  { id: "reporting", home: "/analytics", title: /Analytics/, colour: "rgb(11, 111, 153)" },
  { id: "admin", home: "/settings", title: /System Settings/, colour: "rgb(75, 86, 102)" },
];

test.describe("Portal switching", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Overview to each permitted module, in the module's colour, with its pages open in the sidebar", async ({ page }) => {
    await signIn(page);
    for (const m of MODULES) {
      await page.goto("/overview");
      await portal(page, m.id).click();
      // Immediate feedback: the module lights up and its pages open before the page has arrived.
      await expect(portal(page, m.id)).toHaveClass(/shell-portal-current/);
      await expect(page).toHaveURL(new RegExp(`${m.home === "/" ? "/$" : m.home + "$"}`));
      await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(m.title);
      await expect(portal(page, m.id)).toHaveCSS("background-color", m.colour);
      await expect(page.getByTestId("portal-pages")).toHaveCount(1);
      // Once inside, the module's own name leads back to the Overview; its dashboard is the page marked current.
      await expect(portal(page, m.id)).toHaveAttribute("href", "/overview");
      await expect(portal(page, m.id)).not.toHaveAttribute("aria-current");
      await expect(currentPage(page)).toHaveCount(1);
      // The content area settles on the module colour (it blends there from the previous one).
      await expect(page.getByTestId("main-content")).toHaveCSS("--module", m.colour);
    }
  });

  test("HR sits in the platform shell; entering and leaving it is a full page load, so its style sheet never leaks", async ({ page }) => {
    await signIn(page);
    // The Rota Dashboard, Daily Rota and Unassigned Visits use their own approved header, so read the title bar on another rota page.
    await page.goto("/rota/service-users");
    const rotaTitleFont = await page.getByTestId("title-bar").locator("h1").evaluate((el) => getComputedStyle(el).fontFamily);
    await portal(page, "hr").click();
    await expect(page).toHaveURL(/\/hr\/dashboard/);
    // The same sidebar, top bar and module title bar as every other module, with the HR Hub's screens in the menu.
    await expect(page.getByRole("heading", { level: 1, name: "HR Dashboard" })).toBeVisible();
    await expect(portal(page, "hr")).toHaveClass(/shell-portal-current/);
    await expect(currentPage(page)).toHaveText("HR Dashboard");
    await expect(page.locator('link[href="/hr/hr-hub.css"]')).toHaveCount(1);
    await expect(page.locator("header.h-top, aside.h-side")).toHaveCount(0);
    // The HR Hub's styles stop at its own root: the shell's title bar reads exactly as it does on Rostering.
    await expect(page.getByTestId("title-bar").locator("h1")).toHaveCSS("font-family", rotaTitleFont);

    // Between HR screens the page is not reloaded.
    await page.evaluate(() => ((window as unknown as { stay: number }).stay = 1));
    await sidebar(page).getByRole("link", { name: "People", exact: true }).click();
    await expect(page).toHaveURL(/\/hr\/people/);
    await expect(page.getByTestId("title-bar").getByRole("heading", { level: 1, name: "People" })).toBeVisible();
    await expect(currentPage(page)).toHaveText("People");
    expect(await page.evaluate(() => (window as unknown as { stay?: number }).stay)).toBe(1);

    // HR to Rostering: a fresh page without the HR sheet.
    await portal(page, "rota").click();
    await expect(page).toHaveURL(/\/rota$/);
    await expect(page.getByRole("heading", { level: 1, name: "Rota Dashboard" })).toBeVisible();
    await expect(page.locator('link[href="/hr/hr-hub.css"]')).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { stay?: number }).stay)).toBeUndefined();

    // Back to HR through the browser, then forward again: nothing is left loading.
    await page.goBack();
    await expect(page).toHaveURL(/\/hr\/people/);
    await page.goForward();
    await expect(page.getByRole("heading", { level: 1, name: "Rota Dashboard" })).toBeVisible();
    await expect(page.getByTestId("nav-progress")).toHaveAttribute("data-phase", /idle|done/);
  });

  test("on HR pages the top-bar search opens the HR Hub's search, from the box or with Ctrl+K", async ({ page }) => {
    await signIn(page);
    await page.goto("/hr/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "HR Dashboard" })).toBeVisible();
    await page.locator("header").getByRole("button", { name: "Search people or documents" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Search or jump to" });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder("Search people, documents or actions…").fill("Amelia");
    await dialog.getByPlaceholder("Search people, documents or actions…").press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.keyboard.press("Control+k");
    await expect(dialog).toBeVisible();
  });

  test("bare /hr opens the HR Dashboard and keeps the chosen branch", async ({ page }) => {
    await signIn(page);
    await page.goto("/hr?branch=all");
    await expect(page).toHaveURL(/\/hr\/dashboard\?branch=all$/);
    await expect(page.getByRole("combobox", { name: "Branch scope" })).toHaveValue("all");
  });

  test("clicking the name of the module you are in goes back to the Overview, from every module and from the HR Hub", async ({ page }) => {
    await signIn(page);
    for (const start of ["/policies", "/rota/visits", "/analytics", "/settings", "/hr/people"]) {
      await page.goto(start);
      // The other modules' names still open those modules.
      const others = await sidebar(page).locator('[data-portal]:not(.shell-portal-current):not([data-portal="overview"])').evaluateAll((as) => as.map((a) => a.getAttribute("href")));
      expect(others.length, start).toBeGreaterThan(0);
      expect(others, start).not.toContain("/overview");
      await sidebar(page).locator(".shell-portal-current").click();
      await expect(page, start).toHaveURL(/\/overview$/);
      await expect(portal(page, "overview")).toHaveClass(/shell-portal-current/);
      await expect(portal(page, "overview")).toHaveAttribute("aria-current", "page");
    }
  });

  test("people only see and reach the modules they may use", async ({ page }) => {
    await signIn(page, "carer1@care-solution.demo");
    await page.goto("/overview");
    await expect(sidebar(page).locator("[data-portal]")).toHaveCount(2);
    for (const id of ["rota", "hr", "reporting", "admin"]) await expect(portal(page, id)).toHaveCount(0);
    // A typed address is checked on the server too.
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("System Settings");
    await page.goto("/hr/dashboard");
    await expect(page).not.toHaveURL(/\/hr\/dashboard/);
  });
});

test.describe("Sidebar", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("one active page, marked for assistive technology, with the marker on it; direct URLs, refresh, Back and Forward agree", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/visits");
    await expect(currentPage(page)).toHaveText("Daily Rota");
    await expect(sidebar(page).locator('[data-nav-active="true"]')).toHaveCount(1);
    const markerOnRow = async () =>
      sidebar(page).evaluate((nav) => {
        const row = nav.querySelector<HTMLElement>('[data-nav-active="true"]')!;
        const marker = nav.querySelector<HTMLElement>(".shell-marker")!;
        const a = row.getBoundingClientRect();
        const b = marker.getBoundingClientRect();
        return Math.abs(a.top - b.top) < 1.5 && Math.abs(a.height - b.height) < 1.5 && getComputedStyle(marker).opacity === "1";
      });
    await expect.poll(markerOnRow).toBe(true);

    await sidebar(page).getByRole("link", { name: "The Monitor" }).click();
    await expect(page).toHaveURL(/\/rota\/monitor/);
    await expect(currentPage(page)).toHaveText("The Monitor");
    await expect.poll(markerOnRow).toBe(true);

    await page.reload();
    await expect(currentPage(page)).toHaveText("The Monitor");
    await page.goBack();
    await expect(page).toHaveURL(/\/rota\/visits/);
    await expect(currentPage(page)).toHaveText("Daily Rota");
    await page.goForward();
    await expect(currentPage(page)).toHaveText("The Monitor");
  });

  test("the Rota menu follows OnePlan's sections: extra pages fold away, open by click or keyboard, and the current page is never hidden", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    const nav = sidebar(page);
    const headings = await nav.locator("[data-nav-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-nav-group")));
    expect(headings).toEqual(["Rota", "Templates", "Users", "Invoicing/Wages", "Reports", "Settings", "Help & Training"]);
    await expect(nav.getByRole("link", { name: "Build Rota" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Weekly Planner" })).toBeHidden();
    await expect(nav.getByRole("link", { name: "Invoicing" })).toBeHidden();
    await expect(nav.getByText("Preference Manager")).toBeVisible();
    await expect(nav.getByRole("link", { name: "Preference Manager" })).toHaveCount(0);

    // Opened with the keyboard: the heading is a real button that says whether it is open.
    const more = nav.getByRole("button", { name: /More rota tools/ });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(nav.getByRole("link", { name: "Weekly Planner" })).toBeVisible();
    await nav.getByRole("button", { name: "Rota", exact: true }).click();
    await expect(nav.getByRole("link", { name: "Daily Rota" })).toBeHidden();

    // A page inside a folded group opens that group, with the marker on it.
    await page.goto("/rota/finance/rates?tab=holidays");
    await expect(currentPage(page)).toHaveText("Bank Holidays");
    await expect(nav.getByRole("button", { name: "Invoicing/Wages" })).toHaveAttribute("aria-expanded", "true");
    await page.goto("/rota/missed");
    await expect(currentPage(page)).toHaveText("Missed Calls");
    await expect(nav.getByRole("link", { name: "Missed Calls" })).toBeVisible();
  });

  test("switching module folds the old pages and opens the new ones; the old list is unreachable while it folds", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    await portal(page, "policy").click();
    const closing = sidebar(page).locator('.shell-section[data-state="closing"]');
    // While it folds, the old list is inert (no focus, no clicks, hidden from assistive technology).
    if (await closing.count()) await expect(closing).toHaveAttribute("inert", "");
    await expect(page).toHaveURL(/\/$/);
    await expect(closing).toHaveCount(0);
    await expect(sidebar(page).getByRole("link", { name: "Policy Library" })).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: "Daily Rota" })).toHaveCount(0);
  });

  test("is keyboard operable with a visible focus ring, and its width never changes", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    const width = async () => (await page.locator(".shell-sidebar").first().boundingBox())!.width;
    const before = await width();
    const link = sidebar(page).getByRole("link", { name: "Daily Rota" });
    await link.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(link).toBeFocused();
    expect(await link.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/rota\/visits/);
    await portal(page, "reporting").click();
    await expect(page).toHaveURL(/\/analytics/);
    expect(await width()).toBe(before);
  });
});

test.describe("Page transitions", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("only the content area animates, on a new page but not on a filter or tab change, and the shell is never remounted", async ({ page }) => {
    await signIn(page);
    await page.goto("/policies");
    // Something typed in the shell (the search box) survives every navigation, because the shell is never remounted.
    await page.locator("#global-search").fill("safeguarding");
    await page.evaluate(() => ((document.getElementById("main-content") as HTMLElement & { _mark?: boolean })._mark = true));

    // A query-string change (a library tab): no entrance, no skeleton, same content element.
    const watch = () =>
      page.evaluate(
        () =>
          new Promise<{ animated: boolean; skeleton: boolean }>((resolve) => {
            const main = document.getElementById("main-content")!;
            let animated = false;
            let skeleton = false;
            const o = new MutationObserver(() => (skeleton ||= Boolean(document.querySelector("[data-testid=page-skeleton]"))));
            o.observe(document.body, { childList: true, subtree: true });
            const t = setInterval(() => (animated ||= main.getAnimations().some((a) => a.playState === "running")), 10);
            setTimeout(() => {
              clearInterval(t);
              o.disconnect();
              resolve({ animated, skeleton });
            }, 1800);
          }),
      );
    let seen = watch();
    await page.locator(".pl-tab").nth(1).click();
    await expect(page).toHaveURL(/tab=/);
    expect(await seen).toEqual({ animated: false, skeleton: false });

    // A new page: the content area fades up; the sidebar and top bar do not move.
    seen = watch();
    await sidebar(page).getByRole("link", { name: "Regulatory Updates" }).click();
    await expect(page).toHaveURL(/\/changes/);
    expect((await seen).animated).toBe(true);
    expect(await page.evaluate(() => (document.getElementById("main-content") as HTMLElement & { _mark?: boolean })._mark)).toBe(true);
    await expect(page.locator("#global-search")).toHaveValue("safeguarding");
    expect(await page.locator("header.shell-topbar").evaluate((el) => el.getAnimations().length)).toBe(0);
    // The page's heading is there for screen readers, and the new page is announced by the router.
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  });

  test("large rota registers are not animated row by row", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    const counts = page.evaluate(
      () =>
        new Promise<{ most: number; inRegister: number }>((resolve) => {
          let most = 0;
          let inRegister = 0;
          const t = setInterval(() => {
            const running = document.getAnimations().filter((a) => a.playState === "running");
            most = Math.max(most, running.length);
            const targets = running.map((a) => (a.effect as KeyframeEffect | null)?.target).filter((el): el is Element => el instanceof Element);
            inRegister = Math.max(inRegister, targets.filter((el) => el.closest("table, [role=grid], .rows")).length);
          }, 10);
          setTimeout(() => {
            clearInterval(t);
            resolve({ most, inRegister });
          }, 1500);
        }),
    );
    await sidebar(page).getByRole("link", { name: "Daily Rota" }).click();
    await expect(page.locator("main table").first()).toBeVisible();
    // Nothing inside the register animates; the few that run (page entrance, sidebar marker, progress bar,
    // module colour) are on the frame, however many visits are on the page.
    const { most, inRegister } = await counts;
    expect(inRegister).toBe(0);
    expect(most).toBeLessThanOrEqual(8);
    const shift = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let total = 0;
          new PerformanceObserver((list) => list.getEntries().forEach((e) => (total += (e as PerformanceEntry & { value: number; hadRecentInput: boolean }).hadRecentInput ? 0 : (e as PerformanceEntry & { value: number }).value))).observe({ type: "layout-shift", buffered: true });
          setTimeout(() => resolve(total), 500);
        }),
    );
    expect(shift).toBeLessThan(0.1);
  });
});

test.describe("Loading and slow pages", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a slow page keeps the old page usable, shows progress at once, then says it is taking longer", async ({ page }) => {
    test.setTimeout(60_000);
    await signIn(page);
    await page.goto("/rota");
    await slowNavigations(page, 7_500);
    await sidebar(page).getByRole("link", { name: "Daily Rota" }).click();
    await expect(page.getByTestId("nav-progress")).toHaveAttribute("data-phase", "loading");
    // The chosen page is shown as selected at once; assistive technology still hears about the page on screen.
    await expect(sidebar(page).locator('[data-nav-active="true"]')).toHaveText("Daily Rota");
    await expect(currentPage(page)).toHaveText("Rota Home");
    await expect(page.getByRole("heading", { level: 1, name: "Rota Dashboard" })).toBeVisible();
    // After a moment a placeholder in the page's shape takes over; the old page is hidden, not thrown away.
    await expect(page.getByTestId("page-skeleton")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Rota Dashboard" })).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Rota Dashboard", includeHidden: true })).toHaveCount(1);
    await expect(page.getByTestId("nav-slow")).toContainText("taking longer than usual", { timeout: 9_000 });
    await expect(page).toHaveURL(/\/rota\/visits/, { timeout: 15_000 });
    await expect(page.getByTestId("nav-slow")).toHaveCount(0);
    await expect(page.getByTestId("page-skeleton")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Daily Rota" })).toBeVisible();
    await expect(page.getByTestId("nav-progress")).toHaveAttribute("data-phase", /done|idle/);
  });

  test("a page that stops responding offers to load it again, or to stay on the page already open", async ({ page }) => {
    test.setTimeout(60_000);
    await signIn(page);
    await page.goto("/rota");
    await slowNavigations(page, 40_000);
    await sidebar(page).getByRole("link", { name: "The Monitor" }).click();
    await expect(page.getByTestId("nav-slow")).toContainText("not responding", { timeout: 25_000 });
    await expect(page.getByTestId("nav-slow").getByRole("button", { name: "Load it again" })).toBeVisible();
    await page.getByTestId("nav-slow").getByRole("button", { name: "Dismiss" }).click();
    await expect(page.getByTestId("nav-slow")).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Rota Dashboard" })).toBeVisible();
    await expect(currentPage(page)).toHaveText("Rota Home");
  });

  test("a form shows it is working until the server answers, and never before", async ({ page }) => {
    await signIn(page);
    await page.goto("/notifications");
    await page.route("**/notifications**", async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1_200));
      await route.continue();
    });
    const button = page.getByRole("button", { name: "Mark all read" });
    if (!(await button.count())) test.skip(true, "no unread notifications in this database");
    await button.click();
    await expect(button).toHaveAttribute("data-pending", "true");
    await expect(page.locator(".flash")).toHaveCount(0);
    await expect(page).toHaveURL(/ok=/);
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.locator("[data-pending]")).toHaveCount(0);
  });

  test("navigation still works with scripts switched off, and content is never left invisible", async ({ browser }) => {
    const signedIn = await browser.newContext();
    const p = await signedIn.newPage();
    await signIn(p);
    const state = await signedIn.storageState();
    await signedIn.close();
    const ctx = await browser.newContext({ storageState: state, javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto("/rota");
    await sidebar(page).getByRole("link", { name: "Daily Rota" }).click();
    await expect(page).toHaveURL(/\/rota\/visits/);
    await expect(page.getByRole("heading", { level: 1, name: "Daily Rota" })).toBeVisible();
    await expect(page.locator("#main-content")).toHaveCSS("opacity", "1");
    await ctx.close();
  });
});

test.describe("Dialogs and the phone menu", () => {
  test("a dialog takes focus, closes on Escape and hands focus back", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
    await page.goto("/policies");
    const trigger = page.getByTestId("policy-inspector").getByRole("button", { name: "Assign for Review" });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect.poll(() => page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]")))).toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("on a phone the menu slides in, keeps focus inside, closes on Escape and when a page is chosen", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/rota");
    const open = page.getByRole("button", { name: "Open menu" });
    await open.click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await expect(menu).toBeVisible();
    await expect(page.getByRole("button", { name: "Close menu" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(open).toBeFocused();

    await open.click();
    await menu.getByRole("link", { name: "Daily Rota" }).click();
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(/\/rota\/visits/);
    await expect(page.getByRole("heading", { level: 1, name: "Daily Rota" })).toBeVisible();

    // The module's name in the menu goes back to the Overview on a phone too.
    await open.click();
    await menu.getByRole("link", { name: /Rostering & Care Management, back to Overview/ }).click();
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(/\/overview$/);
  });
});

test.describe("Reduced motion", () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });

  test("nothing slides or fades, but the working signal and the result are the same", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    const anyMoving = page.evaluate(
      () =>
        new Promise<boolean>((resolve) => {
          const main = document.getElementById("main-content")!;
          let moved = false;
          const t = setInterval(() => (moved ||= main.getAnimations().some((a) => a.playState === "running" && Number(a.effect?.getTiming().duration) > 1)), 5);
          setTimeout(() => {
            clearInterval(t);
            resolve(moved);
          }, 1200);
        }),
    );
    await sidebar(page).getByRole("link", { name: "Daily Rota" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Daily Rota" })).toBeVisible();
    expect(await anyMoving).toBe(false);
    const duration = await portal(page, "rota").evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration.split(",").every((d) => parseFloat(d) <= 0.001)).toBe(true);
    await expect(currentPage(page)).toHaveText("Daily Rota");
  });
});
