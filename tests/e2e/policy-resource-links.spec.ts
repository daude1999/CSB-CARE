import { expect, test, type Page } from "@playwright/test";

/**
 * Forms PR 1: the Forms & Resources register, and explicit policy-to-form links placed at a procedure step and shown
 * inside the existing Policy Reader. Fictional demo data only.
 */
const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function safeguardingHref(page: Page) {
  await page.goto("/policies?q=Safeguarding%20Adults");
  return (await page.locator('a[href^="/policies/c"]').filter({ hasText: "Safeguarding Adults" }).first().getAttribute("href"))!;
}

test.describe("Forms & Resources and linked forms", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("the register searches the organisation's forms once each and shows the policies they belong to", async ({ page }) => {
    await signIn(page);
    await page.goto("/policies/forms?q=CSB-FRM-001");
    await expect(page.getByTestId("forms-resources-register")).toBeVisible();
    const rows = page.getByTestId("resource-row");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Safeguarding Concern Record");
    await expect(rows.first().getByTestId("resource-policies")).toContainText("CSB-SAF-001");
  });

  test("an author places a form at a procedure step and staff see it inside that step", async ({ page }) => {
    await signIn(page);
    const href = await safeguardingHref(page);
    await page.goto(href + "/resources");
    await expect(page.getByTestId("active-links")).toContainText("CSB-FRM-001");
    const option = await page.locator("select[name=resourceId] option", { hasText: "CSB-FRM-001" }).first().getAttribute("value");
    await page.selectOption("select[name=resourceId]", option!);
    await page.selectOption("select[name=sectionKey]", "procedure.immediate");
    await page.getByLabel("Use when (optional)").fill("you are told about possible abuse");
    await page.getByRole("button", { name: "Link form" }).click();
    await expect(page).toHaveURL(/ok=/);
    await expect(page.getByTestId("active-links")).toContainText("Step 1: Responding to a concern");

    // The same placement twice is refused with a clear message.
    await page.selectOption("select[name=resourceId]", option!);
    await page.selectOption("select[name=sectionKey]", "procedure.immediate");
    await page.getByRole("button", { name: "Link form" }).click();
    await expect(page).toHaveURL(/error=/);

    await page.goto(href);
    const step = page.getByTestId("step-procedure.immediate");
    await expect(step.getByTestId("step-forms")).toContainText("Safeguarding Concern Record");
    await expect(step.getByTestId("step-forms")).toContainText("you are told about possible abuse");
    await expect(page.getByTestId("forms-section").getByTestId("form-CSB-FRM-001")).toHaveCount(1);
    await expect(page.getByTestId("manage-form-links")).toBeVisible();

    // Removing it needs a reason and keeps it in the history.
    await page.goto(href + "/resources");
    await page.getByTestId("active-links").locator("tr", { hasText: "Step 1: Responding to a concern" }).getByRole("button", { name: "Remove" }).click();
    await page.getByLabel("Reason").fill("Placed at the wrong step in this test");
    await page.getByRole("button", { name: "Remove link" }).click();
    await expect(page).toHaveURL(/ok=/);
    await expect(page.getByTestId("link-history")).toContainText("Placed at the wrong step in this test");
    await page.goto(href);
    await expect(page.getByTestId("step-procedure.immediate").getByTestId("step-forms")).toHaveCount(0);
  });

  test("a carer sees linked forms but cannot manage them", async ({ page }) => {
    await signIn(page, "carer1@care-solution.demo");
    const href = await safeguardingHref(page);
    await page.goto(href);
    await expect(page.getByTestId("forms-section")).toContainText("Safeguarding Concern Record");
    await expect(page.getByTestId("manage-form-links")).toHaveCount(0);
    await page.goto(href + "/resources");
    await expect(page.getByTestId("add-link")).toHaveCount(0);
  });
});
