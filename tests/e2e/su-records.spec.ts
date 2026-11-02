import { expect, test, type Page } from "@playwright/test";

/**
 * Service user profile records (2 Nov 2026): grouped sections, the records summary on the Overview, risk assessments
 * with versions, the person's incidents and visit notes. Demo data only.
 */
const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

async function openFirstPerson(page: Page) {
  await page.goto("/rota/service-users");
  await page.locator('main a[href^="/rota/service-users/c"]').first().click();
  await expect(page.getByRole("navigation", { name: "Service user sections" })).toBeVisible();
  return page.url().split("?")[0]!;
}

test.describe("Service user records", () => {
  test("sections are grouped, and each group opens its own sub-sections", async ({ page }) => {
    await signIn(page);
    await openFirstPerson(page);
    const groups = page.getByRole("navigation", { name: "Service user sections" });
    for (const name of ["Overview", "Personal details", "Care", "Health and safety", "Visits", "Contacts & carers", "History"]) await expect(groups.getByRole("link", { name, exact: true })).toBeVisible();
    await expect(page.getByTestId("care-at-a-glance")).toContainText("Records and compliance");
    for (const row of ["care-plan", "risks", "incidents", "notes"]) await expect(page.locator(`[data-testid=care-at-a-glance] li[data-row=${row}]`)).toBeVisible();
    await groups.getByRole("link", { name: "Care", exact: true }).click();
    const care = page.getByRole("navigation", { name: "Care sections" });
    for (const name of ["Care plans", "Risk assessments", "Care package", "Medication"]) await expect(care.getByRole("link", { name, exact: true })).toBeVisible();
    await expect(care.getByRole("link", { name: "Care plans" })).toHaveAttribute("aria-current", "page");
    await groups.getByRole("link", { name: "Visits", exact: true }).click();
    await page.getByRole("navigation", { name: "Visits sections" }).getByRole("link", { name: "Visit notes" }).click();
    await expect(page.getByRole("heading", { name: "Visit notes" })).toBeVisible();
    await expect(page.getByRole("form", { name: "Filter visit notes" })).toBeVisible();
  });

  test("a manager records a risk assessment with actions, reviews it and reads the earlier version", async ({ page }) => {
    await signIn(page);
    const base = await openFirstPerson(page);
    await page.goto(`${base}?tab=risks`);
    await page.getByRole("link", { name: "New assessment" }).click();
    await page.getByLabel("Type").selectOption("FALLS");
    await page.getByLabel("Risk level after controls").selectOption("MEDIUM");
    await page.getByLabel("Title").fill("E2E falls on the stairs");
    await page.getByLabel(/^Hazards/).fill("Unsteady on the stairs late in the evening.");
    await page.getByLabel(/^Controls/).fill("Walk behind on the stairs and keep the landing light on.");
    await page.getByLabel(/^Actions still required/).fill("Ask the OT about a second rail");
    await page.getByLabel("Responsible for the actions").fill("Care coordinator");
    await page.getByRole("button", { name: "Save assessment" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await expect(page.getByText("Ask the OT about a second rail").first()).toBeVisible();
    await page.getByLabel("Risk level after controls").selectOption("HIGH");
    await page.getByRole("button", { name: "Save review" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    const versions = page.getByRole("list", { name: "Saved versions, newest first" });
    await expect(versions).toContainText("Version 2 (current)");
    await versions.getByRole("link", { name: "Version 1" }).click();
    await expect(page.getByRole("note")).toContainText("You are reading version 1");
    await expect(page.getByText("Medium risk", { exact: true })).toBeVisible();
    await page.goto(`${base}?tab=risks`);
    await expect(page.locator("main tr", { hasText: "E2E falls on the stairs" })).toContainText("Care coordinator");
  });

  test("an incident reported from the profile names the person and who was told", async ({ page }) => {
    await signIn(page);
    const base = await openFirstPerson(page);
    await page.goto(`${base}?tab=incidents`);
    await page.getByRole("link", { name: "Report an incident" }).click();
    await page.getByLabel("Category").selectOption("Fall");
    await page.getByLabel("How serious").selectOption("LOW");
    await page.getByLabel(/What happened/).fill("Found sitting on the floor by the bed. No injury seen; helped up with the frame.");
    await page.getByLabel(/Who was told/).fill("Son by phone");
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText("Son by phone").first()).toBeVisible();
    await page.goto(`${base}?tab=incidents`);
    await expect(page.locator("main tbody tr").first()).toContainText("Fall");
  });
});
