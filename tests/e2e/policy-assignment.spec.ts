import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@care-solution.demo");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("Policy assignment", () => {
  test("a manager can target a published policy by organisation, branch, work location, role, job title and person", async ({ page }) => {
    await signIn(page);

    // Use the seeded, published safeguarding policy. The test database is rebuilt by Playwright setup.
    await page.goto("/policies?q=Safeguarding%20Adults");
    const policyLink = page.locator('a[href^="/policies/c"]').filter({ hasText: "Safeguarding Adults" }).first();
    const policyHref = await policyLink.getAttribute("href");
    expect(policyHref).toMatch(/^\/policies\/c/);

    const policyId = policyHref!.split("/").filter(Boolean).at(-1)!;
    await page.goto(`/staff/policy/${policyId}`);
    await expect(page.getByRole("heading", { name: /Safeguarding Adults/ })).toBeVisible();

    const form = page.locator('form:has(select[name="scope"])');
    await expect(form).toBeVisible();
    const chooseFirst = async (name: string) => {
      const select = form.locator(`select[name="${name}"]`);
      const value = await select.locator('option:not([value=""])').first().getAttribute("value");
      expect(value).toBeTruthy();
      await select.selectOption(value!);
    };
    const add = async (scope: string, field?: string) => {
      await form.locator('select[name="scope"]').selectOption(scope);
      if (field) await chooseFirst(field);
      await form.getByRole("button", { name: "Add assignment" }).click();
      await expect(page.getByRole("status")).toContainText("Assignment added");
    };

    await add("ORG");
    await add("BRANCH", "branchId");
    await add("WORKS_IN_BRANCH", "branchId");
    await add("ROLE", "orgRole");
    await add("JOB_TITLE", "jobTitle");

    await form.locator('select[name="scope"]').selectOption("STAFF");
    const people = form.locator('select[name="staffMemberIds"]');
    const firstPerson = people.locator("option").first();
    const staffId = await firstPerson.getAttribute("value");
    const staffName = (await firstPerson.textContent())?.split(" · ")[0]?.trim();
    expect(staffId).toBeTruthy();
    expect(staffName).toBeTruthy();
    await people.selectOption(staffId!);
    await form.getByRole("button", { name: "Add assignment" }).click();
    await expect(page.getByRole("status")).toContainText("Assignment added");

    for (const label of [
      "Everyone in the organisation",
      "Branch:",
      "Works in branch (incl. cross-branch staff):",
      "Platform role:",
      "Job title:",
      `Named person: ${staffName}`,
    ]) await expect(page.getByText(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))).first()).toBeVisible();
  });
});
