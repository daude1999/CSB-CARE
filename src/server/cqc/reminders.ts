import { db } from "@/lib/db";
import { isoWeek, londonDate } from "@/lib/london";
import { notify } from "../notifications/notify";
import { membersWithRoles, startOfToday } from "./common";
import { OPEN_RCA } from "./rca";

/**
 * Daily reminders for CQC Inspection & Evidence, run from the maintenance tick. Every reminder goes through the
 * existing notification service (in-app plus email, with its delivery record, retries and de-duplication), carries
 * only references and non-sensitive categories, and is sent once per due date (or once a week for evidence gaps).
 */
export async function sendCqcReminders(now = new Date()) {
  const today = startOfToday();
  const week = isoWeek(londonDate(now));
  let sent = 0;
  const due = (d: Date) => d.toISOString().slice(0, 10);
  const link = (id: string) => [{ label: "Open the investigation", url: `/compliance/cqc/rca/${id}` }];
  const what = (r: { reference: string; category: string; restricted: boolean }) => (r.restricted ? `${r.reference} (restricted investigation)` : `${r.reference}: ${r.category}`);

  // Overdue investigations: the investigator and the responsible manager.
  const overdue = await db.rcaInvestigation.findMany({ where: { status: { in: OPEN_RCA }, dueDate: { lt: today } }, select: { id: true, organisationId: true, reference: true, category: true, restricted: true, ownerId: true, managerId: true, dueDate: true } });
  for (const r of overdue) {
    sent += await notify({ organisationId: r.organisationId, userIds: [r.ownerId, r.managerId], type: "rca.overdue", title: `${r.reference} is overdue`, body: `${what(r)}. Action required: complete the investigation or agree a new due date. Due: ${due(r.dueDate)}.`, reason: "You are the investigator or responsible manager.", links: link(r.id), actionUrl: `/compliance/cqc/rca/${r.id}`, dueAt: r.dueDate, dedupeKey: `rca-overdue:${r.id}:${due(r.dueDate)}` });
  }

  // Effectiveness reviews due: every action verified but the review not yet started.
  const atActions = await db.rcaInvestigation.findMany({ where: { status: "ACTIONS_IN_PROGRESS", actions: { some: {} } }, select: { id: true, organisationId: true, reference: true, category: true, restricted: true, managerId: true, dueDate: true, reopenCount: true, actions: { select: { status: true } } } });
  for (const r of atActions) {
    if (!r.actions.every((a) => a.status === "VERIFIED" || a.status === "CLOSED")) continue;
    sent += await notify({ organisationId: r.organisationId, userIds: [r.managerId], type: "rca.effectiveness", title: `${r.reference}: effectiveness review due`, body: `${what(r)}. Action required: check whether the improvements worked. Due: ${due(r.dueDate)}.`, reason: "You are the responsible manager.", links: link(r.id), actionUrl: `/compliance/cqc/rca/${r.id}`, dueAt: r.dueDate, dedupeKey: `rca-effectiveness:${r.id}:${r.reopenCount}:${r.actions.length}` });
  }

  // Overdue actions from investigations and assessments: the owner (and the investigation's manager).
  const actions = await db.complianceAction.findMany({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: today }, OR: [{ rcaId: { not: null } }, { cqcAssessmentId: { not: null } }] }, select: { id: true, organisationId: true, title: true, ownerId: true, dueDate: true, rca: { select: { reference: true, managerId: true } }, cqcAssessment: { select: { reference: true } } } });
  for (const a of actions) {
    const src = a.rca?.reference ?? a.cqcAssessment?.reference ?? "";
    sent += await notify({ organisationId: a.organisationId, userIds: [a.ownerId, ...(a.rca ? [a.rca.managerId] : [])], type: "action.overdue", title: `Overdue action from ${src}`, body: `${a.title}. Action required: complete the action and attach the evidence. Due: ${due(a.dueDate)}.`, reason: "You own this action, or manage the investigation it came from.", links: [{ label: "Open the action", url: `/actions/${a.id}` }], actionUrl: `/actions/${a.id}`, dueAt: a.dueDate, dedupeKey: `action-overdue:${a.id}:${due(a.dueDate)}` });
  }

  // Significant evidence gaps: essential areas with no verified evidence in the latest assessment, once a week.
  const assessments = await db.cqcAssessment.findMany({ where: { status: { in: ["IN_PROGRESS", "AWAITING_APPROVAL", "APPROVED"] } }, orderBy: { createdAt: "desc" }, select: { id: true, organisationId: true, reference: true, branchId: true, frameworkId: true } });
  const seen = new Set<string>();
  for (const a of assessments) {
    const scope = `${a.organisationId}:${a.branchId ?? "org"}`;
    if (seen.has(scope)) continue;
    seen.add(scope);
    const essential = await db.cqcCriterion.findMany({ where: { frameworkId: a.frameworkId, essential: true }, select: { id: true } });
    const na = new Set((await db.cqcAssessmentResult.findMany({ where: { assessmentId: a.id, result: "NOT_APPLICABLE" }, select: { criterionId: true } })).map((r) => r.criterionId));
    const verified = new Set((await db.cqcEvidenceLink.findMany({ where: { organisationId: a.organisationId, status: "VERIFIED", OR: [{ validUntil: null }, { validUntil: { gte: now } }], ...(a.branchId ? { AND: [{ OR: [{ branchId: a.branchId }, { branchId: null }] }] } : {}) }, select: { criterionId: true } })).map((l) => l.criterionId));
    const gaps = essential.filter((c) => !na.has(c.id) && !verified.has(c.id)).length;
    if (!gaps) continue;
    const leads = (await membersWithRoles(a.organisationId, ["ORG_ADMIN", "COMPLIANCE_LEAD"])).map((m) => m.id);
    sent += await notify({ organisationId: a.organisationId, userIds: leads, type: "cqc.evidence.gap", title: `${gaps} essential area${gaps === 1 ? "" : "s"} without verified evidence`, body: `${a.reference}: ${gaps} essential assessment area${gaps === 1 ? " has" : "s have"} no verified, in-date evidence. Action required: link and verify evidence, or record why the area does not apply.`, reason: "You lead compliance for your organisation.", links: [{ label: "Open the evidence", url: "/compliance/cqc/evidence?status=GAPS" }], actionUrl: "/compliance/cqc/evidence?status=GAPS", dedupeKey: `cqc-gap:${a.id}:${week}` });
  }

  // Critical compliance concern: a critical or safeguarding incident still open with no investigation after a day.
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const incidents = await db.incident.findMany({ where: { status: { not: "CLOSED" }, reportedAt: { lt: dayAgo }, OR: [{ severity: "CRITICAL" }, { safeguarding: true, severity: { in: ["HIGH", "CRITICAL"] } }] }, select: { id: true, organisationId: true, reference: true } });
  for (const i of incidents) {
    const linked = await db.rcaSourceLink.findFirst({ where: { organisationId: i.organisationId, sourceType: "INCIDENT", sourceId: i.id } });
    if (linked) continue;
    const managers = (await membersWithRoles(i.organisationId, ["ORG_ADMIN", "COMPLIANCE_LEAD", "CARE_MANAGER"])).map((m) => m.id);
    sent += await notify({ organisationId: i.organisationId, userIds: managers, type: "cqc.critical", title: `${i.reference} needs management attention`, body: `${i.reference} is a serious incident still open with no root cause analysis. Action required: decide whether to start one and check safeguarding and notification duties.`, reason: "You manage incidents for your organisation.", links: [{ label: "Open the incident", url: `/rota/incidents/${i.id}` }], actionUrl: `/rota/incidents/${i.id}`, dedupeKey: `cqc-critical:${i.id}` });
  }
  return sent;
}
