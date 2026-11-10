import "./system-scope";
import { db } from "@/lib/db";
import { addDays, londonDate } from "@/lib/london";
import { createRisk, reviewRisk } from "@/server/care/risks";
import { reportIncident } from "@/server/care/incidents";
import { ctxFor } from "../../helpers";

/**
 * Synthetic data for the service user records screenshots, on a local database only: a risk assessment with an action
 * still required that has been reviewed once (two versions), and a fall reported with who was told. Prints the
 * person's id.
 */
async function main() {
  const ctx = await ctxFor("manager@care-solution.demo", "csb-demo");
  const org = await db.organisation.findUniqueOrThrow({ where: { slug: "csb-demo" } });
  const su = await db.serviceUser.findFirstOrThrow({ where: { organisationId: org.id, status: "ACTIVE", areaId: { not: null }, visits: { some: { visitNotes: { some: {} } } } }, orderBy: { lastName: "asc" } });
  const base = { type: "FALLS", title: "Falls on the stairs", hazards: "Unsteady on the stairs late in the evening, especially when tired.", controls: "Walk behind on the stairs and keep the landing light on.", level: "MEDIUM", reviewDue: addDays(londonDate(), 20) };
  const r = await createRisk(ctx, su.id, { ...base, requiredActions: "Ask the occupational therapist about a second stair rail", responsiblePerson: "Care coordinator" });
  await reviewRisk(ctx, r.id, 1, { ...base, level: "HIGH", controls: "Two carers on the stairs until the second rail is fitted. Landing light on.", requiredActions: "Chase the occupational therapy referral", responsiblePerson: "Registered manager" });
  await reportIncident(ctx, { serviceUserId: su.id, date: addDays(londonDate(), -1), time: "10:15", category: "Fall", severity: "LOW", description: "Synthetic test: found sitting on the bedroom floor. No injury seen, helped up with the frame.", peopleNotified: "Daughter by phone at 10:30; the office" });
  process.stdout.write(JSON.stringify({ su: su.id, risk: r.id }));
  await db.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
