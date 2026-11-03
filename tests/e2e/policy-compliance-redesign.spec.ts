import { expect, test, type Page } from "@playwright/test";
import { Document, HeadingLevel, Packer, Paragraph } from "docx";

/**
 * The Policy & Compliance redesign (owner's brief of 3 Nov 2026) in the browser: tab counts, the Staff Sign-off bulk
 * bar, the Policy Library inspector (Previous / Next, Escape, staying closed), Upload policy, and report filters that
 * the export link carries.
 */
const PASSWORD = "DemoPassword!2026";
async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("Policy & Compliance redesign", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("each workspace has the breadcrumb header and tabs with counts", async ({ page }) => {
    await signIn(page);
    for (const [path, tabs] of [["/policies", "ws-tabs-library"], ["/changes", "ws-tabs-regulatory"], ["/staff", "ws-tabs-signoff"], ["/audits", "ws-tabs-improvements"]] as const) {
      await page.goto(path);
      await expect(page.getByTestId("module-header").getByRole("navigation", { name: "Breadcrumb" })).toContainText("Policy & Compliance");
      const current = page.getByTestId(tabs).locator('a[aria-current="page"]');
      await expect(current).toHaveCount(1);
      await expect(current.locator(".pc-count")).toHaveText(/^\d+/);
    }
  });

  test("Staff Sign-off: ticking outstanding rows shows the bulk bar", async ({ page }) => {
    await signIn(page);
    await page.goto("/staff");
    await expect(page.getByTestId("signoff-figures")).toBeVisible();
    const register = page.getByTestId("signoff-register");
    const box = register.locator('tbody input[type="checkbox"]:not([disabled])').first();
    test.skip((await box.count()) === 0, "no outstanding sign-off in this data set");
    await box.check();
    const bar = page.getByTestId("bulk-bar");
    await expect(bar).toContainText("1 selected");
    for (const name of ["Send reminder", "Extend due date", "Exempt"]) await expect(bar.getByRole("button", { name })).toBeVisible();
    await bar.getByRole("button", { name: "Extend due date" }).click();
    await expect(bar.getByLabel("New due date")).toBeVisible();
    await bar.getByRole("button", { name: "Clear selection" }).click();
    await expect(bar).toHaveCount(0);
  });

  test("Policy Library: Previous / Next, Escape closes and the library stays closed with the search kept", async ({ page }) => {
    await signIn(page);
    await page.goto("/policies?q=safeguard");
    const inspector = page.getByTestId("policy-inspector");
    await expect(page.getByTestId("inspector-position")).toContainText("Policy 1 of");
    await inspector.getByRole("link", { name: "Next policy" }).click();
    await expect(page.getByTestId("inspector-position")).toContainText("Policy 2 of");
    await inspector.getByRole("link", { name: "Previous policy" }).click();
    await expect(page.getByTestId("inspector-position")).toContainText("Policy 1 of");
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(/q=safeguard.*insp=closed/);
    await expect(inspector).toHaveCount(0);
    await page.reload();
    await expect(inspector).toHaveCount(0);
    await expect(page.getByRole("search", { name: "Filter policies" }).getByRole("searchbox")).toHaveValue("safeguard");
    // Choosing a policy opens it again.
    const row = page.getByTestId("policy-row").first();
    await row.getByRole("link").first().click();
    await expect(inspector).toBeVisible();
    await expect(page).not.toHaveURL(/insp=closed/);
  });

  test("Upload policy brings a Word file in as Draft v1, never published", async ({ page }) => {
    await signIn(page);
    await page.goto("/policies");
    await page.getByRole("button", { name: "Upload policy" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("never approved or published automatically");
    const buffer = Buffer.from(await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph({ text: "Purpose", heading: HeadingLevel.HEADING_1 }), new Paragraph("Keeping lone workers safe.")] }] })));
    await dialog.locator('input[type="file"]').setInputFiles({ name: "E2E lone working.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer });
    await expect(dialog.getByRole("list", { name: "Chosen files" })).toContainText("E2E lone working.docx");
    await dialog.getByLabel("Category").selectOption({ index: 1 });
    await dialog.getByRole("button", { name: "Upload policy" }).click();
    await expect(page).toHaveURL(/\/revisions\//);
    await expect(page.getByRole("status")).toContainText("Draft v1");
    await expect(page.getByRole("status")).toContainText("Nothing has been approved or published");
  });

  test("Compliance Reports: cards, filters and an export that carries them", async ({ page }) => {
    await signIn(page);
    await page.goto("/compliance/reports");
    const cards = page.getByTestId("report-cards").getByRole("link");
    await expect(cards).toHaveCount(6);
    await cards.filter({ hasText: "Risk Register Report" }).click();
    await expect(page).toHaveURL(/kind=risks/);
    await page.getByLabel("Status").selectOption("OPEN");
    await page.getByRole("button", { name: "Run report" }).click();
    await expect(page).toHaveURL(/status=OPEN/);
    await expect(page.getByTestId("report-exports").getByRole("link", { name: "CSV" })).toHaveAttribute("href", /status=OPEN/);
    await expect(page.getByText("Internal management report. Not a CQC rating.")).toBeVisible();
    await cards.filter({ hasText: "Compliance Summary" }).click();
    await expect(page.getByTestId("report-exports").getByRole("link")).toHaveText(["PDF"]);
  });
});
