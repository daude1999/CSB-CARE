import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { hasOrgPermission, type Ctx } from "../auth/rbac";
import { centralWhere, DOC_TYPE_NAMES } from "./library-view";

/**
 * Monthly Updates register (owner's brief, 5 Nov 2026): every policy, procedure, form and template version published
 * in a month that applies to the signed-in organisation — its own documents, its customised copies of CSB documents
 * (including CSB central updates applied automatically) and the CSB central documents it uses as published. Only
 * published versions are listed: a regulatory change or an AI draft never appears here until a person publishes it.
 */

export const UPDATE_GROUPS = [
  ["policies", "Policies", ["POLICY", "GUIDANCE"]],
  ["procedures", "Procedures", ["PROCEDURE"]],
  ["forms", "Forms", ["FORM", "CHECKLIST", "RISK_ASSESSMENT", "AUDIT_TOOL"]],
  ["templates", "Templates", ["TEMPLATE"]],
] as const;
export type UpdateGroup = (typeof UPDATE_GROUPS)[number][0];

const MonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const GroupSchema = z.enum(UPDATE_GROUPS.map((g) => g[0]) as [UpdateGroup, ...UpdateGroup[]]);

export type UpdatesQuery = { month: string; group?: UpdateGroup };

/** The month (YYYY-MM, UK time) and document group from the address bar; anything malformed falls back to this month. */
export function parseUpdatesQuery(sp: Record<string, string | string[] | undefined>, now = new Date()): UpdatesQuery {
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : sp[k]);
  const m = MonthSchema.safeParse(one("month"));
  const g = GroupSchema.safeParse(one("type"));
  return { month: m.success ? m.data : ukMonth(now), group: g.success ? g.data : undefined };
}

export function ukMonth(d: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit" }).formatToParts(d);
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}

/** Start and end of a UK calendar month as instants (the month boundary follows British Summer Time). */
export function monthRange(month: string): { from: Date; to: Date } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const ukMidnight = (year: number, mon: number) => {
    const utc = Date.UTC(year, mon - 1, 1);
    const londonHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(new Date(utc)));
    return new Date(utc - londonHour * 3600_000);
  };
  return { from: ukMidnight(y, m), to: m === 12 ? ukMidnight(y + 1, 1) : ukMidnight(y, m + 1) };
}

export function shiftMonth(month: string, by: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface UpdateRow {
  versionId: string;
  policyId: string;
  ref: string;
  title: string;
  docType: string;
  docTypeName: string;
  category: string;
  change: "New" | "Updated";
  source: "CSB central" | "CSB central update" | "Your organisation";
  previousLabel: string | null;
  label: string;
  summary: string | null;
  publishedAt: Date;
  /** Regulatory impact where one was assessed for the change that led to this version. */
  impact: string | null;
  /** Staff reading for this version, when your organisation asked staff to read it and you may see sign-off. */
  reading: { signed: number; assigned: number } | null;
  sectionKeys: string[];
}

export async function monthlyUpdates(ctx: Ctx, q: UpdatesQuery) {
  if (!ctx.organisationId) throw new ForbiddenError("Monthly updates are shown for an organisation");
  const orgId = ctx.organisationId;
  const { from, to } = monthRange(q.month);
  const policyScope: Prisma.PolicyWhereInput = { OR: [{ kind: "CUSTOMER", organisationId: orgId }, await centralWhere(orgId)] };
  const canSeeReading = hasOrgPermission(ctx, "staff.view");
  const versions = await db.policyVersion.findMany({
    where: { publishedAt: { gte: from, lt: to }, status: { in: ["PUBLISHED", "SUPERSEDED", "ARCHIVED"] }, policy: policyScope },
    orderBy: { publishedAt: "desc" },
    take: 500,
    select: {
      id: true, label: true, origin: true, createdById: true, previousVersionId: true, changeSummary: true, reasonForChange: true, publishedAt: true,
      sections: { select: { key: true }, orderBy: { position: "asc" } },
      policy: { select: { id: true, ref: true, title: true, docType: true, kind: true, category: { select: { name: true } } } },
      revisionAsDraft: { select: { kind: true, impactAssessment: { select: { urgency: true } } } },
      publication: { select: { requiresAcknowledgement: true, materialRevision: true, acknowledgements: { where: { supersededAt: null, state: { notIn: ["WITHDRAWN", "EXEMPTED"] } }, select: { acknowledgedAt: true } } } },
    },
  });
  const previous = new Map((await db.policyVersion.findMany({ where: { id: { in: versions.map((v) => v.previousVersionId).filter((x): x is string => Boolean(x)) } }, select: { id: true, label: true } })).map((v) => [v.id, v.label]));
  const all: UpdateRow[] = versions.map((v) => {
    const acks = v.publication?.acknowledgements;
    const rev = v.revisionAsDraft;
    return {
      versionId: v.id,
      policyId: v.policy.id,
      ref: v.policy.ref,
      title: v.policy.title,
      docType: v.policy.docType,
      docTypeName: DOC_TYPE_NAMES.get(v.policy.docType) ?? v.policy.docType,
      category: v.policy.category.name,
      change: v.previousVersionId ? "Updated" : "New",
      source: v.policy.kind === "MASTER" ? "CSB central" : v.origin === "MASTER_SYNC" && !v.createdById ? "CSB central update" : "Your organisation",
      previousLabel: v.previousVersionId ? (previous.get(v.previousVersionId) ?? null) : null,
      label: v.label,
      summary: v.changeSummary ?? v.reasonForChange ?? null,
      publishedAt: v.publishedAt!,
      impact: rev?.impactAssessment ? `Regulatory change · ${rev.impactAssessment.urgency.toLowerCase()} urgency` : rev?.kind === "REGULATORY" ? "Regulatory change" : null,
      reading: canSeeReading && v.policy.kind === "CUSTOMER" && acks?.length ? { signed: acks.filter((a) => a.acknowledgedAt).length, assigned: acks.length } : null,
      sectionKeys: v.sections.map((s) => s.key),
    };
  });
  const inGroup = (r: UpdateRow, g: UpdateGroup) => (UPDATE_GROUPS.find((x) => x[0] === g)![2] as readonly string[]).includes(r.docType);
  const counts = Object.fromEntries(UPDATE_GROUPS.map(([key]) => [key, all.filter((r) => inGroup(r, key)).length])) as Record<UpdateGroup, number>;
  const rows = q.group ? all.filter((r) => inGroup(r, q.group!)) : all;
  return { rows, total: all.length, counts, newCount: rows.filter((r) => r.change === "New").length, updatedCount: rows.filter((r) => r.change === "Updated").length, canSeeReading };
}
