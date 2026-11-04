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

/** The profile of a service user with repeating visits, and the edit page of their first template. */
async function firstTemplate(page: Page) {
  await page.goto("/rota/templates?week=all&day=all");
  const profile = (await page.locator('a[title="Open the service user\'s record"]').first().getAttribute("href"))!;
  await page.goto(`${profile}?tab=template`);
  const edit = (await page.locator("table tbody tr").first().getByRole("link", { name: "Edit" }).getAttribute("href"))!;
  return { profile, edit };
}

const plusMinutes = (hhmm: string, n: number) => {
  const m = (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)) + n + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** Confirm Template Changes, Create Future Rota (brief of 3 Nov 2026, PR B). */
test.describe("Template save confirmation and Create Future Rota", () => {
  test("Save asks first: no changes, Cancel saves nothing, Template only saves the template", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await signIn(page, "manager@care-solution.demo");
    const { edit } = await firstTemplate(page);
    await page.goto(edit);
    await page.getByRole("button", { name: "Save template" }).click();
    await expect(page.getByTestId("template-save-notice")).toContainText("No changes to save.");

    const start = page.locator('input[name="start"]');
    const was = await start.inputValue();
    await start.fill(plusMinutes(was, 10));
    await page.getByRole("button", { name: "Save template" }).click();
    const dialog = page.getByTestId("template-confirm");
    await expect(dialog.getByRole("heading", { name: "Confirm Template Changes" })).toBeVisible();
    await expect(dialog.getByTestId("template-changes")).toContainText("Start");
    await expect(dialog.getByRole("radio", { name: /Template only/ })).toBeChecked();
    await page.screenshot({ path: `${SHOTS}/tpl-confirm-1672.png` });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(start).toHaveValue(was);

    await start.fill(plusMinutes(was, 10));
    await page.getByRole("button", { name: "Save template" }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("status")).toContainText("Existing scheduled visits were not changed");
    await expect(start).toHaveValue(plusMinutes(was, 10));
  });

  test("Template + future rota: review, final confirmation, then apply", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await signIn(page, "manager@care-solution.demo");
    const { edit } = await firstTemplate(page);
    await page.goto(edit);
    const minutes = page.locator('input[name="durationMin"]');
    const was = Number(await minutes.inputValue());
    await minutes.fill(String(was + 5));
    await page.getByRole("button", { name: "Save template" }).click();
    const dialog = page.getByTestId("template-confirm");
    await dialog.getByRole("radio", { name: /Template \+ future rota/ }).check();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("heading", { name: "Review Changes to Future Rota" })).toBeVisible();
    await expect(dialog.getByTestId("impact-summary")).toContainText("eligible for updating");
    await page.screenshot({ path: `${SHOTS}/tpl-review-1672.png` });
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(dialog.getByRole("heading", { name: "Confirm Future Rota Changes" })).toBeVisible();
    await expect(dialog.getByTestId("final-confirm")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/tpl-final-1672.png` });
    await dialog.getByRole("button", { name: "Confirm & Apply" }).click();
    await expect(page.getByRole("status")).toContainText("Template saved");
    await expect(minutes).toHaveValue(String(was + 5));
  });

  test("bulk template changes are confirmed first", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/templates?week=all&day=all");
    await page.locator("tbody tr[data-href]").first().getByRole("checkbox").check();
    await page.getByLabel("Bulk action", { exact: true }).selectOption("addAlert");
    await page.getByRole("button", { name: "Go" }).click();
    const dialog = page.getByTestId("template-bulk-confirm");
    await expect(dialog.getByRole("heading", { name: "Confirm Template Changes" })).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Go" }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByRole("status")).toContainText("1 updated");
  });

  test("Create Future Rota: preview one person's weeks, then create them", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await signIn(page, "manager@care-solution.demo");
    const { profile } = await firstTemplate(page);
    await page.goto(`${profile}?tab=rota`);
    await page.getByRole("link", { name: "Create Future Rota" }).click();
    const panel = page.getByTestId("future-rota");
    await expect(panel.getByRole("heading", { name: "Create Future Rota" })).toBeVisible();
    // Weeks well ahead of anything the demo has built.
    const monday = new Date();
    monday.setUTCDate(monday.getUTCDate() + 7 * 12 - ((monday.getUTCDay() + 6) % 7));
    await panel.getByLabel("First week").fill(monday.toISOString().slice(0, 10));
    await panel.getByLabel("Number of weeks").selectOption("2");
    await panel.getByRole("button", { name: "Preview" }).click();
    await expect(page.getByTestId("future-summary")).toContainText("new visit");
    const rows = await page.locator('[data-testid="future-table"] tbody tr[data-result="create"]').count();
    expect(rows).toBeGreaterThan(0);
    await page.screenshot({ path: `${SHOTS}/su-future-rota-1672.png` });
    await panel.getByRole("button", { name: /^Create \d+ visits?$/ }).click();
    await expect(page.getByRole("status")).toContainText(`Future rota created: ${rows} visit`);
    await expect(page.getByTestId("future-rota")).toBeHidden();
  });
});
