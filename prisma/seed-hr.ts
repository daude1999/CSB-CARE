import { db } from "../src/lib/db";
import { hashPassword } from "../src/server/auth/password";
import { DEMO_PASSWORD } from "../src/server/seed/demo";
import { seedHrWorkspace } from "../src/server/seed/hr";

/**
 * Adds HR & Workforce to a demo database that was seeded before the HR Hub moved into the platform.
 * Hosted builds only run the full seed on an empty database, so this runs on every build. It only adds:
 * the organisation's HR workspace, the manager's HR account, and the HR Hub's three other demo people.
 * Once they exist it changes nothing.
 */
async function main() {
  if (process.env.SEED_DEMO === "false") return;
  for (const [slug, domain] of [["csb-demo", "care-solution.demo"], ["brookfield-demo", "brookfield.demo"]] as const) {
    const org = await db.organisation.findUnique({ where: { slug } });
    if (!org?.isDemo) continue;
    await seedHrWorkspace(org.id);
    const manager = await db.user.findUnique({ where: { email: `manager@${domain}` } });
    if (manager) await db.membership.updateMany({ where: { userId: manager.id, organisationId: org.id, hrUserId: null }, data: { hrUserId: "admin" } });
    const pw = await hashPassword(DEMO_PASSWORD);
    for (const [local, name, jobTitle, hrUserId] of [
      ["jordan.ellis", "Jordan Ellis", "Group HR", "group"],
      ["sam.parker", "Sam Parker", "Branch HR", "liverpool-hr"],
      ["taylor.reed", "Taylor Reed", "Branch HR viewer", "viewer"],
    ] as const) {
      const email = `${local}@${domain}`;
      const u = await db.user.upsert({ where: { email }, create: { email, name, isDemo: true, passwordHash: pw }, update: {} });
      await db.membership.upsert({
        where: { userId_organisationId: { userId: u.id, organisationId: org.id } },
        create: { userId: u.id, organisationId: org.id, roles: ["STAFF"], jobTitle, hrUserId },
        update: {},
      });
    }
    console.log(`HR & Workforce ready for ${org.name}.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
