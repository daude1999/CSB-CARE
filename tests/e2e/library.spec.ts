import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("Policy Library", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("browses, filters, inspects and reads a policy", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/policies");
    await expect(page.getByRole("heading", { level: 1, name: "Policy Library" })).toBeVisible();
    const register = page.getByTestId("policy-register");
    await expect(register.getByRole("heading", { level: 2 })).toHaveText(/^Policies \(\d+\)$/);
    await expect(page.getByRole("link", { name: "Create Policy" })).toBeVisible();
    await expect(page.getByText("Upload Policy")).toHaveCount(0);

    // The first policy opens in the inspector, with the real PDF rendered.
    const inspector = page.getByTestId("policy-inspector");
    await expect(inspector.locator("canvas[data-rendered=true]")).toBeVisible({ timeout: 30_000 });
    await expect(inspector.getByTestId("key-information")).toContainText("Owner");

    // Selecting another row swaps the inspector.
    const second = register.getByTestId("policy-row").nth(1);
    const title = (await second.getByRole("heading").innerText()).trim();
    await second.getByRole("link", { name: title }).first().click();
    await expect(page).toHaveURL(/selected=/);
    await expect(inspector.getByRole("heading", { level: 2 })).toHaveText(title);

    for (const [tab, id] of [["History", "inspector-history"], ["Sign-off", "inspector-signoff"], ["Linked Items", "inspector-linked"]] as const) {
      await inspector.getByRole("tab", { name: tab }).click();
      await expect(inspector.getByTestId(id)).toBeVisible();
    }

    // Category explorer and status filter narrow the register and agree on counts.
    await page.getByRole("navigation", { name: "Categories" }).getByRole("link", { name: /^Safeguarding/ }).first().click();
    await expect(page).toHaveURL(/area=safeguarding/);
    const n = Number((await register.getByRole("heading", { level: 2 }).innerText()).match(/\((\d+)\)/)![1]);
    expect(n).toBeGreaterThan(0);
    await page.getByLabel("Status").selectOption("published");
    await expect(page).toHaveURL(/status=published/);
    await expect(page.getByTestId("register-empty").or(register.getByTestId("policy-row").first())).toBeVisible();

    // Search covers titles and policy text, and can be cleared.
    await page.goto("/policies");
    await page.getByRole("searchbox", { name: "Search policies" }).first().fill("safeguarding");
    await page.getByRole("searchbox", { name: "Search policies" }).first().press("Enter");
    await expect(page).toHaveURL(/q=safeguarding/);
    await expect(register.getByTestId("policy-row").first()).toBeVisible();
    await page.getByRole("link", { name: "Clear filters" }).first().click();
    await expect(page).not.toHaveURL(/q=/);

    // Templates and the review calendar.
    await page.getByRole("navigation", { name: "Library views" }).getByRole("link", { name: "Templates" }).click();
    await expect(register.getByRole("heading", { level: 2 })).toHaveText(/^Templates \(\d+\)$/);
    await page.getByRole("navigation", { name: "Library views" }).getByRole("link", { name: "Review Calendar" }).click();
    await expect(page.getByTestId("review-calendar")).toBeVisible();
  });

  test("archives and restores a policy with a reason", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/policies?sort=title");
    const inspector = page.getByTestId("policy-inspector");
    const title = (await inspector.getByRole("heading", { level: 2 }).innerText()).trim();
    await inspector.getByTitle("More policy actions").click();
    await page.getByRole("button", { name: "Archive policy" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason").fill("Replaced by a combined policy");
    await dialog.getByRole("button", { name: "Archive policy" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page).toHaveURL(/tab=archived/);
    await expect(page.getByTestId("policy-register").getByRole("heading", { level: 2 })).toHaveText("Archived policies (1)");
    await expect(inspector.getByRole("heading", { level: 2 })).toHaveText(title);

    await inspector.getByRole("button", { name: "Restore" }).click();
    await page.getByRole("dialog").getByLabel("Reason").fill("Combined policy withdrawn");
    await page.getByRole("dialog").getByRole("button", { name: "Restore policy" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page).not.toHaveURL(/tab=archived/);
  });

  test("care staff can read but not manage", async ({ page }) => {
    await signIn(page, "carer1@care-solution.demo");
    await page.goto("/policies");
    await expect(page.getByRole("heading", { level: 1, name: "Policy Library" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create Policy" })).toHaveCount(0);
    const inspector = page.getByTestId("policy-inspector");
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Assign for Review" })).toHaveCount(0);
    await expect(inspector.getByRole("button", { name: "Create Revision" })).toHaveCount(0);
    // A forged selection of another organisation's policy is "not found", never shown.
    await page.goto("/policies?selected=cmzzzzzzzzzzzzzzzzzzzzzzz");
    await expect(inspector).toContainText("Policy not found");
  });

  test("is keyboard reachable from the search shortcut", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/policies");
    await page.keyboard.press("Control+k");
    await expect(page.locator("#global-search")).toBeFocused();
    await page.locator("#global-search").fill("medicines");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/q=medicines/);
  });
});
