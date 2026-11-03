import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The Daily Rota's Visit Details panel: Save Changes for carers, Previous/Next, click outside, Escape and the Unsaved
 * Changes prompt. Uses tomorrow's scheduled visits, which can still be re-staffed.
 */
const PASSWORD = "DemoPassword!2026";
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

const panelOf = (page: Page) => page.getByRole("complementary", { name: "Visit Details" });
const visitParam = (page: Page) => new URL(page.url()).searchParams.get("visit");

/** Chooses the first carer the checks allow for a place, and ticks the warnings box if that carer needs a check. */
async function chooseCarer(panel: Locator, place: string, skip = 0) {
  const select = panel.getByLabel(place, { exact: true });
  const values = await select.locator("optgroup[label='Carers ranked for this visit'] option:not([disabled])").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(values.length).toBeGreaterThan(skip);
  await select.selectOption(values[skip]!);
  return values[skip]!;
}
async function tickWarningsIfAsked(panel: Locator) {
  const box = panel.getByLabel("I have read the warnings for the carers I chose.");
  if (await box.isVisible()) await box.check();
}

const usable = (panel: Locator, place: string) => panel.getByLabel(place, { exact: true }).locator("optgroup[label='Carers ranked for this visit'] option:not([disabled])").count();
const firstEmpty = async (panel: Locator) => {
  const label = panel.locator("li[data-kind=empty] label").first();
  return (await label.count()) ? (await label.innerText()).trim() : null;
};

/**
 * Opens the carer editor on a scheduled visit in the next few days that has an empty place with at least one carer
 * free to fill it. Earlier tests book carers, so when no such place is left, one more place is added and saved first.
 */
async function openEditorWithEmptyPlace(page: Page) {
  const panel = panelOf(page);
  for (const pass of ["empty", "add"] as const) {
    for (let d = 1; d <= 6; d++) {
      const day = new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
      await page.goto(`/rota/visits?date=${day}&status=SCHEDULED${pass === "empty" ? "&view=unassigned" : ""}`);
      const links = page.getByRole("link", { name: /Open details of visit/ });
      const n = Math.min(await links.count(), 8);
      for (let i = 0; i < n; i++) {
        const ref = (await links.nth(i).innerText()).trim();
        await links.nth(i).click();
        await expect(panel.getByText(/^Ref: /)).toHaveText(`Ref: ${ref}`);
        await panel.getByRole("button", { name: "Reassign Carers" }).click();
        await expect(panel.getByRole("heading", { name: "Reassign carers" })).toBeVisible();
        let place = await firstEmpty(panel);
        if (!place && pass === "add") {
          await panel.getByRole("button", { name: "Add carer place" }).click();
          place = await firstEmpty(panel);
          if (place && (await usable(panel, place)) >= 1) {
            await panel.getByRole("button", { name: "Save Changes" }).click();
            await expect(panel.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
            await panel.getByRole("button", { name: "Reassign Carers" }).click();
            await expect(panel.locator(`li[data-place] label`, { hasText: place })).toBeVisible();
            return { panel, day, place };
          }
        } else if (place && (await usable(panel, place)) >= 1) return { panel, day, place };
        await panel.getByRole("button", { name: /^(Discard|Close editor)$/ }).click();
      }
    }
  }
  throw new Error("No scheduled visit in the next six days has free carers for an empty place");
}

test.describe("Visit Details panel", () => {
  test.beforeEach(async ({ page }) => signIn(page));

  test("adds a carer and saves deliberately; the rota shows the saved carer and the panel stays open", async ({ page }) => {
    const { panel, day, place } = await openEditorWithEmptyPlace(page);
    const id = visitParam(page);
    const save = panel.getByRole("button", { name: "Save Changes" });
    await expect(save).toBeDisabled();
    const chosen = await chooseCarer(panel, place);
    await expect(panel.locator("li[data-kind=add]")).toHaveCount(1);
    await expect(panel.getByText("1 change waiting to be saved")).toBeVisible();
    await tickWarningsIfAsked(panel);
    await save.click();
    await expect(panel.getByRole("status").filter({ hasText: "Saved" })).toContainText("Saved: 1 change saved");
    await expect(page).toHaveURL(new RegExp(`visit=${id}`));
    // After a reload, the panel and the table row read the saved carer from the database.
    const ref = (await panel.getByText(/^Ref: /).innerText()).replace("Ref: ", "").trim();
    await page.goto(`/rota/visits?date=${day}&q=${ref}&visit=${id}`);
    await expect(panelOf(page)).toBeVisible();
    await expect(panelOf(page).locator(`a[href='/rota/staff/${chosen}']`)).toBeVisible();
    await expect(page.locator("tr[aria-selected=true]").locator(`a[href='/rota/staff/${chosen}']`)).toBeVisible();
  });

  test("removes a carer only after Save Changes, and Discard puts everything back", async ({ page }) => {
    await page.goto(`/rota/visits?date=${tomorrow()}&status=SCHEDULED`);
    // A visit with at least one carer.
    const row = page.locator("main tbody tr", { has: page.locator("a[href^='/rota/staff/']") }).first();
    await row.getByRole("link", { name: /Open details of visit/ }).click();
    const panel = panelOf(page);
    const remove = panel.getByRole("button", { name: /^Remove .* from this visit$/ }).first();
    const name = ((await remove.getAttribute("aria-label")) ?? "").replace(/^Remove | from this visit$/g, "");
    await remove.click();
    await expect(panel.locator("li[data-kind=remove]")).toHaveCount(1);
    await panel.getByRole("button", { name: "Discard" }).click();
    await expect(panel.getByRole("button", { name: `Remove ${name} from this visit` })).toBeVisible();
    await panel.getByRole("button", { name: `Remove ${name} from this visit` }).click();
    await panel.getByRole("button", { name: "Save Changes" }).click();
    await expect(panel.getByRole("status").filter({ hasText: "Saved" })).toContainText("Saved");
    await expect(panel.getByRole("button", { name: `Remove ${name} from this visit` })).toHaveCount(0);
  });

  test("Previous and Next follow the list as shown, keep the day, sort and filters, and cross pages", async ({ page }) => {
    const day = tomorrow();
    await page.goto(`/rota/visits?date=${day}&sort=su`);
    const total = Number(await page.getByTestId("visit-count").getAttribute("data-total"));
    test.skip(total < 3, "needs at least three visits tomorrow");
    await page.getByRole("link", { name: /Open details of visit/ }).first().click();
    const panel = panelOf(page);
    await expect(panel.getByText(`Visit 1 of ${total}`)).toBeVisible();
    await expect(panel.getByLabel("Previous visit (none)")).toBeVisible();
    const first = visitParam(page);
    await panel.getByRole("link", { name: "Next visit" }).click();
    await expect(panel.getByText(`Visit 2 of ${total}`)).toBeVisible();
    expect(visitParam(page)).not.toBe(first);
    await expect(page).toHaveURL(/sort=su/);
    await expect(page).toHaveURL(new RegExp(`date=${day}`));
    await expect(page.locator("tr[aria-selected=true]")).toHaveCount(1);
    // The arrow keys move too, when nobody is typing.
    await page.locator("body").press("ArrowRight");
    await expect(panel.getByText(`Visit 3 of ${total}`)).toBeVisible();
    await page.locator("body").press("ArrowLeft");
    await expect(panel.getByText(`Visit 2 of ${total}`)).toBeVisible();
    // Typing in the search box does not move between visits.
    await page.getByLabel("Search visits by service user, carer or reference").press("ArrowRight");
    await expect(panel.getByText(`Visit 2 of ${total}`)).toBeVisible();
    // A new visit always opens on Details.
    await panel.getByRole("link", { name: "History" }).click();
    await expect(page).toHaveURL(/tab=history/);
    await panel.getByRole("link", { name: "Next visit" }).click();
    await expect(page).not.toHaveURL(/tab=/);
    await expect(panel.getByRole("link", { name: "Details", exact: true })).toHaveAttribute("aria-current", "page");

    if (total > 25) {
      // The 25th visit is the last on page 1; Next turns the table to page 2 with the panel still open.
      await page.goto(`/rota/visits?date=${day}&sort=su`);
      await page.getByRole("link", { name: /Open details of visit/ }).nth(24).click();
      await expect(panel.getByText(`Visit 25 of ${total}`)).toBeVisible();
      await panel.getByRole("link", { name: "Next visit" }).click();
      await expect(panel.getByText(`Visit 26 of ${total}`)).toBeVisible();
      await expect(page).toHaveURL(/page=2/);
      await expect(page.locator("tr[aria-selected=true]")).toBeVisible();
      await panel.getByRole("link", { name: "Previous visit" }).click();
      await expect(panel.getByText(`Visit 25 of ${total}`)).toBeVisible();
      await expect(page).not.toHaveURL(/page=2/);
    }
  });

  test("closes by clicking outside or Escape when nothing is waiting, and another row opens in one click", async ({ page }) => {
    await page.goto(`/rota/visits?date=${tomorrow()}&sort=su`);
    const links = page.getByRole("link", { name: /Open details of visit/ });
    await links.first().click();
    await expect(panelOf(page)).toBeVisible();
    // Clicking a plain cell of another row opens that visit straight away.
    const second = page.locator("main tbody tr").nth(1);
    const ref = (await second.getByRole("link", { name: /Open details of visit/ }).innerText()).trim();
    await second.locator("td").nth(6).click();
    await expect(panelOf(page).getByText(/^Ref: /)).toHaveText(`Ref: ${ref}`);
    // Clicking inside the panel never closes it.
    await panelOf(page).getByRole("heading", { name: "Visit Details" }).click();
    await expect(panelOf(page)).toBeVisible();
    // Clicking empty space closes it and keeps the sort.
    await page.getByRole("heading", { level: 1 }).click();
    await expect(panelOf(page)).toHaveCount(0);
    await expect(page).toHaveURL(/sort=su/);
    await links.first().click();
    await expect(panelOf(page)).toBeVisible();
    await page.locator("body").press("Escape");
    await expect(panelOf(page)).toHaveCount(0);
  });

  test("protects unsaved changes: Continue Editing, Discard, and Save then carry on", async ({ page }) => {
    const { panel, day, place } = await openEditorWithEmptyPlace(page);
    const chosen = await chooseCarer(panel, place);
    const dialog = page.getByRole("dialog", { name: "Unsaved Changes" });

    // Click outside: asked; Continue Editing keeps the draft.
    await page.getByRole("heading", { level: 1 }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("You have changes that haven't been saved. What would you like to do?");
    await dialog.getByRole("button", { name: "Continue Editing" }).click();
    await expect(panel.getByLabel(place, { exact: true })).toHaveValue(chosen);

    // Escape (once the dropdown is no longer in use): asked too.
    await panel.getByRole("heading", { name: "Reassign carers" }).click();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(panel.getByLabel(place, { exact: true })).toHaveValue(chosen);

    // Changing tab: asked; Discard drops the draft and carries on.
    const id = visitParam(page);
    await panel.getByRole("link", { name: "Notes" }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Discard Changes" }).click();
    await expect(page).toHaveURL(/tab=notes/);
    expect(visitParam(page)).toBe(id);

    // Close with X: Save Changes saves first, then closes.
    await panel.getByRole("link", { name: "Details", exact: true }).click();
    await expect(page).toHaveURL(/tab=details/);
    await panel.getByRole("button", { name: "Reassign Carers" }).click();
    await chooseCarer(panel, place);
    await tickWarningsIfAsked(panel);
    await panel.getByRole("link", { name: "Close visit details" }).click();
    await dialog.getByRole("button", { name: "Save Changes" }).click();
    await expect(panelOf(page)).toHaveCount(0);
    await page.goto(`/rota/visits?date=${day}&visit=${id}`);
    await expect(panelOf(page).locator(`a[href^='/rota/staff/']`).first()).toBeVisible();
  });

  test("a colleague's newer save is never overwritten, and the draft stays on screen", async ({ page, browser }) => {
    const { panel, place } = await openEditorWithEmptyPlace(page);
    const url = page.url();
    const mine = await chooseCarer(panel, place);
    await tickWarningsIfAsked(panel);

    // A colleague saves the same visit first.
    const other = await browser.newPage();
    await signIn(other);
    await other.goto(url);
    const theirs = panelOf(other);
    await theirs.getByRole("button", { name: "Reassign Carers" }).click();
    await chooseCarer(theirs, place);
    await tickWarningsIfAsked(theirs);
    await theirs.getByRole("button", { name: "Save Changes" }).click();
    await expect(theirs.getByRole("status").filter({ hasText: "Saved" })).toContainText("Saved");
    await other.close();

    await panel.getByRole("button", { name: "Save Changes" }).click();
    await expect(panel.getByRole("alert")).toContainText("Someone else changed this visit");
    await expect(panel.getByLabel(place, { exact: true })).toHaveValue(mine);
    await panel.getByRole("button", { name: "Reload the latest version" }).click();
    await expect(panel.getByRole("button", { name: "Reassign Carers" })).toBeVisible();
  });

  test("explains why a completed visit cannot be re-staffed and links to corrections", async ({ page }) => {
    await page.goto(`/rota/visits?date=${yesterday()}&status=COMPLETED`);
    const link = page.getByRole("link", { name: /Open details of visit/ }).first();
    test.skip((await link.count()) === 0, "no completed visits yesterday in the demo data");
    await link.click();
    const panel = panelOf(page);
    await expect(panel.getByTestId("staffing-locked")).toContainText("This visit has been completed, so its carers cannot be changed here.");
    await expect(panel.getByTestId("staffing-locked").getByRole("link", { name: /office corrections/ })).toHaveAttribute("href", /#corrections$/);
    await expect(panel.getByRole("button", { name: "Reassign Carers" })).toHaveCount(0);
    // View Visit and Add Note are still there.
    await expect(panel.getByRole("link", { name: "View Visit" })).toBeVisible();
  });
});
