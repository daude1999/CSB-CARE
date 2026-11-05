import { expect, test, type Page } from "@playwright/test";

/**
 * The Policy Reader (owner's spec of 5 Nov 2026): one continuous document with a sticky strip of section cards that
 * follows the reader, reading progress that never signs anything, and the Policy Actions panel.
 */
const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

async function openSafeguarding(page: Page) {
  await page.goto("/policies?q=Safeguarding%20Adults");
  const href = await page.locator('a[href^="/policies/c"]').filter({ hasText: "Safeguarding Adults" }).first().getAttribute("href");
  await page.goto(href!);
  await expect(page.getByTestId("reader-nav")).toBeVisible();
  return href!;
}

/** Scrolls so a section's top sits just under the sticky strip, where a reader would be reading it. */
async function readAt(page: Page, id: string) {
  await page.evaluate((sid) => {
    // The reader publishes the height of the top bar plus the sticky strip as --reader-top.
    const offset = parseFloat(getComputedStyle(document.querySelector(".policy-reader")!).getPropertyValue("--reader-top"));
    window.scrollTo({ top: document.getElementById(sid)!.getBoundingClientRect().top + window.scrollY - offset + 2 });
  }, id);
}

const activeCard = (page: Page) => page.getByTestId("reader-nav").locator('[aria-current="location"]');

test.describe("Policy Reader", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("scrolling highlights the section on screen, both ways, and clicking a card scrolls to it below the sticky strip", async ({ page }) => {
    await signIn(page);
    await openSafeguarding(page);
    await expect(activeCard(page)).toHaveText("Review Sheet");
    await expect(page.getByTestId("reader-progress-section")).toHaveText("1");

    await readAt(page, "scope");
    await expect(activeCard(page)).toHaveText("Scope");
    const progress = Number((await page.getByTestId("reader-progress-value").textContent())!.replace("%", ""));
    expect(progress).toBeGreaterThan(0);

    await readAt(page, "purpose");
    await expect(activeCard(page)).toHaveText("Purpose");

    await page.getByTestId("reader-nav").getByRole("link", { name: "Procedure" }).click();
    await expect(activeCard(page)).toHaveText("Procedure");
    await expect(page).toHaveURL(/#procedure$/);
    await page.waitForTimeout(1300);
    const heading = await page.locator("#h-procedure").boundingBox();
    const strip = await page.locator("[data-reader-strip]").boundingBox();
    expect(heading!.y).toBeGreaterThanOrEqual(strip!.y + strip!.height - 1);

    // Back returns to where the reader was; the last section wins at the bottom of the page.
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
    await expect(activeCard(page)).toHaveText("Forms & Resources");
    await expect(page.getByTestId("reader-progress-value")).toHaveText("100%");
  });

  test("reading to the end does not sign the policy", async ({ page }) => {
    await signIn(page, "carer1@care-solution.demo");
    await openSafeguarding(page);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }));
    await expect(page.getByTestId("reader-progress-value")).toHaveText("100%");
    await page.reload();
    await expect(page.getByTestId("signed-state")).toHaveCount(0);
  });

  test("Policy Actions: important, reading list, compare and history", async ({ page }) => {
    await signIn(page);
    const href = await openSafeguarding(page);
    const important = page.getByTestId("bookmark-important");
    await important.click();
    await expect(important).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("bookmark-reading_list").click();
    await expect(page.getByTestId("bookmark-reading_list")).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.getByTestId("bookmark-important")).toHaveAttribute("aria-pressed", "true");
    await page.goto("/acknowledgements");
    await expect(page.getByTestId("saved-reading")).toContainText("Safeguarding Adults");

    await page.goto(href);
    await page.getByTestId("bookmark-important").click();
    await expect(page.getByTestId("bookmark-important")).toHaveAttribute("aria-pressed", "false");
    await page.getByTestId("bookmark-reading_list").click();
    await expect(page.getByTestId("bookmark-reading_list")).toHaveAttribute("aria-pressed", "false");

    await page.getByTestId("policy-actions").getByRole("link", { name: "View Version History" }).click();
    await expect(page.getByTestId("version-history")).toBeVisible();
    await page.goto(`${href}/compare`);
    await expect(page.getByRole("heading", { level: 1, name: "Compare versions" })).toBeVisible();
  });

  test("a care worker cannot assign the policy to staff", async ({ page }) => {
    await signIn(page, "carer1@care-solution.demo");
    await openSafeguarding(page);
    await expect(page.getByTestId("policy-actions")).toBeVisible();
    await expect(page.getByTestId("assign-to-staff")).toHaveCount(0);
  });

  test("on a phone the strip scrolls sideways and the page does not", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await openSafeguarding(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByTestId("reader-nav").getByRole("link", { name: "Definitions" }).click();
    await expect(activeCard(page)).toHaveText("Definitions");
    await expect(activeCard(page)).toBeInViewport();
  });
});
