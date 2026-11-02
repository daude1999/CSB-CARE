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

const panel = (page: Page) => page.getByRole("dialog", { name: "Find Replacement Cover" });

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
    await expect(panel(page).getByRole("region", { name: "The visit" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/1-recommended.png` });

    // Manual uses the same candidate list, searched by name.
    await panel(page).getByRole("link", { name: "Search Staff Manually" }).click();
    await expect(page).toHaveURL(/fcStep=manual/);
    await expect(panel(page).getByRole("heading", { name: "Search staff" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/2-manual.png` });

    const options = panel(page).getByRole("list", { name: "Staff" }).getByRole("radio", { disabled: false });
    test.skip((await options.count()) === 0, "No carer the rules allow for this visit");
    await options.first().check();
    await panel(page).getByRole("button", { name: "Review Cover" }).click();
    await expect(page).toHaveURL(/fcStaff=/);
    await expect(panel(page).getByRole("heading", { name: "Review Replacement Cover" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/3-review.png` });
    for (const box of await panel(page).getByRole("checkbox").all()) await box.check();
    const reason = panel(page).getByLabel("Why this carer is right despite the warnings");
    if (await reason.count()) await reason.fill("Reviewed with the family by phone");
    await panel(page).getByRole("button", { name: "Confirm Cover" }).click();
    await expect(panel(page).getByRole("heading", { name: /^Cover (partly )?booked$/ })).toBeVisible();
    // The message only claims what is recorded: booked, and whether carers can see it yet. Never "accepted".
    await expect(panel(page).getByRole("status").first()).toContainText("booked as");
    await expect(panel(page).getByRole("status").first()).not.toContainText("accepted");
    // Communication is separate from booking: still outstanding until someone records it.
    await expect(panel(page).getByText("Booking cover does not record that anyone was told.")).toBeVisible();
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
