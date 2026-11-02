import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, dbDate, londonDate } from "@/lib/london";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { effectiveClocks } from "@/server/rota/attendance";
import { memberNames } from "@/server/rota/queries";
import { rotaScope, visitWhere } from "@/server/rota/scope";
import { NOTE_LABEL } from "./visit-record";
import { reviewState } from "./risks";
import { bodyMapCounts } from "./body-map";
import { documentCounts } from "./su-documents";

/**
 * Records that belong to one service user, read for their profile: the visit notes written on their visits, and the
 * "Records and compliance" summary on the Overview. Everything is counted from real records in the caller's scope.
 * The caller has already opened the person through getServiceUser, which checks they may see them.
 */

/** Visit notes about one person, newest first, each with its visit's planned time, actual time and who wrote it. */
export async function serviceUserVisitNotes(ctx: Ctx, serviceUserId: string, f: { category?: string; days?: number; q?: string } = {}) {
  if (!hasOrgPermission(ctx, "rota.view")) return null;
  const scope = await rotaScope(ctx, "rota.view");
  const category = f.category && f.category in NOTE_LABEL ? f.category : undefined;
  const days = f.days && [30, 90, 365].includes(f.days) ? f.days : 90;
  const where: Prisma.VisitNoteWhereInput = {
    organisationId: scope.organisationId,
    createdAt: { gte: new Date(Date.now() - days * 86_400_000) },
    visit: { ...visitWhere(scope), serviceUserId },
    ...(category ? { category } : {}),
    ...(f.q ? { text: { contains: f.q, mode: "insensitive" } } : {}),
  };
  const notes = await db.visitNote.findMany({
    where,
    include: { visit: { select: { id: true, reference: true, scheduledStart: true, scheduledEnd: true, status: true, callType: { select: { name: true } }, clocks: { select: { id: true, kind: true, at: true, staffId: true, supersedesId: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const staffIds = [...new Set(notes.flatMap((n) => (n.staffId ? [n.staffId] : [])))];
  const [staff, members] = await Promise.all([
    staffIds.length ? db.staffMember.findMany({ where: { organisationId: scope.organisationId, id: { in: staffIds } }, select: { id: true, displayName: true } }) : Promise.resolve([]),
    memberNames(ctx, notes.filter((n) => !n.staffId).map((n) => n.authorUserId)),
  ]);
  const staffName = new Map(staff.map((s) => [s.id, s.displayName]));
  return {
    days,
    notes: notes.map((n) => {
      // The note writer's own clock times when they were a carer on the visit; otherwise the visit's first in and last out.
      const clocks = effectiveClocks(n.visit.clocks).filter((c) => !n.staffId || c.staffId === n.staffId);
      const inAt = clocks.find((c) => c.kind === "IN")?.at ?? null;
      const outAt = clocks.filter((c) => c.kind === "OUT").at(-1)?.at ?? null;
      return {
        id: n.id,
        category: n.category,
        text: n.text,
        createdAt: n.createdAt,
        author: n.staffId ? staffName.get(n.staffId) ?? "Former staff" : members.get(n.authorUserId) ?? "Office",
        fromOffice: !n.staffId,
        visit: { id: n.visit.id, reference: n.visit.reference, callType: n.visit.callType.name, scheduledStart: n.visit.scheduledStart, scheduledEnd: n.visit.scheduledEnd },
        actualMinutes: inAt && outAt && outAt > inAt ? Math.round((outAt.getTime() - inAt.getTime()) / 60000) : null,
      };
    }),
  };
}

export type ComplianceTone = "green" | "amber" | "rose" | "slate";
export interface ComplianceRow {
  key: string;
  label: string;
  value: string;
  detail?: string;
  tone: ComplianceTone;
  href: string;
}

/**
 * The person's records at a glance: the care plan, risk assessments, incidents and visit-note concerns, each with a
 * plain status and a link to its section. A row is left out when the viewer may not see that kind of record.
 */
export async function serviceUserCompliance(ctx: Ctx, su: { id: string; organisationId: string }): Promise<ComplianceRow[]> {
  const base = `/rota/service-users/${su.id}`;
  const today = londonDate();
  const todayDb = dbDate(today);
  const canIncidents = hasOrgPermission(ctx, "incident.report");
  const canNotes = hasOrgPermission(ctx, "rota.view");
  const incidentWhere: Prisma.IncidentWhereInput = { organisationId: su.organisationId, serviceUserId: su.id, status: { not: "CLOSED" }, ...(hasOrgPermission(ctx, "incident.manage") ? {} : { reportedById: ctx.userId }) };
  const [plans, risks, openIncidents, safeguarding, concerns, notes] = await Promise.all([
    db.carePlan.findMany({ where: { organisationId: su.organisationId, serviceUserId: su.id, status: { in: ["ACTIVE", "DRAFT", "IN_REVIEW"] } }, select: { version: true, status: true, reviewDue: true } }),
    db.riskAssessment.findMany({ where: { organisationId: su.organisationId, serviceUserId: su.id, status: "ACTIVE" }, select: { reviewDue: true, level: true } }),
    canIncidents ? db.incident.count({ where: incidentWhere }) : Promise.resolve(0),
    canIncidents ? db.incident.count({ where: { ...incidentWhere, safeguarding: true } }) : Promise.resolve(0),
    canNotes ? db.visitNote.count({ where: { organisationId: su.organisationId, category: "CONCERN", createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) }, visit: { serviceUserId: su.id } } }) : Promise.resolve(0),
    canNotes ? db.visitNote.count({ where: { organisationId: su.organisationId, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) }, visit: { serviceUserId: su.id } } }) : Promise.resolve(0),
  ]);
  const rows: ComplianceRow[] = [];

  const inUse = plans.find((p) => p.status === "ACTIVE");
  const pending = plans.find((p) => p.status !== "ACTIVE");
  const planOverdue = inUse?.reviewDue ? inUse.reviewDue < todayDb : false;
  const planSoon = inUse?.reviewDue ? !planOverdue && inUse.reviewDue <= dbDate(addDays(today, 30)) : false;
  rows.push({
    key: "care-plan",
    label: "Care plan",
    value: inUse ? (planOverdue ? "Review overdue" : planSoon ? "Review due soon" : "In use") : "No plan in use",
    detail: [inUse ? `Version ${inUse.version} in use` : null, pending ? `version ${pending.version} ${pending.status === "IN_REVIEW" ? "awaiting approval" : "in draft"}` : null].filter(Boolean).join(", ") || undefined,
    tone: !inUse || planOverdue ? "rose" : planSoon ? "amber" : "green",
    href: `${base}?tab=care-plans`,
  });

  const states = risks.map((r) => reviewState(r.reviewDue, today));
  const overdue = states.filter((s) => s === "OVERDUE").length;
  const soon = states.filter((s) => s === "DUE_SOON").length;
  const high = risks.filter((r) => r.level === "HIGH").length;
  rows.push({
    key: "risks",
    label: "Risk assessments",
    value: !risks.length ? "None recorded" : overdue ? `${overdue} past review date` : soon ? `${soon} due for review soon` : "All in date",
    detail: risks.length ? `${risks.length} active${high ? `, ${high} high risk` : ""}` : undefined,
    tone: !risks.length ? "amber" : overdue ? "rose" : soon ? "amber" : "green",
    href: `${base}?tab=risks`,
  });

  if (canIncidents) {
    rows.push({
      key: "incidents",
      label: "Incidents",
      value: openIncidents ? `${openIncidents} open` : "None open",
      detail: safeguarding ? `${safeguarding} safeguarding` : undefined,
      tone: safeguarding ? "rose" : openIncidents ? "amber" : "green",
      href: `${base}?tab=incidents`,
    });
  }

  if (canNotes) {
    rows.push({
      key: "notes",
      label: "Visit notes, last 30 days",
      value: concerns ? `${concerns} ${concerns === 1 ? "concern" : "concerns"}` : notes ? "No concerns" : "No notes written",
      detail: notes ? `${notes} ${notes === 1 ? "note" : "notes"} in all` : undefined,
      tone: concerns ? "amber" : "slate",
      href: `${base}?tab=notes`,
    });
  }

  const [docs, bodyMap] = await Promise.all([documentCounts(ctx, su.id), bodyMapCounts(ctx, su.id)]);
  if (docs) {
    // Only the required council documents (Council Support Plan, Purchase Order) can be missing; optional ones never are.
    const missing = docs.council.missing.map((m) => m.label);
    const expired = docs.council.expired + docs.other.expired;
    rows.push({
      key: "documents",
      label: "Documents",
      value: missing.length ? `Missing: ${missing.join(", ")}` : expired ? `${expired} expired` : "Required documents held",
      detail: `${docs.council.uploaded} council, ${docs.other.uploaded} other${missing.length && expired ? `, ${expired} expired` : ""}`,
      tone: missing.length ? "rose" : expired ? "amber" : "green",
      href: `${base}?tab=documents&section=council`,
    });
  }
  if (bodyMap && bodyMap.total) {
    rows.push({
      key: "bodymap",
      label: "Body map",
      value: bodyMap.overdue ? `${bodyMap.overdue} follow-up${bodyMap.overdue === 1 ? "" : "s"} overdue` : bodyMap.outstanding ? `${bodyMap.outstanding} follow-up${bodyMap.outstanding === 1 ? "" : "s"} outstanding` : "No follow-ups outstanding",
      detail: [`${bodyMap.reviewed} reviewed`, bodyMap.awaitingDecision ? `${bodyMap.awaitingDecision} awaiting manager review` : null].filter(Boolean).join(", "),
      tone: bodyMap.overdue ? "rose" : bodyMap.outstanding || bodyMap.awaitingDecision ? "amber" : "green",
      href: `${base}?tab=bodymap`,
    });
  }
  return rows;
}
