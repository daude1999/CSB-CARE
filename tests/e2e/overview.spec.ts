import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("Overview", () => {
  test.use({ viewport: { width: 1536, height: 1024 } });

  test("shows a coloured tile for each module the person may open, with planned modules labelled", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/overview");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Care Solution Bureau CIC");
    // Approved design (1 Nov 2026): no row of figures above the cards; the Rota card carries today's five figures,
    // each linking to the page it was counted from, in place of the old planner drawing.
    await expect(page.getByTestId("overview-stats")).toHaveCount(0);
    for (const id of ["completed", "pending", "missed", "unassigned", "staff"]) await expect(page.getByTestId(`rota-figure-${id}`)).toBeVisible();
    await expect(page.getByTestId("tile-rota").getByRole("img")).toHaveCount(0);
    for (const id of ["policy", "rota", "hr", "reporting", "admin"]) await expect(page.getByTestId(`tile-${id}`)).toBeVisible();
    // Electronic call monitoring and service users now live inside Rostering & Care Management.
    for (const id of ["ecm", "service-users"]) await expect(page.getByTestId(`tile-${id}`)).toHaveCount(0);
    await expect(page.getByTestId("tile-rota")).not.toContainText("Not built yet");
    await expect(page.getByTestId("needs-attention")).toBeVisible();

    // The Policy tile and the Policy & Compliance pages share one colour.
    const tileColour = await page.getByTestId("tile-policy").locator(".ov-tile-head").evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.getByTestId("tile-policy").getByRole("link", { name: "Open Policy & Compliance" }).click();
    await expect(page).toHaveURL(/\/$/);
    // The banner blends from the Overview colour into the module's over a quarter of a second, so wait for it to settle.
    await expect(page.getByRole("heading", { level: 1, name: "Compliance Centre Dashboard" })).toHaveCSS("background-color", tileColour);
  });

  test("every module's page banner uses its Overview tile colour", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    const banners: [string, string, string][] = [
      ["reporting", "/reports", "[data-testid=title-bar]"],
      ["reporting", "/analytics", "[data-testid=title-bar]"],
      ["admin", "/settings", "[data-testid=title-bar]"],
      ["rota", "/rota/service-users", "[data-testid=title-bar]"],
      ["hr", "/hr/dashboard", "[data-testid=title-bar]"],
    ];
    for (const [id, path, banner] of banners) {
      await page.goto("/overview");
      const tileColour = await page.getByTestId(`tile-${id}`).locator(".ov-tile-head").evaluate((el) => getComputedStyle(el).backgroundColor);
      await page.goto(path);
      const bannerColour = await page.locator(banner).first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bannerColour, `${id} banner on ${path}`).toBe(tileColour);
    }
  });

  test("a person can rearrange their module boxes, and the order is kept", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/overview");
    await page.getByTestId("arrange-modules").click();
    await expect(page.getByTestId("arrange-bar")).toBeVisible();
    // Start from the standard order so the test does not depend on an earlier run.
    await page.getByRole("button", { name: "Standard order" }).click();
    await expect(page.getByTestId("arrange-bar")).toBeVisible();
    // Move HR to the front with its arrow button (retried until the page is interactive).
    const hr = page.getByTestId("arrange-hr");
    await expect(async () => {
      if (!(await hr.textContent())?.includes("position 1")) await page.getByRole("button", { name: "Move HR & Workforce earlier" }).click();
      await expect(hr).toContainText("position 1", { timeout: 500 });
    }).toPass();
    await page.getByRole("button", { name: "Save order" }).click();
    await expect(page.getByText("Your module order is saved.")).toBeVisible();
    const order = () => page.locator("[data-testid^=tile-]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid));
    expect(await order()).toEqual(["tile-hr", "tile-policy", "tile-rota", "tile-reporting", "tile-admin"]);
    await page.reload();
    expect(await order()).toEqual(["tile-hr", "tile-policy", "tile-rota", "tile-reporting", "tile-admin"]);
    // Back to the standard order for the other tests.
    await page.goto("/overview?arrange=1");
    await page.getByRole("button", { name: "Standard order" }).click();
    await expect(page.getByText("The module boxes are back in the standard order.")).toBeVisible();
  });

  test("care staff only see the modules they can use", async ({ page }) => {
    await signIn(page, "carer1@care-solution.demo");
    await page.goto("/overview");
    await expect(page.getByTestId("tile-policy")).toBeVisible();
    for (const id of ["hr", "admin", "reporting", "rota"]) await expect(page.getByTestId(`tile-${id}`)).toHaveCount(0);
  });

  test("the header shows the CSB logo, today's London date and time, and the signed-in person, with no search box", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/overview");
    const header = page.getByTestId("overview-header");
    await expect(header.getByRole("img", { name: "CSB" })).toHaveAttribute("src", "/brand/csb-monogram-on-dark.png");
    const london = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...o }).format(new Date());
    await expect(page.getByTestId("overview-date")).toHaveText(london({ weekday: "short", day: "numeric", month: "short", year: "numeric" }));
    await expect(page.getByTestId("overview-time")).toHaveText(/^UK time \d{2}:\d{2}$/);
    const time = (await page.getByTestId("overview-time").innerText()).slice(-5);
    const [h, m] = london({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).split(":").map(Number);
    const [sh, sm] = time.split(":").map(Number);
    expect(Math.abs((h! * 60 + m!) - (sh! * 60 + sm!)) % 1440).toBeLessThanOrEqual(1);
    // The same signed-in person the shell names in the sidebar.
    await expect(page.getByTestId("overview-user")).toHaveText(await page.getByTestId("current-user").innerText());
    await expect(page.getByTestId("overview-role")).not.toBeEmpty();
    await expect(page.locator("#global-search")).toHaveCount(0);
    // The account menu offers sign out; other pages keep the standard top bar and its search.
    await page.getByTestId("account-menu").locator("summary").click();
    await expect(page.getByTestId("account-menu").getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.goto("/policies");
    await expect(page.getByTestId("overview-header")).toHaveCount(0);
    await expect(page.locator("#global-search")).toBeVisible();
  });
});

