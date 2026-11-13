import { expect, test, type Page } from "@playwright/test";

/**
 * Simplified Rota Dashboard (owner's request, 1 Nov 2026): the header keeps its date controls and gains the live UK time;
 * the four call cards sit directly beneath it with no "Coming up" panel in between.
 */
const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@care-solution.demo");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

const londonToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

test.describe("Rota Dashboard header and cards", () => {
  test.use({ viewport: { width: 1672, height: 941 } });

  test("the four call cards sit directly under the header, in order", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    const cards = page.getByRole("region", { name: "Calls on this day" }).locator("[data-testid^=card-]");
    await expect(cards).toHaveCount(4);
    const ids = await cards.evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    expect(ids.slice(0, 3)).toEqual(["card-completed", "card-late", "card-missed"]);
    expect(["card-unassigned", "card-missed-meds"]).toContain(ids[3]);
    await expect(page.getByTestId("coming-up")).toHaveCount(0);
    // Nothing between the header and the cards except the notices that were always there (flash, week not built).
    const gap = await page.evaluate(() => {
      const header = document.querySelector("main .rota-home > header")!.getBoundingClientRect();
      const cardsBox = document.querySelector('main section[aria-label="Calls on this day"]')!.getBoundingClientRect();
      return cardsBox.top - header.bottom;
    });
    const notice = await page.getByText(/not been built/i).count();
    if (!notice) expect(gap).toBeLessThanOrEqual(16);
  });

  test("ClearCare header (owner's picture, 12 Nov 2026): title, time and day controls share one row, the date is written out on a white pill", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota?date=2026-11-12");
    const band = page.getByTestId("title-bar");
    const title = (await band.getByRole("heading", { level: 1, name: "Rota Dashboard" }).boundingBox())!;
    const pill = band.locator(".mh-date-pill");
    await expect(pill).toContainText("Thursday 12 November 2026");
    expect(await pill.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(255, 255, 255)");
    for (const control of [page.getByTestId("rota-live-time"), page.getByRole("link", { name: "Previous day" }), pill, page.getByRole("link", { name: "Next day" }), page.getByRole("link", { name: "Today" })]) {
      const box = (await control.boundingBox())!;
      expect(box.x).toBeGreaterThan(title.x + title.width);
      expect(box.y).toBeLessThan(title.y + title.height + 30);
    }
    // The date input still carries the choice: typing a date moves the page to it.
    await page.getByLabel("Date", { exact: true }).fill("2026-11-14");
    await expect(page).toHaveURL(/date=2026-11-14/);
    await expect(pill).toContainText("Saturday 14 November 2026");
  });

  test("previous, next, date picker, branch and Today still drive the selected date", async ({ page }) => {
    await signIn(page);
    const today = londonToday();
    await page.goto("/rota");
    await page.getByRole("link", { name: "Next day" }).click();
    await expect(page).toHaveURL(new RegExp(`date=${shift(today, 1)}`));
    await page.getByRole("link", { name: "Previous day" }).click();
    await expect(page).toHaveURL(new RegExp(`date=${today}`));
    await page.getByRole("link", { name: "Previous day" }).click();
    await expect(page).toHaveURL(new RegExp(`date=${shift(today, -1)}`));
    await page.getByLabel("Date", { exact: true }).fill(shift(today, 5));
    await expect(page).toHaveURL(new RegExp(`date=${shift(today, 5)}`));
    const branch = page.getByRole("combobox", { name: "Branch" });
    if (await branch.count()) {
      const value = await branch.locator("option").nth(1).getAttribute("value");
      await branch.selectOption(value!);
      await expect(page).toHaveURL(new RegExp(`branch=${value}`));
      await expect(page).toHaveURL(new RegExp(`date=${shift(today, 5)}`));
    }
    await page.getByRole("link", { name: "Today" }).click();
    await expect(page).not.toHaveURL(/date=/);
  });

  test("the live UK time follows London's clock (BST in summer, GMT in winter), ticks over, and ignores the selected date", async ({ page }) => {
    await signIn(page);
    // Summer: 11:59:30 UTC is 12:59 in London (BST, UTC+1).
    await page.clock.install({ time: new Date("2026-07-01T11:59:30Z") });
    await page.goto("/rota");
    const time = page.getByTestId("rota-live-time");
    await expect(time).toHaveText("Current UK time 12:59");
    await page.clock.runFor(31_000);
    await expect(time).toHaveText("Current UK time 13:00");
    // Choosing another rota date does not move the clock.
    await page.getByRole("link", { name: "Next day" }).click();
    await expect(page).toHaveURL(/date=/);
    await expect(time).toHaveText(/Current UK time 13:0\d/);
  });

  test("in winter the live UK time is GMT", async ({ page }) => {
    await signIn(page);
    await page.clock.install({ time: new Date("2026-12-01T08:15:00Z") });
    await page.goto("/rota");
    await expect(page.getByTestId("rota-live-time")).toHaveText("Current UK time 08:15");
  });
});

test.describe("Rota Dashboard on a phone", () => {
  test("header, live time and cards fit without sideways scrolling", async ({ page }) => {
    await signIn(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/rota");
    await expect(page.getByTestId("rota-live-time")).toBeVisible();
    await expect(page.getByTestId("card-completed")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
