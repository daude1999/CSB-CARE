import { PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { CORE_REFS, seedBase } from "@/server/seed/base";
import { seedDemo } from "@/server/seed/demo";
import { ctxForUser } from "@/server/auth/session";
import { setAiProviderForTests } from "@/server/ai";
import { LogEmailProvider, setEmailProvider } from "@/server/notifications/email";

/**
 * The table owner's own connection, outside row-level security. The application's client runs every query as the
 * csb_app role, which may not TRUNCATE; emptying the database between test files is the owner's job.
 */
const owner = new PrismaClient();

export async function resetDb() {
  const tables = await owner.$queryRaw<{ tablename: string }[]>`SELECT tablename::text AS tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await owner.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  setAiProviderForTests(undefined);
  const email = new LogEmailProvider();
  setEmailProvider(email);
  return { email };
}

/** Seeds the demo on the core library subset; pass `full: true` for the whole library (slow). */
export async function seedAll(opts: { simulatedChange?: boolean; full?: boolean; care?: boolean } = {}) {
  const masters = await seedBase(opts.full ? {} : { refs: CORE_REFS });
  await seedDemo(masters, opts);
  return masters;
}

export async function ctxFor(email: string, orgSlug?: string) {
  const u = await db.user.findUniqueOrThrow({ where: { email } });
  const org = orgSlug ? await db.organisation.findUniqueOrThrow({ where: { slug: orgSlug } }) : null;
  return ctxForUser(u.id, org ? org.id : undefined);
}

export const BROOKFIELD = "csb-demo";
export const OAKRIDGE = "oakridge-demo";
