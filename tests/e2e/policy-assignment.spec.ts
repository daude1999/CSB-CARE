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
  test("a manager assigns a published policy to named staff and sees the rule", async ({ page }) => {
    await signIn(page);

    // Use the seeded, published safeguarding policy. The test database is rebuilt by Playwright setup.
    await page.goto("/policies?q=Safeguarding%20Adults");
    const policyLink = page.locator('a[href^="/policies/c"]').filter({ hasText: "Safeguarding Adults" }).first();
    await expect(policyLink).toBeVisible();
    const policyHref = await policyLink.getAttribute("href");
    expect(policyHref).toBeTruthy();

    const policyId = policyHref!.split("/").filter(Boolean).at(-1)!;
    await page.goto(`/staff/policy/${policyId}`);
    await expect(page.getByRole("heading", { name: /Safeguarding Adults/ })).toBeVisible();

    const form = page.locator('form:has(select[name="scope"])');
    await expect(form).toBeVisible();
    await form.locator('select[name="scope"]').selectOption("STAFF");

    const people = form.locator('select[name="staffMemberIds"]');
    const firstPerson = people.locator("option").first();
    await expect(firstPerson).toHaveCount(1);
    const staffId = await firstPerson.getAttribute("value");
    const staffName = (await firstPerson.textContent())?.split(" · ")[0]?.trim();
    expect(staffId).toBeTruthy();
    expect(staffName).toBeTruthy();
    await people.selectOption(staffId!);

    await form.getByRole("button", { name: "Add assignment" }).click();
    await expect(page.getByRole("status")).toContainText("Assignment added");
    await expect(page.getByText(`Named people: ${staffName}`, { exact: true })).toBeVisible();
  });
});
