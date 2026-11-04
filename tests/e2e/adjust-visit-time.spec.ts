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

/** A service user's Rota tab for next week, where every visit is still to come. */
async function nextWeekRota(page: Page) {
  await page.goto("/rota/templates?week=all&day=all");
  const profile = (await page.locator('a[title="Open the service user\'s record"]').first().getAttribute("href"))!;
  await page.goto(`${profile}?tab=rota`);
  await page.getByRole("link", { name: "Next Week" }).click();
  await expect(page.locator("table tbody tr").first()).toBeVisible();
}

/** Quick Adjust Visit Time (brief of 3 Nov 2026, PR C). */
test.describe("Adjust Visit Time", () => {
  test("a shorter visit needs an allowed reason; Cancel changes nothing", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await signIn(page, "manager@care-solution.demo");
    await nextWeekRota(page);
    const row = page.locator("table tbody tr").first();
    const before = await row.locator("td").nth(2).textContent();
    await row.getByRole("button", { name: "Adjust time" }).click();
    const d = page.locator("dialog[open][data-testid=adjust-time]");
    await expect(d.getByRole("heading", { name: "Adjust Visit Time" })).toBeVisible();
    const minutes = d.getByLabel("Duration (minutes)");
    const was = Number(await minutes.inputValue());
    await d.getByRole("group", { name: "Duration" }).getByRole("button", { name: "60 min" }).click();
    await expect(minutes).toHaveValue("60");
    await minutes.fill(String(was - 5));
    await d.getByLabel("Reason for the change").fill("Family asked for a shorter call");
    await page.screenshot({ path: `${SHOTS}/adjust-edit-1672.png` });
    await d.getByRole("button", { name: "Check new time" }).click();
    await expect(d.getByRole("heading", { name: "Confirm Visit Time Adjustment" })).toBeVisible();
    await expect(d.getByTestId("adjust-compare")).toContainText(`${was - 5} min`);
    const confirm = d.getByRole("button", { name: "Confirm" });
    await expect(d.getByRole("group", { name: "Why is the visit shorter than planned?" })).toBeVisible();
    await expect(confirm).toBeDisabled();
    await d.getByLabel("Service user or family request").check();
    await page.screenshot({ path: `${SHOTS}/adjust-confirm-1672.png` });
    await d.getByRole("button", { name: "Cancel" }).click();
    await expect(d).toBeHidden();
    await page.reload();
    await expect(page.locator("table tbody tr").first().locator("td").nth(2)).toHaveText(before!);
  });

  test("a later start is checked, confirmed and shown on the rota", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await signIn(page, "manager@care-solution.demo");
    await nextWeekRota(page);
    const rows = page.locator("table tbody tr");
    const count = await rows.count();
    // Try visits until one whose carers can do a time 5 minutes later.
    for (let i = 0; i < Math.min(count, 6); i++) {
      const row = rows.nth(i);
      const button = row.getByRole("button", { name: "Adjust time" });
      if (!(await button.count())) continue;
      const start = (await row.locator("td").nth(1).textContent())!.trim();
      await button.click();
      const d = page.locator("dialog[open][data-testid=adjust-time]");
      const m = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + 5;
      const later = `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      await d.getByLabel("Start time").fill(later);
      await d.getByLabel("Reason for the change").fill("Pharmacy delivery at the planned time");
      await d.getByRole("button", { name: "Check new time" }).click();
      await expect(d.getByRole("heading", { name: "Confirm Visit Time Adjustment" })).toBeVisible();
      if (await d.getByTestId("adjust-blocking").count()) {
        await expect(d.getByRole("button", { name: "Confirm" })).toBeDisabled();
        await d.getByRole("button", { name: "Cancel" }).click();
        continue;
      }
      await d.getByRole("button", { name: "Confirm" }).click();
      await expect(page.getByTestId("adjust-done")).toContainText(`now runs ${later}`);
      await expect(rows.nth(i).locator("td").nth(1)).toHaveText(later);
      await expect(rows.nth(i)).toContainText("Manual change");
      return;
    }
    throw new Error("No visit in the first rows could move 5 minutes later");
  });
});
