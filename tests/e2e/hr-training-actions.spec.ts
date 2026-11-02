import { expect, test, type Page } from "@playwright/test";

/** Assign Training and Send Reminder on HR → Checks & Training (owner's approved Training design). */
const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}
const hubReady = (page: Page) => expect(page.getByText("Opening your HR workspace")).toHaveCount(0, { timeout: 30_000 });

test.describe("Checks & Training actions", () => {
  test.use({ viewport: { width: 1672, height: 941 } });

  test("assign a course to two people, then see it on the record and close it", async ({ page }) => {
    await signIn(page);
    await page.goto("/hr/training");
    await hubReady(page);
    await page.getByRole("button", { name: "Assign training" }).click();
    const form = page.getByTestId("assign-training-form");
    await form.getByLabel("Course").fill("Dementia awareness");
    await form.getByRole("searchbox", { name: "Search people" }).fill("Amelia Hart");
    await form.getByRole("button", { name: /Choose all 2 shown/ }).click();
    await form.getByRole("button", { name: "Assign to 2 people" }).click();
    await expect(page.getByRole("status")).toContainText("Dementia awareness assigned to 2 people.");
    // Assigning again is refused per person, not duplicated.
    await page.getByRole("button", { name: "Assign training" }).click();
    await form.getByLabel("Course").fill("Dementia awareness");
    await form.getByRole("searchbox", { name: "Search people" }).fill("Amelia Hart");
    await expect(form.getByText(/Already assigned, due/).first()).toBeVisible();
    await form.getByRole("button", { name: "Cancel" }).click();

    await page.getByRole("link", { name: "Amelia Hart" }).first().click();
    await hubReady(page);
    await page.getByRole("navigation", { name: "Employee record sections" }).getByRole("button", { name: "Training" }).click();
    const list = page.getByTestId("assigned-training");
    await expect(list).toContainText("Dementia awareness");
    await list.getByRole("button", { name: "Mark complete" }).click();
    await expect(page.getByRole("status")).toContainText("Dementia awareness marked complete");
    await expect(list).toContainText("Completed");
  });

  test("send reminder shows who gets it and who has no sign-in, and sends in-app only", async ({ page }) => {
    await signIn(page);
    await page.goto("/hr/training");
    await hubReady(page);
    await page.getByRole("button", { name: "Send reminder" }).click();
    const form = page.getByTestId("send-reminder-form");
    await expect(form).toContainText("Nothing is sent by email or text");
    await expect(form.getByText("No CSB sign-in: tell them yourself").first()).toBeVisible();
    const send = form.getByRole("button", { name: /^Send \d+ reminders?$/ });
    if (await send.isVisible()) {
      await send.click();
      await expect(page.getByRole("status")).toContainText("Reminder sent to");
      await page.getByRole("button", { name: "Send reminder" }).click();
      await expect(form.getByText(/Reminded today by/).first()).toBeVisible();
    }
  });

  test("a read-only branch viewer does not get the buttons", async ({ page }) => {
    await signIn(page, "taylor.reed@care-solution.demo");
    await page.goto("/hr/training");
    await hubReady(page);
    await expect(page.getByTestId("training-matrix")).toBeVisible();
    await expect(page.getByRole("button", { name: "Assign training" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Send reminder" })).toHaveCount(0);
  });
});
