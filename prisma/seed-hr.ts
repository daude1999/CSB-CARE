import { db } from "../src/lib/db";
import { seedHrWorkspace } from "../src/server/seed/hr";

/**
 * Adds HR & Workforce to a demo database that was seeded before the HR Hub moved into the platform.
 * Hosted builds only run the full seed on an empty database, so this runs on every build and changes
 * nothing once the demo organisation has its HR workspace and its manager has an HR account.
 */
async function main() {
  if (process.env.SEED_DEMO === "false") return;
  for (const [slug, manager] of [["csb-demo", "manager@care-solution.demo"], ["brookfield-demo", "manager@brookfield.demo"]] as const) {
    const org = await db.organisation.findUnique({ where: { slug } });
    if (!org?.isDemo) continue;
    await seedHrWorkspace(org.id);
    const user = await db.user.findUnique({ where: { email: manager } });
    if (user) await db.membership.updateMany({ where: { userId: user.id, organisationId: org.id, hrUserId: null }, data: { hrUserId: "admin" } });
    console.log(`HR & Workforce ready for ${org.name}.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
