import { expect, test, type Page } from "@playwright/test";

/** Visits Needing Attention as one queue: tiles and tabs filter it, a row selects it, the panel acts on it. */
async function signIn(page: Page, email = "coordinator@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeAttached(); // below 1024px the name sits in the menu, not on screen
}

test.describe("Visits Needing Attention", () => {
  test.use({ viewport: { width: 1440, height: 941 } });

  test("selecting a row shows its details on the right", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/attention");
    const rows = page.getByTestId("attention-queue").locator("li");
    test.skip((await rows.count()) < 2, "Needs two items in the demo data");
    const detail = page.getByTestId("attention-detail");
    // With nothing chosen, the first item's details are shown.
    await expect(detail).toBeVisible();
    const second = rows.nth(1).getByRole("link").first();
    const name = (await second.getAttribute("aria-label"))!.split(",")[0]!;
    await second.click();
    await expect(page).toHaveURL(/item=/);
    await expect(rows.nth(1)).toHaveAttribute("data-attn-selected", "true");
    await expect(detail.getByRole("heading", { level: 2 })).toHaveText(name);
  });

  test("each tile and tab filters the list, and the counts agree", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/attention");
    for (const [tile, row] of [["attention-unassigned", "attention-unassigned-row"], ["attention-missed", "attention-missed-row"]] as const) {
      const n = Number(await page.getByTestId(`${tile}-count`).textContent());
      await page.getByTestId(tile).click();
      await expect(page.getByTestId(tile)).toHaveAttribute("aria-current", "true");
      await expect(page.getByTestId(row)).toHaveCount(n);
      await expect(page.getByTestId("attention-queue").locator("li")).toHaveCount(n);
    }
    const now = Number(await page.getByTestId("attention-now-count").textContent());
    await page.getByTestId("attention-now").click();
    await expect(page.getByTestId("attention-queue").locator("li")).toHaveCount(now);
    if (now === 0) await expect(page.getByText("Nothing needs attention here.").first()).toBeVisible();
    await page.getByRole("navigation", { name: "Kind of work" }).getByRole("link", { name: /^All/ }).click();
    await expect(page).not.toHaveURL(/type=/);
  });

  test("search narrows the list by service user or carer", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/attention");
    const rows = page.getByTestId("attention-queue").locator("li");
    test.skip((await rows.count()) === 0, "No items in the demo data");
    const first = (await rows.first().getByRole("link").first().getAttribute("aria-label"))!.split(",")[0]!;
    await page.getByTestId("attention-search").fill(first);
    for (const label of await rows.getByRole("link").first().allTextContents()) expect(label).toContain(first);
    await page.getByTestId("attention-search").fill("zzzz-nobody");
    await expect(page.getByText("No one in this list matches your search.")).toBeVisible();
  });

  test("Assign in the panel opens Find Cover's review step for that carer", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/attention?type=unassigned");
    const rows = page.getByTestId("attention-unassigned-row");
    test.skip((await rows.count()) === 0, "No unassigned visits in the demo data");
    await rows.first().getByRole("link").first().click();
    const assign = page.getByTestId("attention-detail").getByRole("link", { name: /^Assign / });
    test.skip((await assign.count()) === 0, "No recommended carers for this visit");
    await assign.first().click();
    await expect(page).toHaveURL(/fcStep=review/);
    await expect(page.getByRole("dialog", { name: "Find Replacement Cover" })).toBeVisible();
  });

  test("below 1280px the details open as a slide-over that Escape closes", async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1112 });
    await signIn(page);
    await page.goto("/rota/attention");
    const rows = page.getByTestId("attention-queue").locator("li");
    test.skip((await rows.count()) === 0, "No items in the demo data");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await rows.first().getByRole("link").first().click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByTestId("attention-detail")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).not.toHaveURL(/item=/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(834);
  });
});
