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
    await page.goto("/rota/unassigned");
    await expect(page.getByRole("heading", { level: 1, name: "Unassigned Visits" })).toBeVisible();
    const form = page.locator("form:has(select[name=staffId])").first();
    const select = form.locator("select[name=staffId]");
    const options = await select.locator("option").count();
    test.skip(options < 2, "No eligible carer free in the demo data for the first visit");
    await select.selectOption({ index: 1 });
    await form.getByLabel("Accept warnings").check();
    await form.getByRole("button", { name: "Assign" }).click();
    await expect(page.getByRole("status")).toContainText("Carer assigned");

    await page.goto("/rota/visits");
    await page.locator("summary", { hasText: "Filter" }).click();
    await page.getByLabel("Show only").selectOption("unassigned");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page).toHaveURL(/view=unassigned/);
    await expect(page.getByRole("note")).toContainText("unassigned visits only");
  });

  test("bulk change reports each visit, and cancelling needs a reason", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota/visits?layout=list");
    const boxes = page.locator("input[name=visitIds]");
    await boxes.nth(0).check();
    await page.locator("#bulk select[name=kind]").selectOption("cancel");
    await page.locator("#bulk").getByRole("button", { name: "Go" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /reason/i }).first()).toBeVisible();
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
    await page.goto("/rota");
    await page.getByRole("region", { name: "Quick Actions" }).getByRole("link", { name: "Optimise Rota" }).click();
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
    await page.getByRole("navigation").getByRole("link", { name: "Rota Insights" }).click();
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

  test("Rota Dashboard: operational figures that link to the visits, no money, and real quick actions", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    await page.goto("/rota");
    await expect(page.getByRole("heading", { level: 1, name: "Rota Dashboard" })).toBeVisible();
    const figures = page.getByRole("region", { name: "Key figures" });
    for (const id of ["scheduled", "completed", "unassigned", "missed", "late"]) await expect(figures.getByTestId(`kpi-${id}`)).toBeVisible();
    for (const name of ["Today's Performance", "Needs Attention", "Staffing & Availability", "7-Day Visit Coverage", "Key Operational Insights", "Recent Rota Activity", "Quick Actions"]) await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    // The performance states add up to the scheduled figure.
    const scheduled = Number((await figures.getByTestId("kpi-scheduled").locator("[data-value]").innerText()).replace(/,/g, ""));
    const shares = await page.getByRole("region", { name: "Today's Performance" }).locator("li a span.text-right").allInnerTexts();
    expect(shares.reduce((n, t) => n + Number(t.split(" ")[0]), 0)).toBe(scheduled);
    // No money on the operational dashboard.
    await expect(page.locator("main")).not.toContainText("£");
    const quick = page.getByRole("region", { name: "Quick Actions" });
    await expect(quick.getByRole("link", { name: "Build Rota" })).toHaveAttribute("href", /\/rota\/build/);
    await expect(quick.getByRole("link", { name: "Roll Forward" })).toHaveAttribute("href", /\/rota\/build\?roll=1/);
    await expect(quick.getByRole("link", { name: "Manage Cover" })).toHaveAttribute("href", "/rota/cover");
    // The period switch and a coverage bar that opens the Daily Rota for that day.
    await page.getByRole("navigation", { name: "Period" }).getByRole("link", { name: "This Week" }).click();
    await expect(page).toHaveURL(/period=week/);
    await expect(page.getByRole("heading", { level: 2, name: "This Week's Performance" })).toBeVisible();
    await page.getByRole("img", { name: "Visit coverage for the next seven days" }).locator("a").nth(1).click();
    await expect(page.getByRole("heading", { level: 1, name: "Daily Rota" })).toBeVisible();
    // Activity: View all is searchable.
    await page.goto("/rota");
    await page.getByRole("link", { name: /View all activity/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Rota Activity" })).toBeVisible();
    await page.getByLabel("Search", { exact: true }).fill("V-");
    await page.getByRole("button", { name: "Show", exact: true }).click();
    await expect(page).toHaveURL(/q=V-/);
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

  test("Daily Rota: carers as rows, service users on the cards, Visit Details beside the timeline, list one click away", async ({ page }) => {
    await signIn(page, "coordinator@care-solution.demo");
    await page.goto("/rota/visits");
    await expect(page.getByRole("heading", { level: 1, name: "Daily Rota" })).toBeVisible();
    for (const label of ["Branch", "Area", "Team member", "Service user", "Status"]) await expect(page.getByRole("form", { name: "Filters" }).getByLabel(label)).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Needs attention" })).toBeVisible();
    const day = page.getByRole("region", { name: "Day timeline" });
    await expect(day.getByRole("columnheader", { name: /Team members \(\d+\)/ })).toBeVisible();
    await expect(day.getByRole("rowheader").first()).toBeVisible();
    const card = day.locator("a[href*='visit=']").first();
    await card.click();
    await expect(page).toHaveURL(/visit=/);
    const panel = page.getByRole("complementary", { name: "Visit Details" });
    await expect(panel).toBeVisible();
    for (const label of ["Reference", "Date", "Area", "Run route", "Risk", "Scheduled start", "Scheduled end", "Clock in", "Clock out", "Acknowledged", "Double-up"]) await expect(panel.getByText(label, { exact: true }).first()).toBeVisible();
    await panel.getByRole("link", { name: "History" }).click();
    await expect(page).toHaveURL(/tab=history/);
    await expect(page.getByRole("complementary", { name: "Visit Details" }).getByRole("link", { name: "History" })).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "Close visit details" }).click();
    await expect(page.getByRole("complementary", { name: "Visit Details" })).toHaveCount(0);
    await page.getByRole("navigation", { name: "Rota layout" }).getByRole("link", { name: "List" }).click();
    await expect(page).toHaveURL(/layout=list/);
    await expect(page.getByRole("region", { name: "Visits" }).locator("table")).toBeVisible();
    await page.getByRole("navigation", { name: "Day or week" }).getByRole("link", { name: "Week" }).click();
    await expect(page.getByRole("region", { name: "Week roster" })).toBeVisible();
  });

  test("Daily Rota inspector: reassign and move go through the normal checks and come back to the same visit", async ({ page }) => {
    await signIn(page, "manager@care-solution.demo");
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    await page.goto(`/rota/visits?date=${tomorrow}`);
    await page.getByRole("region", { name: "Day timeline" }).locator("a[href*='visit=']").first().click();
    const panel = page.getByRole("complementary", { name: "Visit Details" });
    const ref = (await panel.locator("dd").first().innerText()).trim();
    await panel.locator("summary", { hasText: "Move visit" }).click();
    const move = panel.locator("form:has(button:text-is('Move visit'))");
    await move.locator("input[name=start]").fill("06:05");
    await move.getByRole("button", { name: "Move visit" }).click();
    await expect(page.getByRole("status").or(page.getByRole("alert")).first()).toBeVisible();
    await expect(page).toHaveURL(/visit=/);
    await expect(page.getByRole("complementary", { name: "Visit Details" }).locator("dd").first()).toHaveText(ref);
    await page.getByRole("complementary", { name: "Visit Details" }).locator("summary", { hasText: "Reassign" }).click();
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
      for (const path of ["/rota", "/rota?period=week", "/rota/activity", "/rota/search?q=ab", "/rota/advanced", "/rota/monitor", "/rota/visits", "/rota/visits?layout=list", "/rota/planner", "/rota/build", "/rota/build?roll=1", "/rota/cover", "/rota/optimise", "/rota/insights", "/rota/templates", "/rota/service-users", "/rota/staff", "/rota/care-plans", "/rota/risks", "/rota/incidents", "/rota/finance", "/rota/finance/rates", "/rota/finance/timesheets", "/rota/finance/payroll", "/rota/finance/invoices", "/rota/reports", "/rota/reports?report=carers"]) {
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
    await page.goto(`/rota/visits?date=${tomorrow}`);
    const link = page.getByRole("region", { name: "Day timeline" }).locator("a[href*='visit=']").first();
    await link.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("complementary", { name: "Visit Details" });
    await expect(panel).toBeVisible();
    await panel.locator("summary", { hasText: "Reassign" }).focus();
    await page.keyboard.press("Enter");
    await expect(panel.locator("select[name=staffId]").first()).toBeVisible();
    await panel.getByRole("link", { name: "Open full visit" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel(/Choose first carer|Replace first carer/)).toBeVisible();
  });
});
