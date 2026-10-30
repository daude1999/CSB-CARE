#!/usr/bin/env node
/**
 * Measured page timings against a running production build serving the UAT database (V1 brief, phase 9).
 *   PORT=3200 DATABASE_URL=<local uat url> npx next start -p 3200   (in another terminal)
 *   node scripts/uat-page-timings.mjs http://localhost:3200
 * Each page is loaded three times after one warm-up; "server" is the time to the end of the HTML response, "ready" is
 * when the page has loaded. Read-only: it only opens pages.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const base = process.argv[2] ?? "http://localhost:3200";
const PAGES = [
  ["coordinator", "/rota"],
  ["coordinator", "/rota/advanced"],
  ["coordinator", "/rota/planner"],
  ["coordinator", "/rota/monitor"],
  ["coordinator", "/rota/unassigned"],
  ["coordinator", "/rota/exceptions"],
  ["coordinator", "/rota/service-users"],
  ["coordinator", "/rota/staff"],
  ["coordinator", "/rota/templates"],
  ["coordinator", "/rota/reports"],
  ["coordinator", "/rota/finance/timesheets"],
  ["finance", "/rota/finance/payroll"],
  ["finance", "/rota/finance/invoices"],
  ["manager", "/overview"],
  ["manager", "/analytics"],
  ["manager", "/rota/readiness"],
  ["manager", "/policies"],
  ["manager", "/hr/dashboard"],
  ["coordinator.tower-hamlets@uat.example", "/rota/advanced"],
];
const browser = await chromium.launch();
const out = [];
for (const who of [...new Set(PAGES.map((p) => p[0]))]) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.getByLabel("Email").fill(who.includes("@") ? who : `${who}@care-solution.demo`);
  await page.getByLabel("Password").fill("DemoPassword!2026");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByTestId("current-user").waitFor({ state: "attached" });
  for (const [, path] of PAGES.filter((p) => p[0] === who)) {
    const runs = [];
    for (let i = 0; i < 4; i++) {
      const res = await page.goto(`${base}${path}`, { waitUntil: "load" });
      const t = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0]; return { server: Math.round(n.responseEnd - n.requestStart), ready: Math.round(n.loadEventEnd - n.startTime) }; });
      if (i > 0) runs.push({ ...t, status: res?.status() });
    }
    const med = (k) => runs.map((r) => r[k]).sort((a, b) => a - b)[1];
    out.push(`| ${who.replace("@uat.example", "")} | ${path} | ${runs[0].status} | ${runs.map((r) => r.server).join(", ")} | ${med("server")} | ${med("ready")} |`);
  }
  await context.close();
}
await browser.close();
console.log("| Signed in as | Page | Status | Server (ms, 3 runs) | Server median | Page ready median (ms) |\n|---|---|---|---|---|---|");
console.log(out.join("\n"));
