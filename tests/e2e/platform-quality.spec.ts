import { expect, test, type Page } from "@playwright/test";

/**
 * Platform quality build (1 Nov 2026). The Rota Dashboard and Daily Rota are visually locked: their headings, table
 * columns and controls must match the approved screens exactly. The other checks cover the usability changes.
 */
const PASSWORD = "DemoPassword!2026";

async function signIn(page: Page, email = "manager@care-solution.demo") {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

async function structure(page: Page) {
  return page.evaluate(() => ({
    headings: [...document.querySelectorAll("main h1, main h2")].map((h) => h.textContent?.trim()),
    columns: [...document.querySelectorAll("main thead th")].map((h) => h.textContent?.trim()),
  }));
}

test.describe("protected Rota screens keep their approved structure", () => {
  test.use({ viewport: { width: 1672, height: 941 } });

  test("Rota Dashboard", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota");
    await page.waitForLoadState("networkidle");
    expect(await structure(page)).toEqual({
      // The "Coming up" panel (PR #48) was removed at the owner's request on 1 Nov 2026: the cards sit under the header.
      headings: ["Rota Dashboard", "All Service Users", "All Team Members", "All Active Reminders", "Service User Upcoming Birthdays", "Team Member Upcoming Birthdays", "Quick Actions"],
      columns: ["Actions", "Forename", "Surname", "DOB", "Next Visit", "Actions", "Forename", "Surname", "Role", "Status", "Reminder", "Due", "Account", "Type", "Overdue", "Team Member", "DOB", "Turns", "Birthday"],
    });
  });

  test("Daily Rota", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/visits");
    await page.waitForLoadState("networkidle");
    expect(await structure(page)).toEqual({
      headings: ["Daily Rota – Live View"],
      columns: ["", "Ref", "Date", "Status", "Service User", "Time", "Duration", "Carers", "Service Call", "Team Member", "Alerts", "Notes", "Week", "Calendar week", "Visit checklist"],
    });
  });
});

test.describe("usability improvements", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("the overview lists today's care-delivery problems before policy paperwork", async ({ page }) => {
    await signIn(page);
    await page.goto("/overview");
    const rows = page.getByTestId("needs-attention").locator("li");
    const texts = await rows.allTextContents();
    const firstPolicy = texts.findIndex((t) => /Policy & Compliance/.test(t));
    const lastRota = texts.map((t) => /Rostering & Care Management/.test(t)).lastIndexOf(true);
    if (firstPolicy >= 0 && lastRota >= 0) expect(lastRota).toBeLessThan(firstPolicy);
  });

  test("a service user's overview shows the care plan, risks and incidents at a glance, with key contacts", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/service-users");
    await page.locator('main a[href^="/rota/service-users/c"]').first().click();
    await expect(page.getByTestId("care-at-a-glance")).toBeVisible();
    await expect(page.getByRole("link", { name: "Review care plan" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Key contacts" })).toBeVisible();
    // Demonstration organisation: its people are labelled as fictional.
    await expect(page.getByText(/Fictional demonstration person/)).toBeVisible();
    // The absence form is folded until needed.
    const absence = page.locator("details", { has: page.getByText("Record an absence") });
    await expect(absence.getByLabel("First day")).toBeHidden();
    await absence.getByText("Record an absence").click();
    await expect(absence.getByLabel("First day")).toBeVisible();
  });

  test("the care plan register shows read-by counts against the carers booked", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/care-plans");
    await expect(page.getByText(/booked in 14 days|No carers booked/).first()).toBeVisible();
  });

  test("the monitor explains that a missed call is no recorded attendance, not proof of absence", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/monitor");
    await page.getByText("What the words mean and how the monitor works").click();
    await expect(page.getByTestId("monitor-terms")).toContainText("does not prove the carer did not go");
  });

  test("finance shows the weekly steps and the next step for each week", async ({ page }) => {
    await signIn(page);
    await page.goto("/rota/finance");
    await expect(page.getByTestId("finance-steps")).toContainText("Approve");
    await expect(page.getByRole("columnheader", { name: "Next step" })).toBeVisible();
  });

  test("administration keeps technical pages in a folded Advanced group that opens on its own pages", async ({ page }) => {
    await signIn(page);
    await page.goto("/settings");
    const advanced = page.locator('button[data-nav-group="Advanced"]');
    await expect(advanced).toHaveAttribute("aria-expanded", "false");
    await advanced.click();
    await page.getByTestId("portal-pages").getByRole("link", { name: "Audit Log", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/audit/);
    await expect(page.locator('button[data-nav-group="Advanced"]')).toHaveAttribute("aria-expanded", "true");
  });
});
