import { expect, test, type Page } from "@playwright/test";

/** Each job has one place: reports, settings, logins, visit problems; and a visit note becomes an incident in one step. */
async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

const pages = (page: Page) => page.getByTestId("portal-pages").locator("a.shell-page");

test.describe("one place for each job", () => {
  test.use({ viewport: { width: 1440, height: 941 } });

  test("every report is listed once in Reporting & Analytics, and the old report page leads there", async ({ page }) => {
    await signIn(page);
    await page.goto("/analytics");
    await expect(pages(page)).toHaveText(["Analytics", "Rota Reports", "Rota Insights", "Compliance Reports", "AI Assistant"]);
    await page.goto("/rota/reports");
    await expect(page.getByTestId("portal-pages").locator('[aria-current="page"]')).toHaveText("Rota Reports");
    await page.goto("/reports?kind=acknowledgements");
    await expect(page).toHaveURL(/\/compliance\/reports\?kind=signoff/);
  });

  test("Settings lists every settings screen, and logins and areas are tabs of one entry each", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    const dir = page.getByTestId("settings-directory");
    for (const name of ["Users & Logins", "Branches & Areas", "Rostering Settings", "Policy Sign-off rules", "Activity Log"]) await expect(dir.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
    await page.goto("/admin/workforce");
    await expect(page.getByTestId("admin-tabs-logins").getByRole("link", { name: "Carer app logins & HR sync" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("portal-pages").locator('[aria-current="page"]')).toHaveText("Users & Logins");
  });

  test("visit problems all sit under Visits Needing Attention", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/attention");
    const kinds = page.getByRole("navigation", { name: "Kind of work" });
    for (const name of [/^All/, /^Unassigned/, /^Carer off/, /^Missed calls/, /^Visit problems/]) await expect(kinds.getByRole("link", { name })).toBeVisible();
    await page.goto("/rota/exceptions");
    await expect(page.getByTestId("rota-tabs-attention").getByRole("link", { name: "Exceptions" })).toHaveAttribute("aria-current", "page");
    await page.goto("/rota/cover");
    await expect(page.getByTestId("rota-tabs-attention").getByRole("link", { name: "Sickness & Holiday Cover" })).toHaveAttribute("aria-current", "page");
  });

  test("a visit note becomes an incident report already filled in", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/notes");
    const make = page.getByRole("link", { name: "Make this an incident" }).first();
    test.skip((await make.count()) === 0, "Needs a visit note in the demo data");
    await make.click();
    await expect(page.getByTestId("incident-from-note")).toBeVisible();
    await expect(page.getByLabel("What happened")).toHaveValue(/From the visit note on/);
  });
});
