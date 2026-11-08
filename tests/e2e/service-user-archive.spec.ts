import { expect, test, type Page } from "@playwright/test";

/**
 * Archive, Restore and Delete for service users through the screens: Update ▾ → Archive or Delete, archive with a
 * reason, the person moves to the Archived filter, the profile is read-only, Restore brings them back, and an admin can
 * delete a record added by mistake after typing its CSB reference. A person with care records can only be archived.
 * All people here are fictional.
 */
async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

async function addPerson(page: Page, lastName: string) {
  await page.goto("/rota/service-users/new");
  await page.getByLabel("First name").fill("Testa");
  await page.getByLabel("Last name").fill(lastName);
  await page.locator("main form button.btn-primary").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(lastName);
  return page.url().split("?")[0]!.split("/").pop()!;
}

test.describe("Archive and delete service users", () => {
  test("archive from the Update menu, find under Archived, read-only profile, then restore", async ({ page }) => {
    await signIn(page);
    const id = await addPerson(page, "Archivetest");
    await page.goto("/rota/service-users?q=Archivetest");
    await page.getByTestId("su-row").first().getByTestId("row-update").click();
    await page.getByTestId("update-menu").getByTestId("update-archive").click();
    await expect(page).toHaveURL(new RegExp(`/rota/service-users/${id}/archive$`));
    await page.getByTestId("archive-form").getByLabel(/Why are you archiving/).fill("Enquiry did not go ahead");
    await page.getByTestId("archive-submit").click();
    await expect(page.getByTestId("archived-summary")).toContainText("Enquiry did not go ahead");

    // Gone from the active list; the search says an archived person matches.
    await page.goto("/rota/service-users?q=Archivetest&status=ALL");
    await expect(page.getByTestId("su-row")).toHaveCount(0);
    await expect(page.getByTestId("archived-matches")).toContainText("1 archived person also matches");
    await page.getByTestId("archived-matches").getByRole("link", { name: "Show archived" }).click();
    await expect(page.getByTestId("su-row")).toHaveCount(1);
    await expect(page.getByTestId("su-row").first().getByTestId("status-pill")).toHaveText("Archived");

    // Profile shows the banner and hides the edit form.
    await page.goto(`/rota/service-users/${id}?tab=details`);
    await expect(page.getByTestId("archived-banner")).toBeVisible();
    await expect(page.locator("form:has(select[name=to])")).toHaveCount(0);

    await page.goto(`/rota/service-users/${id}/archive`);
    await page.getByTestId("restore-form").getByLabel(/Why are you restoring/).fill("Care is starting after all");
    await page.getByTestId("restore-submit").click();
    await expect(page.getByTestId("archive-form")).toBeVisible();
    await page.goto("/rota/service-users?q=Archivetest");
    await expect(page.getByTestId("su-row")).toHaveCount(1);
  });

  test("an admin deletes a record added by mistake after typing its CSB reference", async ({ page }) => {
    await signIn(page);
    const id = await addPerson(page, "Mistakentest");
    await page.goto(`/rota/service-users/${id}/archive`);
    await expect(page.getByTestId("delete-archive-first")).toBeVisible();
    await page.getByTestId("archive-form").getByLabel(/Why are you archiving/).fill("Duplicate record");
    await page.getByTestId("archive-submit").click();
    const form = page.getByTestId("delete-form");
    await form.getByLabel(/Why are you deleting/).fill("Duplicate of another record");
    await form.getByLabel(/type the CSB reference/).fill("WRONG");
    await page.getByTestId("delete-submit").click();
    await expect(page.getByRole("alert").or(page.getByRole("status")).first()).toContainText("type the CSB reference exactly");
    const ref = (await page.getByTestId("delete-form").locator("label span.font-semibold.tabular-nums").innerText()).trim();
    await page.getByTestId("delete-form").getByLabel(/Why are you deleting/).fill("Duplicate of another record");
    await page.getByTestId("delete-form").getByLabel(/type the CSB reference/).fill(ref);
    await page.getByTestId("delete-submit").click();
    await expect(page).toHaveURL(/\/rota\/service-users\?status=ARCHIVED/);
    await expect(page.getByText(`${ref} was deleted permanently`)).toBeVisible();
    const res = await page.goto(`/rota/service-users/${id}`);
    expect(res?.status()).toBe(404);
  });

  test("a coordinator sees no Archive or Delete choices", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/service-users");
    await page.getByTestId("su-row").first().getByTestId("row-update").click();
    await expect(page.getByTestId("update-menu").getByTestId("update-manual")).toBeVisible();
    await expect(page.getByTestId("update-archive")).toHaveCount(0);
  });
});
