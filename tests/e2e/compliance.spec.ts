import { expect, test, type Page } from "@playwright/test";

/**
 * Policy & Compliance as six workspaces: the sidebar entries, each workspace's tabs, the old addresses that still
 * open (and light the right entry), the new risk register, compliance reports and the Help menu.
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
const current = (page: Page) => sidebar(page).locator('a.shell-page[aria-current="page"]');
const SIX = ["Compliance Dashboard", "Policy Library", "Regulatory Monitoring", "Staff Sign-off", "Audits & Improvements", "Compliance Reports"];

test.describe("Policy & Compliance workspaces", () => {
  test("the sidebar has exactly the six entries, and each opens its workspace", async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    const pages = page.getByTestId("portal-pages").locator("a.shell-page");
    await expect(pages).toHaveText(SIX);
    await expect(page.getByTestId("needs-attention")).toBeVisible();
    await expect(page.getByTestId("recent-activity")).toBeVisible();

    const opens: [string, RegExp, string | null][] = [
      ["Policy Library", /\/policies/, null],
      ["Regulatory Monitoring", /\/changes/, "ws-tabs-regulatory"],
      ["Staff Sign-off", /\/staff/, "ws-tabs-signoff"],
      ["Audits & Improvements", /\/audits/, "ws-tabs-improvements"],
      ["Compliance Reports", /\/compliance\/reports/, null],
    ];
    for (const [label, url, tabs] of opens) {
      await sidebar(page).getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(url);
      await expect(current(page)).toHaveText(label);
      if (tabs) await expect(page.getByTestId(tabs)).toBeVisible();
    }
  });

  test("old addresses still open and light their workspace", async ({ page }) => {
    await signIn(page);
    const old: [string, string][] = [
      ["/queue", "Policy Library"],
      ["/requirements", "Regulatory Monitoring"],
      ["/compliance/regulatory/sources", "Regulatory Monitoring"],
      ["/acknowledgements", "Staff Sign-off"],
      ["/staff/rules", "Staff Sign-off"],
      ["/actions", "Audits & Improvements"],
      ["/evidence", "Audits & Improvements"],
      ["/compliance/risks", "Audits & Improvements"],
    ];
    for (const [path, entry] of old) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(200);
      await expect(current(page), path).toHaveText(entry);
    }
    // /reports stays in the Reporting portal.
    await page.goto("/reports");
    await expect(page.getByTestId("portal-pages")).not.toContainText("Compliance Dashboard");
  });

  test("a manager records a risk and sees it rated on the register", async ({ page }) => {
    await signIn(page);
    await page.goto("/compliance/risks/new");
    await page.getByLabel("Title", { exact: true }).fill("Weekend evening calls depend on two carers");
    await page.getByLabel(/^Description/).fill("Calls may be late or missed if either carer is off sick at short notice.");
    await page.getByLabel("Category").selectOption({ label: "Staffing and workforce" });
    const inherent = page.locator("fieldset", { hasText: "Inherent" });
    await inherent.getByLabel("Likelihood").selectOption("4");
    await inherent.getByLabel("Impact").selectOption("4");
    await page.getByLabel(/^Existing controls/).fill("On-call coordinator and an agency agreement");
    const residual = page.locator("fieldset", { hasText: "Residual" });
    await residual.getByLabel("Likelihood").selectOption("3");
    await residual.getByLabel("Impact").selectOption("3");
    await page.getByLabel("Owner").selectOption({ label: "Alex Morgan" });
    await page.getByRole("button", { name: "Add to the register" }).click();
    await expect(page).toHaveURL(/\/compliance\/risks\/[^/n]/);
    await expect(page.getByRole("status")).toContainText(/Risk R-\d{3} added/);
    await page.goto("/compliance/risks");
    await expect(page.getByRole("link", { name: /Weekend evening calls/ })).toBeVisible();
  });

  test("compliance reports filter by category and download CSV", async ({ page }) => {
    await signIn(page);
    await page.goto("/compliance/reports?kind=actions");
    await expect(page.locator("#report-title")).toHaveText("Corrective actions");
    await expect(page.getByTestId("report-summary")).toBeVisible();
    const csv = await page.request.get("/api/compliance-reports/actions?format=csv");
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
  });

  test("a carer sees only their own reading and no reports", async ({ page }) => {
    await signIn(page, "carer@care-solution.demo");
    await page.goto("/");
    const labels = await page.getByTestId("portal-pages").locator("a.shell-page").allTextContents();
    expect(labels).not.toContain("Compliance Reports");
    expect((await page.goto("/compliance/reports"))?.status()).toBe(404);
    expect((await page.request.get("/api/compliance-reports/policies?format=csv")).status()).not.toBe(200);
  });

  test("Resource Centre and Interview Prep open from the Help menu", async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    await page.getByLabel("Help and resources").click();
    await page.getByTestId("help-menu").getByRole("link", { name: /Interview Prep/ }).click();
    await expect(page).toHaveURL(/\/interview-prep/);
    await expect(page.getByText(/Guidance only/).first()).toBeVisible();
    await page.getByLabel("Help and resources").click();
    await page.getByTestId("help-menu").getByRole("link", { name: /Resource Centre/ }).click();
    await expect(page).toHaveURL(/\/resource-centre/);
  });
});
