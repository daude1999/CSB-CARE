import { setProcessDefaultScope } from "@/server/tenancy/scope";

/**
 * Row-level security in the vitest suite. Tests call server functions directly with a `ctx` they build themselves
 * and then check the database across organisations, so there is no signed-in request to take a scope from. The
 * suite therefore runs in the system scope by default. Tenant isolation itself is tested where a scope is set on
 * purpose: tests/integration/rls-tenancy.test.ts (every protected table), and the browser suite, which signs in and
 * goes through the real request path.
 */
setProcessDefaultScope({ kind: "SYSTEM", reason: "vitest suite" });
