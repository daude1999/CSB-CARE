// Prints libpq variables (NAME=value, NUL-separated) for the URL held in the environment
// variable named by argv[2]. The URL is read from the environment, never from the command line.
//   node scripts/backup/pg-env.mjs BACKUP_DATABASE_URL [--direct]
//   node scripts/backup/pg-env.mjs RESTORE_TARGET_DATABASE_URL --restore-target
import { BackupConfigError, checkRestoreTarget, pgEnvFromUrl } from "./lib.mjs";

const [name, flag] = process.argv.slice(2);
try {
  const raw = process.env[name ?? ""];
  if (!raw) throw new BackupConfigError(`${name} is not set`);
  const env =
    flag === "--restore-target"
      ? checkRestoreTarget(raw, process.env.PRODUCTION_DATABASE_HOSTS)
      : pgEnvFromUrl(raw, { label: name, requireDirect: flag === "--direct" });
  process.stdout.write(Object.entries(env).map(([k, v]) => `${k}=${v}\0`).join(""));
} catch (e) {
  console.error(`::error::${e instanceof BackupConfigError ? e.message : "Could not read the database URL"}`);
  process.exit(1);
}
