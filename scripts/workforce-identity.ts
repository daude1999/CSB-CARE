/**
 * Employee identity check and backfill (HR & Workforce → Rostering). Read-only unless --reconcile is given.
 *
 *   npm run workforce:identity                 # report for every organisation with an HR workspace
 *   npm run workforce:identity -- --org csb    # one organisation (slug)
 *   npm run workforce:identity -- --reconcile  # project HR into Rostering first, then report again
 *
 * Reconciling only adds or updates StaffMember rows from HR (HR's values win, by rule) and marks staff whose HR
 * employee has gone as hrMissing. It never deletes a staff identity, never merges people, and never touches visits,
 * attendance, timesheets or pay lines; the reference counts printed before and after must be identical. Running it
 * again changes nothing. Recovery: every run is audited (workforce.projected); because nothing is deleted, a wrong HR
 * edit is undone by correcting the HR record, which projects again.
 */
import { db } from "../src/lib/db";
import { reconcileWorkforce } from "../src/server/workforce/projection";
import { workforceIdentityReport } from "../src/server/workforce/identity";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? "") : "";
};

async function main() {
  const slug = arg("org");
  const orgs = await db.organisation.findMany({ where: { ...(slug ? { slug } : {}), hrWorkspace: { isNot: null } }, select: { id: true, slug: true } });
  if (!orgs.length) throw new Error(slug ? `No organisation "${slug}" with HR & Workforce set up` : "No organisation has HR & Workforce set up");
  let problems = 0;
  for (const o of orgs) {
    const before = await workforceIdentityReport(o.id);
    const out: Record<string, unknown> = { organisation: o.slug, before };
    if (process.argv.includes("--reconcile")) {
      out.reconciled = await reconcileWorkforce(o.id, null);
      const after = await workforceIdentityReport(o.id);
      out.after = after;
      const same = JSON.stringify(before?.references) === JSON.stringify(after?.references);
      out.referencesPreserved = same;
      if (!same) problems++;
    }
    const final = (out.after ?? before) as typeof before;
    if (final && (final.counts.notProjected || final.duplicateStaffNumbers.length || final.unmatched.length)) problems++;
    console.log(JSON.stringify(out, null, 2));
  }
  if (problems) console.error(`\n${problems} organisation(s) have identity items to review (see notProjected, unmatched, duplicateStaffNumbers).`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
