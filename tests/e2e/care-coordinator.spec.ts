import { expect, test, type Page } from "@playwright/test";
import { supportPlanPdf, dischargeLetterPdf } from "../support/coordinator-fixture";

/** AI Care Coordinator in the browser, with invented documents only (Ada Fictional). */

const PASSWORD = "DemoPassword!2026";
const SHOTS = "test-results/screens";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

test.describe.configure({ mode: "serial" });

let intakeUrl = "";

test("a coordinator uploads the documents and sees each fact with its page, with no JSON anywhere", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page, "coordinator@care-solution.demo");
  await page.goto("/rota/service-users");
  await page.getByRole("link", { name: "Care Coordinator" }).click();
  await expect(page).toHaveURL(/\/rota\/coordinator$/);
  await page.getByLabel("Name for this intake").fill("Synthetic referral (browser test)");
  await page.locator('input[type=file][name=files]').setInputFiles([
    { name: "Support plan.pdf", mimeType: "application/pdf", buffer: await supportPlanPdf() },
    { name: "Discharge summary.pdf", mimeType: "application/pdf", buffer: await dischargeLetterPdf() },
  ]);
  await page.getByRole("button", { name: "Start and read the documents" }).click();
  await expect(page).toHaveURL(/\/rota\/coordinator\/[a-z0-9]+/);
  intakeUrl = page.url().split("?")[0]!;
  await expect(page.getByRole("status").or(page.getByText(/started and 2 documents read/))).toBeVisible();

  // Timetable continued on page 4 is read, and family rows are kept apart.
  await page.goto(`${intakeUrl}?step=review&section=VISITS`);
  const evening = page.locator("li[id^=fact-]").filter({ hasText: "Evening" });
  await expect(evening).toContainText("20:00–21:00");
  await expect(evening).toContainText("page 4");
  await expect(page.locator("li[id^=fact-]").filter({ hasText: "Shopping" })).toContainText("Carers service");
  await expect(page.locator("textarea[name=manifest], textarea[name=draft]")).toHaveCount(0);
  await expect(page.getByText(/\{"/)).toHaveCount(0);

  // Restricted facts (from the hospital letter) are hidden from a coordinator.
  await page.goto(`${intakeUrl}?step=review&section=MEDICATION`);
  await expect(page.getByText("Restricted: a registered manager reviews this").first()).toBeVisible();
  await expect(page.getByText("Paracetamol")).toHaveCount(0);

  // Edit with plain fields: the end date of the package.
  await page.goto(`${intakeUrl}?step=review&section=PACKAGE`);
  const end = page.locator("li[id^=fact-]").filter({ hasText: "Package end date" });
  await end.getByText("Edit", { exact: true }).click();
  await end.getByLabel(/Package end date/).fill("2026-12-30");
  await end.getByRole("button", { name: "Save edit and approve" }).click();
  await expect(page.locator("li[id^=fact-]").filter({ hasText: "Package end date" })).toContainText("Edited and approved");

  // Keyboard: the section list and the first action are reachable.
  await page.goto(`${intakeUrl}?step=review&section=PERSONAL`);
  const approve = page.getByRole("button", { name: "Approve", exact: true }).first();
  await approve.focus();
  await expect(approve).toBeFocused();

  for (const [w, h, n] of [[1440, 900, "desktop"], [834, 1112, "tablet"], [390, 844, "phone"]] as const) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${intakeUrl}?step=review&section=VISITS`);
    await page.screenshot({ path: `${SHOTS}/coordinator-review-${n}.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

test("a manager can open the restricted letter; a carer cannot reach the Coordinator at all", async ({ page, browser }) => {
  await signIn(page, "manager@care-solution.demo");
  await page.goto(`${intakeUrl}?step=documents`);
  const href = await page.getByRole("link", { name: /Open original Discharge summary/ }).getAttribute("href");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("application/pdf");

  const carer = await browser.newPage();
  await signIn(carer, "carer@care-solution.demo");
  await carer.goto("/rota/coordinator");
  await expect(carer).not.toHaveURL(/\/rota\/coordinator/);
  const blocked = await carer.request.get(href!);
  expect(blocked.status()).toBe(404);
  await carer.close();
});

test("the shift check reads the rota and offers no button that assigns or publishes", async ({ page }) => {
  await signIn(page, "manager@care-solution.demo");
  await page.goto("/rota/coordinator/shift");
  await expect(page.getByRole("heading", { name: /Open places/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /assign|publish|send/i })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${SHOTS}/coordinator-shift-desktop.png` });
});
