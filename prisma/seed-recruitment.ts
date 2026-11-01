import { db } from "../src/lib/db";
import { seedRecruitmentDemo } from "../src/server/seed/recruitment";

/**
 * Adds fictional demonstration candidates to HR & Workforce → Recruitment for the demo organisation. Runs on every
 * hosted build (like seed-hr.ts) but only adds candidates when the organisation has none, so it never duplicates.
 */
async function main() {
  if (process.env.SEED_DEMO === "false") return;
  const org = await db.organisation.findUnique({ where: { slug: "csb-demo" } });
  if (!org?.isDemo) return;
  const manager = await db.user.findUnique({ where: { email: "manager@care-solution.demo" } });
  if (!manager) return;
  const n = await seedRecruitmentDemo(org.id, manager.id);
  console.log(n ? `Recruitment demo candidates ready (${n}).` : "Recruitment demo candidates already present.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
