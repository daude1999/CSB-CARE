import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { hasOrgPermission, type Ctx } from "../auth/rbac";
import { ACTION_PRIORITIES, ACTION_TYPES } from "../compliance/audits";
import { branchScope, startOfToday } from "./common";
import { rcaVisibleWhere } from "./visibility";

/**
 * Improvement actions: the corrective and preventative actions raised from root cause analyses and CQC assessments.
 * They are ordinary corrective actions (same table, same workflow, same independent verification on /actions/[id]);
 * this view only gathers them with where they came from. Actions from investigations the caller cannot open are left out.
 */
export const ACTION_STATUS = { OPEN: "Open", IN_PROGRESS: "In progress", COMPLETED: "Awaiting verification", VERIFIED: "Verified", CLOSED: "Closed" } as const;

export async function improvementActions(ctx: Ctx, f: { status?: string; source?: string; owner?: string } = {}) {
  const organisationId = ctx.organisationId;
  if (!organisationId || (!hasOrgPermission(ctx, "cqc.view") && !hasOrgPermission(ctx, "rca.view") && !hasOrgPermission(ctx, "rca.investigate"))) throw new ForbiddenError("You cannot see improvement actions");
  const canRca = hasOrgPermission(ctx, "rca.view") || hasOrgPermission(ctx, "rca.investigate");
  const sources: Prisma.ComplianceActionWhereInput[] = [];
  if (canRca && f.source !== "CQC") sources.push({ rca: rcaVisibleWhere(ctx) });
  if (hasOrgPermission(ctx, "cqc.view") && f.source !== "RCA") sources.push({ cqcAssessment: { organisationId, AND: [branchScope(ctx)] } });
  if (!sources.length) return [];
  const today = startOfToday();
  const status: Prisma.ComplianceActionWhereInput = f.status === "OVERDUE" ? { status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: today } } : f.status === "OPEN" ? { status: { in: ["OPEN", "IN_PROGRESS", "COMPLETED"] } } : f.status && f.status in ACTION_STATUS ? { status: f.status } : {};
  const rows = await db.complianceAction.findMany({
    where: { organisationId, OR: sources, ...status, ...(f.owner ? { ownerId: f.owner } : {}) },
    include: { rca: { select: { id: true, reference: true, restricted: true } }, rcaFinding: { select: { kind: true, text: true } }, cqcAssessment: { select: { id: true, reference: true } }, cqcCriterion: { select: { code: true, title: true } }, history: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: [{ dueDate: "asc" }],
    take: 500,
  });
  // A stable reference for each action: its source's reference and its order within that source.
  const order = await db.complianceAction.findMany({ where: { organisationId, OR: [{ rcaId: { in: rows.map((r) => r.rcaId).filter((x): x is string => Boolean(x)) } }, { cqcAssessmentId: { in: rows.map((r) => r.cqcAssessmentId).filter((x): x is string => Boolean(x)) } }] }, select: { id: true, rcaId: true, cqcAssessmentId: true }, orderBy: { createdAt: "asc" } });
  const seq = new Map<string, number>();
  const counters = new Map<string, number>();
  for (const o of order) {
    const k = o.rcaId ?? o.cqcAssessmentId!;
    const n = (counters.get(k) ?? 0) + 1;
    counters.set(k, n);
    seq.set(o.id, n);
  }
  const names = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.ownerId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return rows.map((a) => {
    const source = a.rca?.reference ?? a.cqcAssessment?.reference ?? "";
    return {
      ...a,
      reference: `${source}/A${seq.get(a.id) ?? 1}`,
      sourceLabel: a.rca ? a.rca.reference : `${a.cqcAssessment?.reference ?? ""}${a.cqcCriterion ? ` ${a.cqcCriterion.code}` : ""}`,
      sourceHref: a.rca ? `/compliance/cqc/rca/${a.rca.id}` : a.cqcAssessment ? `/compliance/cqc/assessments/${a.cqcAssessment.id}` : null,
      ownerName: names.get(a.ownerId) ?? "Unknown",
      typeLabel: a.actionType ? ACTION_TYPES[a.actionType as keyof typeof ACTION_TYPES] : "Corrective",
      priorityLabel: a.priority ? ACTION_PRIORITIES[a.priority as keyof typeof ACTION_PRIORITIES] : "—",
      statusLabel: ACTION_STATUS[a.status as keyof typeof ACTION_STATUS] ?? a.status,
      verification: a.status === "VERIFIED" || a.status === "CLOSED" ? "Verified independently" : a.status === "COMPLETED" ? "Awaiting verification" : "Not yet completed",
      overdue: ["OPEN", "IN_PROGRESS"].includes(a.status) && a.dueDate < today,
    };
  });
}
