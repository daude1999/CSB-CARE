import { expect, test, type Page } from "@playwright/test";

/**
 * HR & Workforce (orange) and Policy & Compliance (blue) built to the owner's approved designs of 1 Nov 2026:
 * the simpler HR menu with every old screen still reachable, the HR Dashboard, Checks & Training, Documents and the
 * Recruitment board, the Compliance Dashboard and the policy page, and role-specific actions.
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
const currentPage = (page: Page) => sidebar(page).locator('a.shell-page[aria-current="page"]');
const hubReady = (page: Page) => expect(page.getByText("Opening your HR workspace")).toHaveCount(0, { timeout: 30_000 });

test.describe("HR & Workforce, approved design", () => {
  test.use({ viewport: { width: 1672, height: 941 } });

  test("seven menu destinations; tasks, alerts, checks, availability and branches stay one click away", async ({ page }) => {
    await signIn(page);
    await page.goto("/hr/dashboard");
    await hubReady(page);
    const pages = sidebar(page).locator("a.shell-page");
    await expect(pages).toHaveText(["HR Dashboard", "People", "Recruitment", "Checks & Training", "Documents", "Time Off & Availability", "Settings"]);
    await page.getByTestId("hr-tabs").getByRole("link", { name: "My Tasks" }).click();
    await expect(page).toHaveURL(/\/hr\/alerts\?view=tasks/);
    await expect(currentPage(page)).toHaveText("HR Dashboard");
    await page.goto("/hr/compliance");
    await hubReady(page);
    await expect(currentPage(page)).toHaveText("Checks & Training");
    await expect(page.getByTestId("hr-tabs").getByRole("link", { name: "Checks Register" })).toHaveAttribute("aria-current", "page");
    await page.goto("/workforce/availability");
    await expect(currentPage(page)).toHaveText("Time Off & Availability");
    await expect(page.getByTestId("hr-tabs").getByRole("link", { name: "Holidays & Sickness" })).toBeVisible();
    await page.goto("/hr/branches");
    await hubReady(page);
    await expect(currentPage(page)).toHaveText("Settings");
  });

  test("HR Dashboard: figures, a searchable directory, needs attention and quick actions", async ({ page }) => {
    await signIn(page);
    await page.goto("/hr/dashboard");
    await hubReady(page);
    await expect(page.getByRole("heading", { level: 1, name: "HR Dashboard" })).toBeVisible();
    const dir = page.getByTestId("hr-directory");
    await expect(dir.locator("tbody tr")).toHaveCount(10);
    await page.getByRole("searchbox", { name: "Search employees" }).fill("Amelia Hart");
    await expect(dir.locator("tbody tr")).toHaveCount(2);
    await expect(page.getByTestId("hr-needs-attention").getByRole("link", { name: /Overdue checks/ })).toHaveAttribute("href", /status=Overdue/);
    await expect(page.getByRole("button", { name: "Add employee" })).toBeVisible();
    await dir.getByRole("link", { name: "Amelia Hart" }).first().click();
    await expect(page).toHaveURL(/\/hr\/people\//);
    await expect(page.getByTestId("key-checks")).toContainText("Right to work");
  });

  test("Checks & Training matrix and the Documents split view", async ({ page }) => {
    await signIn(page);
    await page.goto("/hr/training");
    await hubReady(page);
    const matrix = page.getByTestId("training-matrix");
    await expect(matrix.getByRole("columnheader", { name: "DBS" })).toBeVisible();
    await expect(matrix.getByRole("columnheader", { name: "Overall" })).toBeVisible();
    await page.getByLabel("Overall status").selectOption("Overdue");
    for (const cell of await matrix.locator("tbody tr td:last-child").allInnerTexts()) expect(cell).toBe("Overdue");

    await page.goto("/hr/documents");
    await hubReady(page);
    const split = page.getByTestId("documents-split");
    await split.getByRole("button", { name: /Alice King/ }).click();
    await expect(split.getByRole("heading", { level: 2, name: "Alice King" })).toBeVisible();
    await expect(split.getByRole("button", { name: "Upload file" })).toBeVisible();
    await split.getByRole("tab", { name: /Files & history/ }).click();
    await page.getByRole("link", { name: "By category" }).click();
    await expect(page.getByText("DBS & Safeguarding").first()).toBeVisible();
  });

  test("Recruitment opens on the board; a card opens the candidate panel with the real stages only", async ({ page }) => {
    await signIn(page);
    await page.goto("/hr/recruitment");
    const board = page.getByTestId("pipeline");
    for (const stage of ["Applied", "Screening", "Interview", "Offer", "Onboarding", "Ready for Work"]) await expect(board.getByRole("heading", { level: 3, name: new RegExp(`^${stage}`) })).toBeVisible();
    await expect(board.getByRole("heading", { name: /Compliance/ })).toHaveCount(0);
    await board.getByRole("link").first().click();
    const drawer = page.getByTestId("candidate-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("link", { name: "Open full record" })).toHaveAttribute("href", /\/hr\/recruitment\/c/);
    await drawer.getByRole("link", { name: "Close candidate details" }).click();
    await expect(drawer).toHaveCount(0);
    await page.getByRole("link", { name: "List" }).click();
    await expect(page.getByTestId("rc-count")).toBeVisible();
  });

  test("a Branch Viewer sees the screens but none of the editing actions", async ({ page }) => {
    await signIn(page, "taylor.reed@care-solution.demo");
    await page.goto("/hr/dashboard");
    await hubReady(page);
    await expect(page.getByTestId("hr-directory")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add employee" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Upload document" })).toHaveCount(0);
    await page.goto("/hr/documents");
    await hubReady(page);
    await expect(page.getByTestId("documents-split")).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload file" })).toHaveCount(0);
  });

  test("no sideways scrolling on a phone", async ({ page }) => {
    // Sign in at desktop width (the account menu sits in the sidebar, which folds away on a phone), then narrow.
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const path of ["/hr/dashboard", "/hr/training", "/hr/documents", "/hr/recruitment", "/"]) {
      await page.goto(path);
      if (path.startsWith("/hr/") && path !== "/hr/recruitment") await hubReady(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), path).toBeLessThanOrEqual(0);
    }
  });
});

test.describe("Policy & Compliance, approved design", () => {
  test.use({ viewport: { width: 1672, height: 941 } });

  test("Compliance Dashboard: figures, review status, needs attention and upcoming reviews", async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Policy & Compliance" })).toBeVisible();
    await expect(page.getByTestId("review-status")).toContainText("Current");
    await expect(page.getByTestId("needs-attention")).toBeVisible();
    await expect(page.getByTestId("upcoming-reviews").getByRole("link").first()).toHaveAttribute("href", /\/policies\/c/);
    await expect(page.getByRole("link", { name: "Add policy" })).toBeVisible();
    // The six workspaces are unchanged.
    await expect(sidebar(page).locator("a.shell-page")).toHaveText(["Compliance Dashboard", "Policy Library", "Regulatory Monitoring", "Staff Sign-off", "Audits & Improvements", "Compliance Reports"]);
  });

  test("a care worker gets their reading, not management actions", async ({ page }) => {
    await signIn(page, "carer1@care-solution.demo");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Policy & Compliance" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Add policy" })).toHaveCount(0);
    expect((await page.goto("/compliance/reports"))?.status()).toBe(404);
  });

  test("the policy page keeps every view as a tab", async ({ page }) => {
    await signIn(page);
    await page.goto("/policies");
    const href = await page.locator('a[href^="/policies/c"]').first().getAttribute("href");
    await page.goto(href!);
    for (const name of ["Review Sheet", "Versions", "Read & Sign", "Regulation Map"]) await expect(page.getByRole("tab", { name: new RegExp(name) })).toBeVisible();
    await page.getByRole("tab", { name: /Versions/ }).click();
    await expect(page.getByRole("tab", { name: /Versions/ })).toHaveAttribute("data-state", "active");
  });
});
