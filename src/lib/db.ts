import { PrismaClient } from "@prisma/client";
import { createRequire } from "node:module";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * The database client. By default this is the standard Prisma client with its native engine.
 *
 * With PRISMA_CLIENT_ENGINE_TYPE=client (set together with PRISMA_JS_ENGINE=1, see prisma.config.ts) the generated
 * client runs on Prisma's bundled WASM query compiler and needs a driver adapter; this is only for build environments
 * that cannot download Prisma's native engines. Behaviour is the same either way.
 */
function createClient(): PrismaClient {
  if (process.env.PRISMA_CLIENT_ENGINE_TYPE === "client") {
    // Loaded only on this path so the standard build never touches the adapter.
    const req = createRequire(import.meta.url);
    const { PrismaPg } = req("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg");
    return new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  }
  return new PrismaClient();
}

export const db: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
