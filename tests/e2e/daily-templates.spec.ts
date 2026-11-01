import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "DemoPassword!2026";
const SHOTS = "test-results/screens";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

/** Daily Templates to the owner's approved design (1 Nov 2026). */
test.describe("Daily Templates", () => {
  test("week and day pickers, details panel, tabs and Roll Forward", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/templates");
    await expect(page.getByRole("heading", { level: 1, name: "Daily Templates" })).toBeVisible();
    await expect(page.getByText("Manage repeating care visits (up to 4-week cycle)")).toBeVisible();
    const views = page.getByRole("navigation", { name: "Template views" });
    await expect(views.getByRole("link", { name: "Daily Templates" })).toHaveAttribute("aria-current", "page");
    await expect(views.getByRole("link", { name: "Advanced Templates" })).toHaveAttribute("href", "/rota/templates/planner");
    await expect(views.getByRole("link", { name: "Build Rota" })).toHaveAttribute("href", "/rota/build");
    await expect(page.getByTestId("roll-forward")).toHaveAttribute("href", "/rota/build?roll=1");

    await page.getByRole("navigation", { name: "Cycle week" }).getByRole("link", { name: "Week 1" }).click();
    await expect(page).toHaveURL(/week=1/);
    await page.getByRole("navigation", { name: "Day" }).getByRole("link", { name: /Mon/ }).click();
    await expect(page).toHaveURL(/week=1.*day=1|day=1.*week=1/);
    await expect(page.getByRole("navigation", { name: "Day" }).getByRole("link", { name: /Mon/ })).toHaveAttribute("aria-current", "true");
    await page.screenshot({ path: `${SHOTS}/daily-templates-1672.png` });

    // Clicking a row (not a link) opens Template Details; the close button hides it again.
    const firstRow = page.locator("tbody tr[data-href]").first();
    await firstRow.locator("td").nth(3).click();
    const panel = page.getByRole("complementary", { name: "Template Details" });
    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/tpl=/);
    await expect(panel.getByRole("link", { name: "Edit" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Duplicate" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/daily-templates-details-1672.png` });
    await panel.getByRole("link", { name: "Close Template Details" }).click();
    await expect(panel).toBeHidden();

    await page.getByTestId("roll-forward").click();
    await expect(page.getByRole("dialog", { name: "Roll Forward Rota" })).toBeVisible();
  });

  test("deactivate asks first, then switches the template off and back on", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/templates?week=all&day=all");
    await page.locator("tbody tr[data-href]").first().getByRole("link", { name: /^View details of/ }).click();
    const panel = page.getByRole("complementary", { name: "Template Details" });
    const ref = (await panel.locator("p").first().innerText()).split(" ")[0]!;
    await panel.getByRole("link", { name: "Deactivate" }).click();
    await expect(panel.getByRole("alertdialog")).toContainText(`Deactivate ${ref}?`);
    await panel.getByRole("button", { name: "Yes, deactivate" }).click();
    await expect(page.getByRole("status")).toContainText("1 updated");
    await expect(panel.getByText("Disabled", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Enable" }).click();
    await expect(panel.getByText("Enabled", { exact: true })).toBeVisible();
  });

  test("bulk actions say what is missing and apply to the ticked templates", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/templates?week=all&day=all");
    await expect(page.getByTestId("bulk-hint")).toHaveText("Tick the templates to change first.");
    await page.locator("tbody tr[data-href]").first().getByRole("checkbox").check();
    await page.getByLabel("Bulk action", { exact: true }).selectOption("addAlert");
    await expect(page.getByTestId("bulk-hint")).toContainText("for 1 template");
    await page.getByRole("button", { name: "Go" }).click();
    await expect(page.getByRole("status")).toContainText("1 updated");
  });
});
