import { expect, test, type Page } from "@playwright/test";

/** Analytics category navigation: every category stays listed, filters survive switching, Back/Forward and phones. */

const PASSWORD = "DemoPassword!2026";
const LABELS = ["All", "Care delivery", "Staffing", "HR, recruitment and readiness", "Care quality", "Compliance", "Finance"];

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

const nav = (page: Page) => page.getByRole("navigation", { name: "Report categories" });
const tab = (page: Page, label: string) => nav(page).getByRole("link", { name: new RegExp(`^${label.replace(/[(),]/g, "\\$&")} \\d+$`) });
const sectionTitles = (page: Page) => page.locator("section.card h2").allTextContents();

async function expectAllTabs(page: Page, active: string) {
  for (const l of LABELS) await expect(tab(page, l)).toBeVisible();
  await expect(nav(page).getByRole("link")).toHaveCount(LABELS.length);
  await expect(nav(page).locator("[aria-current=page]")).toHaveCount(1);
  await expect(tab(page, active)).toHaveAttribute("aria-current", "page");
}

test.describe("Analytics category navigation", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("switching category changes only the measures below, keeps the filters and supports Back and Forward", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/analytics");
    await expectAllTabs(page, "All");
    const total = Number((await tab(page, "All").textContent())!.match(/(\d+)$/)![1]);
    await expect(page.locator("tr[data-kpi]")).toHaveCount(total);

    await page.locator("select[name=branch]").selectOption({ label: "Liverpool" });
    await page.locator("input[name=from]").fill("2026-09-01");
    await page.locator("input[name=to]").fill("2026-09-30");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/from=2026-09-01/);

    await tab(page, "Care delivery").click();
    await expect(page).toHaveURL(/group=delivery/);
    await expect(page).toHaveURL(/branch=/);
    await expect(page).toHaveURL(/from=2026-09-01&to=2026-09-30/);
    await expectAllTabs(page, "Care delivery");
    expect(await sectionTitles(page)).toEqual(["Care delivery"]);
    const delivery = Number((await tab(page, "Care delivery").textContent())!.match(/(\d+)$/)![1]);
    await expect(page.locator("tr[data-kpi]")).toHaveCount(delivery);
    await expect(page.locator("select[name=branch] option:checked")).toHaveText("Liverpool");

    await tab(page, "Finance").click();
    await expect(page).toHaveURL(/group=finance/);
    await expectAllTabs(page, "Finance");
    expect(await sectionTitles(page)).toEqual(["Finance"]);
    await expect(page.locator("tr[data-kpi=payable-hours]")).toBeVisible();

    const csv = await page.request.get(`/api/analytics?${new URL(page.url()).searchParams}`);
    expect(csv.status()).toBe(200);
    const lines = (await csv.text()).trim().split("\n");
    expect(lines.slice(1).every((l) => l.startsWith("Finance,"))).toBe(true);

    await page.goBack();
    await expect(page).toHaveURL(/group=delivery/);
    await expectAllTabs(page, "Care delivery");
    await page.goForward();
    await expect(page).toHaveURL(/group=finance/);
    await expectAllTabs(page, "Finance");

    await tab(page, "All").click();
    await expect(page).not.toHaveURL(/group=/);
    await expect(page).toHaveURL(/branch=/);
    await expectAllTabs(page, "All");
    await expect(page.locator("tr[data-kpi]")).toHaveCount(total);
  });

  test("direct links open each category with every tab still listed", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    const groups: [string, string][] = [["delivery", "Care delivery"], ["staffing", "Staffing"], ["workforce", "HR, recruitment and readiness"], ["quality", "Care quality"], ["compliance", "Compliance"], ["finance", "Finance"]];
    for (const [g, label] of groups) {
      await page.goto(`/analytics?group=${g}`);
      await expectAllTabs(page, label);
      expect(await sectionTitles(page)).toEqual([label]);
    }
  });

  test("a finance-only member sees every category, with counts for only what they may see", async ({ page }) => {
    await signIn(page, "finance@care-solution.demo");
    await page.goto("/analytics?group=finance");
    await expectAllTabs(page, "Finance");
    await expect(tab(page, "Care quality")).toHaveText(/\D0$/);
    await tab(page, "Care quality").click();
    await expectAllTabs(page, "Care quality");
    await expect(page.locator("tr[data-kpi]")).toHaveCount(0);
    await expect(page.getByText("None of the Care quality measures apply to your roles.")).toBeVisible();
  });

  test("recently viewed reports reopen a report and keep the category on return", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/analytics?group=finance");
    await expect(page.getByTestId("recent-reports")).toHaveCount(0);
    await page.locator("tr[data-kpi=payable-hours] a").click();
    await expect(page).toHaveURL(/\/rota\/finance\/timesheets/);
    await page.goBack();
    await expect(page).toHaveURL(/group=finance/);
    await expectAllTabs(page, "Finance");
    const recent = page.getByTestId("recent-reports");
    await expect(recent.getByRole("link", { name: /Approved payable hours/ })).toBeVisible();
    await recent.getByRole("button", { name: "Clear" }).click();
    await expect(page.getByTestId("recent-reports")).toHaveCount(0);
  });
});

test.describe("Analytics categories on a phone", () => {
  test("every category can be reached by scrolling the tabs, without the page scrolling sideways", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/analytics?group=delivery");
    await expect(nav(page).getByRole("link")).toHaveCount(LABELS.length);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await tab(page, "Finance").scrollIntoViewIfNeeded();
    await tab(page, "Finance").click();
    await expect(page).toHaveURL(/group=finance/);
    await expect(nav(page).getByRole("link")).toHaveCount(LABELS.length);
    await expect(tab(page, "Finance")).toHaveAttribute("aria-current", "page");
    await page.goto("/analytics?group=finance");
    await expect(tab(page, "Finance")).toBeInViewport({ ratio: 1 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
