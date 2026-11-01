import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "DemoPassword!2026";
const SHOTS = "test-results/screens/unassigned";

async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

const panel = (page: Page) => page.locator('aside[aria-labelledby="fc-title"]');

test.describe("Unassigned Visits and Coverage History", () => {
  test.use({ viewport: { width: 1672, height: 941 } });

  test("live list: Find Cover recommends, searches by hand, and books only after review", async ({ page }) => {
    await signIn(page);
    // The older ?from=&days= link still works (it becomes a custom range); the demo data leaves gaps a week ahead.
    await page.goto(`/rota/unassigned?from=${new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" })}&days=14`);
    await expect(page.getByRole("heading", { level: 1, name: "Unassigned Visits" })).toBeVisible();
    await expect(page.getByText("Find and allocate suitable care workers.")).toBeVisible();
    const tabs = page.getByRole("navigation", { name: "Unassigned Visits sections" });
    await expect(tabs.getByRole("link", { name: "Unassigned Visits" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("region", { name: "Summary" })).toBeVisible();
    const find = page.getByRole("link", { name: /^Find cover for / });
    test.skip((await find.count()) === 0, "No unassigned visits in the next two weeks of demo data");
    await find.first().click();
    await expect(page).toHaveURL(/cover=/);
    await expect(panel(page).getByRole("region", { name: "Selected visit" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/1-recommended.png` });

    // Manual uses the same candidate list, searched by name.
    await panel(page).getByRole("navigation", { name: "How to choose a carer" }).getByRole("link", { name: "Manual" }).click();
    await expect(page).toHaveURL(/ctab=manual/);
    await expect(panel(page).getByPlaceholder("Search care workers by name...")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/2-manual.png` });

    const options = panel(page).locator('a[aria-label^="Select "]');
    test.skip((await options.count()) === 0, "No carer the rules allow for this visit");
    const name = ((await options.first().getAttribute("aria-label")) ?? "").replace(/^Select /, "");
    await options.first().click();
    await expect(page).toHaveURL(/pick=/);
    await panel(page).getByRole("link", { name: "Review Assignment" }).click();
    await expect(panel(page).getByRole("heading", { name: "Review Assignment" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/3-review.png` });
    const ack = page.getByLabel(/I have read these warnings/);
    if (await ack.count()) await ack.check();
    await page.getByRole("button", { name: "Confirm Assignment" }).click();
    // The message only claims what is recorded: booked, and whether carers can see it yet. Never "accepted".
    await expect(page.getByRole("status")).toContainText(`${name} booked for`);
    await expect(page.getByRole("status")).not.toContainText("accepted");
  });

  test("coverage history: figures reconcile, drill into the table, show a visit's history and export", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/unassigned?tab=history");
    await expect(page.getByRole("heading", { level: 2, name: "Visit Coverage — Last 7 Days" })).toBeVisible();
    const reconcile = (await page.getByTestId("coverage-reconcile").innerText()).replace(/,/g, "");
    const m = /(\d+) attended \+ (\d+) without recorded attendance \+ (\d+) cancelled(?: \+ (\d+) not yet due)? = (\d+) visits/.exec(reconcile);
    expect(m, reconcile).not.toBeNull();
    const [, a, u, c, nd, total] = m!;
    expect(Number(a) + Number(u) + Number(c) + Number(nd ?? 0)).toBe(Number(total));
    await expect(page.getByRole("region", { name: "Coverage summary" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Daily Visit Coverage" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/4-coverage-summary.png` });

    // The table's count matches the summary total.
    await expect(page.getByTestId("coverage-count")).toHaveAttribute("data-total", total);
    await page.locator("#coverage-visits").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/5-detail-table.png` });

    const history = page.getByRole("link", { name: /^View history of visit / });
    if (await history.count()) {
      await history.first().click();
      await expect(page.getByRole("heading", { name: "Visit History" })).toBeVisible();
      await page.locator("#coverage-visits").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/6-timeline.png` });
    }

    for (const [label, type] of [["Export Excel", "spreadsheetml"], ["Export PDF", "application/pdf"]] as const) {
      const href = await page.getByRole("link", { name: label }).getAttribute("href");
      const res = await page.request.get(href!);
      expect(res.status(), label).toBe(200);
      expect(res.headers()["content-type"], label).toContain(type);
    }
  });

  test("signed-out visitors cannot open the coverage export", async ({ playwright, baseURL }) => {
    const anon = await playwright.request.newContext({ baseURL });
    const res = await anon.get("/api/rota/coverage?format=pdf", { maxRedirects: 0 });
    expect([302, 303, 307, 401, 403]).toContain(res.status());
    await anon.dispose();
  });
});
