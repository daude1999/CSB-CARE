#!/usr/bin/env node
/**
 * Screen checks at full UAT scale (V1 brief, phase 6): each page at 1440, 1366, 834 and 390 wide, with no sideways
 * scrolling, a visible heading, no script errors (hydration warnings included), and a screenshot for the QA record.
 *   node scripts/uat-screens.mjs http://localhost:3200 <output folder>
 * Read-only: it only opens pages.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const [base = "http://localhost:3200", outDir = "test-results/uat-screens"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const WIDTHS = [1440, 1366, 834, 390];
const PAGES = {
  coordinator: ["/rota", "/rota/advanced", "/rota/planner", "/rota/monitor", "/rota/unassigned", "/rota/exceptions", "/rota/service-users", "/rota/staff", "/rota/templates", "/rota/routes", "/rota/reports", "/rota/finance/timesheets", "/rota/build"],
  finance: ["/rota/finance/payroll", "/rota/finance/invoices"],
  manager: ["/overview", "/analytics", "/rota/readiness", "/policies", "/hr/dashboard", "/admin/users", "/admin/audit"],
  "coordinator.tower-hamlets@uat.example": ["/rota/advanced", "/rota/planner"],
};
const browser = await chromium.launch();
const problems = [];
let shots = 0;
for (const [who, paths] of Object.entries(PAGES)) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/login`);
  await page.getByLabel("Email").fill(who.includes("@") ? who : `${who}@care-solution.demo`);
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByTestId("current-user").waitFor({ state: "attached" });
  for (const path of paths) {
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w, height: w === 390 ? 844 : 1000 });
      const before = errors.length;
      const res = await page.goto(`${base}${path}`, { waitUntil: "load" });
      await page.waitForTimeout(300);
      const label = `${who.replace("@uat.example", "")} ${path} @${w}`;
      if ((res?.status() ?? 0) >= 400) problems.push(`${label}: HTTP ${res?.status()}`);
      if (!(await page.locator("h1").first().isVisible().catch(() => false))) problems.push(`${label}: no visible heading`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 1) problems.push(`${label}: scrolls sideways by ${overflow}px`);
      for (const e of errors.slice(before)) problems.push(`${label}: script error: ${e.slice(0, 160)}`);
      await page.screenshot({ path: `${outDir}/${who.replace(/[^a-z]+/g, "-")}${path.replace(/\//g, "_")}-${w}.png` });
      shots++;
    }
  }
  await context.close();
}
await browser.close();
console.log(`${shots} screens checked.`);
console.log(problems.length ? problems.join("\n") : "No problems found.");
