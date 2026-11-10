import { setProcessDefaultScope } from "@/server/tenancy/scope";

/**
 * Browser-test fixtures are small programs that prepare records for a test before the browser signs in. They are
 * not a signed-in request, so under row-level security they would see nothing; like the vitest suite
 * (tests/support/db-scope.ts) they run in the system scope. The browser steps that follow go through the real
 * request path and its tenant scope.
 */
setProcessDefaultScope({ kind: "SYSTEM", reason: "browser-test fixture" });
