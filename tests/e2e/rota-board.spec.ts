import { expect, test, type Page } from "@playwright/test";

/**
 * Daily Rota Board and visit drawer (approved redesign PR 3, owner's brief of 10 Nov 2026). The board is the default
 * view of /rota/visits; every block is a button with a full accessible name; a drag goes through the eligibility check.
 */
const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("Daily Rota Board", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("is the default view, with team members by number of visits, call rounds, a footer of real counts and the list one click away", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/visits");
    const views = page.getByRole("navigation", { name: "Rota view" });
    await expect(views.getByRole("link", { name: "Board" })).toHaveAttribute("aria-current", "page");
    const board = page.getByTestId("rota-board");
    await expect(board).toBeVisible();
    // Rows are 50px high (taller only when visits overlap) and sorted by number of visits.
    const rows = board.getByTestId("board-row");
    expect(await rows.count()).toBeGreaterThan(1);
    const counts = (await rows.allInnerTexts()).map((t) => Number(/(\d+) visits?/.exec(t)?.[1]));
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
    expect(await rows.first().evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(50);
    // "Needs a carer" comes first whenever a visit is short of a carer.
    const footer = board.getByTestId("board-footer");
    const needs = Number(/(\d+) need a carer/.exec(await footer.innerText())?.[1]);
    await expect(board.getByTestId("board-needs-row")).toHaveCount(needs ? 1 : 0);
    if (needs) expect(await board.locator("[data-testid=board-needs-row], [data-testid=board-row]").first().getAttribute("data-testid")).toBe("board-needs-row");
    // Call rounds come from the organisation's call types.
    await expect(board.getByTestId("board-round").first()).toHaveText(/Morning|Lunch|Tea|Bed/);
    // The footer agrees with the list's count for the same day.
    const visits = Number(/(\d+) visits today/.exec(await footer.innerText())?.[1]);
    await expect(footer).toContainText(/\d+ completed/);
    await expect(footer).toContainText(/\d+ still to come/);
    await expect(footer).toContainText(/\d+ carers working/);
    // The red line marks the time now on today's board.
    await expect(board.getByTestId("board-now")).toHaveCount(1);
    await views.getByRole("link", { name: "List" }).click();
    await expect(page).toHaveURL(/layout=list/);
    await expect(page.getByTestId("visit-count")).toHaveAttribute("data-total", String(visits));
    await views.getByRole("link", { name: "Board" }).click();
    await expect(page.getByTestId("rota-board")).toBeVisible();
  });

  test("every block is a button with a full name; it opens a 420px drawer that Esc closes, returning focus", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/visits");
    const blocks = page.getByTestId("board-block");
    expect(await blocks.count()).toBeGreaterThan(0);
    for (const b of await blocks.all()) {
      expect(await b.evaluate((el) => el.tagName)).toBe("BUTTON");
      // Service user, call, time, carer and status.
      await expect(b).toHaveAttribute("aria-label", /^.+, .+, \d{2}:\d{2} for \d+ minutes, (carer .+|no carer booked)(, needs \d+ carers)?, (Completed|Still to come|Needs a carer|Missed|Late|In progress|Cancelled), reference .+$/);
    }
    const block = page.locator("[data-testid=board-row] [data-testid=board-block]").first();
    const name = (await block.getAttribute("aria-label"))!.split(",")[0]!;
    // Keyboard: focus the block and press Enter.
    await block.focus();
    await page.keyboard.press("Enter");
    const drawer = page.getByRole("dialog", { name });
    await expect(drawer).toBeVisible();
    expect((await drawer.boundingBox())!.width).toBe(420);
    await expect(drawer.getByRole("heading", { name: "Care tasks" })).toBeVisible();
    await expect(drawer.getByRole("region", { name: "Details" }).or(drawer.locator("section[aria-label=Details]"))).toContainText(/\d{2}:\d{2} to \d{2}:\d{2}/);
    await expect(drawer.getByRole("link", { name: "Open full visit" })).toHaveAttribute("href", /\/rota\/visits\/[^/?]+$/);
    // Focus starts inside the drawer.
    await expect(drawer.getByRole("button", { name: "Close visit details" })).toBeFocused();
    // "Why this carer" appears only with real reasons, each from the eligibility or matching service.
    await expect(drawer.getByText("Loading…")).toHaveCount(0);
    const why = drawer.getByTestId("drawer-why");
    if (await why.count()) await expect(why).toContainText(/eligibility check|warnings|supported this person|works in this area|passes every check/);
    await page.keyboard.press("Escape");
    await expect(drawer).toHaveCount(0);
    await expect(block).toBeFocused();
  });

  test("Reassign in the drawer opens the visit's allocation panel in the list", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/visits");
    const movable = page.locator("[data-testid=board-block][draggable=true]").first();
    test.skip((await movable.count()) === 0, "No visit left to allocate on today's demo rota");
    await movable.click();
    const drawer = page.getByTestId("visit-drawer");
    await drawer.getByRole("link", { name: "Reassign" }).click();
    await expect(page).toHaveURL(/layout=list.*visit=|visit=.*layout=list/);
    await expect(page.getByRole("complementary", { name: "Visit Details" })).toBeVisible();
  });

  test("dragging a visit to another team member is checked by the eligibility service before anything is saved", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/visits");
    const movable = page.locator("[data-testid=board-block][draggable=true]").first();
    test.skip((await movable.count()) === 0, "No visit left to allocate on today's demo rota");
    const from = movable.locator("xpath=ancestor::*[@data-testid='board-row' or @data-testid='board-needs-row']");
    const target = page.getByTestId("board-row").filter({ hasNot: page.locator(`[data-testid=board-block][aria-label="${await movable.getAttribute("aria-label")}"]`) }).last();
    await movable.dragTo(target.locator("> div").nth(1), { targetPosition: { x: 40, y: 25 } });
    expect(await from.count()).toBe(1);
    // The same server action as the planner answers: assigned, refused with the reason, or warnings to confirm.
    const flash = page.getByRole("status").or(page.getByRole("alert"));
    await expect(flash.first()).toContainText(/Carer assigned|Cannot allocate|Needs your confirmation|changed since you opened it|outside yours/);
    if (await page.getByRole("region", { name: "Confirm move" }).count()) await expect(page.getByRole("button", { name: "Move anyway" })).toBeVisible();
  });
});

test.describe("Daily Rota Board on a narrow window", () => {
  test.use({ viewport: { width: 1100, height: 800 } });

  test("under 1280px the board scrolls sideways inside its card and the page never does", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/visits");
    const scroller = page.getByTestId("board-scroll");
    await expect(scroller).toBeVisible();
    expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
