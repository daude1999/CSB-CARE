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

  test("greets the person and shows today's care delivery, what needs action, notifications, this week and a tile per module", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/overview");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Care Solution Bureau CIC");
    // Harbour Overview (owner's decision, 13 Nov 2026; docs/design/harbour/screens/overview-1180.png): a greeting, then
    // white panels with solid coloured title bars, then one tile for each other module.
    await expect(page.getByTestId("overview-greeting")).toHaveText(/^Good (morning|afternoon|evening), \S+$/);
    await expect(page.getByTestId("overview-summary")).toContainText(/\d+ of \d+ done so far\./);
    await expect(page.getByTestId("arrange-modules")).toHaveText("Rearrange");
    await expect(page.getByRole("navigation", { name: "Quick actions" })).toHaveCount(0);
    await expect(page.getByTestId("overview-stats")).toHaveCount(0);

    // Title bars by meaning: navy schedule, red action, blue notifications, green completed, teal links.
    const bars: [string, string, string][] = [
      ["tile-rota", "Today's care delivery", "rgb(31, 58, 104)"],
      ["needs-attention", "Needs action", "rgb(179, 38, 30)"],
      ["overview-notifications", "Notifications", "rgb(46, 91, 207)"],
      ["overview-week", "This week", "rgb(22, 120, 74)"],
      ["overview-go-to", "Go to", "rgb(15, 118, 110)"],
    ];
    for (const [id, title, colour] of bars) {
      const bar = page.getByTestId(id).locator(".hb-pn-h");
      await expect(bar.getByRole("heading", { level: 2 })).toHaveText(title);
      await expect(bar).toHaveCSS("background-color", colour);
    }

    const rota = page.getByTestId("tile-rota");
    await expect(rota.getByTestId("rota-headline")).toHaveText(/^\d+of \d+ visits? done today$/);
    // Call rounds are one ruled table row each (14 Nov 2026), never tall columns.
    const rounds = rota.getByRole("table", { name: "Today's call rounds" });
    await expect(rounds.getByRole("columnheader")).toHaveText(["Call round", "Times", "Visits", "Done", "Needs a carer", "Progress", "Status"]);
    await expect(rounds.locator('tbody tr[data-testid^="round-"]').first()).toBeVisible();
    await expect(rounds.locator("tbody tr").first().getByRole("cell").first()).toHaveText(/^\d{2}:\d{2} to \d{2}:\d{2}$/);
    for (const row of await rounds.locator("tbody tr").all()) expect((await row.boundingBox())!.height).toBeLessThanOrEqual(48);
    await expect(rota.getByTestId("rota-cover")).toContainText(/still needs? a carer|All visits covered/);
    await expect(rota.getByRole("link", { name: /Open Daily Rota/ })).toHaveAttribute("href", "/rota/visits");
    await expect(rota.getByRole("link", { name: "The Monitor" })).toHaveAttribute("href", "/rota/monitor");

    const attention = page.getByTestId("needs-attention");
    const rows = attention.getByRole("listitem");
    expect(await rows.count()).toBeGreaterThan(1);
    // Each row has one action; the first is the main (filled) button, the rest are plain.
    await expect(rows.first().getByRole("link")).toHaveCount(1);
    const [firstBg, secondBg] = await Promise.all([
      rows.nth(0).getByRole("link").evaluate((el) => getComputedStyle(el).backgroundColor),
      rows.nth(1).getByRole("link").evaluate((el) => getComputedStyle(el).backgroundColor),
    ]);
    expect(firstBg).not.toBe(secondBg);

    for (const id of ["policy", "hr", "reporting", "admin"]) await expect(page.getByTestId("module-tiles").getByTestId(`tile-${id}`)).toBeVisible();
    for (const id of ["ecm", "service-users"]) await expect(page.getByTestId(`tile-${id}`)).toHaveCount(0);
    await expect(page.getByTestId("overview-week").getByTestId("reporting-bars").locator("li")).toHaveCount(7);

    // The whole tile opens its module.
    await page.getByTestId("tile-policy").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Compliance Dashboard" })).toBeVisible();
    await expect(page.getByTestId("module-header")).toBeVisible();
  });

  test("puts Needs action beside the side column on a wide screen, and stacks without sideways scrolling below it", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/overview");
    const [attentionBox, notesBox] = [await page.getByTestId("needs-attention").boundingBox(), await page.getByTestId("overview-notifications").boundingBox()];
    expect(Math.abs(attentionBox!.y - notesBox!.y)).toBeLessThanOrEqual(2);
    expect(notesBox!.x).toBeGreaterThan(attentionBox!.x + attentionBox!.width);
    for (const width of [834, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/overview");
      const [a, n] = [await page.getByTestId("needs-attention").boundingBox(), await page.getByTestId("overview-notifications").boundingBox()];
      expect(n!.y, `stacked at ${width}`).toBeGreaterThan(a!.y + a!.height - 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `no sideways scroll at ${width}`).toBeLessThanOrEqual(0);
    }
  });

  // On wide screens the content stays capped at 1320px and centred beside the side panel (owner's fix of 11 Nov 2026).
  for (const [width, height] of [[1440, 900], [1920, 1080]] as const) {
    test(`at ${width} by ${height} nothing is wider than 1320px and the page does not scroll sideways`, async ({ page }, testInfo) => {
      await signIn(page, "manager@care-solution.demo");
      await page.setViewportSize({ width, height });
      await page.goto("/overview");
      await expect(page.getByTestId("module-tiles")).toBeVisible();
      const layout = await page.evaluate(() => {
        const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        const content = document.querySelector('[data-testid="overview-content"]')!;
        return {
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          widest: Math.max(...[content, ...content.querySelectorAll("*")].map((el) => el.getBoundingClientRect().width)),
          content: box('[data-testid="overview-content"]'),
          main: box("main"),
          rounds: [...document.querySelectorAll('[data-testid^="round-"]')].length,
        };
      });
      await testInfo.attach(`overview-${width}x${height}`, { body: await page.screenshot(), contentType: "image/png" });
      expect(layout.sideways, "no sideways scroll").toBeLessThanOrEqual(0);
      expect(layout.widest, "nothing wider than 1320px").toBeLessThanOrEqual(1320);
      expect(Math.abs(layout.content.left - layout.main.left - (layout.main.right - layout.content.right))).toBeLessThanOrEqual(2);
      if (width === 1920) expect(layout.content.width).toBe(1320);
      expect(layout.rounds).toBeGreaterThan(0);
    });
  }

  test("every module's tile on the Overview uses the colour of that module's page header", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    const banners: [string, string][] = [
      ["reporting", "/analytics"],
      ["admin", "/settings"],
      ["policy", "/policies"],
      ["hr", "/workforce/absences"],
    ];
    for (const [id, path] of banners) {
      await page.goto("/overview");
      const tileColour = await page.getByTestId(`tile-${id}`).locator(".hb-tile-ic").evaluate((el) => getComputedStyle(el).backgroundColor);
      await page.goto(path);
      const chipColour = await page.locator(".mh-chip").first().evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(chipColour, `${id} header on ${path}`).toBe(tileColour);
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

  test("in dark mode the panels turn dark and keep their white title-bar text", async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "csb-mode", value: "dark", url: String(baseURL) }]);
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/overview");
    expect(await page.locator("html").getAttribute("data-mode")).toBe("dark");
    await expect(page.getByTestId("tile-rota").locator("h2")).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(page.getByTestId("needs-attention").locator("h2")).toHaveCSS("color", "rgb(255, 255, 255)");
    expect(await page.getByTestId("needs-attention").evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgb(255, 255, 255)");
    expect(await page.getByTestId("tile-policy").evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe("rgb(255, 255, 255)");
  });

  test("care staff only see the modules they can use", async ({ page }) => {
    await signIn(page, "carer1@care-solution.demo");
    await page.goto("/overview");
    await expect(page.getByTestId("tile-policy")).toBeVisible();
    for (const id of ["hr", "admin", "reporting", "rota"]) await expect(page.getByTestId(`tile-${id}`)).toHaveCount(0);
  });

  test("the top bar shows today's London date and time on the Overview, the rail the ClearCare mark, and the account menu the signed-in person", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/overview");
    // The ClearCare mark from the approved Harbour reference: a navy square with "CC".
    await expect(page.getByTestId("rail-logo")).toHaveText("CC");
    const london = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", ...o }).format(new Date());
    await expect(page.getByTestId("overview-date")).toHaveText(london({ weekday: "short", day: "numeric", month: "short", year: "numeric" }));
    await expect(page.getByTestId("overview-time")).toHaveText(/^UK time \d{2}:\d{2}$/);
    const time = (await page.getByTestId("overview-time").textContent())!.slice(-5);
    const [h, m] = london({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).split(":").map(Number);
    const [sh, sm] = time.split(":").map(Number);
    expect(Math.abs((h! * 60 + m!) - (sh! * 60 + sm!)) % 1440).toBeLessThanOrEqual(1);
    // The same signed-in person the top bar names.
    await expect(page.getByTestId("overview-user")).toHaveText(await page.getByTestId("current-user").innerText());
    await expect(page.getByTestId("overview-role")).not.toBeEmpty();
    // The account menu offers sign out; other pages keep the same top bar without the clock.
    await page.getByTestId("account-menu").locator("summary").click();
    await expect(page.getByTestId("account-menu").getByRole("button", { name: "Sign out" })).toBeVisible();
    await page.goto("/policies");
    await expect(page.getByTestId("overview-clock")).toHaveCount(0);
    await expect(page.getByTestId("account-menu")).toBeVisible();
  });
});

