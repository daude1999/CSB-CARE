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

/** The Harbour menu (owner's decision of 13 Nov 2026): closed by default, opened from the icon rail or, below 1024px, the top bar. */
const menu = (page: Page) => page.getByTestId("harbour-menu");
const sidebar = (page: Page) => menu(page).locator('nav[aria-label="Main"]');
const portal = (page: Page, id: string) => menu(page).locator(`[data-portal="${id}"]`);
const currentPage = (page: Page) => menu(page).locator('a.hb-ti[aria-current="page"]');
const rail = (page: Page, id: string) => page.locator(`[data-rail="${id}"]`);

/** Opens the menu (at a module's pages, or the current module's), unless it is already open. */
async function openMenu(page: Page, id?: string) {
  const phone = (page.viewportSize()?.width ?? 1440) < 1024;
  const current = await page.getByTestId("main-content").getAttribute("data-module");
  const trigger = phone ? page.getByRole("button", { name: "Open menu" }) : page.locator(`[data-rail="${id ?? (current && current !== "overview" ? current : "all")}"]`);
  // A click that lands before the page is interactive follows the rail link instead; try again once it is.
  await expect(async () => {
    if ((await menu(page).getAttribute("data-open")) === null) await trigger.click();
    await expect(menu(page)).toHaveAttribute("data-open", "", { timeout: 1_500 });
  }).toPass({ timeout: 15_000 });
}

/** Opens the menu and follows one of its links. */
async function go(page: Page, name: string, id?: string) {
  await openMenu(page, id);
  await sidebar(page).getByRole("link", { name, exact: true }).click();
}

/** Slows every client navigation (React Server Component request) by `ms`. */
async function slowNavigations(page: Page, ms: number) {
  await page.route("**/*", async (route) => {
    if (route.request().headers()["rsc"] === "1") await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

const MODULES: { id: string; home: string; title: RegExp; colour: string }[] = [
  { id: "policy", home: "/", title: /Compliance Dashboard/, colour: "rgb(46, 91, 207)" },
  { id: "rota", home: "/rota", title: /Rota Dashboard/, colour: "rgb(15, 118, 110)" },
  { id: "reporting", home: "/analytics", title: /Analytics/, colour: "rgb(14, 116, 144)" },
  { id: "admin", home: "/settings", title: /^Settings$/, colour: "rgb(91, 94, 150)" },
];

test.describe("Portal switching", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("Overview to each permitted module through the rail, in the module's colour, with its pages in the menu", async ({ page }) => {
    await signIn(page);
    for (const m of MODULES) {
      await page.goto("/overview");
      await openMenu(page, m.id);
      // The rail button opens the menu at that module's pages; its first page is the module's home.
      await expect(rail(page, m.id)).toHaveAttribute("aria-expanded", "true");
      const first = menu(page).locator(`#hb-tree-${m.id} a.hb-ti`).first();
      await expect(first).toHaveAttribute("href", m.home);
      await first.click();
      await expect(page).toHaveURL(new RegExp(`${m.home === "/" ? "/$" : m.home + "$"}`));
      await expect(menu(page)).not.toHaveAttribute("data-open", "");
      await expect(page.getByRole("heading", { level: 1 }).first()).toHaveText(m.title);
      // The rail marks the module you are in; the menu marks one page.
      await expect(rail(page, m.id)).toHaveAttribute("data-on", "");
      await openMenu(page);
      await expect(page.getByTestId("portal-pages")).toHaveCount(1);
      await expect(currentPage(page)).toHaveCount(1);
      await page.keyboard.press("Escape");
      // The content area settles on the module colour.
      await expect(page.getByTestId("main-content")).toHaveCSS("--module", m.colour);
    }
  });

  test("HR sits in the platform shell; entering and leaving it is a full page load, so its style sheet never leaks", async ({ page }) => {
    await signIn(page);
    // The Rota Dashboard, Daily Rota and Unassigned Visits use their own approved header, so read the title bar on another rota page.
    await page.goto("/rota/service-users");
    const rotaTitleFont = await page.getByTestId("title-bar").locator("h1").evaluate((el) => getComputedStyle(el).fontFamily);
    await openMenu(page, "hr");
    await menu(page).locator("#hb-tree-hr a.hb-ti").first().click();
    await expect(page).toHaveURL(/\/hr\/dashboard/);
    // The same rail, menu and top bar as every other module, with the HR Hub's screens in the menu. The HR overview has
    // the approved light heading instead of a coloured title bar.
    await expect(page.getByRole("heading", { level: 1, name: "HR overview" })).toBeVisible();
    await expect(rail(page, "hr")).toHaveAttribute("data-on", "");
    await expect(currentPage(page)).toHaveText("HR Dashboard");
    await expect(page.locator('link[href="/hr/hr-hub.css"]')).toHaveCount(1);
    await expect(page.locator("header.h-top, aside.h-side")).toHaveCount(0);
    // The HR Hub's styles stop at its own root: the HR heading uses exactly the platform's typeface, as on Rostering.
    expect(rotaTitleFont.split(",")[0]).toBe('"Instrument Sans"');
    expect((await page.getByTestId("hr-heading").locator("h1").evaluate((el) => getComputedStyle(el).fontFamily)).split(",")[0]).toBe('"Instrument Sans"');

    // Between HR screens the page is not reloaded.
    await page.evaluate(() => ((window as unknown as { stay: number }).stay = 1));
    await go(page, "People");
    await expect(page).toHaveURL(/\/hr\/people/);
    await expect(page.getByTestId("hr-heading").getByRole("heading", { level: 1, name: "People" })).toBeVisible();
    await expect(currentPage(page)).toHaveText("People");
    expect(await page.evaluate(() => (window as unknown as { stay?: number }).stay)).toBe(1);

    // HR to Rostering: a fresh page without the HR sheet.
    await go(page, "Rota Home", "rota");
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

  test("on HR pages the top-bar search opens the HR Hub's search, and Ctrl+K opens the command bar as on every page", async ({ page }) => {
    await signIn(page);
    await page.goto("/hr/dashboard");
    await expect(page.getByRole("heading", { level: 1, name: "HR overview" })).toBeVisible();
    await page.locator("header").getByRole("button", { name: "Search people or documents" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Search or jump to" });
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder("Search people, documents or actions…").fill("Amelia");
    await dialog.getByPlaceholder("Search people, documents or actions…").press("Escape");
    await expect(dialog).toHaveCount(0);
    // Ctrl+K means the same on every page since the command bar (10 Nov 2026); the HR search stays on the top-bar button.
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("command-bar")).toBeVisible();
    await expect(dialog).toHaveCount(0);
  });

  test("bare /hr opens the HR Dashboard and keeps the chosen branch", async ({ page }) => {
    await signIn(page);
    await page.goto("/hr?branch=all");
    await expect(page).toHaveURL(/\/hr\/dashboard\?branch=all$/);
    await expect(page.getByRole("combobox", { name: "Branch scope" })).toHaveValue("all");
  });

  test("Home on the rail goes back to the Overview, from every module and from the HR Hub", async ({ page }) => {
    await signIn(page);
    const home = page.getByTestId("icon-rail").getByRole("link", { name: "Home", exact: true });
    for (const start of ["/policies", "/rota/visits", "/analytics", "/settings", "/hr/people"]) {
      await page.goto(start);
      await expect(home, start).not.toHaveAttribute("aria-current", "page");
      await home.click();
      await expect(page, start).toHaveURL(/\/overview$/);
      await expect(home, start).toHaveAttribute("aria-current", "page");
      await expect(portal(page, "overview")).toHaveAttribute("aria-current", "page");
    }
  });

  test("people only see and reach the modules they may use", async ({ page }) => {
    await signIn(page, "carer1@care-solution.demo");
    await page.goto("/overview");
    await expect(menu(page).locator("[data-portal]")).toHaveCount(2);
    for (const id of ["rota", "hr", "reporting", "admin"]) {
      await expect(portal(page, id)).toHaveCount(0);
      await expect(rail(page, id)).toHaveCount(0);
    }
    // A typed address is checked on the server too.
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Settings");
    await page.goto("/hr/dashboard");
    await expect(page).not.toHaveURL(/\/hr\/dashboard/);
  });
});

test.describe("Menu", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("one active page, marked for assistive technology; sub-tabs, direct URLs, refresh, Back and Forward agree", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/visits");
    await expect(currentPage(page)).toHaveText("Daily Rota");
    await expect(sidebar(page).locator('[data-nav-active="true"]')).toHaveCount(1);
    await expect(page.getByTestId("breadcrumb")).toContainText("Daily Rota");

    await go(page, "Rota Home");
    await expect(page).toHaveURL(/\/rota$/);
    await expect(currentPage(page)).toHaveText("Rota Home");
    const tabs = page.getByTestId("rota-tabs-home");
    await expect(tabs.getByRole("link", { name: "Today" })).toHaveAttribute("aria-current", "page");
    await tabs.getByRole("link", { name: "The Monitor" }).click();
    await expect(page).toHaveURL(/\/rota\/monitor/);
    await expect(currentPage(page)).toHaveText("Rota Home");
    await expect(tabs.getByRole("link", { name: "The Monitor" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("breadcrumb")).toContainText("Rota Home · The Monitor");

    await page.reload();
    await expect(currentPage(page)).toHaveText("Rota Home");
    await expect(tabs.getByRole("link", { name: "The Monitor" })).toHaveAttribute("aria-current", "page");
    await page.goBack();
    await expect(page).toHaveURL(/\/rota$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/rota\/visits/);
    await expect(currentPage(page)).toHaveText("Daily Rota");
    await expect(page.getByTestId("rota-tabs-home")).toHaveCount(0);
    await page.goForward();
    await expect(currentPage(page)).toHaveText("Rota Home");
  });

  test("Care & Rostering is nine entries; nested pages light their entry and every grouped page is a sub-tab", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    const labels = await menu(page).locator("#hb-tree-rota a.hb-ti").allTextContents();
    expect(labels).toEqual(["Rota Home", "Daily Rota", "Needs attention", "Plan the rota", "Templates & runs", "Service users", "Carers", "Finance", "Rota Settings"]);

    // Deep links light the parent entry.
    for (const [href, label] of [
      ["/rota/monitor", "Rota Home"],
      ["/rota/missed", "Needs attention"],
      ["/rota/unassigned", "Needs attention"],
      ["/rota/exceptions", "Needs attention"],
      ["/rota/cover", "Needs attention"],
      ["/rota/incidents", "Service users"],
      ["/rota/care-plans", "Service users"],
      ["/rota/risks", "Service users"],
      ["/rota/readiness", "Carers"],
      ["/rota/staff", "Carers"],
      ["/rota/finance/payroll", "Finance"],
      ["/rota/planner", "Plan the rota"],
      ["/rota/routes", "Templates & runs"],
      ["/rota/routes/templates", "Templates & runs"],
    ] as const) {
      await page.goto(href);
      await expect(currentPage(page), href).toHaveText(label);
    }

    // Pages that were menu entries are sub-tabs of their entry, reachable by keyboard.
    await page.goto("/rota/planner");
    const plan = page.getByTestId("rota-tabs-plan");
    for (const name of ["Weekly Planner", "Advanced Rota", "Build Rota", "Generate & Optimise", "Printable Rota"]) await expect(plan.getByRole("link", { name, exact: true })).toBeVisible();
    await expect(plan.getByRole("link", { name: "Weekly Planner" })).toHaveAttribute("aria-current", "page");
    await plan.getByRole("link", { name: "Printable Rota" }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/rota\/print/);
    await expect(currentPage(page)).toHaveText("Plan the rota");
    await page.goto("/rota/care-plans");
    for (const name of ["All service users", "Care Coordinator", "Care Plans", "Risk Assessments", "Incidents", "Visit Notes"]) await expect(page.getByTestId("rota-tabs-people").getByRole("link", { name, exact: true })).toBeVisible();
    await page.goto("/rota/finance");
    for (const name of ["This week", "Invoicing", "Wages", "Timesheets", "Mileage", "Tariffs & Funders", "Bank Holidays"]) await expect(page.getByTestId("rota-tabs-finance").getByRole("link", { name, exact: true })).toBeVisible();
    // Staff administration lives in HR & Workforce; the rota keeps its operational staff pages under Carers.
    await page.goto("/rota/staff");
    for (const name of ["Staff & Eligibility", "Staff Readiness"]) await expect(page.getByTestId("rota-tabs-carers").getByRole("link", { name, exact: true })).toBeVisible();
    await expect(page.getByTestId("rota-tabs-carers").getByRole("link", { name: "Staff & Eligibility" })).toHaveAttribute("aria-current", "page");
    // A page with one entry and no group has no sub-tabs.
    await page.goto("/rota/visits");
    await expect(page.locator(".hb-stabs")).toHaveCount(0);
  });

  test("Visits Needing Attention lists unassigned visits and missed calls in one queue, each leading into its own workflow", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    await go(page, "Needs attention");
    await expect(page.getByRole("heading", { level: 1, name: "Visits Needing Attention" })).toBeVisible();
    const queue = page.getByTestId("attention-queue");
    await expect(page.getByTestId("attention-unassigned")).toBeVisible();
    await expect(page.getByTestId("attention-missed")).toBeVisible();

    // The figures match the full pages they come from.
    const unCount = Number(await page.getByTestId("attention-unassigned-count").textContent());
    const mcCount = Number(await page.getByTestId("attention-missed-count").textContent());
    await queue.getByRole("link", { name: "Open Unassigned Visits" }).click();
    await expect(page).toHaveURL(/\/rota\/unassigned\?when=week/);
    await expect(page.getByTestId("sum-visits")).toHaveText(String(unCount));
    await expect(currentPage(page)).toHaveText("Needs attention");
    await page.goBack();
    await queue.getByRole("link", { name: "Open Missed Calls" }).click();
    await expect(page).toHaveURL(/\/rota\/missed\?period=custom/);
    await expect(page.getByText(new RegExp(`^${mcCount} calls? ·`))).toBeVisible();
    await page.goBack();

    // Find Cover opens the shared Find Replacement Cover panel on this page, with recommended carers or a manual search.
    if (unCount > 0) {
      await queue.getByRole("link", { name: /^Find cover for/ }).first().click();
      await expect(page).toHaveURL(/\/rota\/attention\?.*cover=/);
      const panel = page.getByRole("dialog", { name: "Find Replacement Cover" });
      await expect(panel.getByRole("link", { name: "Search Staff Manually" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await page.getByTestId("attention-detail").getByRole("link", { name: /^Choose a carer by hand/ }).click();
      await expect(page).toHaveURL(/fcStep=manual/);
      await expect(panel.getByRole("heading", { name: "Search staff" })).toBeVisible();
      await page.keyboard.press("Escape");
    }
    // Investigate opens the missed call's case.
    if (mcCount > 0) {
      await queue.getByRole("link", { name: /^Investigate/ }).first().click();
      await expect(page).toHaveURL(/\/rota\/missed\/[^/?]+$/);
      await expect(currentPage(page)).toHaveText("Needs attention");
      await page.goBack();
    }
    await queue.getByRole("link", { name: "Coverage History" }).click();
    await expect(page).toHaveURL(/tab=history/);
  });

  test("a carer sees only their own pages, and cannot open the attention page", async ({ page }) => {
    await signIn(page, "carer@care-solution.demo");
    await page.goto("/carer");
    const labels = await page.getByTestId("portal-pages").locator("a.hb-ti").allTextContents();
    expect(labels).toEqual(["Incidents", "My Visits"]);
    await page.goto("/rota/attention");
    await expect(page).not.toHaveURL(/\/rota\/attention/);
  });

  test("another module's rail button opens its pages; the menu closes on Escape, on the scrim and when a page is chosen", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    await openMenu(page, "policy");
    await expect(sidebar(page).getByRole("link", { name: "Policy Library" })).toBeVisible();
    await expect(menu(page).locator("#hb-tree-rota")).toHaveCount(0);
    // Pressing the same rail button again folds the menu away.
    await rail(page, "policy").click();
    await expect(menu(page)).not.toHaveAttribute("data-open", "");
    await expect(menu(page)).toHaveAttribute("inert", "");
    await openMenu(page, "policy");
    await page.locator(".hb-scrim").click({ position: { x: 900, y: 400 } });
    await expect(menu(page)).not.toHaveAttribute("data-open", "");
    await openMenu(page, "policy");
    await page.keyboard.press("Escape");
    await expect(menu(page)).not.toHaveAttribute("data-open", "");
    await expect(rail(page, "policy")).toBeFocused();
    await go(page, "Policy Library", "policy");
    await expect(page).toHaveURL(/\/policies/);
    await expect(menu(page)).not.toHaveAttribute("data-open", "");
  });

  test("is keyboard operable with a visible focus ring, and the rail's width never changes", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    const width = async () => (await page.getByTestId("icon-rail").boundingBox())!.width;
    expect(await width()).toBe(76);
    await rail(page, "rota").focus();
    await page.keyboard.press("Enter");
    await expect(menu(page)).toHaveAttribute("data-open", "");
    const link = sidebar(page).getByRole("link", { name: "Daily Rota", exact: true });
    await link.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(link).toBeFocused();
    expect(await link.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/rota\/visits/);
    await go(page, "Analytics", "reporting");
    await expect(page).toHaveURL(/\/analytics/);
    expect(await width()).toBe(76);
  });
});

test.describe("Page transitions", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("only the content area animates, on a new page but not on a filter or tab change, and the shell is never remounted", async ({ page }) => {
    await signIn(page);
    await page.goto("/policies");
    // The shell is never remounted: a mark left on the top bar survives every navigation.
    await page.locator("header.hb-hd").evaluate((el) => ((el as HTMLElement & { _mark?: boolean })._mark = true));
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
    // The first page load has its own entrance; let it finish so only the tab change is being watched.
    await page.waitForFunction(() => !document.getElementById("main-content")!.getAnimations().some((a) => a.playState === "running"));
    let seen = watch();
    await page.getByTestId("ws-tabs-library").getByRole("link", { name: /CSB Central Library/ }).click();
    await expect(page).toHaveURL(/tab=/);
    expect(await seen).toEqual({ animated: false, skeleton: false });

    // A new page: the content area fades up; the rail and top bar do not move.
    await openMenu(page);
    seen = watch();
    await sidebar(page).getByRole("link", { name: "Regulatory Monitoring" }).click();
    await expect(page).toHaveURL(/\/changes/);
    expect((await seen).animated).toBe(true);
    expect(await page.evaluate(() => (document.getElementById("main-content") as HTMLElement & { _mark?: boolean })._mark)).toBe(true);
    expect(await page.locator("header.hb-hd").evaluate((el) => (el as HTMLElement & { _mark?: boolean })._mark)).toBe(true);
    expect(await page.locator("header.hb-hd").evaluate((el) => el.getAnimations().length)).toBe(0);
    // The page's heading is there for screen readers, and the new page is announced by the router.
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  });

  test("large rota registers are not animated row by row", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    await openMenu(page);
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
    await sidebar(page).getByRole("link", { name: "Daily Rota", exact: true }).click();
    await expect(page.locator("main table").first()).toBeVisible();
    // Nothing inside the register animates; the few that run are on the frame, however many visits are on the page:
    // the page entrance, progress bar and module colour, the menu folding away, and Harbour's panel entrance (pnIn,
    // one per panel, at most eight staggered).
    const { most, inRegister } = await counts;
    expect(inRegister).toBe(0);
    expect(most).toBeLessThanOrEqual(14);
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
    await go(page, "Daily Rota");
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
    await page.getByTestId("rota-tabs-home").getByRole("link", { name: "The Monitor" }).click();
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
    // The rail's module buttons are links to the module's home, and sub-tabs are plain links.
    await page.goto("/overview");
    await page.locator('[data-rail="rota"]').click();
    await expect(page).toHaveURL(/\/rota$/);
    await expect(page.getByRole("heading", { level: 1, name: "Rota Dashboard" })).toBeVisible();
    await page.getByTestId("rota-tabs-home").getByRole("link", { name: "The Monitor" }).click();
    await expect(page).toHaveURL(/\/rota\/monitor/);
    await expect(page.locator("#main-content")).toHaveCSS("opacity", "1");
    await ctx.close();
  });
});

test.describe("Dialogs and the phone menu", () => {
  test("a dialog takes focus, closes on Escape and hands focus back", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
    await page.goto("/policies");
    // The page's own "Upload policy" dialog: it is there whatever policy happens to be selected.
    const trigger = page.getByRole("button", { name: "Upload policy" });
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
    const drawer = page.getByRole("dialog", { name: "Menu" });
    await expect(drawer).toBeVisible();
    await expect(page.getByRole("button", { name: "Close menu" })).toBeFocused();
    // Tabbing round the menu never leaves it.
    for (const key of ["Shift+Tab", "Tab", "Tab"]) {
      await page.keyboard.press(key);
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest("#hb-menu")))).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(open).toBeFocused();

    await open.click();
    await drawer.getByRole("link", { name: "Daily Rota", exact: true }).click();
    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL(/\/rota\/visits/);
    await expect(page.getByRole("heading", { level: 1, name: "Daily Rota" })).toBeVisible();

    // The Overview is at the top of the menu on a phone too.
    await open.click();
    await drawer.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(drawer).toBeHidden();
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
    await go(page, "Daily Rota");
    await expect(page.getByRole("heading", { level: 1, name: "Daily Rota" })).toBeVisible();
    expect(await anyMoving).toBe(false);
    const duration = await menu(page).evaluate((el) => getComputedStyle(el).transitionDuration);
    expect(duration.split(",").every((d) => parseFloat(d) <= 0.001)).toBe(true);
    await expect(currentPage(page)).toHaveText("Daily Rota");
  });
});
