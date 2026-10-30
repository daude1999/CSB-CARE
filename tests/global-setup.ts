import { execSync } from "node:child_process";

export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/csb_test?schema=public";
  // PRISMA_JS_ENGINE=1: environments without Prisma's native engines reset through plain SQL (see prisma.config.ts).
  execSync(process.env.PRISMA_JS_ENGINE === "1" ? "node scripts/local-migrate.mjs --reset" : "npx prisma migrate reset --force --skip-seed --skip-generate", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "test database reset by automated test setup" },
  });
}
