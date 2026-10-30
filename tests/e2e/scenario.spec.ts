import { expect, test, type Browser, type Page } from "@playwright/test";

const PASSWORD = "DemoPassword!2026";

async function signIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
  return page;
}

async function openSimulatedChange(page: Page) {
  await page.goto("/changes?group=all");
  await page.getByTestId("changes-table").getByRole("link", { name: /Reporting safeguarding concerns/ }).first().click();
  await expect(page.getByText("This is a simulated update", { exact: false })).toBeVisible();
  return page.url();
}

test("detected change flows through review, drafting, approval, publication and acknowledgement", async ({ browser }) => {
  // 1. A regulatory reviewer confirms the detected (simulated) change is relevant. Detection alone changes nothing.
  const reviewer = await signIn(browser, "regulatory@csb.demo");
  const changeUrl = await openSimulatedChange(reviewer);
  await expect(reviewer.getByTestId("source-diff-reporting-concerns")).toContainText("24 hours");
  const triage = reviewer.getByTestId("triage-form");
  await triage.getByLabel("Move to status").selectOption("CONFIRMED_RELEVANT");
  await triage.getByLabel("Reason").fill("Reporting timescale shortened from 48 to 24 hours; applies to all adult social care providers.");
  await triage.getByRole("button", { name: "Record review" }).click();
  await expect(reviewer.getByRole("status")).toContainText("Change updated");
  await expect(reviewer.getByText("confirmed relevant").first()).toBeVisible();

  // 2. The organisation's compliance lead decides that their safeguarding policy needs revising.
  const manager = await signIn(browser, "manager@care-solution.demo");
  await manager.goto(changeUrl);
  const assessment = manager.locator('[data-testid^="assessment-"]').filter({ hasText: "Safeguarding" }).first();
  await expect(assessment).toBeVisible();
  const policyLink = assessment.getByRole("link").first();
  const policyHref = await policyLink.getAttribute("href");
  expect(policyHref).toMatch(/^\/policies\//);
  await assessment.getByLabel("Decision").selectOption("REVISION_REQUIRED");
  await assessment.getByLabel("Reason").fill("Our reporting procedure states 48 hours and must be updated.");
  await assessment.getByRole("button", { name: "Record decision" }).click();
  await expect(manager.getByRole("status")).toContainText("Assessment decision recorded");

  // 3. A policy author generates a draft. The approved policy is unchanged until approval and publication.
  const author = await signIn(browser, "author@care-solution.demo");
  await author.goto(changeUrl);
  await author.locator('[data-testid^="assessment-"]').filter({ hasText: "Safeguarding" }).first().getByRole("button", { name: "Generate draft revision" }).click();
  await expect(author).toHaveURL(/\/revisions\//);
  const revisionUrl = author.url();
  await expect(author.getByTestId("draft-banner")).toContainText("This is a draft");
  const reportingDiff = author.locator('[data-testid^="diff-"]').filter({ hasText: "24 hours" }).first();
  await expect(reportingDiff.locator("ins")).toContainText(["24"]);
  await expect(author.getByTestId("validation-panel")).toContainText("verified");

  await author.goto(`${policyHref}?view=procedure`);
  await expect(author.getByText("within 48 hours").first()).toBeVisible();
  await expect(author.getByText("within 24 hours")).toHaveCount(0);

  await author.goto(revisionUrl);
  await author.getByRole("button", { name: "Submit for review" }).click();
  await expect(author.getByRole("status")).toContainText("Submitted for review");
  await expect(author.getByText("You are the author, so you cannot approve this revision.")).toBeVisible();

  // 4. A different person approves and publishes.
  const approver = await signIn(browser, "approver@care-solution.demo");
  await approver.goto("/notifications");
  await expect(approver.getByTestId("notification-list")).toContainText("Draft awaiting your review");
  await approver.goto(revisionUrl);
  const decision = approver.getByTestId("decision-form");
  await decision.getByLabel("Decision", { exact: true }).selectOption("APPROVE");
  await decision.getByLabel("Decision comment").fill("Checked against the source text. Approved.");
  await decision.getByRole("button", { name: "Record decision" }).click();
  await expect(approver.getByRole("status")).toContainText("Decision recorded");
  await approver.getByTestId("publish-form").getByRole("button", { name: "Publish" }).click();
  await expect(approver.getByRole("status")).toContainText("Publication recorded");

  await approver.goto(`${policyHref}?view=procedure`);
  await expect(approver.getByText("within 24 hours").first()).toBeVisible();
  await approver.getByRole("tab", { name: /Versions/ }).click();
  await expect(approver.getByTestId("version-history")).toContainText("superseded");

  // 5. Staff are asked to acknowledge the updated policy.
  const carer = await signIn(browser, "carer1@care-solution.demo");
  await carer.goto("/acknowledgements");
  const ack = carer.locator('[data-testid^="ack-"]').filter({ hasText: "Safeguarding" }).first();
  await ack.getByRole("button", { name: /I confirm I have read this policy/ }).click();
  await expect(carer.getByRole("status")).toContainText("acknowledgement has been recorded");
  await expect(carer.locator('[data-testid^="ack-"]').filter({ hasText: "Safeguarding" }).first()).toContainText("acknowledged");

  // 6. Another organisation cannot see Brookfield's draft or policy.
  const other = await signIn(browser, "manager@oakridge.demo");
  const res = await other.goto(revisionUrl);
  expect(res?.status()).toBe(404);
  const res2 = await other.goto(policyHref!);
  expect(res2?.status()).toBe(404);
});

test("unauthenticated users are sent to sign in, and wrong passwords are refused", async ({ page }) => {
  await page.goto("/policies");
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill("manager@care-solution.demo");
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});
