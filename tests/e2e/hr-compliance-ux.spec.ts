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
/** The current module's pages in the Harbour menu (readable while the menu is closed). */
const sidebar = (page: Page) => page.getByTestId("portal-pages");
const currentPage = (page: Page) => page.getByTestId("harbour-menu").locator('a.hb-ti[aria-current="page"]');
const hubReady = (page: Page) => expect(page.getByText("Opening your HR workspace")).toHaveCount(0, { timeout: 30_000 });

test.describe("HR & Workforce, approved design", () => {
  test.use({ viewport: { width: 1672, height: 941 } });

  test("seven menu destinations; tasks, alerts, checks, availability and branches stay one click away", async ({ page }) => {
    await signIn(page);
    await page.goto("/hr/dashboard");
    await hubReady(page);
    const pages = sidebar(page).locator("a.hb-ti");
    await expect(pages).toHaveText(["HR Dashboard", "People", "Recruitment", "Checks & Training", "Documents", "Time Off & Availability", "Settings"]);
    await hubReady(page);
    await page.getByTestId("hr-heading").getByRole("link", { name: "My tasks" }).click();
    await expect(page).toHaveURL(/\/hr\/alerts\?.*view=tasks/);
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

  test("HR overview: priorities, not a directory; each Review opens the filtered screen", async ({ page }) => {
    await signIn(page);
    await page.goto("/hr/dashboard");
    await hubReady(page);
    await expect(page.getByRole("heading", { level: 1, name: "HR overview" })).toBeVisible();
    await expect(page.getByText("Your priorities today")).toBeVisible();
    for (const id of ["fig-employees", "fig-actions", "fig-starting", "fig-interviews"]) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId("fig-actions")).not.toContainText("…");
    // No employee directory on the overview (that is People's job).
    await expect(page.getByTestId("people-table")).toHaveCount(0);
    const actions = page.getByTestId("hr-action-required");
    await expect(actions.getByRole("link", { name: /^Review: .*checks? overdue/ })).toHaveAttribute("href", /\/hr\/compliance\?.*status=Overdue/);
    await actions.getByRole("link", { name: /^Review: .*missing evidence/ }).click();
    await expect(page).toHaveURL(/\/hr\/compliance\?.*status=Missing\+evidence/);
    await hubReady(page);
    await expect(page.getByRole("button", { name: "Missing evidence" })).toHaveClass(/active/);
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "HR overview" })).toBeVisible();
    await page.getByTestId("fig-employees").click();
    await expect(page).toHaveURL(/\/hr\/people/);
  });

  test("People: one directory with search, branch and status filters; a name opens the record and Back keeps the filters", async ({ page }) => {
    await signIn(page);
    await page.goto("/hr/people");
    await hubReady(page);
    await expect(page.getByRole("heading", { level: 1, name: "People" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add employee" })).toHaveCount(1);
    const table = page.getByTestId("people-table");
    for (const h of ["Name", "Role", "Branch", "Status", "Compliance"]) await expect(table.getByRole("columnheader", { name: h })).toBeVisible();
    await page.getByLabel("Employment status").selectOption("Onboarding");
    for (const s of await table.locator("tbody tr td:nth-child(4)").allInnerTexts()) expect(s).toContain("New starter");
    await page.getByLabel("Employment status").selectOption("");
    await page.getByRole("searchbox", { name: "Search employees" }).fill("Amelia Hart");
    await expect(table.locator("tbody tr")).toHaveCount(2);
    await expect(page).toHaveURL(/q=Amelia/);
    await table.getByRole("button", { name: /Open Amelia Hart's record/ }).first().click();
    await expect(page).toHaveURL(/\/hr\/people\/.+returnTo=/);
    await expect(page.getByTestId("record-checks")).toContainText("Right to work");
    await page.goBack();
    await expect(page.getByRole("searchbox", { name: "Search employees" })).toHaveValue("Amelia Hart");
    // The actions menu: quick view and edit, reachable from the keyboard.
    await table.getByRole("button", { name: /Actions for Amelia Hart/ }).first().click();
    await expect(page.getByRole("button", { name: "Edit details" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Edit details" })).toHaveCount(0);
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

  test("Recruitment opens on the board with every real stage; a card opens the record, its menu the quick panel", async ({ page }) => {
    await signIn(page);
    await page.goto("/hr/recruitment");
    await expect(page.getByRole("heading", { level: 1, name: "Recruitment" })).toBeVisible();
    const board = page.getByTestId("pipeline");
    for (const stage of ["Applied", "Screening", "Interview", "Offer", "Onboarding", "Ready for Work"]) await expect(board.getByRole("heading", { level: 2, name: new RegExp(`^${stage}`) })).toBeVisible();
    await expect(board.getByRole("heading", { name: /Compliance/ })).toHaveCount(0);
    const applied = board.getByRole("region", { name: /^Applied/ });
    const name = (await applied.getByTestId("applicant-card").first().locator(".hx-applicant-name").innerText()).trim();
    const card = board.getByTestId("applicant-card").filter({ hasText: name }).first();
    await expect(card.getByRole("link", { name })).toHaveAttribute("href", /\/hr\/recruitment\/c/);
    await card.getByLabel(`Actions for ${name}`).click();
    await card.getByRole("link", { name: /Quick view/ }).click();
    const drawer = page.getByTestId("candidate-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Screening" })).toBeVisible();
    await drawer.getByRole("button", { name: "Screening" }).click();
    await expect(page.getByTestId("pipeline").getByRole("region", { name: /^Screening/ })).toContainText(name);
    await page.getByLabel("Search applicants").fill("zzz-nobody");
    await page.getByLabel("Search applicants").press("Enter");
    await expect(page).toHaveURL(/q=zzz-nobody/);
    await expect(page.getByText("No one here matches.").first()).toBeVisible();
    // An unknown applicant in the address shows no panel rather than an error.
    await page.goto("/hr/recruitment?candidate=not-a-candidate");
    await expect(drawer).toHaveCount(0);
    await page.getByRole("link", { name: "List" }).click();
    await expect(page.getByTestId("rc-count")).toBeVisible();
  });

  test("a Branch Viewer sees the screens but none of the editing actions", async ({ page }) => {
    await signIn(page, "taylor.reed@care-solution.demo");
    await page.goto("/hr/people");
    await hubReady(page);
    await expect(page.getByTestId("people-table")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add employee" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "More people actions" })).toHaveCount(0);
    await page.goto("/hr/recruitment");
    await expect(page.getByRole("link", { name: "Add applicant" })).toHaveCount(0);
    await page.goto("/hr/documents");
    await hubReady(page);
    await expect(page.getByTestId("documents-split")).toBeVisible();
    await expect(page.getByRole("button", { name: "Upload file" })).toHaveCount(0);
  });

  test("no sideways scrolling on a phone", async ({ page }) => {
    // Sign in at desktop width (the signed-in name is hidden on a phone), then narrow.
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

  test("Compliance Dashboard: four figures, needs attention and key dates", async ({ page }) => {
    await signIn(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Compliance Dashboard" })).toBeVisible();
    for (const id of ["figure-total", "figure-up-to-date", "figure-needs-review", "figure-drafts"]) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId("needs-attention")).toBeVisible();
    await expect(page.getByTestId("key-dates").getByRole("link").first()).toHaveAttribute("href", /\/policies\?selected=/);
    await expect(page.getByRole("link", { name: "Create policy" })).toBeVisible();
    // The six workspaces are unchanged; CQC Inspection & Evidence follows them.
    await expect(sidebar(page).locator("a.hb-ti")).toHaveText(["Compliance Dashboard", "Policy Library", "Regulatory Monitoring", "Staff Sign-off", "Audits & Improvements", "Compliance Reports", "CQC Inspection & Evidence"]);
  });

  test("a care worker gets their reading, not management actions", async ({ page }) => {
    await signIn(page, "carer1@care-solution.demo");
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Compliance Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create policy" })).toHaveCount(0);
    expect((await page.goto("/compliance/reports"))?.status()).toBe(404);
  });

  test("the policy page keeps every record view next to the reader", async ({ page }) => {
    await signIn(page);
    await page.goto("/policies");
    const href = await page.locator('a[href^="/policies/c"]:not([href^="/policies/coverage"]):not([href^="/policies/cross"])').first().getAttribute("href");
    await page.goto(href!);
    await expect(page.getByTestId("reader-nav").getByRole("link", { name: "Review Sheet" })).toBeVisible();
    const views = page.getByTestId("record-views");
    for (const name of ["Versions", "Read & Sign", "Regulation Map"]) await expect(views.getByRole("link", { name: new RegExp(name) })).toBeVisible();
    await views.getByRole("link", { name: /Versions/ }).click();
    await expect(views.getByRole("link", { name: /Versions/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("version-history")).toBeVisible();
  });
});
