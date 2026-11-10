import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  // The same JSX runtime as Next.js, so tests can import components that build menus (e.g. src/components/hr-nav.tsx).
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/csb_test?schema=public",
      AI_PROVIDER: "simulated",
      STORAGE_PROVIDER: "local",
      STORAGE_LOCAL_DIR: ".data/test-storage",
      EMAIL_PROVIDER: "log",
      SOURCE_MIN_INTERVAL_MS: "0",
    },
    pool: "forks",
    // One worker process: every test file shares one real database, so files run one after another.
    maxWorkers: 1,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
