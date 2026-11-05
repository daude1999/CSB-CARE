import { expect, test, type Page } from "@playwright/test";

/** Forms PR 2/3: filling in a form on screen, submitting it, and a manager returning and approving it. Demo data only. */
const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test.describe("On-screen forms", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("a carer fills in a declaration; a manager returns it, then approves the corrected version", async ({ browser }) => {
    const carer = await (await browser.newContext()).newPage();
    await signIn(carer, "carer1@care-solution.demo");
    await carer.goto("/policies/forms?q=CSB-FRM-020");
    await carer.getByTestId("start-CSB-FRM-020").click();
    await expect(carer).toHaveURL(/\/policies\/forms\/records\/c/);
    const url = carer.url().split("?")[0]!;

    // Follow-up questions appear only when they apply.
    const details = carer.getByLabel(/Where, and your usual hours/);
    await expect(details).toBeHidden();
    for (const [name, value] of [["new_conduct", "no"], ["registration_conditions", "no"], ["relationships", "no"], ["other_work", "yes"], ["business_interests", "no"]]) {
      await carer.locator(`input[name=f_${name}][value=${value}]`).check();
    }
    await expect(details).toBeVisible();
    await details.fill("Fictional Corner Shop, 8 hours");
    await carer.getByRole("button", { name: "Save draft" }).click();
    await expect(carer).toHaveURL(/ok=Draft/);

    // Submitting without the declaration ticked keeps the answers and says what is missing.
    await carer.getByRole("button", { name: "Submit for review" }).click();
    await expect(carer).toHaveURL(/error=/);
    await expect(carer.getByLabel(/Where, and your usual hours/)).toHaveValue("Fictional Corner Shop, 8 hours");
    await carer.locator("input[name=f_confirm]").check();
    await carer.getByRole("button", { name: "Submit for review" }).click();
    await expect(carer.getByTestId("form-answers")).toContainText("Fictional Corner Shop, 8 hours");

    const manager = await (await browser.newContext()).newPage();
    await signIn(manager, "manager@care-solution.demo");
    await manager.goto("/policies/forms/records");
    await expect(manager.getByTestId("review-queue")).toContainText("Kwame Boateng");
    await manager.goto(url);
    await manager.getByRole("button", { name: "Return for correction" }).click();
    await manager.getByLabel("What needs correcting").fill("Please give the shop's full name");
    await manager.getByRole("button", { name: "Return", exact: true }).click();
    await expect(manager).toHaveURL(/ok=/);

    await carer.goto(url);
    await expect(carer.getByTestId("return-reason")).toContainText("Please give the shop's full name");
    await carer.getByLabel(/Where, and your usual hours/).fill("Fictional Corner Shop Ltd, 8 hours");
    await carer.locator("input[name=f_confirm]").check();
    await carer.getByRole("button", { name: "Submit for review" }).click();
    await expect(carer).toHaveURL(/ok=Submitted/);

    await manager.goto(url);
    await manager.getByTestId("review-actions").getByRole("button", { name: "Approve" }).click();
    await expect(manager.getByTestId("form-history")).toContainText("Approved");
    await expect(manager.getByTestId("form-history")).toContainText("Returned for correction");

    // Another carer cannot open it.
    const other = await (await browser.newContext()).newPage();
    await signIn(other, "carer2@care-solution.demo");
    const res = await other.goto(url);
    expect(res?.status()).toBe(404);
  });

  test("a manager starts a Subject Access Request log from a service user's record and links a staff member", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/service-users");
    const first = page.locator('a[href^="/rota/service-users/c"]').first();
    const suHref = (await first.getAttribute("href"))!.split("?")[0]!;
    await page.goto(`${suHref}?tab=documents&section=forms`);
    const panel = page.getByTestId("service-user-forms");
    await expect(panel).toContainText("No on-screen forms");
    await panel.getByRole("button", { name: /Start Subject Access Request Log/ }).click();
    await expect(page).toHaveURL(/\/policies\/forms\/records\/c/);
    const links = page.getByTestId("form-links");
    await expect(links.locator("li")).toHaveCount(1);
    await expect(links).toContainText("Service user");

    // Link a staff member too, then find the form on both records.
    const select = links.locator("select[name=about]");
    const staffValue = await select.locator('optgroup[label="Staff"] option').first().getAttribute("value");
    await select.selectOption(staffValue!);
    await links.getByRole("button", { name: "Link" }).click();
    await expect(page).toHaveURL(/ok=Linked/);
    await expect(page.getByTestId("form-links").locator("li")).toHaveCount(2);
    await expect(page.getByTestId("form-history")).toContainText("Linked to a person's record");

    await page.goto(`${suHref}?tab=documents&section=forms`);
    await expect(page.getByTestId("service-user-forms").locator("tbody tr")).toHaveCount(1);
    await page.goto(`/rota/staff/${staffValue!.split(":")[1]}`);
    await expect(page.getByTestId("staff-forms")).toContainText("Subject Access Request Log");
  });
});
