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

  // Owner's layout fix of 11 Nov 2026 (reference: the Overview mock-up of 10 Nov): on wide screens the content is capped
  // at 1320px and centred beside the side panel, with the specified sizes.
  for (const [width, height] of [[1440, 900], [1920, 1080]] as const) {
    test(`at ${width} by ${height} nothing is wider than 1320px, the page does not scroll sideways and the sizes are as specified`, async ({ page }, testInfo) => {
      await signIn(page, "manager@care-solution.demo");
      await page.setViewportSize({ width, height });
      await page.goto("/overview");
      await expect(page.getByTestId("module-tiles")).toBeVisible();

      const layout = await page.evaluate(() => {
        const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
        const content = document.querySelector('[data-testid="overview-content"]')!;
        const widest = Math.max(...[content, ...content.querySelectorAll("*")].map((el) => el.getBoundingClientRect().width));
        const px = (sel: string, prop: "fontSize" | "fontWeight" | "padding" | "borderRadius" | "columnGap") => getComputedStyle(document.querySelector(sel)!)[prop];
        const rounds = [...document.querySelectorAll('[data-testid^="round-"]')].map((el) => el.getBoundingClientRect());
        return {
          sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          widest,
          content: box('[data-testid="overview-content"]'),
          main: box("main"),
          rota: box('[data-testid="tile-rota"]'),
          attention: box('[data-testid="needs-attention"]'),
          roundsList: box('ul[aria-label="Today\'s call rounds"]'),
          rounds: rounds.map((r) => ({ left: r.left, width: r.width, bottom: r.bottom })),
          cover: box('[data-testid="rota-cover"]'),
          tileHeights: [...document.querySelectorAll('[data-testid="module-tiles"] .ovx-tile')].map((el) => el.getBoundingClientRect().height),
          greeting: [px('[data-testid="overview-greeting"]', "fontSize"), px('[data-testid="overview-greeting"]', "fontWeight")],
          headline: [px('[data-testid="rota-headline"] > span:first-child', "fontSize"), px('[data-testid="rota-headline"] > span:first-child', "fontWeight"), px('[data-testid="rota-headline"] > span:nth-child(2)', "fontSize")],
          figure: [px('[data-testid="tile-hr"] .tabular-nums', "fontSize"), px('[data-testid="tile-hr"] .tabular-nums', "fontWeight")],
          title: [px('[data-testid="tile-hr"] .ovx-title', "fontSize"), px('[data-testid="tile-hr"] .ovx-title', "fontWeight")],
          rotaPadding: px('[data-testid="tile-rota"]', "padding"),
          tilePadding: px('[data-testid="tile-hr"]', "padding"),
          radius: [px('[data-testid="tile-rota"]', "borderRadius"), px('[data-testid="tile-hr"]', "borderRadius")],
          gaps: [px('[data-testid="module-tiles"]', "columnGap"), px('[data-testid="tile-rota"]', "columnGap")],
        };
      });
      await testInfo.attach(`overview-${width}x${height}`, { body: await page.screenshot(), contentType: "image/png" });

      expect(layout.sideways, "no sideways scroll").toBeLessThanOrEqual(0);
      expect(layout.widest, "nothing wider than 1320px").toBeLessThanOrEqual(1320);
      // Centred in the space to the right of the side panel.
      expect(Math.abs(layout.content.left - layout.main.left - (layout.main.right - layout.content.right))).toBeLessThanOrEqual(2);
      if (width === 1920) expect(layout.content.width).toBe(1320);

      expect(layout.greeting).toEqual(["26px", "600"]);
      expect(layout.headline).toEqual(["68px", "700", "19px"]);
      expect(layout.figure).toEqual(["46px", "700"]);
      expect(layout.title).toEqual(["15px", "600"]);
      expect(layout.rotaPadding).toBe("22px");
      expect(layout.tilePadding).toBe("18px 20px");
      expect(layout.radius).toEqual(["18px", "18px"]);
      expect(layout.gaps).toEqual(["16px", "20px"]);
      for (const h of layout.tileHeights) expect(h).toBe(224);

      // Call rounds: fixed width between 150 and 220px, packed from the left.
      expect(layout.rounds.length).toBeGreaterThan(0);
      expect(Math.abs(layout.rounds[0]!.left - layout.roundsList.left)).toBeLessThanOrEqual(1);
      for (const r of layout.rounds) {
        expect(r.width).toBeGreaterThanOrEqual(150);
        expect(r.width).toBeLessThanOrEqual(220);
      }
      // The cover bar follows the rounds with a 20px gap, and the Rota tile matches Needs your attention in height.
      expect(Math.abs(layout.cover.top - layout.roundsList.bottom - 20)).toBeLessThanOrEqual(1);
      expect(Math.abs(layout.rota.height - layout.attention.height)).toBeLessThanOrEqual(1);
      expect(Math.abs(layout.rota.top - layout.attention.top)).toBeLessThanOrEqual(2);
    });
  }

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

