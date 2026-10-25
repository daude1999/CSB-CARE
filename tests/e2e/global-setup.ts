import { execSync } from "node:child_process";

/** Resets the dedicated end-to-end database and loads the demo data, including the simulated change. */
export default function setup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/csb_e2e?schema=public";
  const env = { ...process.env, DATABASE_URL: url, AI_PROVIDER: "simulated", STORAGE_PROVIDER: "local", STORAGE_LOCAL_DIR: ".data/e2e-storage", LOG_LEVEL: "warn", PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: "e2e database reset by automated test setup" };
  execSync("npx prisma migrate reset --force --skip-generate --skip-seed", { stdio: "inherit", env });
  execSync("npx tsx prisma/seed.ts", { stdio: "inherit", env });
}
