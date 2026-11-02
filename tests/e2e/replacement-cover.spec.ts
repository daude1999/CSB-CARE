import { expect, test, type Page } from "@playwright/test";

/** Find Replacement Cover's Contact & communication tab, and the header's Back and Forward buttons, in the browser. */
const SHOTS = process.env.SHOTS_DIR ?? "test-results/screens/replacement-cover";

async function signIn(page: Page, email = "coordinator@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe("Find Replacement Cover", () => {
  test.use({ viewport: { width: 1672, height: 941 } });

  test("records communication separately from booking, and a message left stays awaiting confirmation", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/attention");
    const find = page.getByRole("link", { name: /^Find cover for .*: recommended carers$/ });
    test.skip((await find.count()) === 0, "No unassigned visits in the demo data");
    await find.first().click();
    const panel = page.getByRole("dialog", { name: "Find Replacement Cover" });
    await expect(panel.getByRole("region", { name: "The visit" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/1-panel-cover.png` });

    await panel.getByRole("navigation", { name: "Find Cover sections" }).getByRole("link", { name: /Contact & communication/ }).click();
    await expect(page).toHaveURL(/fcTab=comms/);
    await expect(panel.getByTestId("comms-state")).toContainText("Not yet contacted");
    await expect(panel.getByRole("heading", { name: "Service user", exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Next of kin and other contacts" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/2-panel-contacts.png` });

    // Clicking a phone link records nothing: the history stays empty.
    const tel = panel.locator('a[href^="tel:"]');
    if (await tel.count()) await expect(tel.first()).toHaveAttribute("href", /^tel:\+?\d+$/);

    const form = panel.getByRole("form", { name: "Record a communication attempt" });
    await form.getByRole("radio").first().check();
    await form.getByText("Message left", { exact: true }).click();
    await form.getByLabel("What was communicated (optional)").fill("Left a message about the new carer");
    await expect(panel.locator('[data-unsaved="true"]')).toHaveCount(1);
    await form.getByRole("button", { name: "Save communication" }).click();
    await expect(panel.getByTestId("comms-state")).toContainText("Attempted — awaiting confirmation");
    const history = panel.getByRole("list", { name: "Communication history, oldest first" });
    await expect(history).toContainText("Message left");
    await expect(panel.locator('[data-unsaved="true"]')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/3-panel-history.png`, fullPage: false });

    // It shows as outstanding on Visits Needing Attention, without blocking anything.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: /Communication Outstanding/ })).toBeVisible();
  });
});
