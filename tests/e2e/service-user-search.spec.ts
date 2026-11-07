import { expect, test, type Page } from "@playwright/test";

const SHOTS = "test-results/screens";

async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

/** A fictional demo person's full name and CSB number, read from the directory. */
async function demoPerson(page: Page) {
  await page.goto("/rota/service-users");
  const first = page.locator("table tbody tr").first();
  const name = (await first.locator("td").first().locator("a").innerText()).trim();
  const csb = ((await first.locator("td").first().locator("div").innerText()).split("·")[0] ?? "").trim();
  const href = (await first.locator("td").first().locator("a").getAttribute("href"))!;
  return { name, csb, href };
}

test.describe("Service user search", () => {
  test("the top bar finds a person by full name and CSB number and opens their profile", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await signIn(page);
    const p = await demoPerson(page);
    await page.goto("/rota");
    const search = page.getByRole("searchbox", { name: "Search rostering" });
    await page.keyboard.press("Control+k");
    await expect(search).toBeFocused();
    await search.fill(`  ${p.name.toUpperCase()} `);
    await search.press("Enter");
    await expect(page).toHaveURL(/\/rota\/search\?q=/);
    const results = page.getByRole("region", { name: "Service users" });
    await expect(results.getByRole("link", { name: p.name, exact: true })).toBeVisible();
    await expect(page.getByTestId("reference-search-problem")).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/search-1-header-full-name.png` });

    await page.goto(`/rota/search?q=${encodeURIComponent(p.csb)}`);
    await results.getByRole("link", { name: p.name, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${p.href}$`));

    // A number that is not on anyone's record says the whole number is needed, rather than guessing.
    await page.goto("/rota/search?q=9871234");
    await expect(page.getByText(/only found when the whole number is typed exactly/)).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/search-2-header-no-match.png` });
  });

  test("the Service Users directory accepts a full name and keeps its filters", async ({ page }) => {
    await page.setViewportSize({ width: 1672, height: 941 });
    await signIn(page);
    const p = await demoPerson(page);
    const filters = page.getByRole("region", { name: "Filters" });
    await filters.getByLabel("Search").fill(p.name);
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page).toHaveURL(/q=/);
    await expect(page.locator("table tbody tr")).toHaveCount(1);
    await expect(page.locator("table").getByRole("link", { name: p.name, exact: true })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/search-3-directory-full-name.png` });

    // Filtering to Ended hides the person and the page says a filter is hiding a match.
    await filters.getByLabel("Status").selectOption("ENDED");
    await page.getByRole("button", { name: "Apply" }).click();
    await expect(page.getByTestId("hidden-by-filters")).toContainText("1 more person matches");
    await page.screenshot({ path: `${SHOTS}/search-4-directory-hidden-by-filter.png` });
    await page.getByRole("link", { name: "Show all matches" }).click();
    await expect(page.locator("table").getByRole("link", { name: p.name, exact: true })).toBeVisible();
  });
});
