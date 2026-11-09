import { expect, test, type Page } from "@playwright/test";

/**
 * Regression tests for the rota, policy assignment and service-user problems found in the review of 9 Nov 2026.
 * Synthetic people only; the e2e database is rebuilt by global setup.
 */
const PASSWORD = "DemoPassword!2026";
const SHOTS = "test-results/flow-fixes";

async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

const stamp = () => Date.now().toString(36).slice(-5);

test.describe("Service user creation", () => {
  test("a duplicate is refused, what was typed is kept, and a confirmed different person is added", async ({ page }) => {
    await signIn(page);
    const last = `Fixture${stamp()}`;
    const fill = async () => {
      await page.getByLabel("First name").fill("Ada");
      await page.getByLabel("Last name").fill(last);
      await page.getByLabel("Date of birth", { exact: true }).fill("1941-05-06");
    };

    await page.goto("/rota/service-users/new");
    await fill();
    await page.getByRole("button", { name: "Add service user" }).click();
    await page.waitForURL(/\/rota\/service-users\/c[^/?]+\?ok=/);
    await expect(page.getByRole("status")).toContainText("Service user added");

    // Same name and date of birth again: refused, and the non-sensitive details typed are still in the form.
    await page.goto("/rota/service-users/new");
    await fill();
    await page.getByLabel("Town").fill("Liverpool");
    await page.getByLabel("Access notes for carers").fill("Key safe by the back door");
    await page.getByRole("button", { name: "Add service user" }).click();
    await page.waitForURL(/error=/);
    await expect(page.getByText(/already has the same name and date of birth/)).toBeVisible();
    await expect(page.getByLabel("Last name")).toHaveValue(last);
    await expect(page.getByLabel("Town")).toHaveValue("Liverpool");
    await expect(page.getByLabel("Access notes for carers")).toHaveValue("Key safe by the back door");
    // Sensitive identifiers are never kept in the browser, so the date of birth is typed again.
    await expect(page.getByLabel("Date of birth", { exact: true })).toHaveValue("");
    await page.screenshot({ path: `${SHOTS}/su-duplicate-kept-1440.png`, fullPage: false });

    await page.getByLabel("Date of birth", { exact: true }).fill("1941-05-06");
    await page.getByLabel(/this is a different person/).check();
    await page.getByRole("button", { name: "Add service user" }).click();
    await page.waitForURL(/\/rota\/service-users\/c[^/?]+\?ok=/);
    await expect(page.getByRole("status")).toContainText("Service user added");
  });

  test("a date of birth in the future and a short NHS number are stopped before saving", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/service-users/new");
    await page.getByLabel("First name").fill("Future");
    await page.getByLabel("Last name").fill(`Born${stamp()}`);
    await page.getByLabel("NHS number").fill("123");
    await page.getByRole("button", { name: "Add service user" }).click();
    // The browser blocks the save: still on the form, nothing created, typed values untouched.
    await expect(page).toHaveURL(/\/rota\/service-users\/new$/);
    expect(await page.getByLabel("NHS number").evaluate((el: HTMLInputElement) => el.validity.patternMismatch)).toBe(true);
    await expect(page.getByLabel("First name")).toHaveValue("Future");
    const max = await page.getByLabel("Date of birth", { exact: true }).getAttribute("max");
    expect(max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

test.describe("Policy assignment", () => {
  async function openSafeguardingSignoff(page: Page) {
    await page.goto("/policies?q=Safeguarding%20Adults");
    const href = await page.locator('a[href^="/policies/c"]').filter({ hasText: "Safeguarding Adults" }).first().getAttribute("href");
    await page.goto(href!);
    await page.getByTestId("assign-to-staff").click();
    await page.waitForURL(/\/staff\/policy\//);
  }

  test("only the field for the chosen target is shown, so a branch rule cannot become an organisation rule", async ({ page }) => {
    await signIn(page);
    await openSafeguardingSignoff(page);
    const form = page.locator('form:has(select[name="scope"])');
    await expect(form.locator('select[name="branchId"]')).toHaveCount(0);
    await expect(form.locator('select[name="staffMemberIds"]')).toHaveCount(0);
    await expect(form.getByText("Everyone in the organisation will be asked to read it.")).toBeVisible();

    await form.locator('select[name="scope"]').selectOption("BRANCH");
    const branch = form.locator('select[name="branchId"]');
    await expect(branch).toBeVisible();
    await expect(form.locator('select[name="jobTitle"]')).toHaveCount(0);
    // A branch is required for a branch rule: the browser stops an empty one.
    await form.getByRole("button", { name: "Add assignment" }).click();
    expect(await branch.evaluate((el: HTMLSelectElement) => el.validity.valueMissing)).toBe(true);
    const branchName = (await branch.locator('option:not([value=""])').first().textContent())!.trim();
    await branch.selectOption({ label: branchName });
    await page.screenshot({ path: `${SHOTS}/policy-assign-branch-1440.png` });
    await form.getByRole("button", { name: "Add assignment" }).click();
    await expect(page.getByRole("status")).toContainText("Assignment added");
    const rules = page.locator("ul.rows").last();
    await expect(rules).toContainText(`Branch: ${branchName}`);
  });

  test("a CSB central document offers Assign to Staff and explains how to create the organisation's copy", async ({ page }) => {
    await signIn(page);
    // Find a CSB central document the organisation has not copied (a newly published central document is like this).
    await page.goto("/policies?tab=templates");
    const hrefs = await page.locator('a[href^="/policies/c"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")!.split("?")[0]))]);
    let central: string | null = null;
    for (const h of hrefs) {
      const html = await (await page.request.get(`/staff/policy/${h.split("/").at(-1)}`)).text();
      if (html.includes('data-testid="central-signoff"')) { central = h; break; }
    }
    test.skip(!central, "Every central document is already copied in this database");
    await page.goto(central!);
    await expect(page.getByTestId("assign-to-staff")).toBeVisible();
    await page.getByTestId("assign-to-staff").click();
    await expect(page.getByTestId("central-signoff")).toContainText("Staff sign-off is recorded against your organisation");
    await expect(page.getByRole("button", { name: "Create our copy" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/policy-central-assign-1440.png` });
  });

  test("conflicting choices sent straight to the server are refused, not widened to everyone", async ({ page }) => {
    await signIn(page);
    await openSafeguardingSignoff(page);
    const form = page.locator('form:has(select[name="scope"])');
    const rulesBefore = await page.locator("ul.rows").last().locator("li").count();
    // Simulate an old page or a hand-made request: scope says everyone, but a branch is also sent.
    await form.evaluate((f) => {
      const i = document.createElement("input");
      i.type = "hidden";
      i.name = "branchId";
      i.value = "some-branch";
      f.appendChild(i);
    });
    await form.getByRole("button", { name: "Add assignment" }).click();
    await page.waitForURL(/error=/);
    await expect(page.getByText(/"Assign to" is set to something else. Nothing was assigned/)).toBeVisible();
    await expect(page.locator("ul.rows").last().locator("li")).toHaveCount(rulesBefore);
  });
});

test.describe("Rota for a new service user", () => {
  test("a template added after the weeks were built says so and links to Create Future Rota", async ({ page }) => {
    await signIn(page);
    const last = `Rota${stamp()}`;
    await page.goto("/rota/service-users/new");
    await page.getByLabel("First name").fill("Nora");
    await page.getByLabel("Last name").fill(last);
    await page.getByLabel("Area").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Add service user" }).click();
    await page.waitForURL(/\/rota\/service-users\/c[^/?]+\?ok=/);
    const profile = new URL(page.url()).pathname;

    const status = page.locator('form:has(select[name="to"])');
    await status.locator('select[name="to"]').selectOption("ACTIVE");
    await status.getByLabel("Reason").fill("Assessment complete");
    await status.getByRole("button", { name: "Change status" }).click();
    await page.waitForURL(/ok=Status/);

    await page.goto(profile);
    await page.getByRole("link", { name: "New template" }).click();
    const tpl = page.locator("main form").first();
    await tpl.locator('select[name="callTypeId"]').selectOption({ index: 1 });
    for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) await tpl.getByLabel(d, { exact: true }).check();
    await tpl.locator('[name="start"]').fill("21:00");
    await tpl.locator('[name="durationMin"]').fill("30");
    await tpl.getByRole("button", { name: "Create template" }).click();
    await page.waitForURL(/\/rota\/templates\/c[^/?]+\?ok=/);
    const templatePage = new URL(page.url()).pathname;

    const gap = page.getByTestId("template-rota-gap");
    await expect(gap).toBeVisible();
    await expect(gap).toContainText("missing from weeks that were already built");
    await page.screenshot({ path: `${SHOTS}/template-not-on-rota-1440.png` });
    await gap.getByRole("link", { name: "Add to the built weeks" }).click();
    await page.waitForURL(/tab=rota&future=1/);
    await page.getByRole("button", { name: /^Create \d+ visit/ }).click();
    await page.waitForURL(/ok=/);

    // Back on the template, nothing is missing any more.
    await page.goto(templatePage);
    await expect(page.getByTestId("template-rota-gap")).toHaveCount(0);
  });
});
