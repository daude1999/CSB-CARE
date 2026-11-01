import { expect, test, type Page } from "@playwright/test";

const PASSWORD = "DemoPassword!2026";
const SHOTS = "test-results/screens";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByTestId("current-user")).toBeVisible();
}

/** ISO date of the Monday `n` weeks after this week's Monday (UTC is fine for picking a week). */
function mondayWeeksAhead(n: number) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 7 * n);
  return d.toISOString().slice(0, 10);
}

test.describe("Rostering & Care Management", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("coordinator works the day: filters visits, assigns a carer, and sees the result", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    // The older ?from=&days= link still works (it becomes a custom range); the demo data leaves gaps a week ahead.
    await page.goto(`/rota/unassigned?from=${new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" })}&days=14`);
    await expect(page.getByRole("heading", { level: 1, name: "Unassigned Visits" })).toBeVisible();
    const find = page.getByRole("link", { name: /^Find cover for / }).first();
    test.skip((await find.count()) === 0, "No unassigned visits in the next two weeks of demo data");
    await find.click();
    await expect(page).toHaveURL(/cover=/);
    await expect(page.getByRole("region", { name: "Selected visit" })).toBeVisible();
    const options = page.locator('aside[aria-labelledby="fc-title"] a[aria-label^="Select "]');
    test.skip((await options.count()) === 0, "No eligible carer free in the demo data for the first visit");
    await options.first().click();
    await expect(page).toHaveURL(/pick=/);
    await page.getByRole("link", { name: "Review Assignment" }).click();
    await expect(page.getByRole("heading", { name: "Review Assignment" })).toBeVisible();
    const ack = page.getByLabel(/I have read these warnings/);
    if (await ack.count()) await ack.check();
    await page.getByRole("button", { name: "Confirm Assignment" }).click();
    await expect(page.getByRole("status")).toContainText("booked for");
    await page.goto("/rota/visits");
    await page.locator("summary", { hasText: "More Filters" }).click();
    await page.getByLabel("Show only").selectOption("unassigned");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(/view=unassigned/);
    await expect(page.getByRole("note")).toContainText("visits short of a carer");
  });

  test("bulk change reports each visit, and cancelling needs a reason", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/visits?layout=list");
    const boxes = page.locator("input[name=visitIds]");
    await boxes.nth(0).check();
    const bulk = page.locator("#bulk");
    const go = bulk.getByRole("button", { name: "Go" });
    await expect(bulk.getByTestId("bulk-selected")).toHaveText("1 selected");
    await bulk.locator("select[name=kind]").selectOption("cancel");
    await expect(go).toBeDisabled();
    // Cancelling asks whether to charge, then for a reason of at least 3 letters (the server checks both again).
    await expect(bulk.getByTestId("bulk-hint")).toContainText("Charge or Don't charge");
    await bulk.getByLabel("Don't charge").check();
    await expect(bulk.getByTestId("bulk-hint")).toContainText("Give a reason");
    await bulk.getByPlaceholder("Reason").fill("ab");
    await expect(go).toBeDisabled();
    await bulk.getByPlaceholder("Reason").fill("Family visiting");
    await expect(go).toBeEnabled();
  });

  test("bulk actions show the details each action needs, and Reassign and Lock work from the Daily Rota", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto(`/rota/visits?date=${mondayWeeksAhead(1)}`);
    const bulk = page.locator("#bulk");
    const go = bulk.getByRole("button", { name: "Go" });
    await expect(go).toBeDisabled();
    await expect(bulk.getByTestId("bulk-hint")).toContainText("Tick the visits");
    // Select all ticks the page, and the count follows.
    await page.getByLabel("Select all visits on this page").check();
    await expect(bulk.getByTestId("bulk-selected")).not.toHaveText("0 selected");
    await page.getByLabel("Select all visits on this page").uncheck();
    await expect(bulk.getByTestId("bulk-selected")).toHaveText("0 selected");

    // Reassign: the carer picker appears beside the action, and Go waits for it.
    await page.locator("input[name=visitIds]").nth(0).check();
    await bulk.locator("select[name=kind]").selectOption("assign");
    await expect(bulk.getByLabel("Carer", { exact: true })).toBeVisible();
    await expect(bulk.getByTestId("bulk-hint")).toHaveText("Choose a carer.");
    await expect(go).toBeDisabled();
    await bulk.getByLabel("Carer", { exact: true }).selectOption({ index: 1 });
    await bulk.getByLabel("Accept warnings").check();
    await expect(go).toBeEnabled();
    await go.click();
    // Each visit is checked by the eligibility service: the result is either an update or a reason it was refused.
    await expect(page.getByRole("status").or(page.getByRole("alert")).first()).toBeVisible();
    await expect(page).toHaveURL(/[?&](ok|error)=/);

    // Lock needs nothing else and reports the visits it changed.
    await page.locator("input[name=visitIds]").nth(1).check();
    await bulk.locator("select[name=kind]").selectOption("lock");
    await expect(bulk.getByLabel("Carer", { exact: true })).toHaveCount(0);
    await go.click();
    await expect(page.getByRole("status")).toContainText("1 updated");
  });

  test("Build Rota previews a future week with its checklist", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    // The demo seed already builds next week, so preview the week after.
    await page.goto(`/rota/build?week=${mondayWeeksAhead(2)}`);
    await expect(page.getByRole("dialog", { name: "Add New Rota" })).toBeVisible();
    await expect(page.getByLabel("Week Setting")).toBeVisible();
    await expect(page.getByRole("button", { name: "Build New Rota" })).toBeVisible();
    await page.getByRole("link", { name: "No, cancel for now" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "All Rotas" })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Yes", exact: true })).toBeVisible();
  });

  test("Roll Forward previews last week's carers against the new week, then saves drafts once", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    // Week 6 ahead is clear of the weeks other tests build.
    await page.goto(`/rota/build?roll=1&from=${mondayWeeksAhead(1)}&to=${mondayWeeksAhead(6)}&weeks=1`);
    const dialog = page.getByRole("dialog", { name: "Roll Forward Rota" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Roll forward summary")).toContainText("Visits to create");
    await expect(dialog.getByRole("heading", { name: "Previous rota and proposed rota" })).toBeVisible();
    await dialog.getByRole("button", { name: /^Save \d+ visits as drafts$/ }).click();
    await expect(page.getByRole("status")).toContainText("Rolled forward into 1 week");
    // Doing it again finds everything already in place.
    await page.goto(`/rota/build?roll=1&from=${mondayWeeksAhead(1)}&to=${mondayWeeksAhead(6)}&weeks=1`);
    await expect(page.getByRole("dialog", { name: "Roll Forward Rota" }).getByLabel("Roll forward summary")).toContainText(/Visits to create\s*0/);
  });

  test("Sickness & Holiday Cover lists bookings to cover and replaces a carer through the normal checks", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/cover");
    await expect(page.getByRole("heading", { level: 1, name: "Sickness & Holiday Cover" })).toBeVisible();
    const use = page.getByRole("button", { name: /^Replace with / }).first();
    if (await use.count()) {
      await use.click();
      await expect(page.getByRole("status")).toContainText("Carer assigned");
    } else {
      await expect(page.getByText("No absences or flagged bookings in these dates.")).toBeVisible();
    }
  });

  test("Generate & Optimise proposes changes that are only applied once accepted", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/visits");
    await page.locator("summary", { hasText: "Actions" }).last().click();
    await page.getByTestId("main-content").getByRole("link", { name: "Generate & Optimise" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Generate & Optimise Rota" })).toBeVisible();
    await page.locator("select[name=days]").selectOption("7");
    await page.getByRole("button", { name: "Generate plan" }).click();
    await expect(page).toHaveURL(/\/rota\/optimise\/c/);
    const summary = page.getByRole("region", { name: "Plan summary" });
    await expect(summary).toContainText("open carer slot");
    await expect(summary).toContainText("No distances or driving times are used");
    const acceptAll = page.getByRole("button", { name: "Accept all" });
    if (await acceptAll.isVisible()) {
      await acceptAll.click();
      await expect(page.getByRole("status")).toContainText("accepted");
      await page.getByRole("button", { name: /^Apply \d+ accepted change/ }).click();
      await expect(page.getByRole("status")).toContainText("applied");
      await expect(page.getByText("Carer booked").first()).toBeVisible();
    }
    await page.goto("/rota/optimise");
    await expect(page.getByRole("table")).toBeVisible();
  });

  test("Rota Insights shows the week's figures, links to the records, and money estimates for finance roles", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota");
    // Reports opens Rota Reports; Rota Insights is its second tab.
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Reports", exact: true }).click();
    await page.getByTestId("rota-tabs-reports").getByRole("link", { name: "Rota Insights" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Rota Insights" })).toBeVisible();
    for (const name of ["Visits", "Workforce", "Care hours", "Needs action", "Money this week (estimate)"]) await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    await expect(page.getByText("These are projections, not payroll or invoices.")).toBeVisible();
    await page.getByRole("region", { name: "Visits" }).getByRole("link").first().click();
    await expect(page).toHaveURL(/\/rota\/planner\?week=/);
    await page.context().clearCookies();
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/insights");
    await expect(page.getByRole("heading", { level: 2, name: "Money this week (estimate)" })).toHaveCount(0);
  });

  test("Rota Dashboard: call cards, people, reminders, issues, birthdays and quick actions, all from real records", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota");
    await expect(page.getByRole("heading", { level: 1, name: "Rota Dashboard" })).toBeVisible();
    for (const id of ["card-completed", "card-late", "card-missed"]) await expect(page.getByTestId(id)).toBeVisible();
    await expect(page.getByTestId("card-missed-meds").or(page.getByTestId("card-unassigned"))).toBeVisible();
    for (const name of ["All Service Users", "All Team Members", "All Active Reminders", "Service User Upcoming Birthdays", "Team Member Upcoming Birthdays", "Quick Actions"]) await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    // Percentages use the day's scheduled visits as the denominator, as the card says.
    await expect(page.getByTestId("card-completed")).toContainText(/\d+ of \d+ scheduled visits completed/);
    // No money on the operational dashboard.
    await expect(page.locator("main")).not.toContainText("£");
    // A service-user search narrows the table; pages of five.
    const su = page.getByRole("region", { name: "All Service Users" });
    await expect(su.locator("tbody tr")).toHaveCount(5);
    const first = (await su.locator("tbody tr").first().locator("td").nth(2).innerText()).trim();
    await su.getByLabel("Search service users").fill(first);
    await expect(su.locator("tbody tr").first()).toContainText(first);
    await su.getByRole("link", { name: /: record$/ }).first().click();
    await expect(page).toHaveURL(/\/rota\/service-users\//);
    await page.goBack();
    // Issue strip and quick actions open the real screens.
    await expect(page.getByTestId("issue-rota")).toHaveAttribute("href", /\/rota\/visits\?.*view=review/);
    await expect(page.getByTestId("issue-template")).toHaveAttribute("href", "/rota/templates/planner");
    await expect(page.getByTestId("issue-holidays")).toHaveAttribute("href", "/workforce/absences");
    const quick = page.getByRole("region", { name: "Quick Actions" });
    await expect(quick.getByRole("link", { name: "Build Rota" })).toHaveAttribute("href", /\/rota\/build\?week=/);
    await expect(quick.getByRole("link", { name: "Weekly Planner" })).toHaveAttribute("href", /\/rota\/planner\?week=/);
    await expect(quick.getByRole("link", { name: /Exceptions/ })).toHaveAttribute("href", "/rota/exceptions");
    // The date drives the page.
    await page.getByRole("link", { name: "Next day" }).click();
    await expect(page).toHaveURL(/date=/);
    // Reminders: View All lists the same records.
    await page.goto("/rota");
    await page.getByRole("link", { name: "View All" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Active Reminders" })).toBeVisible();
    // The old Today at a Glance address lands on the dashboard.
    await page.goto("/rota/today");
    await expect(page).toHaveURL(/\/rota$/);
  });

  test("Weekly Planner keeps the week roster with drag and drop, and a visit opens beside it", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/planner");
    await expect(page.getByRole("heading", { level: 1, name: "Weekly Planner" })).toBeVisible();
    const roster = page.getByRole("region", { name: "Week roster" });
    await expect(roster.getByRole("rowheader", { name: /Unassigned/ })).toBeVisible();
    await expect(roster.getByRole("list", { name: "Colour key" })).toContainText("Draft (not published)");
    await roster.locator("a[href*='visit=']").first().click();
    const panel = page.getByRole("complementary", { name: "Visit details" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("link", { name: "Open visit" })).toHaveAttribute("href", /\/rota\/visits\//);
    await panel.getByRole("link", { name: "Close visit details" }).click();
    await expect(panel).toHaveCount(0);
  });

  test("Daily Rota: a live list with no figure cards, the approved columns, and Visit Details only when a visit is chosen", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/visits");
    await expect(page.getByRole("heading", { level: 1, name: "Daily Rota – Live View" })).toBeVisible();
    await expect(page.getByRole("region", { name: "The day's figures" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Rota view" }).getByRole("link", { name: "List" })).toHaveAttribute("aria-current", "page");
    for (const label of ["Search visits by service user, carer or reference", "Area", "Status", "Service user", "Team member"]) await expect(page.getByRole("form", { name: "Filters" }).getByLabel(label, { exact: true })).toBeVisible();
    const table = page.getByRole("region", { name: "Visits" }).locator("table");
    for (const name of ["Ref", "Date", "Status", "Service User", "Time", "Duration", "Carers", "Service Call", "Team Member", "Alerts", "Notes", "Week", "Calendar week", "Visit checklist"]) await expect(table.getByRole("columnheader", { name, exact: true })).toBeVisible();
    // No details panel until a visit is chosen.
    await expect(page.getByRole("complementary", { name: "Visit Details" })).toHaveCount(0);
    // Coverage badges read filled/required; the calendar week is a number; Week is "Week n" or a dash.
    await expect(table.locator("tbody tr").first().locator("td").nth(7)).toHaveText(/^\d\/\d|—/);
    await expect(table.locator("tbody tr").first().locator("td").nth(13)).toHaveText(/^\d{1,2}$/);
    await expect(table.locator("tbody tr").first().locator("td").nth(12)).toHaveText(/^Week \d$|—/);
    // Choosing a visit opens the details beside the list, keeping the filters; it closes again.
    await page.getByRole("link", { name: /Open details of visit/ }).first().click();
    await expect(page).toHaveURL(/visit=/);
    const panel = page.getByRole("complementary", { name: "Visit Details" });
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/Ref: /);
    await expect(panel).toContainText(/Carers \(\d of \d\)/);
    await panel.getByRole("link", { name: "History" }).click();
    await expect(page).toHaveURL(/tab=history/);
    await page.getByRole("link", { name: "Close visit details" }).click();
    await expect(page.getByRole("complementary", { name: "Visit Details" })).toHaveCount(0);
    // Column settings add the less-used columns; sorting and Planner keep working.
    await page.locator("summary", { hasText: "Columns" }).click();
    await page.getByRole("checkbox", { name: "Clock in" }).check();
    await page.getByRole("button", { name: "Apply", exact: true }).last().click();
    await expect(page).toHaveURL(/cols=clockIn/);
    await expect(table.getByRole("columnheader", { name: "Clock in" })).toBeVisible();
    await table.getByRole("columnheader", { name: "Service User" }).getByRole("link").click();
    await expect(page).toHaveURL(/sort=su/);
    await page.getByRole("navigation", { name: "Rota view" }).getByRole("link", { name: "Planner" }).click();
    await expect(page).toHaveURL(/\/rota\/advanced\?date=/);
  });

  test("Daily Rota inspector: reassign and move go through the normal checks and come back to the same visit", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await page.goto(`/rota/visits?date=${tomorrow}&status=SCHEDULED`);
    await page.getByRole("link", { name: /Open details of visit/ }).first().click();
    const panel = page.getByRole("complementary", { name: "Visit Details" });
    const ref = (await panel.getByText(/^Ref: /).innerText()).trim();
    await panel.locator("summary", { hasText: "Edit Visit" }).click();
    const move = panel.locator("form:has(button:text-is('Save visit'))");
    await move.locator("input[name=start]").fill("06:05");
    await move.getByRole("button", { name: "Save visit" }).click();
    await expect(page.getByRole("status").or(page.getByRole("alert")).first()).toBeVisible();
    await expect(page).toHaveURL(/visit=/);
    await expect(page.getByRole("complementary", { name: "Visit Details" }).getByText(/^Ref: /)).toHaveText(ref);
    await page.getByRole("complementary", { name: "Visit Details" }).locator("summary", { hasText: "Reassign Carers" }).click();
    await expect(page.getByRole("complementary", { name: "Visit Details" }).locator("select[name=staffId]").first()).toBeVisible();
  });

  test("a carer cannot open the office rota or the monitor, and sees their own visits", async ({ page }) => {
    await signIn(page, "carer@care-solution.demo");
    await page.goto("/rota/visits");
    await expect(page.getByRole("heading", { level: 1, name: "Daily Rota" })).toHaveCount(0);
    await page.goto("/rota/monitor");
    await expect(page.getByRole("heading", { level: 1, name: "The Monitor" })).toHaveCount(0);
    await page.goto("/carer");
    await expect(page.getByRole("heading", { level: 1, name: "My Visits" })).toBeVisible();
    await expect(page.getByText(/Location and NFC checks are not used/)).toBeVisible();
  });

  test("the monitor checks calls on demand and reports when it last checked", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/monitor");
    await expect(page.getByRole("heading", { level: 1, name: "The Monitor" })).toBeVisible();
    await page.getByRole("button", { name: "Check now" }).click();
    await expect(page.getByRole("status")).toContainText(/Checked \d+ visits?/);
    await expect(page.getByText(/Last checked at/)).toBeVisible();
  });

  for (const [name, width] of [["desktop", 1440], ["tablet", 834], ["phone", 390]] as const) {
    test(`rota screens render at ${name} width without page overflow`, async ({ page }) => {
      // Sign in at desktop width (the signed-in check uses the sidebar, hidden on phones), then resize.
      await signIn(page, "manager@care-solution.demo");
      await page.setViewportSize({ width, height: 1000 });
      for (const path of ["/rota", "/rota/reminders", "/rota/activity", "/rota/search?q=ab", "/rota/advanced", "/rota/monitor", "/rota/visits", "/rota/visits?layout=timeline", "/rota/planner", "/rota/build", "/rota/build?roll=1", "/rota/cover", "/rota/optimise", "/rota/insights", "/rota/templates", "/rota/service-users", "/rota/staff", "/rota/care-plans", "/rota/risks", "/rota/incidents", "/rota/finance", "/rota/finance/rates", "/rota/finance/timesheets", "/rota/finance/payroll", "/rota/finance/invoices", "/rota/reports", "/rota/reports?report=carers"]) {
        await page.goto(path);
        await expect(page.locator("main h1").first()).toBeVisible();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(1);
        await page.screenshot({ path: `${SHOTS}/${name}${path.replaceAll(/[/?=]/g, "_")}.png`, fullPage: false });
      }
    });
  }

  test("care records: open a care plan from the register, then report an incident that a manager can see", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/care-plans");
    await page.locator("tbody tr", { hasNotText: "No plan in use" }).locator("a[href^='/rota/care-plans/']").first().click();
    await expect(page.getByRole("heading", { level: 2, name: /^Version \d+$/ }).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "About me" })).toBeVisible();

    await page.goto("/rota/incidents/new");
    await page.getByLabel("Category").selectOption("Fall");
    await page.getByLabel("How serious").selectOption("LOW");
    await page.getByLabel("What happened").fill("Browser test: slipped on a wet floor in the kitchen, no injury seen.");
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByRole("status")).toContainText(/Reported as INC-/);
    await expect(page.getByRole("heading", { level: 2, name: "Timeline" })).toBeVisible();
  });

  test("finance: whoever prepared a pay run cannot approve it; a second person approves and can download the CSV", async ({ page }) => {
    await signIn(page, "finance@care-solution.demo");
    await page.goto("/rota/finance/payroll");
    await page.locator("table a[href^='/rota/finance/payroll/']").first().click();
    await expect(page.getByText("You prepared this run, so someone else must approve it.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve run" })).toHaveCount(0);
    const runUrl = page.url();

    await page.context().clearCookies();
    await signIn(page, "manager@care-solution.demo");
    await page.goto(runUrl);
    await page.getByRole("button", { name: "Approve run" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    const csv = page.getByRole("link", { name: "Download CSV" });
    await expect(csv).toBeVisible();
    const res = await page.request.get((await csv.getAttribute("href"))!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
  });

  test("reports: switch report, change the dates, and download the CSV", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/reports");
    await expect(page.getByRole("heading", { level: 2, name: "Visit delivery by day" })).toBeVisible();
    await expect(page.locator("tfoot td").first()).toHaveText("Total");
    await page.getByRole("navigation", { name: "Reports" }).getByRole("link", { name: "Carer attendance" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Carer attendance" })).toBeVisible();
    await page.getByLabel("To", { exact: true }).fill("2020-01-01");
    await page.getByRole("button", { name: "Show report" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "The end date must be on or after the start date" })).toBeVisible();
    const res = await page.request.get((await page.getByRole("link", { name: "Download CSV" }).getAttribute("href"))!);
    expect(res.status()).toBe(200);
    // The byte-order mark lets Excel read the file as UTF-8 (src/lib/csv.ts).
    expect(await res.text()).toMatch(/^\uFEFFDate,Planned,Completed/);
  });

  test("the top bar searches rostering on rota pages", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota");
    const search = page.getByPlaceholder("Search rostering (e.g. service user, team member, reference)…");
    await search.fill("V-2");
    await search.press("Enter");
    await expect(page).toHaveURL(/\/rota\/search\?q=V-2/);
    await expect(page.getByRole("heading", { level: 1, name: "Search rostering" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Visits" }).getByRole("link").first()).toBeVisible();
  });

  test("Advanced Rota shows the day by carer with an Unassigned row, and switches view", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/advanced");
    const board = page.getByRole("region", { name: "Team member" });
    await expect(board.getByText("Unassigned", { exact: true })).toBeVisible();
    await expect(board.locator("a[href^='/rota/visits/']").first()).toBeVisible();
    await page.locator("select[name=view]").selectOption("su-day");
    await page.getByRole("button", { name: "Show", exact: true }).click();
    await expect(page.getByRole("region", { name: "Service user" })).toBeVisible();
    await page.getByRole("region", { name: "Service user" }).locator("a[href^='/rota/visits/']").first().click();
    await expect(page.getByRole("heading", { level: 2, name: "Carers" })).toBeVisible();
  });

  test("keyboard: a visit can be opened and reassigned without a mouse", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    // Tomorrow's visits are still scheduled, so they can be reassigned (today's earliest may already be done).
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await page.goto(`/rota/visits?date=${tomorrow}&status=SCHEDULED`);
    const link = page.getByRole("link", { name: /Open details of visit/ }).first();
    await link.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("complementary", { name: "Visit Details" });
    await expect(panel).toBeVisible();
    await panel.locator("summary", { hasText: "Reassign Carers" }).focus();
    await page.keyboard.press("Enter");
    await expect(panel.locator("select[name=staffId]").first()).toBeVisible();
    await panel.getByRole("link", { name: "Full visit" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel(/Choose first carer|Replace first carer/)).toBeVisible();
  });
});
