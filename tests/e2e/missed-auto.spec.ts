import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

/**
 * Automated missed call investigation in the browser: the coordinator sees the evidence, the carer answers on a phone,
 * the coordinator refreshes and accepts the suggested reason, and the queue panel shows the summary. The automation is
 * switched off again afterwards so the other browser tests see the default.
 */
const PASSWORD = "DemoPassword!2026";
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/csb_e2e?schema=public";
let made: { caseId: string; reference: string; confirmationId: string; start: string };

const fixture = (arg: string) => {
  const out = execSync(`npx tsx tests/e2e/fixtures/missed-auto.ts ${arg}`, { env: { ...process.env, DATABASE_URL, LOG_LEVEL: "warn" } }).toString();
  return JSON.parse(out.slice(out.indexOf("{")));
};

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

const hhmm = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

test.describe.configure({ mode: "serial" });
test.beforeAll(() => { made = fixture("on"); });
test.afterAll(() => { fixture("off"); });

test("the case shows the evidence collected and that the carer has been asked", async ({ page }) => {
  await signIn(page, "coordinator@care-solution.demo");
  await page.goto(`/rota/missed/${made.caseId}`);
  const auto = page.getByTestId("automated-investigation");
  await expect(auto.getByRole("heading", { name: "Automated investigation" })).toBeVisible();
  await expect(auto.getByRole("list", { name: "Carer confirmation" })).toContainText(/Asked/);
  await expect(auto.getByRole("list", { name: "Investigation timeline" })).toContainText(/Marked missed/i);
  await expect(page.getByTestId("auto-suggestion")).toContainText("Waiting for the carer's explanation");
  // Nothing is decided for the coordinator: the investigation steps are still open.
  await expect(page.locator("#step-1")).toBeVisible();
});

test("the carer answers on a phone in two steps", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "carer@care-solution.demo");
  await page.goto("/carer");
  const card = page.getByTestId("carer-missed-card").first();
  await expect(card).toBeVisible();
  await card.getByRole("link", { name: /Tell us what happened/ }).click();
  await expect(page).toHaveURL(new RegExp(`/carer/missed/${made.confirmationId}`));
  await page.getByRole("list", { name: "Choose what happened" }).getByRole("link").first().click();
  const start = new Date(made.start);
  await page.getByLabel("Time you arrived").fill(hhmm(new Date(start.getTime() + 3 * 60_000)));
  await page.getByLabel("Time you left").fill(hhmm(new Date(start.getTime() + 25 * 60_000)));
  await page.getByRole("radio").first().check();
  await page.getByRole("button", { name: "Submit confirmation" }).click();
  await expect(page.getByText(/Thank you\. Your statement has been recorded/)).toBeVisible();
  // The card on the home screen goes once the carer has answered.
  await page.goto("/carer");
  await expect(page.getByTestId("carer-missed-card")).toHaveCount(0);
});

test("the coordinator refreshes the evidence and accepts the suggested reason", async ({ page }) => {
  await signIn(page, "coordinator@care-solution.demo");
  await page.goto(`/rota/missed/${made.caseId}`);
  const auto = page.getByTestId("automated-investigation");
  await auto.getByRole("button", { name: "Refresh evidence" }).click();
  const suggestion = page.getByTestId("auto-suggestion");
  await expect(suggestion).toContainText("Possible visit delivered without clock-in");
  await expect(suggestion).toContainText("Visit delivered but not clocked");
  await expect(auto).toContainText("Not verified");
  await suggestion.getByLabel("Your findings (needed to accept)").fill("Spoke to the carer and the family, who confirmed the visit took place.");
  await suggestion.getByRole("button", { name: "Accept suggested reason" }).click();
  await expect(page.getByTestId("auto-suggestion")).toContainText(/Accepted by/);
});

test("Visits Needing Attention shows the automatic summary for the case", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 941 });
  await signIn(page, "coordinator@care-solution.demo");
  await page.goto(`/rota/attention?item=${encodeURIComponent(`missed:${made.caseId}`)}`);
  const block = page.getByTestId("attention-auto");
  await expect(block).toBeVisible();
  await expect(block).toContainText("Carer confirmation");
  await expect(block).toContainText("Possible visit delivered without clock-in");
  await block.getByRole("link", { name: `View the automated investigation for ${made.reference}` }).click();
  await expect(page).toHaveURL(new RegExp(`/rota/missed/${made.caseId}`));
});

test("an organisation admin sees the three switches in Rostering settings", async ({ page }) => {
  await signIn(page, "manager@care-solution.demo");
  await page.goto("/rota/settings#missed-automation");
  await expect(page.getByLabel("1. Collect evidence and build a timeline for each missed call")).toBeChecked();
  await expect(page.getByLabel("2. Ask booked carers with a sign-in what happened (in the app only)")).toBeChecked();
  await expect(page.getByLabel("3. Suggest a reason for the coordinator to accept or reject")).toBeChecked();
  await expect(page.getByLabel("Minutes a carer has to answer")).toHaveValue("60");
});
