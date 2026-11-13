import { expect, test, type Page } from "@playwright/test";

/** Service User → Reference Numbers: tab position, add a Frameworki number, verify it, find the person by it. Fictional data only. */
async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("Reference Numbers", () => {
  test.use({ viewport: { width: 1440, height: 941 } });

  test("sits between Personal details and Care, adds and verifies a Frameworki number, and search finds it", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/service-users");
    await page.locator("table a").first().click();
    await page.waitForURL(/\/rota\/service-users\/[^/?]+/);
    const base = page.url().split("?")[0]!;
    const nav = page.getByRole("navigation", { name: "Service user sections" });
    // Harbour record tabs (13 Nov 2026) show a count beside some labels.
    const labels = (await nav.getByRole("link").allInnerTexts()).map((s) => s.replace(/\s*\d+$/, "").trim());
    expect(labels.slice(0, 4)).toEqual(["Overview", "Personal details", "Reference Numbers", "Care"]);
    expect(labels).toEqual(expect.arrayContaining(["Health and safety", "Visits", "Documents", "Contacts & carers", "History"]));

    await nav.getByRole("link", { name: "Reference Numbers" }).click();
    await expect(page.getByTestId("csb-reference")).toHaveText(/^CSB-\d{6}$/);
    const csb = (await page.getByTestId("csb-reference").innerText()).trim();

    const form = page.locator("#add-reference");
    await form.getByLabel("Reference type").selectOption("COUNCIL_CLIENT");
    await form.getByLabel("Issuing organisation").fill("Tower Hamlets Council");
    await form.getByLabel("System or label (optional)").fill("Frameworki");
    await form.getByLabel("Reference number").fill("0098761");
    await form.getByRole("button", { name: "Add reference" }).click();
    await expect(page.getByText("Reference added. It is awaiting verification.")).toBeVisible();
    const row = page.getByTestId("reference-row").filter({ hasText: "0098761" });
    await expect(row.getByRole("heading", { name: "Tower Hamlets – Frameworki" })).toBeVisible();
    await expect(row.getByText("Awaiting verification")).toBeVisible();

    await row.locator("summary").filter({ hasText: /^Verify$/ }).click();
    const verify = row.locator("form").filter({ has: page.getByLabel("Matches the source") });
    await verify.getByLabel("Matches the source").check();
    await verify.getByLabel("Reason").fill("Checked against the support plan");
    await verify.getByRole("button", { name: "Save decision" }).click();
    await expect(page.getByTestId("reference-row").filter({ hasText: "0098761" }).getByText("Verified", { exact: true })).toBeVisible();
    await expect(page.getByTestId("reference-history")).toContainText("Verification decision: verified");

    await page.goto("/rota/service-users?q=Frameworki+0098761");
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await expect(page.locator("tbody tr")).toContainText("matched Tower Hamlets – Frameworki");
    await page.goto(`/rota/search?q=${encodeURIComponent(csb)}`);
    await expect(page.getByRole("region", { name: "Service users" }).getByRole("link")).toHaveCount(1);

    // Other tabs still open.
    for (const t of ["details", "package", "documents", "history"]) {
      await page.goto(`${base}?tab=${t}`);
      await expect(page.getByText("This page couldn't load")).toHaveCount(0);
    }
  });

  test("a coordinator cannot see NHS numbers or verify", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/service-users");
    await page.locator("table a").first().click();
    await page.waitForURL(/\/rota\/service-users\/[^/?]+/);
    await page.goto(`${page.url().split("?")[0]}?tab=references`);
    await expect(page.getByTestId("nhs-check")).toContainText("Restricted");
    await expect(page.locator("summary").filter({ hasText: /^Verify$/ })).toHaveCount(0);
    await expect(page.locator("#add-reference").getByLabel("Reference type").locator("option[value=NHS]")).toHaveCount(0);
  });
});
