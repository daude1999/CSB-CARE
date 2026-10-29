import { expect, test, type Page } from "@playwright/test";

/** Browser tests for the Version 1 features: one test per workflow, each from a real sign-in. */

const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("Version 1", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("staff readiness: the manager finds evidence awaiting verification and verifies it", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/readiness");
    await expect(page.getByRole("heading", { level: 1, name: "Staff Readiness" })).toBeVisible();
    await page.getByRole("link", { name: /Pending verification/ }).click();
    await expect(page).toHaveURL(/status=PENDING_VERIFICATION/);
    await page.locator("table a.row-title").first().click();
    await expect(page.getByRole("heading", { name: "Staff readiness" })).toBeVisible();
    const form = page.locator("section[aria-label='Evidence awaiting verification'] form").first();
    await form.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("status")).toContainText("Evidence verified");

    await page.goto("/admin/readiness");
    await expect(page.getByRole("heading", { level: 1, name: "Staff Readiness Matrix" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /Safeguarding adults/ }).first()).toBeVisible();
  });

  test("staff sign-off: the manager targets a policy, drills down and exports reconciled evidence", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/staff");
    await expect(page.getByRole("heading", { level: 1, name: "Staff Sign-off" })).toBeVisible();
    await expect(page.getByText(/not training and does not show competence/).first()).toBeVisible();
    await page.getByRole("link", { name: "By policy" }).click();
    await page.locator("table a.row-title").first().click();
    await expect(page.getByRole("heading", { name: "Who must read it" })).toBeVisible();
    const form = page.locator("form:has(select[name=scope])");
    await form.locator("select[name=scope]").selectOption("ORG");
    await form.getByRole("button", { name: "Add assignment" }).click();
    await expect(page.getByRole("status")).toContainText("Assignment added");
    const csv = await page.request.get("/api/staff-signoff");
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain("Staff member,Sign-in,Job title");
  });

  test("exceptions: the coordinator takes an open exception and resolves it with evidence", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/exceptions");
    await expect(page.getByRole("heading", { level: 1, name: "Exceptions" })).toBeVisible();
    await page.getByRole("link", { name: /^All/ }).click();
    await expect(page).toHaveURL(/state=all/);
    await page.getByRole("link", { name: /^Open/ }).click();
    const first = page.locator("ul.rows > li").first();
    await expect(first).toBeVisible();
    await first.getByLabel("What was done").fill("Rang the family and the carer; visit rearranged");
    await first.getByLabel("Evidence").fill("Office call log");
    await first.getByRole("button", { name: "Resolve" }).click();
    await expect(page.getByRole("status")).toContainText("Exception resolved");
  });

  test("visit notes: the carer writes a handover note and the office finds it on Visit Notes", async ({ page }) => {
    await signIn(page, "carer@care-solution.demo");
    await page.goto("/carer");
    await page.getByText("Add a note").first().click();
    const form = page.locator("form:has(textarea[name=text])").first();
    await form.locator("select[name=category]").selectOption("HANDOVER");
    await form.locator("textarea[name=text]").fill("Front door sticks; lift and push");
    await form.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByRole("status")).toContainText("Note added");
    await page.context().clearCookies();
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/notes?category=HANDOVER");
    await expect(page.getByRole("heading", { level: 1, name: "Visit Notes" })).toBeVisible();
    await expect(page.getByText("Front door sticks; lift and push")).toBeVisible();
  });

  test("care packages: the coordinator replaces a person's package and sees it against the planned visits", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/service-users");
    await page.locator("table tbody a").first().click();
    await page.getByRole("link", { name: "Care package", exact: true }).click();
    await expect(page.getByText(/Repeating visits plan/).first()).toBeVisible();
    const form = page.locator("form:has(input[name=serviceUserId])");
    await form.locator("input[name=reference]").fill("PKG-E2E");
    await form.locator("input[name=hoursPerWeek]").fill("10.5");
    const start = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    await form.locator("input[name=startDate]").fill(start);
    await form.getByRole("button", { name: "Record package" }).click();
    await expect(page.getByRole("status")).toContainText("Care package recorded");
    await expect(page.getByText("PKG-E2E")).toBeVisible();
  });
});
