import { db } from "@/lib/db";
import { seedBase } from "@/server/seed/base";
import { seedDemo } from "@/server/seed/demo";
import { ctxForUser } from "@/server/auth/session";
import { setAiProviderForTests } from "@/server/ai";
import { LogEmailProvider, setEmailProvider } from "@/server/notifications/email";

export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  setAiProviderForTests(undefined);
  const email = new LogEmailProvider();
  setEmailProvider(email);
  return { email };
}

export async function seedAll(opts: { simulatedChange?: boolean } = {}) {
  const masters = await seedBase();
  await seedDemo(masters, opts);
  return masters;
}

export async function ctxFor(email: string, orgSlug?: string) {
  const u = await db.user.findUniqueOrThrow({ where: { email } });
  const org = orgSlug ? await db.organisation.findUniqueOrThrow({ where: { slug: orgSlug } }) : null;
  return ctxForUser(u.id, org ? org.id : undefined);
}

export const BROOKFIELD = "brookfield-demo";
export const OAKRIDGE = "oakridge-demo";
