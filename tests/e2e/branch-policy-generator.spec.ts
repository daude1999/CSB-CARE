import { expect, test, type Page } from "@playwright/test";

/** Branch-specific Policy Generator: configuration, references, the generator steps, coverage and cross-boundary. */
async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("Branch-specific Policy Generator", () => {
  test.use({ viewport: { width: 1440, height: 941 } });

  test("branch configuration lists each branch with its local authority and can be saved", async ({ page }) => {
    await signIn(page);
    await page.goto("/policies/branches");
    const row = page.getByTestId("branch-row-Liverpool");
    await expect(row).toContainText("Liverpool");
    await expect(row).toContainText("North West");
    await row.getByRole("link").click();
    const form = page.getByTestId("branch-profile-form");
    await form.locator("[name=branchReference]").fill("E2E-LV");
    await form.getByRole("button", { name: "Save branch" }).click();
    await expect(page.getByText(/Branch saved/)).toBeVisible();
    await expect(page.getByTestId("branch-row-Liverpool")).toContainText("E2E-LV");
  });

  test("reference library shows only regional sources for the chosen area", async ({ page }) => {
    await signIn(page);
    await page.goto("/compliance/regulatory/references?la=liverpool");
    const table = page.getByTestId("reference-table");
    await expect(table).toContainText("North West");
    await expect(table).not.toContainText("Pan-London");
    await expect(table).not.toContainText("Tower Hamlets");
  });

  test("the generator shows sources and gaps before generating, then opens the draft", async ({ page }) => {
    await signIn(page);
    await page.goto("/policies/generator");
    const s1 = page.getByTestId("generator-step1");
    await s1.getByLabel("A new policy").check();
    await s1.getByLabel("New policy title").fill("E2E branch safeguarding arrangements");
    await s1.getByLabel("New policy reference").fill(`E2E-BR-${Date.now() % 100000}`);
    await s1.getByLabel("Category").selectOption("SAFEGUARDING");
    await s1.getByRole("button", { name: "Continue" }).click();
    const s2 = page.getByTestId("generator-step2");
    for (const cb of await s2.locator("input[name=branch]").all()) await cb.check();
    await s2.getByRole("button", { name: "Review requirements" }).click();
    const review = page.getByTestId("generator-review");
    await expect(review.getByTestId("review-branch-Liverpool")).toContainText("North West");
    await expect(review.getByTestId("review-branch-Liverpool")).not.toContainText("Pan-London");
    await expect(review.getByTestId("review-branch-Tower Hamlets")).toContainText("London");
    await expect(page.getByTestId("generate-form")).toContainText("critical gap");
    await page.getByTestId("generate-draft").click();
    await expect(page).toHaveURL(/\/revisions\//);
    await expect(page.getByTestId("generated-draft-card")).toContainText("Critical");
  });

  test("coverage and cross-boundary pages load from stored records", async ({ page }) => {
    await signIn(page);
    await page.goto("/policies/coverage");
    await expect(page.getByTestId("coverage-summary")).toBeVisible();
    await page.goto("/policies/cross-boundary?show=all");
    await expect(page.getByTestId("cross-boundary-summary")).toBeVisible();
  });
});
