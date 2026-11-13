import { followMenu } from "./harbour-menu";
import { expect, test, type Page } from "@playwright/test";

/**
 * CQC Inspection & Evidence with Root Cause Analysis in the browser: the sidebar entry and tabs, the "not an official
 * rating" label, starting an assessment and recording a result, the evidence queue, opening an RCA from an incident's
 * details through the seven steps' first screens, the reports page, and access for roles without CQC rights.
 */
const PASSWORD = "DemoPassword!2026";
async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("CQC Inspection & Evidence", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("overview: sidebar entry, six tabs, warnings and the not-official label", async ({ page }) => {
    await signIn(page);
    await page.goto("/policies");
    await followMenu(page, "CQC Inspection & Evidence");
    await expect(page).toHaveURL(/\/compliance\/cqc$/);
    const tabs = page.getByTestId("ws-tabs-cqc");
    for (const name of ["Overview", "CQC Assessment", "Evidence", "Root Cause Analysis", "Improvement Actions", "Reports"]) await expect(tabs.getByRole("link", { name: new RegExp(`^${name}`) })).toBeVisible();
    await expect(page.getByTestId("not-official")).toContainText("Internal CQC Readiness Assessment – Not an Official CQC Rating");
    await expect(page.getByTestId("cqc-attention")).toBeVisible();
    await expect(page.getByRole("link", { name: "New RCA Investigation" })).toBeVisible();
  });

  test("starts an assessment, records a result with the history kept, and shows low confidence", async ({ page }) => {
    await signIn(page);
    await page.goto("/compliance/cqc/assessments");
    const start = page.locator("#start");
    await start.getByLabel("Period from").fill("2026-08-01");
    await start.getByLabel("Period to").fill("2026-10-31");
    await start.getByRole("button", { name: /Start assessment/ }).click();
    await expect(page.getByTestId("assessment-areas")).toBeVisible();
    await expect(page.getByTestId("assessment-readiness")).toContainText(/Not assessed|Low confidence/);
    await page.getByTestId("area-S01").getByRole("link").click();
    const form = page.getByTestId("result-form");
    await form.getByLabel("Met", { exact: true }).check();
    await form.getByLabel("Rationale").fill("Sampled ten care records and observed two visits; practice matched the procedure.");
    await form.getByRole("button", { name: "Save result" }).click();
    await expect(page.getByTestId("area-result")).toContainText("Met");
    await expect(page.getByTestId("area-history")).toContainText("Result");
    // Not applicable without a reason is refused with a useful message.
    // Wait for the next area's own page: its form has the same fields, so a slow page let the old form be filled instead.
    const firstArea = new URL(page.url()).pathname;
    await page.getByRole("link", { name: "Next area" }).click();
    await expect.poll(() => new URL(page.url()).pathname).not.toBe(firstArea);
    await expect(page.getByTestId("area-result")).toContainText("Not assessed");
    await page.getByTestId("result-form").getByLabel("Not applicable", { exact: true }).check();
    await page.getByTestId("result-form").getByLabel("Rationale").fill("Does not apply to our domiciliary service.");
    await page.getByTestId("result-form").getByRole("button", { name: "Save result" }).click();
    await expect(page.getByRole("alert").or(page.getByRole("status")).first()).toContainText(/does not apply/i);
  });

  test("evidence: finding possible evidence only suggests; gaps are listed", async ({ page }) => {
    await signIn(page);
    await page.goto("/compliance/cqc/evidence");
    await page.getByRole("button", { name: "Find possible evidence" }).click();
    await expect(page.getByText(/suggested|No new suggestions/).first()).toBeVisible();
    await page.getByTestId("evidence-views").getByRole("link", { name: /^Verified/ }).click();
    await expect(page.getByTestId("evidence-list")).toContainText(/No evidence in this view|Verified/);
    await page.getByTestId("evidence-views").getByRole("link", { name: /^Gaps/ }).click();
    await expect(page.getByTestId("evidence-list").locator("tbody tr").first()).toBeVisible();
  });

  test("opens an RCA, records the timeline, and blocks review until the steps are done", async ({ page }) => {
    await signIn(page);
    await page.goto("/compliance/cqc/rca/new");
    const f = page.getByTestId("new-rca");
    await f.getByLabel("Title").fill("Late tea-time visits on the Riverside run");
    await f.getByLabel("Category").selectOption("Missed or late visit");
    await f.getByLabel("Investigator").selectOption({ label: "Riley Reviewer" });
    await f.getByLabel("Responsible manager").selectOption({ label: "Avery Approver" });
    await f.getByRole("button", { name: "Open investigation" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/RCA-\d{4}-\d{4}/);
    await expect(page.getByTestId("rca-escalations")).toBeVisible();
    await page.getByTestId("rca-steps").getByRole("link", { name: "2 Timeline" }).click();
    await page.getByLabel("Date", { exact: true }).fill(new Date().toISOString().slice(0, 10));
    await page.getByLabel("Time", { exact: true }).fill("16:40");
    await page.getByLabel("What happened", { exact: true }).fill("Carer arrived 45 minutes late");
    await page.getByRole("button", { name: "Add to timeline" }).click();
    await expect(page.getByTestId("rca-timeline")).toContainText("Carer arrived 45 minutes late");
    await page.getByTestId("rca-steps").getByRole("link", { name: "6 Management review" }).click();
    await expect(page.getByTestId("rca-gaps")).toContainText("Record what happened");
    await page.goto("/compliance/cqc/rca");
    await expect(page.getByTestId("rca-list")).toContainText("Late tea-time visits on the Riverside run");
    await expect(page.getByTestId("rca-figures")).toContainText("Open investigations");
  });

  test("reports page offers PDF and CSV downloads", async ({ page }) => {
    await signIn(page);
    await page.goto("/compliance/cqc/reports");
    const reports = page.getByTestId("cqc-reports");
    await expect(reports).toContainText("CQC inspection readiness");
    const [download] = await Promise.all([page.waitForEvent("download"), reports.getByRole("link", { name: "All open actions CSV" }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
  });

  test("a role without CQC rights cannot open it; an investigator sees only the RCA tabs", async ({ page }) => {
    await signIn(page, "author@care-solution.demo");
    const res = await page.goto("/compliance/cqc");
    expect(res?.status()).toBe(404);
    await page.context().clearCookies();
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/compliance/cqc");
    await expect(page).toHaveURL(/\/compliance\/cqc\/rca/);
    await expect(page.getByTestId("ws-tabs-cqc").getByRole("link", { name: /^Overview/ })).toHaveCount(0);
  });
});
