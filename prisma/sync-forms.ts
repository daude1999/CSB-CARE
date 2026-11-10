import { db } from "../src/lib/db";
import { withSystemScope } from "../src/server/tenancy/system";
import { syncPilotForms } from "../src/server/forms/pilots";

/**
 * Keeps the CSB on-screen forms in step with src/server/forms/pilots.ts on every deploy (the seed only runs on an empty
 * database). Idempotent: a new form version is published only when a form's fields or instructions change.
 */
withSystemScope("deploy script: sync on-screen forms", syncPilotForms)
  .then((n) => console.log(`On-screen forms in step (${n} new version${n === 1 ? "" : "s"} published).`))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
