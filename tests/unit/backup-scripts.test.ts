import { describe, expect, it } from "vitest";
import {
  BackupConfigError,
  backupBlobName,
  checkRestoreTarget,
  latestBackupName,
  missingTablesInToc,
  parseContainerSas,
  pgEnvFromUrl,
  REQUIRED_TABLES,
  sasDaysLeft,
} from "../../scripts/backup/lib.mjs";

// Synthetic values only: no real account, key, host or password.
const ACCOUNT = "https://csbbackupsexample.blob.core.windows.net/csb-db-backups";
const sas = (q: string) => `${ACCOUNT}?sv=2023-11-03&${q}&sig=c3ludGhldGlj`;
const PROD = "ep-calm-prod-111111.eu-west-2.aws.neon.tech";

describe("backup container SAS", () => {
  it("accepts a container-scoped create/write SAS for backups", () => {
    const parsed = parseContainerSas(sas("sr=c&sp=cw&se=2027-01-01T00:00:00Z"), "backup");
    expect(parsed.container).toBe("csb-db-backups");
    expect(parsed.containerUrl).toBe(ACCOUNT);
    expect(sasDaysLeft(parsed, new Date("2026-12-22T00:00:00Z"))).toBe(10);
  });

  it("refuses account SAS, blob SAS, delete or list rights, and plain http", () => {
    expect(() => parseContainerSas(sas("ss=b&srt=sco&sp=cw"), "backup")).toThrow(/container-scoped/);
    expect(() => parseContainerSas(sas("sr=b&sp=cw"), "backup")).toThrow(/sr=c/);
    expect(() => parseContainerSas(sas("sr=c&sp=cwd"), "backup")).toThrow(/delete/);
    expect(() => parseContainerSas(sas("sr=c&sp=cwl"), "backup")).toThrow(/list/);
    expect(() => parseContainerSas(sas("sr=c&sp=cw").replace("https", "http"), "backup")).toThrow(/https/);
    expect(() => parseContainerSas(`${ACCOUNT}/postgres?sr=c&sp=cw&sig=x`, "backup")).toThrow(/container/);
    expect(() => parseContainerSas(undefined, "backup")).toThrow(BackupConfigError);
  });

  it("requires a read/list-only SAS for restores", () => {
    expect(parseContainerSas(sas("sr=c&sp=rl"), "restore").container).toBe("csb-db-backups");
    expect(() => parseContainerSas(sas("sr=c&sp=r"), "restore")).toThrow(/read \(r\) and list/);
    expect(() => parseContainerSas(sas("sr=c&sp=rlw"), "restore")).toThrow(/read and list only/);
  });

  it("never puts the signature in an error message", () => {
    try {
      parseContainerSas(sas("sr=c&sp=cwd"), "backup");
    } catch (e) {
      expect(String(e)).not.toContain("c3ludGhldGlj");
    }
  });
});

describe("backup names", () => {
  it("names backups by UTC time and picks the newest", () => {
    expect(backupBlobName(new Date("2026-11-09T02:37:05.123Z"))).toBe("postgres/20261109T023705Z/csb-care.dump.age");
    expect(
      latestBackupName([
        "postgres/20261101T023700Z/csb-care.dump.age",
        "postgres/20261109T023700Z/csb-care.dump.age",
        "postgres/20261105T023700Z/csb-care.dump.age",
        "postgres/notes.txt",
      ]),
    ).toBe("postgres/20261109T023700Z/csb-care.dump.age");
    expect(latestBackupName([])).toBeNull();
  });
});

describe("database URLs", () => {
  it("turns a URL into libpq variables and drops Prisma-only parameters", () => {
    const env = pgEnvFromUrl("postgresql://csb_owner:p%40ss@ep-calm-prod-111111.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require&schema=public");
    expect(env).toEqual({
      PGHOST: PROD,
      PGPORT: "5432",
      PGUSER: "csb_owner",
      PGPASSWORD: "p@ss",
      PGDATABASE: "neondb",
      PGSSLMODE: "require",
      PGCHANNELBINDING: "require",
    });
  });

  it("refuses the pooled Neon host for backups", () => {
    expect(() => pgEnvFromUrl("postgresql://u:p@ep-calm-prod-111111-pooler.eu-west-2.aws.neon.tech/neondb", { requireDirect: true })).toThrow(/unpooled/);
  });

  it("does not echo the password in errors", () => {
    expect(() => pgEnvFromUrl("mysql://u:secretvalue@h/db")).toThrow(/^(?!.*secretvalue)/);
  });
});

describe("restore target guard", () => {
  const staging = "postgresql://u:p@ep-quiet-stage-222222.eu-west-2.aws.neon.tech/csb_restore_check";

  it("allows a separate staging database", () => {
    expect(checkRestoreTarget(staging, PROD).PGDATABASE).toBe("csb_restore_check");
  });

  it("refuses production, by direct or pooled host, whatever the database name", () => {
    expect(() => checkRestoreTarget(`postgresql://u:p@${PROD}/csb_restore_check`, PROD)).toThrow(/production host/);
    expect(() => checkRestoreTarget("postgresql://u:p@ep-calm-prod-111111-pooler.eu-west-2.aws.neon.tech/staging", PROD)).toThrow(/production host/);
    expect(() => checkRestoreTarget(staging, `other.example, ${PROD.replace("ep-calm-prod-111111", "ep-calm-prod-111111-pooler")}`)).not.toThrow();
    expect(() => checkRestoreTarget(staging, "ep-quiet-stage-222222-pooler.eu-west-2.aws.neon.tech")).toThrow(/production host/);
  });

  it("refuses when production hosts are not listed or the name does not say restore/staging", () => {
    expect(() => checkRestoreTarget(staging, "")).toThrow(/PRODUCTION_DATABASE_HOSTS/);
    expect(() => checkRestoreTarget("postgresql://u:p@ep-quiet-stage-222222.eu-west-2.aws.neon.tech/neondb", PROD)).toThrow(/restore" or "staging/);
  });
});

describe("dump validation", () => {
  const line = (t: string) => `3456; 0 16390 TABLE DATA public ${t} csb_owner`;

  it("requires data for core tables and uploaded documents", () => {
    const full = REQUIRED_TABLES.map(line).join("\n");
    expect(missingTablesInToc(full)).toEqual([]);
    const withoutFiles = REQUIRED_TABLES.filter((t) => t !== "StoredObject").map(line).join("\n");
    expect(missingTablesInToc(withoutFiles)).toEqual(["StoredObject"]);
    // "User" must not be satisfied by "UserSession" or similar.
    expect(missingTablesInToc(full.replace(line("User"), line("UserSession")))).toEqual(["User"]);
  });
});
