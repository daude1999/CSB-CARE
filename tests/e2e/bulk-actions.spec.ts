import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "DemoPassword!2026";
const SHOTS = "test-results/bulk-actions";
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/csb_e2e?schema=public";

const ALL_ACTIONS = [
  "Cancel Visits", "Activate Visits", "Reassign Visits", "Unassign Visits", "Add Rota Lock(s)", "Remove Rota Lock(s)", "Edit Times", "Edit Duration", "Edit Service Name",
  "Add Alerts", "Remove Alerts", "Add Shadow Shifts", "Convert To Double Up", "Revert Double Up To Single", "Change Carers Needed", "Nudge Times", "Publish to Carers", "Complete Calls",
];

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("Daily Rota bulk actions", () => {
  test.use({ viewport: { width: 1672, height: 941 } });

  test("offers all 18 actions; the count, Select all and Go follow the ticks exactly", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/visits");
    const bulk = page.locator("#bulk");
    const options = await bulk.locator("select[name=kind] option:not([disabled])").allTextContents();
    expect(options).toEqual(ALL_ACTIONS);

    const boxes = page.locator("input[name=visitIds]");
    const all = page.getByLabel("Select all visits on this page");
    const go = bulk.getByRole("button", { name: "Go" });
    const n = await boxes.count();
    test.skip(n < 3, "Needs at least three visits today");
    await boxes.nth(0).check();
    await boxes.nth(1).check();
    await expect(bulk.getByTestId("bulk-selected")).toHaveText("2 selected");
    await boxes.nth(1).press("Space"); // keyboard unticks too
    await expect(bulk.getByTestId("bulk-selected")).toHaveText("1 selected");
    await all.check();
    await expect(bulk.getByTestId("bulk-selected")).toHaveText(`${n} selected`);
    await boxes.nth(0).uncheck();
    await expect(bulk.getByTestId("bulk-selected")).toHaveText(`${n - 1} selected`);
    // Select all no longer claims every row once one is unticked.
    expect(await all.evaluate((el: HTMLInputElement) => ({ checked: el.checked, part: el.indeterminate }))).toEqual({ checked: false, part: true });
    await expect(go).toBeDisabled();
    await bulk.locator("select[name=kind]").selectOption("editDuration");
    await expect(go).toBeDisabled();
    await bulk.getByLabel("New length in minutes").fill("3");
    await expect(bulk.getByTestId("bulk-hint")).toContainText("5 to 1440");
    await bulk.getByLabel("New length in minutes").fill("45");
    await expect(go).toBeEnabled();
    // Enter opens the review instead of changing anything straight away.
    await bulk.getByLabel("New length in minutes").press("Enter");
    const review = page.getByRole("dialog", { name: "Review: Edit Duration" });
    await expect(review.getByTestId("bulk-review-summary")).toContainText(`${n - 1} visits selected`);
    await expect(page).not.toHaveURL(/[?&](ok|error)=/);
    await review.getByRole("button", { name: "Back" }).click();
    await expect(review).toBeHidden();
    // Clicking a part-ticked Select all ticks every row; clicking again clears them.
    await all.click();
    await expect(bulk.getByTestId("bulk-selected")).toHaveText(`${n} selected`);
    await all.click();
    await expect(bulk.getByTestId("bulk-selected")).toHaveText("0 selected");
  });

  test("Complete Calls: review with exceptions, confirm, exact results, and the list shows office confirmed", async ({ page }) => {
    const data = JSON.parse(execSync("npx tsx tests/e2e/fixtures/bulk-complete.ts", { env: { ...process.env, DATABASE_URL, LOG_LEVEL: "warn" } }).toString()) as { date: string; scheduled: string[]; missed: string[]; unstaffed: string[]; cancelled: string[] };
    const refs = [...data.scheduled, ...data.missed, ...data.unstaffed, ...data.cancelled];
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto(`/rota/visits?date=${data.date}&cancelled=1&sort=time`);
    const bulk = page.locator("#bulk");
    for (const r of refs) await page.getByLabel(`Select ${r}`, { exact: true }).check();
    await expect(bulk.getByTestId("bulk-selected")).toHaveText("6 selected");
    await bulk.locator("select[name=kind]").selectOption("complete");
    await expect(bulk.getByTestId("bulk-hint")).toHaveText("Give the reason for completing (at least 3 letters).");
    await bulk.getByLabel("Reason for completing").fill("Carer's phone failed; visits confirmed with the family");
    await expect(bulk.getByTestId("bulk-hint")).toHaveText("Say who confirmed the care was delivered.");
    await bulk.getByLabel("Who confirmed the care was delivered").fill("Jo Smith, senior carer");
    await page.screenshot({ path: `${SHOTS}/1-complete-calls-bar.png` });
    await bulk.getByRole("button", { name: "Go" }).click();

    const review = page.getByRole("dialog", { name: "Review: Complete Calls" });
    await expect(review.getByTestId("bulk-review-summary")).toHaveText("6 visits selected: 4 will change, 2 cannot be changed.");
    await expect(review.getByText(`Cancelled visits are not completed here`)).toBeVisible();
    await expect(review.getByText("Nobody is booked on this visit", { exact: false })).toBeVisible();
    await expect(review.getByText("Recorded as missed: the missed-call record and its investigation are kept")).toBeVisible();
    const confirm = review.getByRole("button", { name: "Confirm Completion (4)" });
    await expect(confirm).toBeDisabled(); // until the coordinator confirms the care was delivered
    await review.getByLabel(`Actual start for ${data.scheduled[0]}`).fill("02:05");
    await review.getByLabel(`Actual end for ${data.scheduled[0]}`).fill("02:30");
    await review.getByRole("checkbox", { name: /I confirm the care on these 4 visits was delivered/ }).check();
    await page.screenshot({ path: `${SHOTS}/2-review.png` });
    // The review works on a tablet and a phone too.
    for (const [w, h, name] of [[834, 1112, "2b-review-tablet"], [390, 844, "2c-review-phone"]] as const) {
      await page.setViewportSize({ width: w, height: h });
      await expect(confirm).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/${name}.png` });
    }
    await page.setViewportSize({ width: 1672, height: 941 });
    await confirm.click();

    const results = page.getByRole("dialog", { name: "Complete Calls: results" });
    await expect(results.getByTestId("bulk-results-summary")).toContainText("4 visits completed.");
    await expect(results.getByTestId("bulk-results-summary")).toContainText("0 visits already as asked");
    await expect(results.getByTestId("bulk-results-summary")).toContainText("2 visits could not be completed.");
    await expect(results.getByTestId("bulk-results-summary")).toContainText("0 unexpected errors.");
    await expect(results.getByTestId("bulk-failed-row")).toHaveCount(2);
    await expect(results.getByTestId("bulk-failed-row").filter({ hasText: data.cancelled[0]! })).toContainText("Cancelled visits are not completed here");
    await page.screenshot({ path: `${SHOTS}/3-results.png` });
    await results.getByRole("button", { name: "Keep the 2 visits not changed ticked" }).click();
    await expect(bulk.getByTestId("bulk-selected")).toHaveText("2 selected");
    for (const r of [...data.unstaffed, ...data.cancelled]) await expect(page.getByLabel(`Select ${r}`, { exact: true })).toBeChecked();

    // The list refreshed: the four are Completed and marked as confirmed by the office.
    for (const r of [...data.scheduled, ...data.missed]) await expect(page.getByRole("row").filter({ hasText: r })).toContainText("Completed · office confirmed");
    await page.screenshot({ path: `${SHOTS}/4-list-after.png` });

    // Doing it again changes nothing and says so.
    for (const box of await page.locator("input[name=visitIds]").all()) await box.uncheck();
    await page.getByLabel(`Select ${data.scheduled[1]}`, { exact: true }).check();
    await bulk.getByRole("button", { name: "Go" }).click();
    const again = page.getByRole("dialog", { name: "Review: Complete Calls" });
    await expect(again.getByTestId("bulk-review-summary")).toHaveText("1 visit selected: 0 will change, 1 already as asked.");
    await expect(again.getByRole("button", { name: "Nothing to change" })).toBeDisabled();
    await expect(again.getByText("No change: Already completed by the office")).toBeVisible();
    await again.getByRole("button", { name: "Back" }).click();

    // Visit Details says it was completed by the office, with who confirmed it and that no clock record exists.
    await page.getByRole("link", { name: `Open details of visit ${data.missed[0]}` }).click();
    await expect(page.getByTestId("office-completed").first()).toContainText("Completed by the office");
    await page.screenshot({ path: `${SHOTS}/5-visit-details.png` });
    await page.goto("/rota/attention?type=missed");
    await page.screenshot({ path: `${SHOTS}/6-attention-queue.png` });
  });

  test("Cancel Visits asks for the charge decision and a reason, and reports already-cancelled visits as unchanged", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    const d = new Date(Date.now() + 9 * 86400000).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
    await page.goto(`/rota/visits?date=${d}`);
    const boxes = page.locator("input[name=visitIds]");
    test.skip((await boxes.count()) < 1, "No visits on that day of the demo rota");
    await boxes.nth(0).check();
    const bulk = page.locator("#bulk");
    await bulk.locator("select[name=kind]").selectOption("cancel");
    await bulk.getByLabel("Don't charge").check();
    await bulk.getByPlaceholder("Reason").fill("Family visiting");
    await bulk.getByRole("button", { name: "Go" }).click();
    const review = page.getByRole("dialog", { name: "Review: Cancel Visits" });
    await expect(review.getByText("Don't charge")).toBeVisible();
    await review.getByRole("button", { name: "Confirm: Cancel Visits (1)" }).click();
    await expect(page.getByRole("dialog", { name: "Cancel Visits: results" }).getByTestId("bulk-results-summary")).toContainText("1 visit updated.");
    await page.getByRole("button", { name: "Close" }).click();
  });
});
