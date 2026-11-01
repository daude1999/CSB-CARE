import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

/** Find Cover in the browser: open from the register and from a case, keep filters on close, search staff, review the checks, confirm, and see the visit on the Daily Rota. */
const PASSWORD = "DemoPassword!2026";
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/csb_e2e?schema=public";
type Made = { caseId: string; visitId: string; reference: string };
let made: { single: Made; double: Made };

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

const range = () => {
  const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const from = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  return `period=custom&from=${from}&to=${to}`;
};

test.beforeAll(() => {
  const out = execSync("npx tsx tests/e2e/fixtures/missed-call.ts", { env: { ...process.env, DATABASE_URL, LOG_LEVEL: "warn" } }).toString();
  made = JSON.parse(out.slice(out.indexOf("{")));
});

test("Find Cover opens from the register and closes back to the same filters", async ({ page }) => {
  await signIn(page, "coordinator@care-solution.demo");
  await page.goto(`/rota/missed?${range()}&q=${made.single.reference}`);
  await page.getByRole("link", { name: `Find Cover for ${made.single.reference}` }).first().click();
  const panel = page.getByRole("dialog", { name: "Find Replacement Cover" });
  await expect(panel).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`cover=${made.single.caseId}`));
  await expect(panel.getByText("Find an eligible care worker for this visit.")).toBeVisible();
  await expect(panel.getByRole("region", { name: "The missed visit" })).toContainText(made.single.reference);
  const recs = panel.getByRole("list", { name: "Recommended carers" }).getByRole("radio");
  expect(await recs.count()).toBeLessThanOrEqual(3);

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).not.toHaveURL(/cover=/);
  await expect(page).toHaveURL(new RegExp(`q=${made.single.reference}`));
  await expect(page).toHaveURL(/period=custom/);

  // The close button does the same.
  await page.getByRole("link", { name: `Find Cover for ${made.single.reference}` }).first().click();
  await expect(panel).toBeVisible();
  await panel.getByRole("link", { name: "Close Find Cover" }).click();
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`q=${made.single.reference}`));
});

test("Search staff by hand: carers who fail a rule cannot be chosen", async ({ page }) => {
  await signIn(page, "coordinator@care-solution.demo");
  await page.goto(`/rota/missed?${range()}&cover=${made.single.caseId}&fcStep=manual`);
  const panel = page.getByRole("dialog", { name: "Find Replacement Cover" });
  await expect(panel.getByRole("heading", { name: "Search staff" })).toBeVisible();
  const staff = panel.getByRole("list", { name: "Staff" });
  await expect(staff.getByRole("radio").first()).toBeVisible();
  // The carer booked on the missed visit is listed but cannot be picked.
  await expect(staff.getByText(/Booked on the missed visit/).first()).toBeVisible();
  const disabled = await staff.getByRole("radio", { disabled: true }).count();
  expect(disabled).toBeGreaterThan(0);
});

test("Find Cover from a case: review the checks, confirm, and the recovery visit is on the Daily Rota", async ({ page }) => {
  await signIn(page, "coordinator@care-solution.demo");
  await page.goto(`/rota/missed/${made.double.caseId}`);
  await page.getByRole("link", { name: "Find Cover" }).first().click();
  const panel = page.getByRole("dialog", { name: "Find Replacement Cover" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("region", { name: "The missed visit" })).toContainText("2 still to cover");
  // Choose the recovery time: tomorrow at 03:00, clear of the demo rota's day visits whatever time the suite runs.
  const tomorrow = new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  await panel.getByLabel("Date").fill(tomorrow);
  await panel.getByLabel("Start time").fill("03:00");
  await panel.getByRole("button", { name: "Update carers" }).click();
  await expect(page).toHaveURL(/fcTime=03%3A00/);

  for (const slot of [1, 2]) {
    await panel.getByRole("list", { name: "Recommended carers" }).getByRole("radio").first().check();
    await panel.getByRole("button", { name: "Review Cover" }).click();
    await expect(panel.getByRole("heading", { name: "Review Replacement Cover" })).toBeVisible();
    await expect(panel.getByRole("list", { name: "Safety checks" })).toContainText("Rota clashes");
    for (const box of await panel.getByRole("checkbox").all()) await box.check();
    const reason = panel.getByLabel("Why this carer is right despite the warnings");
    if (await reason.count()) await reason.fill("Reviewed with the family by phone");
    await panel.getByRole("button", { name: "Confirm Cover" }).click();
    await expect(panel.getByRole("heading", { name: slot === 1 ? "Cover partly booked" : "Cover booked" })).toBeVisible();
    if (slot === 1) await panel.getByRole("link", { name: "Find the second carer" }).click();
  }
  await expect(panel.getByRole("list", { name: "Cover progress" })).toContainText("Investigation signed off: Not yet");
  const ref = ((await panel.getByRole("link", { name: /^V-\d{6}-/ }).first().textContent()) ?? "").trim();
  expect(ref).not.toBe("");
  await panel.getByRole("link", { name: "Open the Daily Rota" }).click();
  await expect(page.getByLabel(`Select ${ref}`)).toBeVisible();

  // The missed visit is still missed and the case is still open.
  await page.goto(`/rota/missed/${made.double.caseId}`);
  await expect(page.getByText("Cover booked through Find Cover").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "View cover booked" }).first()).toBeVisible();
});
