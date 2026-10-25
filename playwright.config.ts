import { defineConfig, devices } from "@playwright/test";

const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/csb_e2e?schema=public";
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    // Requires `npm run build` first. Uses a dedicated database that global setup resets and seeds.
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DATABASE_URL, AI_PROVIDER: "simulated", STORAGE_PROVIDER: "local", STORAGE_LOCAL_DIR: ".data/e2e-storage", EMAIL_PROVIDER: "log", COOKIE_SECURE: "false", SHOW_DEMO_LOGINS: "true", LOG_LEVEL: "warn" },
  },
});
