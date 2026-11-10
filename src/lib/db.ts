import { Prisma, PrismaClient } from "@prisma/client";
import { currentScope, scopeSettings, type DbScope } from "@/server/tenancy/scope";
import { createRequire } from "node:module";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The database client. By default this is the standard Prisma client with its native engine.
 *
 * With PRISMA_CLIENT_ENGINE_TYPE=client (set together with PRISMA_JS_ENGINE=1, see prisma.config.ts) the generated
 * client runs on Prisma's bundled WASM query compiler and needs a driver adapter; this is only for build environments
 * that cannot download Prisma's native engines. Behaviour is the same either way.
 */
/**
 * Interactive transactions get 60 seconds (Prisma's default is 5). On the live site the database is a network hop
 * away from the server, so a transaction that writes a long support plan's facts one by one can take longer than 5
 * seconds; Prisma then closes it and the whole step fails (error P2028). Waiting for a connection stays short.
 */
const transactionOptions = { maxWait: 10_000, timeout: 60_000 };

function createClient(): PrismaClient {
  if (process.env.PRISMA_CLIENT_ENGINE_TYPE === "client") {
    // Loaded only on this path so the standard build never touches the adapter.
    const req = createRequire(import.meta.url);
    const { PrismaPg } = req("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");
    return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }), transactionOptions });
  }
  return new PrismaClient({ transactionOptions });
}

/**
 * Row-level security (docs/SECURITY.md). Every query from the application runs as the `csb_app` database role with
 * the caller's scope (src/server/tenancy/scope.ts) set for that one transaction:
 *
 *   - a single query becomes a short transaction: set the role and scope, then the query;
 *   - an interactive transaction (`db.$transaction(async (tx) => ...)`) sets them once, as its first statement,
 *     and its queries then run as they are.
 *
 * `set_config(..., true)` is transaction-local, so nothing stays on a pooled connection afterwards. Set
 * DB_ROW_LEVEL_SECURITY=off to connect without it (only for a database that has not had the RLS migration).
 */
const RLS_ON = process.env.DB_ROW_LEVEL_SECURITY !== "off";

export function scopeStatement(scope: DbScope) {
  const s = scopeSettings(scope);
  return Prisma.sql`SELECT set_config('role', 'csb_app', true), set_config('app.organisation_id', ${s.organisationId}, true), set_config('app.rls_bypass', ${s.bypass}, true)`;
}

/** Prisma marks a query that belongs to an interactive transaction; such a query must not be wrapped again. */
function insideTransaction(params: object): boolean {
  return "__internalParams" in params && typeof params.__internalParams === "object" && params.__internalParams !== null && "transaction" in params.__internalParams && Boolean(params.__internalParams.transaction);
}

function withRowLevelSecurity(base: PrismaClient): PrismaClient {
  const extended = base.$extends({
    name: "row-level-security",
    query: {
      async $allOperations(params) {
        const { args, query } = params;
        if (insideTransaction(params)) return query(args);
        const scope = await currentScope();
        const [, result] = await base.$transaction([base.$queryRaw(scopeStatement(scope)), query(args)]);
        return result;
      },
    },
  });
  // Interactive and batch transactions: the scope is the transaction's first statement.
  // Typed loosely here; callers see PrismaClient's own `$transaction` signatures through the proxy below.
  const transaction = async (input: unknown, options?: unknown): Promise<unknown> => {
    const scope = await currentScope();
    if (typeof input === "function") {
      const fn = input as (tx: Tx) => Promise<unknown>;
      return extended.$transaction(async (tx) => {
        await tx.$queryRaw(scopeStatement(scope));
        return fn(tx as unknown as Tx);
      }, options as Parameters<PrismaClient["$transaction"]>[1]);
    }
    const batch = input as Prisma.PrismaPromise<unknown>[];
    const [, ...results] = await extended.$transaction([extended.$queryRaw(scopeStatement(scope)), ...batch], options as { isolationLevel?: Prisma.TransactionIsolationLevel });
    return results;
  };
  return new Proxy(extended as unknown as PrismaClient, {
    get(target, prop, receiver) {
      if (prop === "$transaction") return transaction;
      return Reflect.get(target, prop, receiver);
    },
  });
}

function createDb(): PrismaClient {
  const base = createClient();
  return RLS_ON ? withRowLevelSecurity(base) : base;
}

export const db: PrismaClient = globalForPrisma.prisma ?? createDb();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
