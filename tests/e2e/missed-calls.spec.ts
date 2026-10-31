import { expect, test, type Page } from "@playwright/test";

/** Missed Calls in the browser: the register's figures and filters, then a case worked from reason to sign-off request. */
const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test("Missed Calls register: figures, smart filter, and a case investigated to sign-off", async ({ page }) => {
  await signIn(page, "coordinator@care-solution.demo");
  await page.goto("/rota/missed?period=month");
  await expect(page.getByRole("heading", { name: "Missed Calls" })).toBeVisible();
  const figures = page.getByRole("region", { name: "Management figures" });
  for (const label of ["Total missed calls", "Repeat offenders", "High-risk missed visits", "Uninvestigated", "Resolved", "Repeat service-user incidents"]) await expect(figures.getByText(label, { exact: true })).toBeVisible();

  await page.getByRole("link", { name: /^Uninvestigated \d+$/ }).click();
  await expect(page).toHaveURL(/smart=uninvestigated/);
  const first = page.locator("table a[href^='/rota/missed/']").first();
  await first.click();
  await expect(page.getByRole("heading", { name: /^Missed call / })).toBeVisible();

  await page.getByLabel("Reason for the missed call").selectOption("CARER_TRAVEL");
  await page.getByLabel("What happened (findings)").fill("Carer's car broke down; they did not ring the office.");
  await page.getByRole("button", { name: "Save reason" }).click();
  await expect(page).toHaveURL(/ok=Reason\+recorded/);

  await page.locator("select[name=replacementType]").selectOption("FAMILY_COVERED");
  await page.getByLabel("Client or family told (who, how, when)").fill("Son by phone at 12:40");
  await page.getByRole("button", { name: "Record arrangement" }).click();
  await expect(page).toHaveURL(/ok=Replacement\+care/);

  await page.getByLabel("Management comment").fill("Checked with the family; all well.");
  await page.getByRole("button", { name: "Add comment" }).click();
  await expect(page).toHaveURL(/ok=Comment/);
  await expect(page.getByText("Checked with the family; all well.", { exact: true })).toBeVisible();

  await page.getByLabel("Investigation outcome").selectOption("MISSED_CARER");
  await page.getByLabel("Preventable?").selectOption("yes");
  await page.getByLabel("Outcome summary and what will stop it happening again").fill("Reminded to ring the office whenever delayed.");
  await page.getByRole("button", { name: "Send for manager sign-off" }).click();
  await expect(page).toHaveURL(/ok=Sent\+to\+the\+care/);
  await expect(page.getByText("You investigated this missed call, so another care manager must sign it off.")).toBeVisible();
});

test("Missed Calls on a phone shows cards and the figures", async ({ page }) => {
  await signIn(page, "manager@care-solution.demo");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/rota/missed?period=month");
  await expect(page.getByRole("region", { name: "Management figures" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Export Excel" })).toBeVisible();
});
