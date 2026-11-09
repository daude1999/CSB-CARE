import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { MODULE_KEYS } from "@/lib/platform-modules";
import { confirmOwnPassword, requirePlatform } from "./access";

/**
 * Platform settings (Admin Centre → Platform Settings). Every setting here is read by working code; its `effect` says
 * exactly where. Nothing decorative and no secrets: API keys, database and email passwords stay in the hosting
 * environment and are shown only as "configured" or "not configured".
 */
type Kind = "text" | "email" | "int" | "bool" | "modules" | "longtext";
interface Def<T> {
  group: SettingGroup;
  label: string;
  kind: Kind;
  default: T;
  effect: string;
  schema: z.ZodType<T>;
  /** Changing it needs the administrator's own password again. */
  sensitive?: boolean;
}
export type SettingGroup = "general" | "authentication" | "notifications" | "ai" | "customers" | "maintenance";
export const SETTING_GROUPS: { id: SettingGroup; name: string }[] = [
  { id: "general", name: "General" },
  { id: "authentication", name: "Authentication" },
  { id: "notifications", name: "Notifications" },
  { id: "ai", name: "AI configuration" },
  { id: "customers", name: "Default customer configuration" },
  { id: "maintenance", name: "Maintenance" },
];

const optInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable();
const def = <T>(d: Def<T>) => d;

export const SETTINGS = {
  "general.platformName": def({ group: "general", label: "Platform name", kind: "text", default: "Evantix", schema: z.string().trim().min(2).max(60), effect: "Shown in the Admin Centre header and sidebar." }),
  "general.supportEmail": def({ group: "general", label: "Support email", kind: "email", default: "", schema: z.union([z.literal(""), z.string().trim().email().max(200)]), effect: "Shown to customer staff when their organisation is suspended, and on password and invitation pages." }),
  "general.supportPhone": def({ group: "general", label: "Support telephone", kind: "text", default: "", schema: z.string().trim().max(40), effect: "Shown beside the support email in the same places." }),
  "auth.inviteExpiryDays": def({ group: "authentication", label: "Invitation link expiry (days)", kind: "int", default: 7, schema: z.number().int().min(1).max(30), sensitive: true, effect: "How long a new invitation link works, for customer administrators and Evantix alike." }),
  "auth.resetExpiryHours": def({ group: "authentication", label: "Password reset link expiry (hours)", kind: "int", default: 24, schema: z.number().int().min(1).max(72), sensitive: true, effect: "How long a new password reset link works." }),
  "auth.passwordMinLength": def({ group: "authentication", label: "Minimum password length", kind: "int", default: 12, schema: z.number().int().min(12).max(64), sensitive: true, effect: "The shortest password accepted when anyone sets or resets a password. Never below 12." }),
  "auth.resetLinksPerHour": def({ group: "authentication", label: "Reset links per person per hour", kind: "int", default: 5, schema: z.number().int().min(1).max(20), sensitive: true, effect: "Abuse protection: how many reset links can be created for one person in an hour." }),
  "notifications.securityAlerts": def({ group: "notifications", label: "Security alerts to platform administrators", kind: "bool", default: true, schema: z.boolean(), effect: "When on, every platform administrator gets an in-app notification when platform roles change, an account is deactivated, a customer is suspended or emergency support access is used." }),
  "ai.inputPencePerMillionTokens": def({ group: "ai", label: "Input token price (pence per million)", kind: "int", default: null as number | null, schema: optInt(0, 1_000_000), effect: "Used to estimate AI cost from measured tokens. Empty means AI cost is shown as not configured." }),
  "ai.outputPencePerMillionTokens": def({ group: "ai", label: "Output token price (pence per million)", kind: "int", default: null as number | null, schema: optInt(0, 1_000_000), effect: "As above, for output tokens." }),
  "ai.platformMonthlyRequests": def({ group: "ai", label: "Platform-wide AI requests per month", kind: "int", default: null as number | null, schema: optInt(1, 10_000_000), effect: "A ceiling across all customers. When reached, AI requests are refused until the next month. Empty means no ceiling." }),
  "customers.trialDays": def({ group: "customers", label: "Trial length (days)", kind: "int", default: 30, schema: z.number().int().min(1).max(180), effect: "The trial end date proposed when a new client starts on a trial." }),
  "customers.defaultModules": def({ group: "customers", label: "Modules ticked for a new client", kind: "modules", default: [...MODULE_KEYS] as string[], schema: z.array(z.enum(MODULE_KEYS)), effect: "Pre-selected modules in Add New Client. The plan and the administrator can still change them." }),
  "customers.defaultStorageMb": def({ group: "customers", label: "Default storage allowance (MB)", kind: "int", default: null as number | null, schema: optInt(1, 10_000_000), effect: "Proposed storage allowance for a new client when its plan sets none." }),
  "maintenance.notice": def({ group: "maintenance", label: "Maintenance notice", kind: "longtext", default: "", schema: z.string().trim().max(300), effect: "When filled in, shown as a banner at the top of every page for every signed-in person." }),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]["default"];

export function isSettingKey(k: string): k is SettingKey {
  return k in SETTINGS;
}

/** One setting's value, or its default. Safe to call without a platform context: it is used by working code. */
export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const row = await db.platformSetting.findUnique({ where: { key } });
  const d = SETTINGS[key];
  if (!row) return d.default as SettingValue<K>;
  const p = (d.schema as z.ZodType).safeParse(row.value);
  return (p.success ? p.data : d.default) as SettingValue<K>;
}

export async function allSettings(ctx: Ctx) {
  requirePlatform(ctx, "platform.settings");
  const rows = await db.platformSetting.findMany();
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return (Object.keys(SETTINGS) as SettingKey[]).map((key) => {
    const d = SETTINGS[key];
    const row = byKey.get(key);
    const p = row ? (d.schema as z.ZodType).safeParse(row.value) : null;
    return { key, ...d, schema: undefined, value: p?.success ? p.data : d.default, updatedAt: row?.updatedAt ?? null, updatedById: row?.updatedById ?? null };
  });
}

/** Turns raw form text into the setting's type. Empty optional numbers become null. */
export function coerceSetting(key: SettingKey, raw: string | string[] | undefined): unknown {
  const kind = SETTINGS[key].kind;
  if (kind === "modules") return Array.isArray(raw) ? raw : raw ? [raw] : [];
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (kind === "bool") return v === "on" || v === "true";
  if (kind === "int") {
    if (v === undefined || v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return v ?? "";
}

/** Saves one group of settings. Authentication settings need the administrator's own password. Audited with before and after. */
export async function updateSettings(ctx: Ctx, group: SettingGroup, values: Record<string, unknown>, confirmPassword?: string) {
  requirePlatform(ctx, "platform.settings");
  const keys = (Object.keys(SETTINGS) as SettingKey[]).filter((k) => SETTINGS[k].group === group);
  if (!keys.length) throw new NotFoundError("Settings group");
  if (keys.some((k) => SETTINGS[k].sensitive)) await confirmOwnPassword(ctx, confirmPassword);
  const parsed: [SettingKey, unknown][] = [];
  for (const k of keys) {
    if (!(k in values)) continue;
    const p = (SETTINGS[k].schema as z.ZodType).safeParse(values[k]);
    if (!p.success) throw new ValidationError(`${SETTINGS[k].label}: ${p.error.issues[0]?.message ?? "not valid"}`);
    parsed.push([k, p.data]);
  }
  const before = await db.platformSetting.findMany({ where: { key: { in: parsed.map(([k]) => k) } } });
  const old = new Map(before.map((r) => [r.key, r.value]));
  const changed = parsed.filter(([k, v]) => JSON.stringify(old.get(k) ?? SETTINGS[k].default) !== JSON.stringify(v));
  if (!changed.length) return { changed: 0 };
  await db.$transaction(async (tx) => {
    for (const [key, value] of changed) {
      await tx.platformSetting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue, updatedById: ctx.userId }, update: { value: value as Prisma.InputJsonValue, updatedById: ctx.userId } });
    }
    await audit({ actorId: ctx.userId, action: "platform.settings.updated", entityType: "PlatformSetting", entityId: group, data: { changes: changed.map(([k, v]) => ({ key: k, before: (old.get(k) ?? SETTINGS[k].default) as Prisma.InputJsonValue, after: v as Prisma.InputJsonValue })) } }, tx);
  });
  return { changed: changed.length };
}

/** The last verified restore test, recorded by a person (the platform cannot verify a restore by itself). */
const restoreSchema = z.object({ testedOn: z.coerce.date(), outcome: z.enum(["PASSED", "FAILED"]), notes: z.string().trim().max(500).default("") });
export type RestoreTest = { testedOn: string; outcome: "PASSED" | "FAILED"; notes: string; recordedById: string; recordedAt: string };

export async function recordRestoreTest(ctx: Ctx, input: { testedOn: string; outcome: string; notes?: string }) {
  requirePlatform(ctx, "platform.settings");
  const p = restoreSchema.safeParse(input);
  if (!p.success) throw new ValidationError("Give the date of the restore test and whether it passed");
  if (p.data.testedOn.getTime() > Date.now() + 60_000) throw new ValidationError("A restore test cannot be in the future");
  const value: RestoreTest = { testedOn: p.data.testedOn.toISOString(), outcome: p.data.outcome, notes: p.data.notes, recordedById: ctx.userId, recordedAt: new Date().toISOString() };
  await db.$transaction(async (tx) => {
    await tx.platformSetting.upsert({ where: { key: "maintenance.lastRestoreTest" }, create: { key: "maintenance.lastRestoreTest", value, updatedById: ctx.userId }, update: { value, updatedById: ctx.userId } });
    await audit({ actorId: ctx.userId, action: "platform.restore_test.recorded", entityType: "PlatformSetting", entityId: "maintenance.lastRestoreTest", data: value }, tx);
  });
}

export async function lastRestoreTest(): Promise<RestoreTest | null> {
  const row = await db.platformSetting.findUnique({ where: { key: "maintenance.lastRestoreTest" } });
  return row ? (row.value as RestoreTest) : null;
}
