import { expect, test, type Page } from "@playwright/test";

/**
 * The main screen of every module at desktop (1440), laptop (1366), tablet (834) and phone (390) widths: no sideways scrolling and a
 * visible heading at each width. Screenshots go to test-results/screens-v1 (copied into docs/implementation/screenshots
 * for the QA report).
 */
const PASSWORD = "DemoPassword!2026";
const WIDTHS = [1440, 1366, 834, 390] as const;
const SCREENS: { who: string; module: string; path: string }[] = [
  { who: "manager", module: "overview", path: "/overview" },
  { who: "manager", module: "policy-library", path: "/" },
  { who: "manager", module: "staff-signoff", path: "/staff" },
  { who: "manager", module: "readiness-matrix", path: "/admin/readiness" },
  { who: "coordinator", module: "rota-dashboard", path: "/rota" },
  { who: "coordinator", module: "daily-visits", path: "/rota/visits" },
  { who: "coordinator", module: "monitor", path: "/rota/monitor" },
  { who: "coordinator", module: "exceptions", path: "/rota/exceptions" },
  { who: "coordinator", module: "run-routes", path: "/rota/routes" },
  { who: "coordinator", module: "printable-rota", path: "/rota/print" },
  { who: "coordinator", module: "service-users", path: "/rota/service-users" },
  { who: "coordinator", module: "visit-notes", path: "/rota/notes" },
  { who: "finance", module: "timesheets", path: "/rota/finance/timesheets" },
  { who: "finance", module: "mileage", path: "/rota/finance/mileage" },
  { who: "finance", module: "pay-runs", path: "/rota/finance/payroll" },
  { who: "carer", module: "carer-visits", path: "/carer" },
  { who: "manager", module: "analytics", path: "/analytics" },
  { who: "manager", module: "users", path: "/admin/users" },
  { who: "manager", module: "audit-log", path: "/admin/audit" },
  { who: "manager", module: "rota-settings", path: "/rota/settings" },
];

async function signIn(page: Page, who: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(`${who}@care-solution.demo`);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeAttached();
}

test("every module's main screen fits desktop, tablet and phone", async ({ page }) => {
  test.setTimeout(600_000);
  const problems: string[] = [];
  let current = "";
  for (const s of SCREENS) {
    if (s.who !== current) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await signIn(page, s.who);
      current = s.who;
    }
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: w === 390 ? 844 : 1000 });
      const res = await page.goto(s.path);
      if ((res?.status() ?? 0) >= 400) problems.push(`${s.path} ${w}: HTTP ${res?.status()}`);
      if (!(await page.locator("h1").first().isVisible())) problems.push(`${s.path} ${w}: no heading`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) problems.push(`${s.path} ${w}: scrolls sideways by ${overflow}px`);
      await page.screenshot({ path: `test-results/screens-v1/${s.module}-${w}.png`, fullPage: w !== 1440 ? false : true });
    }
  }
  expect(problems).toEqual([]);
});

test("the main menu and portal switcher work from the keyboard", async ({ page }) => {
  await signIn(page, "manager");
  await page.goto("/rota");
  const first = page.locator('aside nav[aria-label="Main"] a').first();
  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => ({ tag: document.activeElement?.tagName, outline: getComputedStyle(document.activeElement as Element).outlineStyle, shadow: getComputedStyle(document.activeElement as Element).boxShadow }));
  expect(focused.tag).toBe("A");
  expect(focused.outline !== "none" || focused.shadow !== "none").toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator("h1").first()).toBeVisible();
});
