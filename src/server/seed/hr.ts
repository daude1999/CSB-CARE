import { db } from "@/lib/db";
import type { State } from "@/hr/lib/domain";
import { seed } from "@/hr/lib/seed";
import { upgradeFixtures } from "@/hr/lib/upgrade-fixtures";

/** The HR Hub's own organisation id inside its records (its standalone fixtures use "csb" for Care Solution Bureau). */
const HR_ORG = "csb";

/**
 * The HR Hub's fictional Care Solution Bureau records (45 employees across Liverpool, Portsmouth and Tower Hamlets),
 * without the standalone pilot's second "isolation" organisation: in the platform each organisation has its own row.
 */
export function demoHrState(): State {
  const all = upgradeFixtures(seed());
  const mine = <T extends { org: string }>(rows: T[] | undefined) => (rows ?? []).filter((r) => r.org === HR_ORG);
  return {
    ...all,
    branches: mine(all.branches),
    users: mine(all.users),
    employees: mine(all.employees),
    checks: mine(all.checks),
    documents: mine(all.documents),
    events: mine(all.events),
    notes: mine(all.notes),
    notices: mine(all.notices),
    imports: mine(all.imports),
    views: all.views.filter((v) => all.users.some((u) => u.id === v.user && u.org === HR_ORG)),
    tasks: mine(all.tasks),
    settings: { [HR_ORG]: all.settings[HR_ORG]! },
  };
}

export async function seedHrWorkspace(organisationId: string) {
  await db.hrWorkspace.upsert({
    where: { organisationId },
    create: { organisationId, state: demoHrState() as object },
    update: {},
  });
}
