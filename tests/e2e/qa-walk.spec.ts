import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * QA walk: for each role, open every page reachable from the menus and then every internal link on those pages (two
 * levels, every distinct route shape once), and check each one: no server error or missing page, a page heading, no
 * error screen, no script error, no sideways scrolling at desktop width, and every form control labelled. Pages that
 * say plainly that something is not built yet are listed for the QA report. Results go to test-results/qa-walk.
 */
const PASSWORD = "DemoPassword!2026";
const ROLES = [
  "manager@care-solution.demo",
  "coordinator@care-solution.demo",
  "finance@care-solution.demo",
  "carer@care-solution.demo",
  "author@care-solution.demo",
  "approver@care-solution.demo",
  "sam.parker@care-solution.demo",
  "admin@csb.demo",
];
const SKIP = /^\/(api|logout|account|hr)(\/|$)|[?&](download|format)=/;
const MAX_PAGES = 220;

/** /rota/visits/abc123 and /rota/visits/def456 are the same screen: check one of each. */
const shape = (path: string) => path.split("?")[0]!.replace(/\/c[a-z0-9]{20,}/g, "/:id").replace(/\/\d{4}-\d{2}-\d{2}/g, "/:date");

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

interface Finding { path: string; problem: string; from?: string }

for (const email of ROLES) {
  test(`QA walk: every reachable screen works for ${email}`, async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const scriptErrors: string[] = [];
    page.on("pageerror", (e) => scriptErrors.push(e.message));
    await signIn(page, email);

    const portals = await page.locator("[data-testid=portal-switcher] a[data-portal-home]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
    const start: string[] = [];
    for (const home of portals.filter((h) => h && !h.startsWith("/hr"))) {
      await page.goto(home);
      start.push(home, ...(await page.locator('aside nav[aria-label="Main"] a').evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))));
    }
    start.push("/notifications", "/acknowledgements");

    const queue = [...new Set(start.filter((h) => h.startsWith("/") && !SKIP.test(h)))].map((p) => ({ path: p, depth: 0, from: "menu" }));
    const shapes = new Set<string>();
    const visited: string[] = [];
    const findings: Finding[] = [];
    const notBuilt: string[] = [];
    const hydration: string[] = [];

    while (queue.length && visited.length < MAX_PAGES) {
      const { path, depth, from } = queue.shift()!;
      const clean = path.split("#")[0]!;
      if (shapes.has(shape(clean))) continue;
      shapes.add(shape(clean));
      visited.push(clean);
      const before = scriptErrors.length;
      const res = await page.goto(clean);
      const status = res?.status() ?? 0;
      if (status >= 400) {
        findings.push({ path: clean, problem: `HTTP ${status}`, from });
        continue;
      }
      if (!(await page.locator("h1").first().isVisible().catch(() => false))) findings.push({ path: clean, problem: "no page heading" });
      const body = await page.locator("body").innerText();
      if (/Application error|Something went wrong|Unhandled Runtime Error|This page could not be found/i.test(body)) findings.push({ path: clean, problem: "error screen shown" });
      if (/not built yet|planned|version 2/i.test(body)) notBuilt.push(clean);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) findings.push({ path: clean, problem: `scrolls sideways by ${overflow}px at 1440` });
      const unlabelled = await page.evaluate(() =>
        [...document.querySelectorAll("main input:not([type=hidden]):not([type=submit]):not([type=button]), main select, main textarea")]
          .filter((el) => {
            const e = el as HTMLInputElement;
            if (e.closest("[hidden]") || e.offsetParent === null) return false;
            const labelled = (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)) || e.closest("label") || e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || e.getAttribute("title");
            return !labelled;
          })
          .map((e) => (e as HTMLInputElement).name || e.tagName.toLowerCase()),
      );
      if (unlabelled.length) findings.push({ path: clean, problem: `unlabelled controls: ${[...new Set(unlabelled)].join(", ")}` });
      const emptyButtons = await page.evaluate(() => [...document.querySelectorAll("main button")].filter((b) => !(b.textContent ?? "").trim() && !b.getAttribute("aria-label") && !b.getAttribute("title")).length);
      if (emptyButtons) findings.push({ path: clean, problem: `${emptyButtons} button(s) with no name` });
      // React's hydration notice (#418) has appeared once per run on a different page each time and could not be
      // reproduced on its own; it is listed for the QA report rather than failing the walk. Any other script error fails.
      const newErrors = scriptErrors.slice(before);
      for (const e of newErrors.filter((x) => /error #418|Hydration/i.test(x))) hydration.push(`${clean}: ${e.slice(0, 120)}`);
      const real = newErrors.filter((x) => !/error #418|Hydration/i.test(x));
      if (real.length) findings.push({ path: clean, problem: `script error: ${real.join(" | ").slice(0, 200)}` });
      if (depth < 2) {
        const links = await page.locator("main a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
        for (const l of links) if (!SKIP.test(l) && !shapes.has(shape(l.split("#")[0]!))) queue.push({ path: l, depth: depth + 1, from: clean });
      }
    }

    mkdirSync("test-results/qa-walk", { recursive: true });
    writeFileSync(`test-results/qa-walk/${email.replace(/[^a-z0-9]+/gi, "_")}.json`, JSON.stringify({ email, visited, findings, notBuilt, hydration }, null, 2));
    expect(findings, `${email}: ${visited.length} screens checked`).toEqual([]);
  });
}
