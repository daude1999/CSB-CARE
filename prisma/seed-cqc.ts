import { db } from "../src/lib/db";
import { seedCqcDemo } from "../src/server/seed/cqc";

/**
 * Adds synthetic CQC Inspection & Evidence demo data (an assessment, evidence and three investigations) to a demo
 * database. Never part of the normal seed, so tests and the hosted demo are unchanged unless someone runs it on purpose.
 * Usage: npx tsx prisma/seed-cqc.ts
 */
seedCqcDemo()
  .then((r) => console.log(r.skipped ? "CQC demo data already present; nothing changed." : `CQC demo data added: ${JSON.stringify(r)}`))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => db.$disconnect());
