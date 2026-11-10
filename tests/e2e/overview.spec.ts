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

  test("greets the person and shows today's rota, what needs attention and a solid tile per module", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/overview");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Care Solution Bureau CIC");
    // Owner's redesign of 10 Nov 2026: a greeting with the organisation and today's date, then the Rota tile beside
    // Needs your attention, then one solid tile for each other module.
    await expect(page.getByTestId("overview-greeting")).toHaveText(/^Good (morning|afternoon|evening), \S+$/);
    await expect(page.getByText(/^Here is .+ today, \w+day \d{1,2} \w+\.$/)).toBeVisible();
    await expect(page.getByTestId("arrange-modules")).toHaveText("Rearrange");
    await expect(page.getByRole("navigation", { name: "Quick actions" })).toHaveCount(0);
    await expect(page.getByTestId("overview-stats")).toHaveCount(0);
    await expect(page.getByText("Each module is its own workspace")).toHaveCount(0);

    const rota = page.getByTestId("tile-rota");
    await expect(rota.getByTestId("rota-headline")).toHaveText(/^\d+of \d+ visits? done today$/);
    await expect(rota.getByRole("list", { name: "Today's call rounds" }).getByRole("listitem").first()).toBeVisible();
    await expect(rota.getByTestId("rota-cover")).toContainText(/still needs? a carer|All visits covered/);
    await expect(rota.getByRole("link", { name: /Open rota/ })).toHaveAttribute("href", "/rota/visits");

    const attention = page.getByTestId("needs-attention");
    await expect(attention).toBeVisible();
    const rows = attention.getByRole("listitem");
    expect(await rows.count()).toBeLessThanOrEqual(5);
    // Each row has one action; the first is in its module's colour, the rest are light grey.
    await expect(rows.first().getByRole("link")).toHaveCount(1);
    const [firstBg, secondBg] = await Promise.all([
      rows.nth(0).getByRole("link").evaluate((el) => getComputedStyle(el).backgroundColor),
      rows.nth(1).getByRole("link").evaluate((el) => getComputedStyle(el).backgroundColor),
    ]);
    expect(firstBg).not.toBe(secondBg);

    for (const id of ["policy", "hr", "reporting", "admin"]) await expect(page.getByTestId("module-tiles").getByTestId(`tile-${id}`)).toBeVisible();
    for (const id of ["ecm", "service-users"]) await expect(page.getByTestId(`tile-${id}`)).toHaveCount(0);
    await expect(page.getByTestId("tile-reporting").getByTestId("reporting-bars").locator("span")).toHaveCount(7);

    // The whole tile opens its module, and the Policy tile shares the Policy & Compliance colour.
    const tileColour = await page.getByTestId("tile-policy").evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.getByTestId("tile-policy").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Compliance Dashboard" })).toBeVisible();
    await expect(page.getByTestId("module-header")).toBeVisible();
    expect(tileColour).toBeTruthy();
  });

  test("fits one 1440 by 900 screen, and stacks below 1100px without sideways scrolling", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/overview");
    const bottom = await page.getByTestId("module-tiles").evaluate((el) => el.getBoundingClientRect().bottom);
    expect(bottom).toBeLessThanOrEqual(900);
    const [rotaBox, attentionBox] = [await page.getByTestId("tile-rota").boundingBox(), await page.getByTestId("needs-attention").boundingBox()];
    // Side by side: the same top (to within the page-entry animation's sub-pixel offset).
    expect(Math.abs(rotaBox!.y - attentionBox!.y)).toBeLessThanOrEqual(2);
    expect(attentionBox!.x).toBeGreaterThan(rotaBox!.x + rotaBox!.width);
    for (const width of [834, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/overview");
      const [r, a] = [await page.getByTestId("tile-rota").boundingBox(), await page.getByTestId("needs-attention").boundingBox()];
      expect(a!.y, `stacked at ${width}`).toBeGreaterThan(r!.y + r!.height - 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `no sideways scroll at ${width}`).toBeLessThanOrEqual(0);
    }
  });

  test("every module's page banner uses its Overview tile colour", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    const banners: [string, string][] = [
      ["reporting", "/analytics"],
      ["admin", "/settings"],
      ["rota", "/rota/service-users"],
      ["hr", "/workforce/absences"],
    ];
    for (const [id, path] of banners) {
      await page.goto("/overview");
      const tileColour = await page.getByTestId(`tile-${id}`).evaluate((el) => getComputedStyle(el).backgroundColor);
      await page.goto(path);
      const bannerColour = await page.locator(".mh-band").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bannerColour, `${id} banner on ${path}`).toBe(tileColour);
    }
  });

  test("a person can rearrange the module tiles, and the order is kept", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/overview");
    await page.getByTestId("arrange-modules").click();
    await expect(page.getByTestId("arrange-bar")).toBeVisible();
    // Start from the standard order so the test does not depend on an earlier run.
    await page.getByRole("button", { name: "Standard order" }).click();
    // Wait for the standard order to come back before moving anything, so the move is not undone by the reload.
    await expect(page.getByText("The module boxes are back in the standard order.")).toBeVisible();
    await expect(page.getByTestId("arrange-bar")).toBeVisible();
    const hr = page.getByTestId("arrange-hr");
    await expect(async () => {
      if (!(await hr.textContent())?.includes("position 1")) await page.getByRole("button", { name: "Move HR & Workforce earlier" }).click();
      await expect(hr).toContainText("position 1", { timeout: 500 });
    }).toPass();
    await page.getByRole("button", { name: "Save order" }).click();
    await expect(page.getByText("Your module order is saved.")).toBeVisible();
    // Rearrange orders the four tiles along the bottom; the Rota tile stays first.
    const order = () => page.getByTestId("module-tiles").locator("[data-testid^=tile-]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.testid));
    expect(await order()).toEqual(["tile-hr", "tile-policy", "tile-reporting", "tile-admin"]);
    await page.reload();
    expect(await order()).toEqual(["tile-hr", "tile-policy", "tile-reporting", "tile-admin"]);
    await page.goto("/overview?arrange=1");
    await page.getByRole("button", { name: "Standard order" }).click();
    await expect(page.getByText("The module boxes are back in the standard order.")).toBeVisible();
  });

  test("in dark mode the tiles keep white text and white parts on a toned-down module colour", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "csb-mode", value: "dark", url: String(baseURL) }]);
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/overview");
    expect(await page.locator("html").getAttribute("data-mode")).toBe("dark");
    await expect(page.getByTestId("rota-cover")).toHaveCSS("background-color", "rgb(255, 255, 255)");
    await expect(page.getByTestId("tile-rota").locator("h2")).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(page.getByTestId("tile-policy")).toHaveCSS("color", "rgb(255, 255, 255)");
    // The page and the attention panel turn dark.
    expect(await page.getByTestId("needs-attention").evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgb(255, 255, 255)");
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

