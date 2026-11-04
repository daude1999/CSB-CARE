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

/** Opens the profile of a service user who has repeating visits, from the Daily Templates list. */
async function openProfileWithTemplates(page: Page) {
  await page.goto("/rota/templates?week=all&day=all");
  const href = await page.locator('a[title="Open the service user\'s record"]').first().getAttribute("href");
  expect(href).toBeTruthy();
  return href!;
}

/** Service User Profile -> Visits -> Template and Rota (brief of 3 Nov 2026). */
test.describe("Service user Template and Rota tabs", () => {
  test("Template tab: weeks and days filter together, and Clear Filters resets", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await signIn(page, "manager@care-solution.demo");
    const profile = await openProfileWithTemplates(page);
    await page.goto(`${profile}?tab=visits`);
    const sub = page.getByRole("navigation", { name: "Visits sections" });
    await expect(sub.getByRole("link")).toHaveText(["Visits", "Template", "Rota", "Visit notes", "Missed calls"]);
    await sub.getByRole("link", { name: "Template" }).click();
    await expect(page.getByRole("heading", { name: "Template", level: 2 })).toBeVisible();
    await expect(page.getByTestId("template-summary")).toContainText("for all weeks, every day");
    const total = await page.locator("table tbody tr").count();
    expect(total).toBeGreaterThan(0);

    await page.getByTestId("week-select").locator("summary").click();
    await page.getByRole("group", { name: "Select weeks" }).getByRole("link", { name: "Week 1" }).click();
    await expect(page).toHaveURL(/weeks=1/);
    await page.getByTestId("week-select").locator("summary").click();
    await page.getByRole("group", { name: "Select weeks" }).getByRole("link", { name: "Week 3" }).click();
    await expect(page).toHaveURL(/weeks=1%2C3|weeks=1,3/);
    await page.getByRole("group", { name: "Days" }).getByRole("link", { name: "Monday" }).click();
    await page.getByRole("group", { name: "Days" }).getByRole("link", { name: "Wednesday" }).click();
    await expect(page.getByTestId("template-summary")).toContainText("Week 1 and Week 3, Monday and Wednesday");
    await expect(page.getByRole("group", { name: "Days" }).getByRole("link", { name: "Monday, selected" })).toHaveAttribute("aria-pressed", "true");
    await page.screenshot({ path: `${SHOTS}/su-template-filtered-1672.png` });

    await page.getByRole("link", { name: "Clear Filters" }).click();
    await expect(page.getByTestId("template-summary")).toContainText("for all weeks, every day");
    await expect(page.locator("table tbody tr")).toHaveCount(total);

    // Add Template opens the form with this person already chosen.
    await page.getByRole("link", { name: "Add Template" }).click();
    const id = profile.split("/").pop()!;
    await expect(page.locator('select[name="serviceUserId"]')).toHaveValue(id);
  });

  test("Rota tab: week navigation, status filters and the same visit as the Daily Rota", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await signIn(page, "manager@care-solution.demo");
    const profile = await openProfileWithTemplates(page);
    await page.goto(`${profile}?tab=rota`);
    await expect(page.getByRole("heading", { name: "Rota", level: 2 })).toBeVisible();
    const range = await page.getByTestId("rota-range").textContent();
    expect(range).toMatch(/^Monday \d+ \w+ – Sunday \d+ \w+ \d{4}/);
    await page.getByRole("link", { name: "Next Week" }).click();
    await expect(page.getByTestId("rota-range")).not.toHaveText(range!);
    await page.getByRole("link", { name: "This Week" }).click();
    await expect(page.getByTestId("rota-range")).toHaveText(range!);

    const filters = page.getByRole("group", { name: "Show visits" });
    await filters.getByRole("link", { name: /^Completed/ }).click();
    await expect(page).toHaveURL(/status=completed/);
    const statuses = await page.locator("table tbody tr td:nth-child(9)").allTextContents();
    expect(statuses.every((s) => s.startsWith("Completed"))).toBe(true);
    await filters.getByRole("link", { name: /^All/ }).click();

    // The first visit's reference opens the same record the Daily Rota and Visit Details use.
    const first = page.locator("table tbody tr").first();
    const ref = await first.getAttribute("data-visit");
    await first.getByRole("link", { name: /Open/ }).click();
    await expect(page.getByText(ref!).first()).toBeVisible();
  });

  test("tabs are reachable by keyboard and fit a phone", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await signIn(page, "manager@care-solution.demo");
    await page.setViewportSize({ width: 390, height: 844 });
    const profile = await openProfileWithTemplates(page);
    await page.goto(`${profile}?tab=template`);
    const days = page.getByRole("group", { name: "Days" });
    await days.getByRole("link", { name: "All Days" }).focus();
    await page.keyboard.press("Tab");
    await expect(days.getByRole("link", { name: "Monday" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/days=1/);
    await page.screenshot({ path: `${SHOTS}/su-template-390.png`, fullPage: true });
    await page.goto(`${profile}?tab=rota`);
    await page.screenshot({ path: `${SHOTS}/su-rota-390.png`, fullPage: true });
  });
});
