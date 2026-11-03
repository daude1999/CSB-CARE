import { execSync } from "node:child_process";
import { expect, test, type Locator, type Page } from "@playwright/test";

const PASSWORD = "DemoPassword!2026";
const SHOTS = "test-results/screens";
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/csb_e2e?schema=public";
const fixture = (...args: string[]) => JSON.parse(execSync(`npx tsx tests/e2e/fixtures/roll-forward-scenario.ts ${args.join(" ")}`, { env: { ...process.env, DATABASE_URL, LOG_LEVEL: "warn" } }).toString());
const dmy = (iso: string) => iso.split("-").reverse().join("/");
const addDays = (iso: string, d: number) => {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};
type Snap = { count: number; digest: string; ids: string[]; duplicates: number };

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("manager@care-solution.demo");
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}
const figure = (dlg: Locator, name: string) => dlg.getByLabel("Roll forward summary").locator("div", { hasText: name }).locator("dd");

/** Presses Preview and checks the dialog shows it is working, then that the preview was updated. */
async function preview(dlg: Locator) {
  const status = dlg.getByTestId("roll-status");
  await dlg.getByTestId("roll-preview").click();
  await expect(status).toContainText("Updating the preview");
  await expect(dlg.getByTestId("roll-results")).toHaveAttribute("aria-busy", "true");
  await expect(status).toContainText("Preview updated at", { timeout: 60_000 });
  await expect(dlg.getByTestId("roll-results")).not.toHaveAttribute("aria-busy", "true");
}

/**
 * The owner's scenario (3 Nov 2026), from synthetic data: 1,206 visits in the source week, 1,204 of them already in the
 * destination week and 2 still to roll forward. Preview must work the plan out again for whatever is chosen, show it
 * is working, keep the dialog and the choices, show the whole destination rota, and never change the rota itself.
 */
test.describe("Roll Forward preview", () => {
  test.describe.configure({ timeout: 300_000 });

  test("recalculates for every choice, shows the whole destination week and saves only the reviewed plan", async ({ page }) => {
    const sc = fixture() as { demoWeek: string; sourceWeek: string; targetWeek: string; source: number; existing: number; create: number; skipped: number };
    expect(sc).toMatchObject({ source: 1206, existing: 1204, create: 2 });
    const before = fixture("snapshot", sc.targetWeek) as Snap;
    expect(before.count).toBe(1204);

    await page.setViewportSize({ width: 1672, height: 941 });
    await signIn(page);
    // Give the server's answer a moment, so the "working" state is always there to see (and to test).
    await page.route(/\/rota\/build\?/, async (route) => {
      if (route.request().headers()["rsc"]) await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });
    await page.goto(`/rota/build?roll=1&from=${sc.sourceWeek}&to=${sc.targetWeek}&weeks=1`);
    const dlg = page.getByRole("dialog", { name: "Roll Forward Rota" });
    await expect(dlg).toBeVisible();
    await expect(figure(dlg, "Visits to create")).toHaveText("2");
    await expect(figure(dlg, "Already in place")).toHaveText("1,204");
    await expect(dlg.getByTestId("roll-sentence")).toContainText(`Copying 1,206 visits from ${dmy(sc.sourceWeek)}`);
    // The whole destination week: every visit already there plus the new ones, labelled.
    await expect(dlg.getByTestId("roll-week-total")).toContainText("1,206 visits in the rota after saving (1,204 already exist, 2 new)");
    const table = dlg.getByTestId("roll-destination");
    await expect(table.locator('tbody tr[data-kind="EXISTING"]')).toHaveCount(1204);
    await expect(table.locator('tbody tr[data-kind="NEW"]')).toHaveCount(2);
    for (const label of ["Already exists", "New visit", "Carer retained", "Needs review", "Uncovered", "Skipped"]) await expect(table.getByRole("button", { name: new RegExp(`^${label}`) })).toBeVisible();
    await table.getByRole("button", { name: /^New visit/ }).click();
    await expect(table.locator("tbody tr[data-kind]")).toHaveCount(2);
    await table.getByRole("button", { name: /^Whole rota/ }).click();
    await page.screenshot({ path: `${SHOTS}/roll-forward-1-week.png` });

    // Daily view: one day of the week at a time.
    await table.getByRole("group", { name: "View" }).getByRole("button", { name: "Daily view" }).click();
    const wed = addDays(sc.targetWeek, 2);
    await table.getByRole("group", { name: "Day" }).getByRole("button", { name: new RegExp(`^${new Date(`${wed}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}`) }).click();
    const dayRows = table.locator("tbody tr[data-kind]");
    expect(await dayRows.count()).toBeGreaterThan(0);
    expect(await dayRows.count()).toBeLessThan(1206);
    await expect(table.locator("tbody th[scope=colgroup]")).toHaveCount(1);
    await expect(table.locator("tbody th[scope=colgroup]")).toContainText(new Date(`${wed}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }));
    await table.getByRole("group", { name: "View" }).getByRole("button", { name: "Weekly view" }).click();
    await expect(table.locator("tbody th[scope=colgroup]")).toHaveCount(7);

    // Weeks and areas are under More options; 1 week → 2 weeks gives new dates and counts, and the dialog stays open.
    await dlg.getByText("More options").click();
    await dlg.getByText("2 weeks", { exact: true }).click();
    await expect(dlg.getByTestId("roll-status")).toContainText("Press Preview Rota");
    await expect(dlg.getByRole("button", { name: "Save as Draft" })).toBeDisabled();
    await preview(dlg);
    await expect(page).toHaveURL(/weeks=2/);
    await expect(dlg.getByRole("radio", { name: "2 weeks" })).toBeChecked();
    await expect(dlg.getByTestId("roll-sentence")).toContainText(`into ${dmy(sc.targetWeek)}, ${dmy(addDays(sc.targetWeek, 7))}`);
    await expect(figure(dlg, "Visits to create")).toHaveText((1206 + 2 - sc.skipped).toLocaleString("en-GB"));
    await expect(dlg.getByRole("group", { name: "Destination week" }).getByRole("button")).toHaveCount(2);
    await page.screenshot({ path: `${SHOTS}/roll-forward-2-weeks.png` });

    // Destination week: one week later is empty, so all 1,206 are new and nothing is in place.
    await dlg.getByText("1 week", { exact: true }).click();
    await dlg.getByLabel("Copy Rota To (week starting)").fill(addDays(sc.targetWeek, 7));
    await preview(dlg);
    await expect(figure(dlg, "Already in place")).toHaveText("0");
    await expect(dlg.getByTestId("roll-week-total")).toContainText(`${dmy(addDays(sc.targetWeek, 7))} – `);
    await expect(dlg.getByLabel("Copy Rota To (week starting)")).toHaveValue(addDays(sc.targetWeek, 7));
    await dlg.getByLabel("Copy Rota To (week starting)").fill(sc.targetWeek);
    await preview(dlg);
    await expect(figure(dlg, "Already in place")).toHaveText("1,204");

    // Source week: copy from the demo's next week instead; the target moves to the week after it, and the source count and the
    // previous-carers column follow the new source.
    const thisWeek = sc.demoWeek;
    await dlg.getByLabel("Copy Rota From").selectOption(thisWeek);
    await expect(dlg.getByLabel("Copy Rota To (week starting)")).toHaveValue(addDays(thisWeek, 7));
    await dlg.getByLabel("Copy Rota To (week starting)").fill(sc.targetWeek);
    await preview(dlg);
    await expect(dlg.getByTestId("roll-sentence")).toContainText(`from ${dmy(thisWeek)} into ${dmy(sc.targetWeek)}`);
    await expect(dlg.getByTestId("roll-sentence")).not.toContainText("Copying 1,206 visits");
    await expect(table.getByRole("columnheader", { name: `Previous carers (${dmy(thisWeek)})` })).toBeVisible();
    await dlg.getByLabel("Copy Rota From").selectOption(sc.sourceWeek);
    await expect(dlg.getByLabel("Copy Rota To (week starting)")).toHaveValue(sc.targetWeek);
    await preview(dlg);

    // Areas: ticking one area narrows both the visits copied and the destination rota.
    const area = dlg.getByRole("group", { name: /^Areas/ }).getByRole("checkbox").first();
    await area.check();
    await preview(dlg);
    await expect(page).toHaveURL(/areas=/);
    await expect(area).toBeChecked();
    const inArea = Number((await figure(dlg, "Already in place").innerText()).replace(/,/g, ""));
    expect(inArea).toBeGreaterThan(0);
    expect(inArea).toBeLessThan(1204);
    await expect(dlg.getByTestId("roll-week-total")).toContainText(`${inArea.toLocaleString("en-GB")} already exist`);
    await area.uncheck();
    await preview(dlg);
    await expect(figure(dlg, "Already in place")).toHaveText("1,204");

    // Pressing Preview again and again keeps working.
    for (let i = 0; i < 3; i++) await preview(dlg);
    await expect(figure(dlg, "Visits to create")).toHaveText("2");

    // Previews never touched the rota.
    expect((fixture("snapshot", sc.targetWeek) as Snap).digest).toBe(before.digest);
    expect((fixture("snapshot", addDays(sc.targetWeek, 7)) as Snap).count).toBe(0);

    // Save acts only on the preview on screen: a change to the rota after it was worked out stops the save.
    fixture("add", sc.sourceWeek);
    await expect(dlg.getByTestId("roll-save-note")).toContainText("Saves the 2 new visits");
    await dlg.getByRole("button", { name: "Save as Draft" }).click();
    await expect(page.getByText("The rota has changed since this preview was worked out")).toBeVisible();
    expect((fixture("snapshot", sc.targetWeek) as Snap).digest).toBe(before.digest);
    // The page comes back with the latest plan: now 3 new visits.
    const again = page.getByRole("dialog", { name: "Roll Forward Rota" });
    await expect(figure(again, "Visits to create")).toHaveText("3");
    await expect(again.getByTestId("roll-save-note")).toContainText("Saves the 3 new visits");
    await again.getByRole("button", { name: "Save as Draft" }).click();
    // Saved: the dialog stays open on the next week, ready to roll forward again.
    await expect(again.getByRole("heading", { name: "Saved as draft" })).toBeVisible();
    await expect(again.getByText(/Rolled forward into 1 week: 3 visits saved as drafts/)).toBeVisible();
    await expect(again.getByLabel("Copy Rota From")).toHaveValue(sc.targetWeek);
    await expect(again.getByLabel("Copy Rota To (week starting)")).toHaveValue(addDays(sc.targetWeek, 7));
    await page.screenshot({ path: `${SHOTS}/roll-forward-saved.png` });

    // The 1,204 visits already there are exactly as they were; 3 were added and nothing is duplicated.
    const after = fixture("snapshot", sc.targetWeek) as Snap;
    expect(after.count).toBe(1207);
    expect(after.duplicates).toBe(0);
    expect(before.ids.every((id) => after.ids.includes(id))).toBe(true);

    // Roll Forward Next Week: the week just saved is copied into the (empty) week after it, and saved as a draft.
    await again.getByRole("button", { name: "Roll Forward Next Week" }).click();
    await expect(again.getByTestId("roll-status")).toContainText("Preview updated at", { timeout: 60_000 });
    await expect(again.getByTestId("roll-sentence")).toContainText(`Copying 1,207 visits from ${dmy(sc.targetWeek)} into ${dmy(addDays(sc.targetWeek, 7))}`);
    await expect(figure(again, "Already in place")).toHaveText("0");
    await again.getByRole("button", { name: "Save as Draft" }).click();
    await expect(again.getByRole("heading", { name: "Saved as draft" })).toBeVisible({ timeout: 60_000 });
    await expect(again.getByLabel("Copy Rota From")).toHaveValue(addDays(sc.targetWeek, 7));
    const next = fixture("snapshot", addDays(sc.targetWeek, 7)) as Snap;
    expect(next.duplicates).toBe(0);
    expect((fixture("snapshot", sc.targetWeek) as Snap).count).toBe(1207);

    // Running the first week again adds nothing.
    await page.goto(`/rota/build?roll=1&from=${sc.sourceWeek}&to=${sc.targetWeek}&weeks=1`);
    await expect(page.getByRole("dialog", { name: "Roll Forward Rota" }).getByText(/Every visit already exists in the new weeks/)).toBeVisible();
  });
});
