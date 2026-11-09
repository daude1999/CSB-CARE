// Types for lib.mjs (plain JavaScript so the self-hosted runner needs no build step).
export class BackupConfigError extends Error {}
export interface ContainerSas { containerUrl: string; sas: string; container: string; expiresAt: Date | null }
export type PgEnv = Record<"PGHOST" | "PGPORT" | "PGUSER" | "PGPASSWORD" | "PGDATABASE" | "PGSSLMODE", string> &
  Partial<Record<"PGCHANNELBINDING" | "PGOPTIONS", string>>;
export function parseContainerSas(raw: string | undefined, purpose: "backup" | "restore"): ContainerSas;
export function sasDaysLeft(parsed: ContainerSas, now?: Date): number | null;
export function backupBlobName(date?: Date): string;
export function isBackupBlobName(name: string): boolean;
export function latestBackupName(names: string[]): string | null;
export function pgEnvFromUrl(raw: string | undefined, opts?: { label?: string; requireDirect?: boolean }): PgEnv;
export function databaseHostKey(host: string): string;
export function checkRestoreTarget(targetRaw: string | undefined, productionHostsRaw: string | undefined): PgEnv;
export const REQUIRED_TABLES: readonly string[];
export function missingTablesInToc(tocText: string): string[];
