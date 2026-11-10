import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Database scope: which organisation's rows the current piece of work may touch.
 *
 * PostgreSQL row-level security is the second layer of tenant isolation (the application's own `organisationId`
 * filters stay the first). Every query the app sends runs as the `csb_app` database role with one of these scopes:
 *
 *  - TENANT   rows of one organisation (plus shared rows that belong to no organisation, such as master policies).
 *             This is every signed-in request: the scope comes from the session, never from the request.
 *  - SYSTEM   every organisation. Only through `withSystemScope(reason, ...)`, which is recorded in the audit log.
 *             Used by Platform Admin pages, seeds and scripts, the background worker and the cron/job routes.
 *  - IDENTITY every organisation, for the sign-in machinery only (finding a session's memberships before any
 *             organisation is known). Not written to the audit log one by one: it runs on every page view.
 *  - NONE     no scope was established. Protected tables then show no rows and refuse writes (default deny).
 *
 * The scope travels with the async call chain (AsyncLocalStorage `run`, never `enterWith`), so it cannot leak into
 * another request.
 */
export type DbScope =
  | { kind: "TENANT"; organisationId: string }
  | { kind: "SYSTEM"; reason: string }
  | { kind: "IDENTITY" }
  | { kind: "NONE" };

type RequestScopeResolver = () => Promise<DbScope | undefined>;

/**
 * Kept on globalThis: Next.js can load a module once per server bundle, and the scope must be one and the same
 * for all of them (the code that sets it and the database client that reads it may sit in different bundles).
 */
interface TenancyState {
  storage: AsyncLocalStorage<DbScope>;
  requestResolver?: RequestScopeResolver;
  processDefault?: DbScope;
}
const globalForTenancy = globalThis as typeof globalThis & { csbTenancy?: TenancyState };
const state: TenancyState = (globalForTenancy.csbTenancy ??= { storage: new AsyncLocalStorage<DbScope>() });
const storage = state.storage;

/** The scope set explicitly for the current call chain, if any. */
export function explicitScope(): DbScope | undefined {
  return storage.getStore();
}

/**
 * `fn` is awaited inside the scope on purpose: Prisma queries are lazy and only start when awaited, so returning an
 * un-awaited query from the callback would run it outside the scope.
 */
function run<T>(scope: DbScope, fn: () => Promise<T> | T): Promise<T> {
  return storage.run(scope, async () => await fn());
}

/** Work for one organisation outside a signed-in request (a job for that organisation, a test). */
export function withTenantScope<T>(organisationId: string, fn: () => Promise<T> | T): Promise<T> {
  if (!organisationId) throw new Error("withTenantScope needs an organisation id");
  return run({ kind: "TENANT", organisationId }, fn);
}

/** Sign-in machinery only. See the note on IDENTITY above. */
export function withIdentityScope<T>(fn: () => Promise<T> | T): Promise<T> {
  return run({ kind: "IDENTITY" }, fn);
}

/** Explicitly no scope, whatever the caller had. Used by tests of the default-deny rule. */
export function withNoScope<T>(fn: () => Promise<T> | T): Promise<T> {
  return run({ kind: "NONE" }, fn);
}

/** Used by `withSystemScope` in ./system.ts, which adds the audit entry. Do not call directly. */
export function runSystemScope<T>(reason: string, fn: () => Promise<T> | T): Promise<T> {
  return run({ kind: "SYSTEM", reason }, fn);
}

/**
 * Finds the scope of a signed-in web request when none was set explicitly. Registered by the auth layer
 * (src/server/auth/current.ts), which reads the session cookie; it answers `undefined` outside a request.
 */
export function setRequestScopeResolver(resolver: RequestScopeResolver) {
  state.requestResolver = resolver;
}

/**
 * A process-wide fallback for programs that are not web requests and do all their work as the system: the test
 * runner sets it (tests/support), nothing in the application does.
 */
export function setProcessDefaultScope(scope: DbScope | undefined) {
  state.processDefault = scope;
}

/** The scope a query should run in: explicit, else the signed-in request's, else the process default, else none. */
export async function currentScope(): Promise<DbScope> {
  const explicit = storage.getStore();
  if (explicit) return explicit;
  const fromRequest = state.requestResolver ? await state.requestResolver() : undefined;
  return fromRequest ?? state.processDefault ?? { kind: "NONE" };
}

/** The three settings the database policies read, as text values for `set_config`. */
export function scopeSettings(scope: DbScope): { organisationId: string; bypass: "on" | "off" } {
  switch (scope.kind) {
    case "TENANT":
      return { organisationId: scope.organisationId, bypass: "off" };
    case "SYSTEM":
    case "IDENTITY":
      return { organisationId: "", bypass: "on" };
    case "NONE":
      return { organisationId: "", bypass: "off" };
  }
}
