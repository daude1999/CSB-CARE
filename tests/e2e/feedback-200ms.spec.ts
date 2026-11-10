import { expect, test, type Page } from "@playwright/test";

/**
 * Responsiveness acceptance test: on the Overview, Rota, Service Users, HR Hub and Policies pages, pressing a
 * primary action gives visible feedback within 200 ms, however slow the server is.
 *
 * The server is held back by 1.5 seconds for every navigation and form, so nothing the test sees can be the answer
 * itself. The time is measured inside the page, from the click event to the first animation frame in which one of
 * these is on screen:
 *
 *  - the sidebar's selection has moved to the page being opened;
 *  - the progress bar under the top bar has started (it is held back 120 ms on purpose, so quick pages never flash);
 *  - the pressed button shows its "working" spinner;
 *  - a dialog or menu has opened.
 */
const PASSWORD = "DemoPassword!2026";
const LIMIT_MS = 200;
const HOLD_SERVER_MS = 1_500;

type Feedback = { ms: number; what: string[] };

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@care-solution.demo");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

/** Runs in the page: reports the first visible change after each click as a console message. */
function watchClicks() {
  const shown = (el: Element | null | undefined): boolean => {
    if (!el) return false;
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width >= 1 && box.height >= 1 && style.visibility !== "hidden" && Number(style.opacity) > 0;
  };
  const signals = (): string[] => {
    const out: string[] = [];
    if (shown(document.querySelector('[data-testid="nav-progress"]:not([data-phase="idle"]):not([data-phase="done"]) > span'))) out.push("progress bar");
    if (shown(document.querySelector('[data-pending="true"]'))) out.push("button shows it is working");
    if (Array.from(document.querySelectorAll('[role="dialog"], dialog[open], [role="menu"]')).some(shown)) out.push("dialog or menu open");
    out.push(`expanded:${document.querySelectorAll('[aria-expanded="true"]').length}`);
    out.push(`sidebar:${document.querySelector('nav[aria-label="Main"] [data-nav-active="true"]')?.textContent?.trim() ?? ""}`);
    return out;
  };
  window.addEventListener(
    "click",
    (e) => {
      const started = e.timeStamp;
      const before = signals();
      const look = () => {
        const fresh = signals().filter((s) => !before.includes(s));
        if (fresh.length) console.log(`CSB_FEEDBACK ${JSON.stringify({ ms: Math.round(performance.now() - started), what: fresh })}`);
        else if (performance.now() - started < 3_000) requestAnimationFrame(look);
        else console.log(`CSB_FEEDBACK ${JSON.stringify({ ms: -1, what: [] })}`);
      };
      requestAnimationFrame(look);
    },
    true,
  );
}

type Action = { name: string; press: (page: Page) => ReturnType<Page["locator"]> };
const main = (page: Page) => page.locator("#main-content");

const PAGES: { title: string; path: string; actions: Action[] }[] = [
  {
    title: "Overview",
    path: "/overview",
    actions: [
      { name: "open the Rostering module", press: (p) => main(p).getByRole("link", { name: "Open Rostering & Care Management" }) },
      { name: "open the HR module (a full page load)", press: (p) => main(p).getByRole("link", { name: "Go to HR & Workforce" }) },
      { name: "view all notifications", press: (p) => main(p).getByRole("link", { name: "View all", exact: true }) },
    ],
  },
  {
    title: "Rota",
    path: "/rota",
    actions: [
      { name: "next day", press: (p) => main(p).getByRole("link", { name: "Next day" }) },
      { name: "completed calls tile", press: (p) => main(p).getByRole("link", { name: /^Completed Calls/ }) },
      { name: "late calls tile", press: (p) => main(p).getByRole("link", { name: /^Late Calls/ }) },
    ],
  },
  {
    title: "Service users",
    path: "/rota/service-users",
    actions: [
      { name: "Add New Service User", press: (p) => p.getByTestId("add-service-user") },
      { name: "apply the search", press: (p) => main(p).getByRole("button", { name: "Apply", exact: true }) },
      { name: "open a service user", press: (p) => main(p).getByRole("link", { name: /^View / }).first() },
    ],
  },
  {
    title: "HR Hub",
    path: "/hr/dashboard",
    actions: [
      { name: "alerts", press: (p) => main(p).getByRole("link", { name: "Alerts", exact: true }) },
      { name: "employees", press: (p) => main(p).getByRole("link", { name: /Employees/ }).first() },
      { name: "recruitment", press: (p) => main(p).getByRole("link", { name: "Recruitment", exact: true }) },
    ],
  },
  {
    title: "Policies",
    path: "/policies",
    actions: [
      { name: "Upload policy", press: (p) => main(p).getByRole("button", { name: "Upload policy" }) },
      { name: "Create policy", press: (p) => main(p).getByRole("link", { name: "Create policy" }) },
      { name: "grid view", press: (p) => main(p).getByRole("link", { name: "Grid view" }) },
      { name: "CSB Central Library tab", press: (p) => main(p).getByRole("link", { name: /CSB Central Library/ }) },
    ],
  },
];

test.describe("Visible feedback within 200 ms of a click", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  for (const screen of PAGES) {
    test(`${screen.title}: every primary action answers within ${LIMIT_MS} ms while the server is slow`, async ({ page }) => {
      const reports: Feedback[] = [];
      page.on("console", (m) => {
        const text = m.text();
        if (text.startsWith("CSB_FEEDBACK ")) reports.push(JSON.parse(text.slice("CSB_FEEDBACK ".length)) as Feedback);
      });
      await signIn(page);
      await page.addInitScript(watchClicks);

      const results: string[] = [];
      for (const action of screen.actions) {
        await page.unrouteAll({ behavior: "wait" });
        await page.goto(screen.path);
        await page.waitForLoadState("networkidle");
        // The page's own entrance animation is over, so nothing it does can be mistaken for an answer to the click.
        await expect.poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && !(a.effect?.getComputedTiming().iterations === Infinity)).length)).toBe(0);
        await page.route("**/*", async (route) => {
          const request = route.request();
          if (request.headers()["rsc"] === "1" || request.method() === "POST" || request.resourceType() === "document") await new Promise((r) => setTimeout(r, HOLD_SERVER_MS));
          await route.continue().catch(() => undefined);
        });

        reports.length = 0;
        const control = action.press(page);
        await expect(control, `${screen.title}: "${action.name}" is on the page`).toBeVisible();
        await control.click({ noWaitAfter: true });
        await expect.poll(() => reports.length, { message: `${screen.title}: "${action.name}" reported`, timeout: 5_000 }).toBeGreaterThan(0);
        const first = reports[0];
        results.push(`${action.name}: ${first.ms} ms (${first.what.join(", ")})`);
        expect(first.ms, `${screen.title}: "${action.name}" showed nothing for 3 seconds`).toBeGreaterThanOrEqual(0);
        expect(first.ms, `${screen.title}: "${action.name}" took ${first.ms} ms to show ${first.what.join(", ")}`).toBeLessThanOrEqual(LIMIT_MS);
      }
      test.info().annotations.push({ type: "feedback", description: results.join("; ") });
      console.log(`[feedback] ${screen.title}: ${results.join("; ")}`);
    });
  }
});

test.describe("Forms and the Admin Centre", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a form sent twice while the server is still answering runs its action once", async ({ page }) => {
    await signIn(page);
    await page.goto("/actions");
    await page.getByRole("button", { name: "New action" }).click();
    const dialog = page.getByRole("dialog");
    const title = `Double submit check ${Date.now()}`;
    await dialog.getByLabel("Action", { exact: true }).fill(title);
    await dialog.getByLabel("Due").fill("2027-01-15");
    let posts = 0;
    await page.route("**/actions**", async (route) => {
      if (route.request().method() === "POST") {
        posts++;
        await new Promise((r) => setTimeout(r, 1_200));
      }
      await route.continue();
    });
    // Enter pressed twice in quick succession: the second submission arrives while the first is with the server.
    await dialog.getByLabel("Action", { exact: true }).evaluate((input) => {
      const form = (input as HTMLInputElement).form!;
      form.requestSubmit();
      form.requestSubmit();
    });
    await expect(page).toHaveURL(/ok=/);
    expect(posts).toBe(1);
    await page.goto("/actions?view=all");
    await expect(page.getByRole("link", { name: title })).toHaveCount(1);
  });

  test("the Platform Admin Centre shows the same working feedback as the care platform", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@csb.demo");
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByTestId("platform-admin")).toBeVisible();
    await page.route("**/*", async (route) => {
      if (route.request().headers()["rsc"] === "1") await new Promise((r) => setTimeout(r, HOLD_SERVER_MS));
      await route.continue();
    });
    await page.getByRole("navigation", { name: "Admin Centre workspaces" }).getByRole("link").nth(1).click();
    await expect(page.getByTestId("nav-progress")).toHaveAttribute("data-phase", "loading");
    await expect(page.getByTestId("nav-progress")).toHaveAttribute("data-phase", /done|idle/, { timeout: 10_000 });
  });
});
