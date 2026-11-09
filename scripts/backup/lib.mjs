// Pure helpers for the encrypted PostgreSQL backup and restore scripts.
// No network or file access here, so tests/unit/backup-scripts.test.ts can cover every rule.
// Never include a connection string or SAS token in an error message: callers print messages to CI logs.

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export class BackupConfigError extends Error {}

/**
 * Checks an Azure Blob container SAS URL and returns its parts.
 * purpose "backup": must be able to create/write, must not delete or list.
 * purpose "restore": must be able to read and list, must not write, create or delete.
 * Account-level SAS tokens (ss= / srt=) are refused: the token must be container-scoped (sr=c).
 */
export function parseContainerSas(raw, purpose) {
  if (!raw) throw new BackupConfigError(`The ${purpose} container SAS URL is not set`);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new BackupConfigError(`The ${purpose} container SAS URL is not a valid URL`);
  }
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) {
    throw new BackupConfigError(`The ${purpose} container SAS URL must use https`);
  }
  const q = url.searchParams;
  if (!q.get("sig")) throw new BackupConfigError(`The ${purpose} container SAS URL has no signature (sig=)`);
  if (q.has("ss") || q.has("srt")) {
    throw new BackupConfigError(`The ${purpose} SAS is an account SAS. Use a container-scoped SAS (signed resource "c")`);
  }
  if (q.get("sr") !== "c") {
    throw new BackupConfigError(`The ${purpose} SAS must be container-scoped (sr=c)`);
  }
  // Azurite and other local emulators use path-style URLs: /<account>/<container>.
  const segments = url.pathname.split("/").filter(Boolean);
  const container = loopback ? segments[1] : segments[0];
  if (!container || segments.length !== (loopback ? 2 : 1)) {
    throw new BackupConfigError(`The ${purpose} SAS URL must point at a container, not a blob or folder`);
  }
  const perms = q.get("sp");
  if (perms !== null) {
    const has = (p) => perms.includes(p);
    if (purpose === "backup") {
      if (!has("c") && !has("w")) throw new BackupConfigError("The backup SAS needs create (c) or write (w) permission");
      if (has("d") || has("x") || has("y")) throw new BackupConfigError("The backup SAS must not allow delete. Issue it with create and write only");
      if (has("l")) throw new BackupConfigError("The backup SAS must not allow list. Issue it with create and write only");
    } else {
      if (!has("r") || !has("l")) throw new BackupConfigError("The restore SAS needs read (r) and list (l) permission");
      if (has("w") || has("c") || has("d") || has("a") || has("x") || has("y")) {
        throw new BackupConfigError("The restore SAS must be read and list only");
      }
    }
  } else if (!q.get("si")) {
    throw new BackupConfigError(`The ${purpose} SAS has no permissions (sp=) and no stored access policy (si=)`);
  }
  const expiresAt = q.get("se") ? new Date(q.get("se")) : null;
  const base = new URL(url.toString());
  base.search = "";
  return {
    containerUrl: base.toString().replace(/\/$/, ""),
    sas: url.search.replace(/^\?/, ""),
    container,
    expiresAt: expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt : null,
  };
}

/** Days until the SAS expires, or null when the expiry lives in a stored access policy. */
export function sasDaysLeft(parsed, now = new Date()) {
  if (!parsed.expiresAt) return null;
  return Math.floor((parsed.expiresAt.getTime() - now.getTime()) / 86_400_000);
}

const BLOB_NAME = /^postgres\/(\d{8}T\d{6}Z)\/csb-care\.dump\.age$/;

export function backupBlobName(date = new Date()) {
  const stamp = date.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
  return `postgres/${stamp}/csb-care.dump.age`;
}

export function isBackupBlobName(name) {
  return BLOB_NAME.test(name);
}

/** The newest backup blob name; names sort by their UTC timestamp. */
export function latestBackupName(names) {
  const valid = names.filter(isBackupBlobName).sort();
  return valid.length ? valid[valid.length - 1] : null;
}

/**
 * Turns a postgres:// URL into libpq environment variables, so the password never appears
 * on a command line (where `ps` on the runner could see it). Prisma-only parameters are dropped.
 */
export function pgEnvFromUrl(raw, { label = "database URL", requireDirect = false } = {}) {
  let url;
  try {
    url = new URL(raw ?? "");
  } catch {
    throw new BackupConfigError(`The ${label} is not a valid PostgreSQL URL`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new BackupConfigError(`The ${label} must start with postgresql://`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!url.hostname || !database) throw new BackupConfigError(`The ${label} needs a host and a database name`);
  if (requireDirect && /-pooler\./i.test(url.hostname)) {
    throw new BackupConfigError(`The ${label} uses the Neon pooled host (-pooler). Use the direct, unpooled connection string`);
  }
  const q = url.searchParams;
  const env = {
    PGHOST: url.hostname.replace(/^\[|\]$/g, ""),
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: database,
    PGSSLMODE: q.get("sslmode") ?? (LOOPBACK.has(url.hostname) ? "prefer" : "require"),
  };
  if (q.get("channel_binding")) env.PGCHANNELBINDING = q.get("channel_binding");
  if (q.get("options")) env.PGOPTIONS = q.get("options");
  return env;
}

/** Neon endpoint id ("ep-...") or plain hostname, with the pooler suffix removed. */
export function databaseHostKey(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  const first = h.split(".")[0];
  if (first.startsWith("ep-")) return first.replace(/-pooler$/, "");
  return h.replace(/-pooler\./, ".");
}

/**
 * Refuses any restore target that could be production. The target must:
 *  - not share a host or Neon endpoint with any listed production host,
 *  - have "restore" or "staging" in its database name,
 * and the list of production hosts must not be empty.
 */
export function checkRestoreTarget(targetRaw, productionHostsRaw) {
  const target = pgEnvFromUrl(targetRaw, { label: "restore target database URL" });
  const production = String(productionHostsRaw ?? "")
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean);
  if (!production.length) {
    throw new BackupConfigError("Set PRODUCTION_DATABASE_HOSTS so the restore can prove it is not touching production");
  }
  const targetKey = databaseHostKey(target.PGHOST);
  for (const host of production) {
    if (databaseHostKey(host) === targetKey) {
      throw new BackupConfigError("Refusing to restore: the target database is on a production host. Use a separate staging database");
    }
  }
  if (!/(restore|staging)/i.test(target.PGDATABASE)) {
    throw new BackupConfigError('Refusing to restore: the target database name must contain "restore" or "staging"');
  }
  return target;
}

/** Tables a valid CSB dump must contain data for (records, uploaded documents, migration history). */
export const REQUIRED_TABLES = ["Organisation", "User", "ServiceUser", "ServiceUserDocument", "StoredObject", "AuditLog", "_prisma_migrations"];

/** Checks `pg_restore --list` output: every required table must have a TABLE DATA entry. */
export function missingTablesInToc(tocText) {
  return REQUIRED_TABLES.filter((t) => !new RegExp(`\\bTABLE DATA public "?${t}"? `).test(tocText));
}
