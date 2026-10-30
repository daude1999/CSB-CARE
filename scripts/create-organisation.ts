/**
 * Sets up a real organisation on this installation and prints a one-time link for its first admin.
 *
 *   npm run org:create -- --name "Care Solution Bureau CIC" --branches "Liverpool,Portsmouth,Tower Hamlets" \
 *     --admin-email you@example.com --admin-name "Your Name" [--slug csb]
 *
 * The admin opens the link (valid for 7 days), chooses a password and signs in, then invites everyone else from
 * Administration → Users. Nothing is emailed.
 */
import { db } from "../src/lib/db";
import { AppError } from "../src/lib/errors";
import { provisionOrganisation } from "../src/server/admin/users";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? "") : "";
}

async function main() {
  const name = arg("name");
  const slug = arg("slug") || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const { organisation, token } = await provisionOrganisation({
    name,
    slug,
    branches: arg("branches").split(",").map((b) => b.trim()).filter(Boolean),
    adminEmail: arg("admin-email"),
    adminName: arg("admin-name"),
  });
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  console.log(`\nCreated "${organisation.name}" (short name ${organisation.slug}).`);
  console.log(`Give this link to the first admin. It works once, for 7 days:\n\n  ${base}/account/${token}\n`);
}

main()
  .catch((e) => {
    console.error(`\n${e instanceof AppError ? e.message : e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
