import type { Prisma } from "@prisma/client";
import { withSystemScope } from "../src/server/tenancy/system";
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
/**
 * The owner renamed the demo manager from "Alex Morgan" (Registered manager) to "Mohamed Mire" (CEO) on 3 Nov 2026.
 * Databases seeded before then still hold the old name, so this changes it once: the login's name, its job title, and
 * every mention in the demo HR workspace (uploader, reviewer, line manager, activity). Approved and published policy
 * text is immutable and is left as it was. Once renamed it changes nothing.
 */
async function renameDemoManager(organisationId: string, userId: string) {
  await db.$transaction(async (tx) => {
    await tx.user.updateMany({ where: { id: userId, name: OLD_NAME }, data: { name: NEW_NAME } });
    await tx.membership.updateMany({ where: { userId, organisationId, jobTitle: "Registered manager" }, data: { jobTitle: "CEO" } });
    const [row] = await tx.$queryRaw<{ state: unknown }[]>`SELECT state FROM "HrWorkspace" WHERE "organisationId" = ${organisationId} FOR UPDATE`;
    if (!row) return;
    const text = JSON.stringify(row.state);
    if (!text.includes(OLD_NAME)) return;
    const state = JSON.parse(text.split(OLD_NAME).join(NEW_NAME)) as Prisma.InputJsonValue;
    await tx.hrWorkspace.update({ where: { organisationId }, data: { state, version: { increment: 1 } } });
  });
}
const OLD_NAME = "Alex Morgan";
const NEW_NAME = "Mohamed Mire";

async function main() {
  if (process.env.SEED_DEMO === "false") return;
  for (const [slug, domain] of [["csb-demo", "care-solution.demo"], ["brookfield-demo", "brookfield.demo"]] as const) {
    const org = await db.organisation.findUnique({ where: { slug } });
    if (!org?.isDemo) continue;
    await seedHrWorkspace(org.id);
    const manager = await db.user.findUnique({ where: { email: `manager@${domain}` } });
    if (manager) await db.membership.updateMany({ where: { userId: manager.id, organisationId: org.id, hrUserId: null }, data: { hrUserId: "admin" } });
    if (manager && slug === "csb-demo") await renameDemoManager(org.id, manager.id);
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

withSystemScope("seed: HR demo people", main)
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
