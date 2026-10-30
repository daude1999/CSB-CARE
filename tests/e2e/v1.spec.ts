import { expect, test, type Page } from "@playwright/test";

/** Browser tests for the Version 1 features: one test per workflow, each from a real sign-in. */

const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("Version 1", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("staff readiness: the manager finds evidence awaiting verification and verifies it", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/readiness");
    await expect(page.getByRole("heading", { level: 1, name: "Staff Readiness" })).toBeVisible();
    await page.getByRole("link", { name: /Pending verification/ }).click();
    await expect(page).toHaveURL(/status=PENDING_VERIFICATION/);
    await page.locator("table a.row-title").first().click();
    await expect(page.getByRole("heading", { name: "Staff readiness" })).toBeVisible();
    const form = page.locator("section[aria-label='Evidence awaiting verification'] form").first();
    await form.getByRole("button", { name: "Verify" }).click();
    await expect(page.getByRole("status")).toContainText("Evidence verified");

    await page.goto("/admin/readiness");
    await expect(page.getByRole("heading", { level: 1, name: "Staff Readiness Matrix" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /Safeguarding adults/ }).first()).toBeVisible();
  });

  test("staff sign-off: the manager targets a policy, drills down and exports reconciled evidence", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/staff");
    await expect(page.getByRole("heading", { level: 1, name: "Staff Sign-off" })).toBeVisible();
    await expect(page.getByText(/not training and does not show competence/).first()).toBeVisible();
    await page.getByRole("link", { name: "By policy" }).click();
    await page.locator("table a.row-title").first().click();
    await expect(page.getByRole("heading", { name: "Who must read it" })).toBeVisible();
    const form = page.locator("form:has(select[name=scope])");
    await form.locator("select[name=scope]").selectOption("ORG");
    await form.getByRole("button", { name: "Add assignment" }).click();
    await expect(page.getByRole("status")).toContainText("Assignment added");
    const csv = await page.request.get("/api/staff-signoff");
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain("Staff member,Sign-in,Job title");
  });

  test("exceptions: the coordinator takes an open exception and resolves it with evidence", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/exceptions");
    await expect(page.getByRole("heading", { level: 1, name: "Exceptions" })).toBeVisible();
    await page.getByRole("link", { name: /^All/ }).click();
    await expect(page).toHaveURL(/state=all/);
    await page.getByRole("link", { name: /^Open/ }).click();
    const first = page.locator("ul.rows > li").first();
    await expect(first).toBeVisible();
    await first.getByLabel("What was done").fill("Rang the family and the carer; visit rearranged");
    await first.getByLabel("Evidence").fill("Office call log");
    await first.getByRole("button", { name: "Resolve" }).click();
    await expect(page.getByRole("status")).toContainText("Exception resolved");
  });

  test("visit notes: the carer writes a handover note and the office finds it on Visit Notes", async ({ page }) => {
    await signIn(page, "carer@care-solution.demo");
    await page.goto("/carer");
    await page.getByText("Add a note").first().click();
    const form = page.locator("form:has(textarea[name=text])").first();
    await form.locator("select[name=category]").selectOption("HANDOVER");
    await form.locator("textarea[name=text]").fill("Front door sticks; lift and push");
    await form.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByRole("status")).toContainText("Note added");
    await page.context().clearCookies();
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/notes?category=HANDOVER");
    await expect(page.getByRole("heading", { level: 1, name: "Visit Notes" })).toBeVisible();
    await expect(page.getByText("Front door sticks; lift and push")).toBeVisible();
  });

  test("care packages: the coordinator replaces a person's package and sees it against the planned visits", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/service-users");
    await page.locator("table tbody a").first().click();
    await page.getByRole("link", { name: "Care package", exact: true }).click();
    await expect(page.getByText(/Repeating visits plan/).first()).toBeVisible();
    const form = page.locator("form:has(input[name=serviceUserId])");
    await form.locator("input[name=reference]").fill("PKG-E2E");
    await form.locator("input[name=hoursPerWeek]").fill("10.5");
    const start = new Date(Date.now() + 10 * 86400_000).toISOString().slice(0, 10);
    await form.locator("input[name=startDate]").fill(start);
    await form.getByRole("button", { name: "Record package" }).click();
    await expect(page.getByRole("status")).toContainText("Care package recorded");
    await expect(page.getByText("PKG-E2E")).toBeVisible();
  });

  test("clock corrections: the carer asks for a corrected time and a coordinator approves it", async ({ page }) => {
    await signIn(page, "carer@care-solution.demo");
    await page.goto("/carer");
    await page.getByText("Ask the office to correct a time").first().click();
    const form = page.locator("form:has(input[name=reason][placeholder*=signal])").first();
    await form.locator("select[name=kind]").selectOption("IN");
    await form.locator("input[name=time]").fill("07:05");
    await form.locator("input[name=reason]").fill("Phone had no signal when I arrived");
    await form.getByRole("button", { name: "Send to the office" }).click();
    await expect(page.getByRole("status")).toContainText("Request sent to the office");
    await page.context().clearCookies();
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/exceptions?kind=CLOCK_CORRECTION");
    await page.locator("ul.rows a.row-title").first().click();
    const req = page.locator("section[aria-label='Clock correction requests']");
    await expect(req.getByText("Phone had no signal when I arrived")).toBeVisible();
    await req.getByRole("button", { name: "Reject" }).first().click();
    await expect(page.getByRole("alert").filter({ hasText: "Say why" })).toBeVisible();
    await req.getByRole("button", { name: "Approve" }).first().click();
    await expect(page.getByRole("status")).toContainText("Decision recorded");
    await expect(req.getByText("Approved").first()).toBeVisible();
  });

  test("users: the admin invites a coordinator, who sets a password from the one-time link and signs in", async ({ page, browser }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/admin/users");
    await expect(page.getByRole("heading", { level: 1, name: "Users" })).toBeVisible();
    const invite = page.locator("form:has(input[name=email])");
    await invite.locator("input[name=name]").fill("Pilot Coordinator");
    const email = `pilot-${Date.now()}@example.test`;
    await invite.locator("input[name=email]").fill(email);
    await invite.locator("input[value=CARE_COORDINATOR]").check();
    await invite.getByRole("button", { name: "Create invitation link" }).click();
    const link = (await page.getByTestId("one-time-link").textContent())!.trim();
    const other = await browser.newPage();
    await other.goto(link.replace(/^https?:\/\/[^/]+/, ""));
    await other.getByLabel("Password", { exact: true }).fill("pilot password for testing");
    await other.getByLabel("Type it again").fill("pilot password for testing");
    await other.getByRole("button", { name: "Create my account" }).click();
    await expect(other).toHaveURL(/\/login/);
    await other.getByLabel("Email").fill(email);
    await other.getByLabel("Password").fill("pilot password for testing");
    await other.getByRole("button", { name: "Sign in" }).click();
    await expect(other.getByTestId("current-user")).toBeVisible();
    await other.close();
    await page.goto("/admin/audit?action=admin.member");
    await expect(page.getByRole("cell", { name: "admin.member.joined" }).first()).toBeVisible();
  });

  test("analytics: the manager reads the measures with their definitions and narrows to one branch", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/analytics");
    await expect(page.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible();
    await expect(page.locator("tr[data-kpi=visits-delivered]")).toContainText("Completed visits as a share");
    await page.locator("select[name=branch]").selectOption({ label: "Liverpool" });
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/branch=/);
    await expect(page.getByText(/^Liverpool ·/)).toBeVisible();
    const csv = await page.request.get(`/api/analytics?${new URL(page.url()).searchParams}`);
    expect(csv.status()).toBe(200);
    expect(await csv.text()).toContain("Definition");
  });
  test("run routes, printable rota and mileage: the coordinator adds a route and prints, a carer claims miles and finance approves", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/routes");
    await expect(page.getByRole("heading", { level: 1, name: "Live Run Routes" })).toBeVisible();
    const form = page.locator("form:has(input[name=name])").first();
    await form.locator("input[name=name]").fill("E2E morning round");
    await form.locator("select[name=staffId]").selectOption({ index: 1 });
    await form.getByRole("button", { name: "Add run route" }).click();
    await expect(page.getByRole("status")).toContainText("Run route added");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E morning round");
    await page.goto("/rota/print");
    const carerForm = page.locator("form:has(select[name=ids])").first();
    await carerForm.locator("select[name=ids]").selectOption({ index: 0 });
    const download = page.waitForEvent("download");
    await carerForm.getByRole("button", { name: "Download PDF" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.pdf$/);
    await page.context().clearCookies();
    await signIn(page, "carer@care-solution.demo");
    await page.goto("/carer");
    await page.getByText("Claim mileage").click();
    const claim = page.locator("form:has(input[name=miles])");
    await claim.locator("input[name=miles]").fill("7.5");
    await claim.locator("input[name=reason]").fill("Between the morning visits");
    await claim.getByRole("button", { name: "Send claim" }).click();
    await expect(page.getByRole("status")).toContainText("Mileage claim sent");
    await page.context().clearCookies();
    await signIn(page, "finance@care-solution.demo");
    await page.goto("/rota/finance/mileage");
    await expect(page.getByText("Between the morning visits")).toBeVisible();
    await page.locator("li:has-text('Between the morning visits')").getByRole("button", { name: "Approve" }).click();
    await expect(page.getByRole("status")).toContainText("Decision recorded");
  });

  test("medication: off until an admin records a clinical review, then a medicine waits for a second person", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/settings");
    const sw = page.locator("form:has(input[name=reviewNote])");
    await sw.locator("input[name=reviewNote]").fill("E2E: reviewed by the registered nurse");
    await sw.getByRole("button", { name: "Switch on medication records" }).click();
    await expect(page.getByText(/Clinical review: E2E: reviewed by the registered nurse/)).toBeVisible();
    await page.goto("/rota/service-users");
    await page.locator("table tbody a").first().click();
    await page.getByRole("link", { name: "Medication", exact: true }).click();
    const add = page.locator("form:has(input[name=dose])").first();
    await add.locator("input[name=name]").fill("E2E Paracetamol");
    await add.locator("input[name=dose]").fill("2 tablets");
    await add.locator("input[name=startDate]").fill(new Date().toISOString().slice(0, 10));
    await add.getByLabel("Morning").check();
    await add.getByRole("button", { name: "Add for a second check" }).click();
    await expect(page.getByRole("status")).toContainText("Someone else must now check it");
    await expect(page.getByText("E2E Paracetamol").first()).toBeVisible();
    // The person who entered it cannot approve it.
    await expect(page.locator("li:has-text('E2E Paracetamol')").getByRole("button", { name: /approve/ })).toHaveCount(0);
    await page.goto("/rota/settings");
    await page.locator("form:has(input[name=on][value='0'])").getByRole("button", { name: "Switch off" }).click();
    await expect(page.getByRole("button", { name: "Switch on medication records" })).toBeVisible();
  });
});
