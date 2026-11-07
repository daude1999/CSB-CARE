import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Set up from support plan (4 Nov 2026): upload, check and correct, confirm. The e2e database runs the simulated AI
 * provider, which cannot read documents, so the form opens empty and the test types the plan in, as the office would.
 * Synthetic person only. Screenshots go to test-results/su-import.
 */
const PASSWORD = "DemoPassword!2026";
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const OUT = "test-results/su-import";

async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

async function fillVisit(page: Page, n: number, v: { start: string; minutes: string; tasks: string; days?: string[]; funded?: string; medication?: boolean; until?: string }) {
  const row = page.getByTestId("import-visit").nth(n);
  await row.getByLabel("Start").fill(v.start);
  await row.getByLabel("Minutes").fill(v.minutes);
  await row.getByLabel("Tasks").fill(v.tasks);
  if (v.days) {
    for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      const box = row.getByRole("group", { name: `Visit ${n + 1} days` }).getByLabel(d);
      if ((await box.isChecked()) !== v.days.includes(d)) await box.click({ force: true });
    }
  }
  if (v.funded) await row.getByLabel("Funded by").selectOption({ label: v.funded });
  if (v.medication) await row.getByLabel("Medication prompt").check();
  if (v.until) await row.getByLabel("Until (if temporary)").fill(v.until);
}

test.describe("Set up from support plan", () => {
  test("a manager uploads, checks, corrects and confirms, and the person appears with their visits", async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width: 1672, height: 941 });
    await signIn(page);
    // Uploads now start in the Care Coordinator; the quick form is still reachable for typing a plan in.
    await page.goto("/rota/service-users");
    await expect(page.getByRole("link", { name: "Upload support plan" })).toHaveAttribute("href", /\/rota\/coordinator\?mode=NEW/);
    await page.goto("/rota/service-users/import");
    await expect(page.getByRole("heading", { name: "Set up from support plan" })).toBeVisible();
    await page.screenshot({ path: `${OUT}/1-upload-1672.png` });

    // Nothing chosen yet: a clear message, no request.
    await page.getByRole("button", { name: /Read the plan|Continue/ }).click();
    await expect(page.getByTestId("import-error")).toContainText("Choose the council support plan");

    await page.getByLabel("Files").setInputFiles([
      { name: "Example Council support plan.pdf", mimeType: "application/pdf", buffer: PDF },
      { name: "Hospital discharge letter.pdf", mimeType: "application/pdf", buffer: PDF },
    ]);
    await page.getByRole("button", { name: /Read the plan|Continue/ }).click();
    await expect(page.getByRole("heading", { name: "2. Check and correct" })).toBeVisible();

    // Person
    await page.getByLabel("First name").fill("Imogen");
    await page.getByLabel("Last name").fill("Synthetic");
    await page.getByLabel("Date of birth").fill("1944-01-01");
    await page.getByLabel("Gender").fill("Female");
    await page.getByLabel("First language").fill("Somali");
    await page.getByLabel("Council reference").fill("1000001");
    await page.getByLabel("Address", { exact: true }).fill("Flat 1 Example House");
    await page.getByLabel("Address line 2").fill("Example Street");
    await page.getByLabel("Town").fill("London");
    await page.getByLabel("Postcode").fill("E1 1AA");
    await page.getByLabel("Phone", { exact: true }).fill("07000 000000");
    await page.getByLabel("Access notes for carers").fill("Ground floor, lift. Can open the door herself. Lives with her granddaughter.");
    await page.getByLabel("Carer preference").selectOption("FEMALE");

    // Contacts
    await page.getByRole("button", { name: "Add contact" }).click();
    await page.getByRole("button", { name: "Add contact" }).click();
    const c1 = page.getByRole("group", { name: "Contact 1" });
    await c1.getByLabel("Type").selectOption("NEXT_OF_KIN");
    await c1.getByLabel("Name").fill("Nadia Synthetic");
    await c1.getByLabel("Relationship").fill("Daughter");
    await c1.getByLabel("Phone", { exact: true }).fill("0200 000 0000");
    await c1.getByLabel("Key holder").check();
    await c1.getByLabel("Main contact").check();
    const c2 = page.getByRole("group", { name: "Contact 2" });
    await c2.getByLabel("Type").selectOption("OTHER");
    await c2.getByLabel("Name").fill("Sam Synthetic");
    await c2.getByLabel("Relationship").fill("Friend");
    await c2.getByLabel("Emergency contact").check();

    // Package
    await page.getByLabel("Funder").fill("Example Council");
    await page.getByLabel("Commissioned minutes a week").fill("1365");
    await page.getByLabel("Package start").fill("2026-09-30");
    await page.getByLabel("Requirements and conditions").fill("All visits single handed.");

    // Timetable: six rows as the council writes them.
    for (let i = 0; i < 6; i++) await page.getByRole("button", { name: "Add visit" }).click();
    await fillVisit(page, 0, { start: "09:00", minutes: "60", tasks: "Transfers, toileting, personal care, dressing, washing, meal preparation, prompt with medication, support with feeding.", medication: true });
    await fillVisit(page, 1, { start: "12:00", minutes: "45", tasks: "Meal preparation, feeding when required, continence care, prompt with medication if required.", medication: true });
    await fillVisit(page, 2, { start: "16:30", minutes: "30", tasks: "NEW SERVICE: teatime meal, drinks, personal and continence care, prompt with medication as required. Monitor welfare.", medication: true, until: "2026-11-10" });
    await fillVisit(page, 3, { start: "20:00", minutes: "60", tasks: "Meal preparation, continence and personal care, bedtime routine, safe mobility with walking aid, nightwear, oral hygiene." });
    await fillVisit(page, 4, { start: "11:00", minutes: "60", tasks: "Food shopping; store groceries safely.", days: ["Wed"], funded: "Carers service" });
    await fillVisit(page, 5, { start: "12:45", minutes: "60", tasks: "Clean bedroom, kitchen, bathroom and hallway; laundry.", days: ["Mon"], funded: "Carers service" });
    await expect(page.getByText("Weekly total 24.75 h")).toBeVisible();
    await expect(page.getByText("Commissioned 22.75 h (matches)")).toBeVisible();

    // Documents: the discharge letter goes to Discharge Information (restricted).
    const docs = page.getByRole("group", { name: "Hospital discharge letter.pdf" });
    await docs.getByLabel("Category").selectOption("DISCHARGE_INFORMATION");
    await expect(docs.getByText("Restricted to managers")).toBeVisible();

    await page.screenshot({ path: `${OUT}/2-check-1672.png`, fullPage: true });

    // A wrong row is caught before the confirm step.
    await page.getByTestId("import-visit").nth(5).getByLabel("Start").fill("");
    await page.getByRole("button", { name: "Continue to confirm" }).click();
    await expect(page.getByTestId("import-error")).toContainText("Visit 6: give a start time");
    await page.getByTestId("import-visit").nth(5).getByLabel("Start").fill("12:45");
    await page.getByRole("button", { name: "Continue to confirm" }).click();

    await expect(page.getByRole("heading", { name: "3. Confirm" })).toBeVisible();
    const summary = page.getByTestId("import-summary");
    await expect(summary.locator("tbody tr")).toHaveCount(6);
    await expect(summary).toContainText("Carers service");
    await expect(summary.locator("tbody tr").nth(0)).toContainText("Morning call");
    await expect(summary.locator("tbody tr").nth(3)).toContainText("Bed call");
    await expect(summary).toContainText("2026-09-30 → 2026-11-10");
    await expect(page.getByText("Not created here, on purpose")).toBeVisible();
    await page.screenshot({ path: `${OUT}/3-confirm-1672.png`, fullPage: true });

    // Tablet and phone views of the confirm step.
    await page.setViewportSize({ width: 834, height: 1000 });
    await page.screenshot({ path: `${OUT}/4-confirm-834.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${OUT}/5-confirm-390.png` });
    await page.setViewportSize({ width: 1672, height: 941 });

    await page.getByRole("button", { name: "Confirm and set up" }).click();
    await expect(page).toHaveURL(/\/rota\/service-users\/[^/?]+\?ok=/);
    await expect(page.getByText(/set up: 2 contacts, 6 repeating visits and 2 documents/)).toBeVisible();
    await page.screenshot({ path: `${OUT}/6-person-visits-1672.png` });
    const base = page.url().split("?")[0]!;

    // The records are there: contacts, package, documents and the repeating visits.
    await page.goto(`${base}?tab=people`);
    await expect(page.getByText("Nadia Synthetic").first()).toBeVisible();
    await expect(page.getByText("Sam Synthetic").first()).toBeVisible();
    await page.goto(`${base}?tab=package`);
    await expect(page.getByTestId("package-details").getByText("22.75 hours/week", { exact: true })).toBeVisible();
    await page.goto(`${base}?tab=documents`);
    await expect(page.getByText("Example Council support plan", { exact: false }).first()).toBeVisible();
    await page.goto("/rota/templates?q=Synthetic");
    await page.screenshot({ path: `${OUT}/7-templates-1672.png` });

    // Build Rota previews the imported visits for next week.
    await page.goto("/rota/build");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("a carer cannot open the import", async ({ page }) => {
    await signIn(page, "carer@care-solution.demo");
    const res = await page.goto("/rota/service-users/import");
    // Either a 404 or a redirect away from the rota portal; the screen itself never opens.
    expect(res?.status() === 404 || !page.url().includes("/rota/service-users/import")).toBe(true);
    await expect(page.getByRole("heading", { name: "Set up from support plan" })).toHaveCount(0);
  });

  test("the duplicate check stops a second record for the same person", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/service-users/import");
    await page.getByLabel("Files").setInputFiles([{ name: "plan.pdf", mimeType: "application/pdf", buffer: PDF }]);
    await page.getByRole("button", { name: /Read the plan|Continue/ }).click();
    await page.getByLabel("First name").fill("Imogen");
    await page.getByLabel("Last name").fill("Synthetic");
    await page.getByLabel("Postcode").fill("E1 1AA");
    await page.getByLabel("Package start").fill("2026-09-30");
    await page.getByRole("button", { name: "Add visit" }).click();
    await fillVisit(page, 0, { start: "09:00", minutes: "60", tasks: "Personal care" });
    await page.getByRole("button", { name: "Continue to confirm" }).click();
    await page.getByRole("button", { name: "Confirm and set up" }).click();
    await expect(page.getByTestId("import-error")).toContainText("already on record");
    await expect(page).toHaveURL(/\/rota\/service-users\/import/);
  });
});
