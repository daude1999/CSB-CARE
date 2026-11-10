import { Client } from "pg";

/**
 * One-off clean-up of the hosted site's demonstration data so Care Solution Bureau can start fresh (the owner's request
 * of 6 Nov 2026: "remove all demo data ... so we can have it as a fresh application"; scope confirmed in the project
 * thread: remove every service user, Faduma included, and the other demo records; keep the support workers).
 *
 * Runs from `vercel-build` after migrations and before the seeds, and does nothing unless all of these hold:
 *   - this is the production build on Vercel (or CSB_DEMO_CLEANUP_LOCAL=true for a local test database);
 *   - the Care Solution Bureau organisation (slug csb-demo) still exists and is still marked as a demo;
 *   - this CLEANUP_ID has not been applied before (recorded in the audit log).
 *
 * Everything happens in ONE transaction, so it either completes or changes nothing:
 *   1. Every table is copied, as it is, into the schema BACKUP_SCHEMA in the same database (the restore copy).
 *   2. Service users and everything about them, the rota, finance runs, missed-call cases, recruitment candidates,
 *      audits, actions and risks, CQC and RCA records, form records, call notes, notifications and the fictional
 *      funders are deleted from Care Solution Bureau. The test organisation "Oakridge" and its only-member logins go too.
 *   3. Kept: the organisation, branches, areas, call types, settings, every login, staff and the HR workspace,
 *      the policy library, forms (definitions) and templates, readiness rules, and the audit log (immutable).
 *   4. The organisation is no longer a demo: its name loses "(DEMO)", the "fictional" labels disappear, and the
 *      demo seeds (seed.ts, seed-hr.ts, seed-recruitment.ts, demo-reset.ts) skip it from then on. Its logins stop
 *      being demo logins, so their passwords can be changed.
 *
 * To restore, copy the rows back from BACKUP_SCHEMA (see docs/implementation/DEMO_DATA_CLEANUP.md).
 */
export const CLEANUP_ID = "2026-11-06-fresh-start";
export const BACKUP_SCHEMA = "backup_20261106_before_cleanup";
const ORG_SLUG = "csb-demo";
const TEST_ORG_SLUG = "oakridge-demo";

/** Organisation-scoped tables cleared for Care Solution Bureau. Order does not matter: see deleteAll(). */
export const CLEARED_TABLES = [
  // Service users and their care records
  "ServiceUser", "ServiceUserAbsence", "ServiceUserContact", "ServiceUserDocument", "ServiceUserDocumentVersion",
  "ServiceUserExternalReference", "ServiceUserReferenceCounter", "CarePackage", "CarePlan", "CarePlanAcknowledgement",
  "CareSummary", "CarerPreference", "CareIntake", "CareIntakeDocument", "CareIntakeFact", "CareIntakeReviewItem",
  "CareIntakeSection", "RiskAssessment", "RiskAssessmentVersion", "Incident", "Medication", "MedicationApplicationSite",
  "MarRecord", "BodyMapObservation", "BodyMapNote", "BodyMapPhoto", "BodyMapRecommendation", "BodyMapRecommendationRun",
  "BodyMapReview", "BodyMapTask", "SafeguardingAuthorityDecision", "CoverContactAttempt",
  // Rota, visits and their history
  "Visit", "VisitAssignment", "VisitClock", "VisitEvent", "VisitMedicationLead", "VisitNote", "VisitTaskOutcome",
  "VisitTemplate", "ClockCorrectionRequest", "RotaAlert", "RotaBuild", "RotaPlan", "RotaPlanChange", "RotaProcessingRun",
  "RunRoute", "RunRouteTemplate", "MissedCallAction", "MissedCallCarerConfirmation", "MissedCallCarerResponse",
  "MissedCallCase", "MissedCallComment", "MissedCallCover", "MissedCallInvestigationDraft", "MissedCallInvestigationRun",
  // Finance runs built from those visits
  "Invoice", "InvoiceRun", "PayRun", "Timesheet", "MileageClaim",
  // Call notes
  "CallNote", "CallNoteItem", "CallNoteLink", "CallNoteTask", "CallNoteReferenceCounter",
  // Recruitment candidates
  "Candidate", "CandidateEvent", "CandidateInterview", "CandidateNote", "CandidateScreening",
  // Audits, actions, risks, CQC, RCA, evidence and completed forms
  "Audit", "AuditFinding", "ComplianceAction", "ComplianceRisk", "CqcAssessment", "CqcAssessmentResult",
  "CqcEvidenceLink", "CqcReadinessSnapshot", "RcaEscalation", "RcaFinding", "RcaInvestigation", "RcaReview",
  "RcaSourceLink", "EvidenceDocument", "FormRecord", "FormRecordEvent", "FormRecordLink",
  // Bell notifications and assistant history from the demo
  "Notification", "AssistantQuery",
] as const;

type Q = Client;

async function existingTables(c: Q) {
  const rows = (await c.query<{ t: string }>(`SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'`)).rows;
  return rows.map((r) => r.t);
}

const ident = (t: string) => `"${t.replace(/"/g, '""')}"`;

/**
 * Deletes the given statements' rows. Foreign keys between the tables decide the order, so each pass tries every
 * remaining statement inside a savepoint and keeps the ones that succeed, until all are done.
 */
async function deleteAll(c: Q, statements: [string, string, unknown[]][]) {
  const counts: Record<string, number> = {};
  let left = statements;
  while (left.length) {
    const failed: typeof left = [];
    let lastError: unknown;
    for (const s of left) {
      await c.query("SAVEPOINT step");
      try {
        const r = await c.query(s[1], s[2]);
        counts[s[0]] = (counts[s[0]] ?? 0) + (r.rowCount ?? 0);
        await c.query("RELEASE SAVEPOINT step");
      } catch (e) {
        await c.query("ROLLBACK TO SAVEPOINT step");
        failed.push(s);
        lastError = e;
      }
    }
    if (failed.length === left.length) throw new Error(`demo clean-up: cannot delete ${failed.map((f) => f[0]).join(", ")}: ${String(lastError)}`);
    left = failed;
  }
  return counts;
}

export async function cleanUp(c: Q) {
  const org = (await c.query<{ id: string; isDemo: boolean; name: string }>(`SELECT id, "isDemo", name FROM "Organisation" WHERE slug = $1`, [ORG_SLUG])).rows[0];
  if (!org) return { skipped: "no Care Solution Bureau organisation" };
  if (!org.isDemo) return { skipped: "Care Solution Bureau is no longer a demo organisation" };
  const done = (await c.query(`SELECT 1 FROM "AuditLog" WHERE action = 'demo.cleanup' AND "entityId" = $1`, [CLEANUP_ID])).rowCount;
  if (done) return { skipped: `${CLEANUP_ID} already applied` };

  const tables = await existingTables(c);
  // 1. The restore copy, readable only by the database owner.
  await c.query(`CREATE SCHEMA ${ident(BACKUP_SCHEMA)}`);
  await c.query(`REVOKE ALL ON SCHEMA ${ident(BACKUP_SCHEMA)} FROM PUBLIC`);
  await c.query(tables.map((t) => `CREATE TABLE ${ident(BACKUP_SCHEMA)}.${ident(t)} AS TABLE public.${ident(t)}`).join(";\n"));

  // Immutability triggers (completed visits, published records, decisions) would refuse these deletes; foreign keys
  // stay on, so cascades still run and nothing is left pointing at a deleted row.
  await c.query(tables.map((t) => `ALTER TABLE public.${ident(t)} DISABLE TRIGGER USER`).join(";\n"));

  const present = new Set(tables);
  const statements: [string, string, unknown[]][] = CLEARED_TABLES.filter((t) => present.has(t)).map((t) => [t, `DELETE FROM public.${ident(t)} WHERE "organisationId" = $1`, [org.id]]);
  // Child tables without their own organisation column whose keys refuse a parent's deletion.
  statements.push(["CallNoteRevision", `DELETE FROM public."CallNoteRevision" WHERE "callNoteId" IN (SELECT id FROM public."CallNote" WHERE "organisationId" = $1)`, [org.id]]);
  statements.push(["RiskEvent", `DELETE FROM public."RiskEvent" WHERE "riskId" IN (SELECT id FROM public."ComplianceRisk" WHERE "organisationId" = $1)`, [org.id]]);
  statements.push(["Funder (fictional)", `DELETE FROM public."Funder" WHERE "organisationId" = $1 AND name ILIKE '%(fictional)%'`, [org.id]]);
  const counts = await deleteAll(c, statements);

  // The test organisation, and logins that belonged only to it.
  const test = (await c.query<{ id: string }>(`SELECT id FROM "Organisation" WHERE slug = $1 AND "isDemo"`, [TEST_ORG_SLUG])).rows[0];
  if (test) {
    const only = (await c.query<{ id: string }>(`SELECT m."userId" AS id FROM "Membership" m JOIN "User" u ON u.id = m."userId" WHERE m."organisationId" = $1 AND u."isDemo" AND u."platformRoles" = '{}' AND NOT EXISTS (SELECT 1 FROM "Membership" o WHERE o."userId" = m."userId" AND o."organisationId" <> $1)`, [test.id])).rows.map((r) => r.id);
    // Rows that name the organisation without a cascading key, then the organisation itself.
    const refs = (await c.query<{ t: string; col: string }>(`SELECT c.relname AS t, a.attname AS col FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1] WHERE k.contype = 'f' AND k.confrelid = '"Organisation"'::regclass AND c.relnamespace = 'public'::regnamespace`)).rows;
    const orgStatements: [string, string, unknown[]][] = refs.map((r) => [`Oakridge ${r.t}`, `DELETE FROM public.${ident(r.t)} WHERE ${ident(r.col)} = $1`, [test.id]]);
    orgStatements.push(["Oakridge organisation", `DELETE FROM public."Organisation" WHERE id = $1`, [test.id]]);
    Object.assign(counts, await deleteAll(c, orgStatements));
    if (only.length) Object.assign(counts, await deleteAll(c, [["Oakridge-only logins", `DELETE FROM public."User" WHERE id = ANY($1)`, [only]]]));
  }

  await c.query(tables.map((t) => `ALTER TABLE public.${ident(t)} ENABLE TRIGGER USER`).join(";\n"));

  // 4. No longer a demo.
  await c.query(`UPDATE "Organisation" SET "isDemo" = false, name = regexp_replace(name, '\\s*\\(DEMO\\)\\s*$', '') WHERE id = $1`, [org.id]);
  await c.query(`UPDATE "User" SET "isDemo" = false WHERE id IN (SELECT "userId" FROM "Membership" WHERE "organisationId" = $1)`, [org.id]);

  const deleted = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
  await c.query(`INSERT INTO "AuditLog" (id, action, "entityType", "entityId", "organisationId", data, "createdAt") VALUES (gen_random_uuid()::text, 'demo.cleanup', 'Database', $1, $2, $3, now())`, [CLEANUP_ID, org.id, JSON.stringify({ note: "Demonstration data removed for a fresh start, as approved by the owner on 6 Nov 2026", backupSchema: BACKUP_SCHEMA, deleted })]);
  return { deleted };
}

async function main() {
  const local = process.env.CSB_DEMO_CLEANUP_LOCAL === "true";
  if (process.env.VERCEL_ENV !== "production" && !local) return console.log("demo clean-up: not a production build, skipped");
  const client = new Client({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("BEGIN");
    // Row-level security: this script connects as the table owner and works across organisations on purpose.
    await client.query("SELECT set_config('app.rls_bypass', 'on', true)");
    const result = await cleanUp(client);
    await client.query("COMMIT");
    console.log("demo clean-up:", JSON.stringify(result));
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    // Never fail the deployment over this: nothing was changed, and the next build tries again.
    console.error("demo clean-up: failed, nothing was changed", e);
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.endsWith("demo-cleanup.ts")) void main();
