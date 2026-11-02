import { expect, test, type Page } from "@playwright/test";

/**
 * HR & Workforce owns the employee; the rota schedules them. The rota's staff page shows what scheduling needs
 * (working pattern, HR time off, eligibility), offers the HR record only to people HR lets in, and has no way to
 * change HR's records.
 */
const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

async function firstCarer(page: Page) {
  await page.goto("/rota/staff");
  await page.locator("table.table tbody tr").first().getByRole("link").first().click();
  await expect(page).toHaveURL(/\/rota\/staff\/[^/]+$/);
}

test("a manager with HR access can open the HR record from the rota and keep the working pattern", async ({ page }) => {
  await signIn(page, "manager@care-solution.demo");
  await firstCarer(page);
  await expect(page.getByRole("heading", { name: "Availability" })).toBeVisible();
  await expect(page.getByText("Add to working pattern")).toBeVisible();
  const hr = page.getByTestId("open-hr-record");
  await expect(hr).toHaveAttribute("href", /^\/hr\/people\/[^?]+\?branch=.*returnTo=%2Frota%2Fstaff%2F/);
  // Nothing on the page edits HR's records.
  for (const name of [/edit employee/i, /upload document/i, /record sickness/i, /add training/i]) await expect(page.getByRole("button", { name })).toHaveCount(0);
});

test("a coordinator without HR access schedules staff but is not offered, or given, the HR record", async ({ page }) => {
  await signIn(page, "coordinator@care-solution.demo");
  await firstCarer(page);
  await expect(page.getByTestId("open-hr-record")).toHaveCount(0);
  // Training and competency evidence is HR's: the coordinator sees readiness but no recording forms.
  await expect(page.getByTestId("readiness-hr-only")).toBeVisible();
  await expect(page.getByText("Record training or a qualification")).toHaveCount(0);
  await expect(page.getByText("Add to working pattern")).toBeVisible();
  const res = await page.request.get("/api/hr/hub");
  expect(res.status()).toBe(403);
});
