/**
 * Prisma CLI configuration.
 *
 * Default (Windows laptop, CI, Vercel): the standard Prisma engines; nothing to configure.
 *
 * PRISMA_JS_ENGINE=1 (with PRISMA_CLIENT_ENGINE_TYPE=client): use Prisma's bundled JavaScript/WASM engines through
 * the pg driver adapter, for build environments that cannot download Prisma's native engine binaries. Migrations are
 * then applied with `node scripts/local-migrate.mjs` (plain SQL through psql) because the WASM schema engine in
 * Prisma 6.19 cannot read the migrations table. Nothing about the schema or migrations changes.
 */
import "dotenv/config";
import { defineConfig } from "prisma/config";

const schema = "prisma/schema.prisma";

export default process.env.PRISMA_JS_ENGINE === "1"
  ? defineConfig({
      schema,
      experimental: { adapter: true },
      engine: "js",
      async adapter() {
        const { PrismaPg } = await import("@prisma/adapter-pg");
        return new PrismaPg({ connectionString: process.env.DATABASE_URL });
      },
    })
  : defineConfig({ schema });
