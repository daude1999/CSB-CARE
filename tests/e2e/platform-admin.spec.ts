import { expect, test, type Page } from "@playwright/test";

/**
 * Evantix Platform Admin Centre in the browser, on synthetic data: an organisation administrator cannot open it; a
 * platform administrator sets up a plan, adds a client through the wizard, gets a one-time invitation link, opens
 * every profile tab and every page. Set PA_SHOTS to a folder to also save screenshots.
 */
const PASSWORD = "DemoPassword!2026";
const SHOTS = process.env.PA_SHOTS;
/** Keeps names unique if the spec is run again on the same database. */
const RUN = String(Date.now() % 1_000_000).padStart(6, "0");

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
}

test("an organisation administrator cannot open the Admin Centre", async ({ page }) => {
  await signIn(page, "manager@care-solution.demo");
  for (const path of ["/platform-admin", "/platform-admin/clients", "/platform-admin/users"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(404);
  }
});

test("a platform administrator adds a plan and a client, and every page and profile tab renders", async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1672, height: 941 });
  await signIn(page, "admin@csb.demo");

  // Lands on the Admin Centre straight after sign-in.
  await expect(page).toHaveURL(/\/platform-admin$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Platform Overview");

  await page.goto("/platform-admin/plans");
  await page.getByRole("link", { name: "New plan" }).first().click();
  const newPlan = page.getByRole("dialog");
  await newPlan.getByLabel("Plan name").fill(`Domiciliary Standard ${RUN}`);
  await newPlan.getByLabel("Code").fill(`DOM-${RUN}`);
  await newPlan.getByLabel("Included users").fill("40");
  await newPlan.getByLabel("AI requests per month").fill("500");
  await newPlan.getByRole("button", { name: "Create plan" }).click();
  await expect(page.getByText("Plan saved")).toBeVisible();
  await expect(page.getByText(`Domiciliary Standard ${RUN}`).first()).toBeVisible();

  await page.goto("/platform-admin/clients/new");
  await page.getByLabel("Legal company name *").fill(`Brightwater Homecare ${RUN} Ltd`);
  await page.getByLabel("Company registration number").fill(`BW${RUN}`);
  await page.getByLabel("Main contact person").fill("Jordan Example");
  await page.getByLabel("Contact email").fill("office@brightwater.example");
  await page.getByLabel("CQC provider ID").fill("1-000000123");
  await page.getByLabel(/^Branches/).fill("Northgate\nRiverside");
  await shot(page, "03-add-client-step1");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Plan *")).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Administrator name *").fill("Morgan Example");
  await page.getByLabel("Administrator email *").fill(`morgan.${RUN}@brightwater.example`);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(`Brightwater Homecare ${RUN} Ltd`).first()).toBeVisible();
  await shot(page, "04-add-client-review");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("is set up");
  await expect(page.locator("text=/\\/account\\/[A-Za-z0-9_-]{20,}/").first()).toBeVisible();
  await shot(page, "05-client-created");
  // The link is shown once only.
  await page.waitForLoadState("networkidle");
  await page.reload();
  await expect(page.locator("text=/\\/account\\/[A-Za-z0-9_-]{20,}/")).toHaveCount(0);

  await page.goto(`/platform-admin/clients?q=${RUN}`);
  await page.getByRole("link", { name: /Brightwater Homecare/ }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Brightwater");
  // Back returns to the same filtered list.
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Clients" }).click();
  await expect(page).toHaveURL(new RegExp(`q=${RUN}`));
  await page.getByRole("link", { name: /Brightwater Homecare/ }).first().click();
  const profile = page.url().split("?")[0];
  for (const tab of ["overview", "users", "subscription", "modules", "usage", "security", "settings"]) {
    const res = await page.goto(`${profile}?tab=${tab}`);
    expect(res?.status(), tab).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1 }), tab).toContainText("Brightwater");
    await expect(page.getByRole("navigation", { name: "Client workspace" }).locator('[aria-current="page"]'), tab).toHaveCount(1);
    if (tab === "overview" || tab === "subscription" || tab === "modules") await shot(page, `06-client-${tab}`);
  }
  // Tabs of the first Admin Centre still open the tab that now holds their content.
  for (const [legacy, now] of [["company", "Overview"], ["branches", "Overview"], ["ai", "Usage"], ["storage", "Usage"], ["audit", "Security"]]) {
    await page.goto(`${profile}?tab=${legacy}`);
    await expect(page.getByRole("navigation", { name: "Client workspace" }).locator('[aria-current="page"]'), legacy).toHaveText(now);
  }
  // Company details open in a side panel over the tab.
  await page.goto(`${profile}?tab=overview`);
  await page.getByRole("link", { name: "Edit details" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Global search finds the client by reference or name.
  const search = page.getByRole("combobox", { name: /Search clients/ });
  await search.fill(`Brightwater Homecare ${RUN}`);
  await expect(page.getByRole("option", { name: /Brightwater/ }).first()).toBeVisible();

  for (const path of ["", "/clients", "/onboarding", "/administrators", "/users", "/passwords", "/roles", "/sessions", "/security", "/subscriptions", "/plans", "/billing", "/renewals", "/modules", "/ai", "/storage", "/jobs", "/health", "/settings", "/notifications", "/support", "/activity"]) {
    const res = await page.goto(`/platform-admin${path}`);
    expect(res?.status(), path || "/").toBeLessThan(400);
    await expect(page.locator("h1").first(), path || "/").toBeVisible();
    if (["", "/clients", "/users", "/roles", "/billing", "/ai", "/health", "/security"].includes(path)) await shot(page, `pa${path.replace("/", "-") || "-dashboard"}`);
  }
});

for (const [name, width] of [["phone", 390], ["tablet", 834]] as const) {
  test(`the Admin Centre works on a ${name} without sideways page scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await signIn(page, "admin@csb.demo");
    for (const path of ["", "/clients", "/users", "/roles", "/settings", "/ai", "/subscriptions", "/health"]) {
      await page.goto(`/platform-admin${path}`);
      await expect(page.locator("h1").first(), path || "/").toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path || "/").toBeLessThanOrEqual(1);
    }
    await shot(page, `${name}-health`);
  });
}
