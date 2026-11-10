import { expect, test, type Page } from "@playwright/test";

/**
 * Audits and corrective actions are kept for ever, so their lists are read a page at a time (50 rows). These check
 * that the footer still reports the true total and that a page number from the address bar cannot break the list.
 */
async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@care-solution.demo");
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

const footer = (page: Page) => page.locator(".pc-foot").first();
async function counts(page: Page) {
  const m = /Showing (\d+) of (\d+)/.exec((await footer(page).textContent()) ?? "");
  expect(m, "the footer says how many rows are shown").not.toBeNull();
  return { shown: Number(m![1]), total: Number(m![2]) };
}

test("corrective actions: the footer gives the true total, and a page past the end is empty, not an error", async ({ page }) => {
  await signIn(page);
  await page.goto("/actions?view=all");
  const first = await counts(page);
  expect(first.shown).toBe(Math.min(50, first.total));
  expect(await page.locator("table tbody tr").count()).toBe(first.shown);

  const res = await page.goto("/actions?view=all&page=999");
  expect(res?.status()).toBe(200);
  const beyond = await counts(page);
  expect(beyond).toEqual({ shown: 0, total: first.total });

  // Nonsense in the address is read as the first page.
  await page.goto("/actions?view=all&page=abc");
  const last = await counts(page);
  expect(last.total).toBe(first.total);
  if (first.total) expect(last.shown).toBeGreaterThan(0);
});

test("audits: the footer gives the true total, and an out-of-range page falls back to the last page", async ({ page }) => {
  await signIn(page);
  await page.goto("/audits");
  const first = await counts(page);
  expect(first.shown).toBe(Math.min(50, first.total));
  const res = await page.goto("/audits?page=999");
  expect(res?.status()).toBe(200);
  const last = await counts(page);
  expect(last.total).toBe(first.total);
  if (first.total) expect(last.shown).toBeGreaterThan(0);
});
