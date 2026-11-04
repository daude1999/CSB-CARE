import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { londonTime } from "@/lib/london";
import { effectiveClocks } from "../attendance";

/**
 * The evidence collector for one missed call. It only reads. Everything it returns is something a record in the system
 * says: no clock time, visit, contact or outcome is ever made up, and a missing record is listed as missing, never filled
 * in. The snapshot keeps ids, times, statuses, counts and short labels only: no note text, addresses, phone numbers,
 * medication names, risk text or care-plan text, which stay behind their own pages and permissions.
 */

export type EvidenceGroup = "visit" | "booking" | "attendance" | "record" | "office" | "risk" | "carer";
export type EvidenceKind = "SYSTEM" | "OFFICE" | "CARER_REPORTED";
export type Availability = "PRESENT" | "ABSENT" | "NOT_APPLICABLE";

export interface EvidenceItem {
  /** Stable within a case, so two runs can be compared. */
  key: string;
  group: EvidenceGroup;
  /** The record type it came from, and its id (null for a check that found nothing). */
  source: string;
  sourceId: string | null;
  label: string;
  value: string;
  /** When it happened, as the record says (ISO), or null for a state rather than an event. */
  eventAt: string | null;
  /** When the system recorded it, when that differs from when it happened (an office entry made later). */
  recordedAt: string | null;
  availability: Availability;
  kind: EvidenceKind;
  staffId: string | null;
  /** True for system or office records; a carer's statement and a visit note are never verification on their own. */
  verified: boolean;
  /** Shown only to people who may see this kind of record. */
  restricted?: "medication";
  /** Where an authorised user can open the source. */
  href?: string;
}

/** What each booked carer's records say, for the suggestion rules. */
export interface CarerFacts {
  staffId: string;
  name: string;
  slot: string;
  hasLogin: boolean;
  confirmation: string;
  /** The effective clock-in, if any. */
  clockInAt: string | null;
  clockOutAt: string | null;
  /** The clock-in was recorded after the call was marked missed. */
  clockInAfterDetection: boolean;
  /** Still booked on the visit now (a removed carer cannot use the clock-correction form). */
  stillBooked: boolean;
  pendingCorrection: boolean;
  approvedCorrection: boolean;
  absenceOverlap: boolean;
  response: CarerStatement | null;
  responseCount: number;
}

export interface CarerStatement {
  id: string;
  answer: string;
  reportedArrival: string | null;
  reportedDeparture: string | null;
  careDelivered: string | null;
  unableReason: string | null;
  submittedAt: string;
}

export interface CaseFacts {
  caseId: string;
  organisationId: string;
  visitId: string;
  serviceUserId: string;
  stage: string;
  detectedAt: string;
  scheduledStart: string;
  scheduledEnd: string;
  visitStatus: string;
  carersRequired: number;
  medicationRequired: boolean;
  highRisk: boolean;
  /** A service-user absence (hospital, holiday, cancellation) covering the visit time is on record. */
  suAbsenceRecorded: boolean;
  recoveryBooked: boolean;
  replacementRecorded: boolean;
  reasonRecorded: boolean;
  escalated: boolean;
  carers: CarerFacts[];
}

export interface TimelineEntry {
  at: string;
  recordedAt: string | null;
  text: string;
  source: string;
  sourceId: string | null;
  kind: EvidenceKind;
  staffId: string | null;
  href?: string;
  restricted?: "medication";
}

export interface Collected {
  facts: CaseFacts;
  items: EvidenceItem[];
  timeline: TimelineEntry[];
  refs: { source: string; id: string }[];
  fingerprint: string;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
/** A later record counts as "recorded later" when it was entered more than two minutes after the time it gives. */
const later = (at: Date, created: Date) => (created.getTime() - at.getTime() > 120_000 ? created.toISOString() : null);

export const ANSWER_LABEL: Record<string, string> = {
  ATTENDED_NO_CLOCK: "I attended but forgot to clock in",
  ARRIVED_LATE: "I arrived late",
  UNABLE_TO_ATTEND: "I was unable to attend",
  ACCESS_PROBLEM: "I had an access problem",
  SU_CANCELLED: "The service user cancelled or declined",
  PHONE_SYSTEM: "I had a phone or system problem",
  ROTA_WRONG: "I believe the rota information is wrong",
  OTHER: "Something else",
};

function raw(caseId: string) {
  return db.missedCallCase.findUnique({
    where: { id: caseId },
    include: {
      visit: {
        select: {
          id: true, reference: true, status: true, statusChangedAt: true, scheduledStart: true, scheduledEnd: true, carersRequired: true, medicationRequired: true, serviceUserId: true,
          callType: { select: { name: true } },
          serviceUser: { select: { riskLevel: true, risks: { where: { level: "HIGH", status: "ACTIVE", archivedAt: null }, select: { id: true } } } },
          assignments: { select: { id: true, staffId: true, slot: true, assignedAt: true, removedAt: true, acknowledgedAt: true, reviewReason: true, staff: { select: { displayName: true } } }, orderBy: { assignedAt: "asc" } },
          clocks: { orderBy: { at: "asc" } },
          correctionRequests: { orderBy: { createdAt: "asc" } },
          visitNotes: { select: { id: true, category: true, createdAt: true, staffId: true }, orderBy: { createdAt: "asc" } },
          taskOutcomes: { select: { id: true, at: true, staffId: true }, orderBy: { at: "asc" } },
          marRecords: { where: { supersededAt: null }, select: { id: true, at: true, outcome: true } },
          events: { where: { type: "STATUS" }, select: { id: true, fromStatus: true, toStatus: true, createdAt: true, data: true }, orderBy: { createdAt: "asc" } },
        },
      },
      carerConfirmations: { include: { staff: { select: { displayName: true } }, responses: { orderBy: { submittedAt: "asc" } } }, orderBy: { position: "asc" } },
      comments: { where: { kind: { not: "SYSTEM" } }, select: { id: true, createdAt: true } },
      covers: { select: { id: true, recoveryVisitId: true, confirmedAt: true, staffId: true } },
      contactAttempts: { select: { id: true, contactedAt: true, createdAt: true } },
    },
  });
}
type Raw = NonNullable<Awaited<ReturnType<typeof raw>>>;

/** Loads everything about one case, with the absences and alerts that sit outside it. Null if the case does not exist. */
export async function collectEvidence(caseId: string): Promise<Collected | null> {
  const r = await raw(caseId);
  if (!r) return null;
  const staffIds = [...new Set([...r.carerConfirmations.map((c) => c.staffId), ...r.visit.assignments.map((a) => a.staffId)])];
  const [absences, suAbsences, alerts] = await Promise.all([
    db.staffAbsence.findMany({ where: { organisationId: r.organisationId, staffId: { in: staffIds }, status: "APPROVED", startsAt: { lt: r.visit.scheduledEnd }, endsAt: { gt: r.visit.scheduledStart } }, select: { id: true, staffId: true, kind: true } }),
    db.serviceUserAbsence.findMany({ where: { organisationId: r.organisationId, serviceUserId: r.visit.serviceUserId, cancelledAt: null, startsAt: { lt: r.visit.scheduledEnd }, OR: [{ endsAt: null }, { endsAt: { gt: r.visit.scheduledStart } }] }, select: { id: true, reason: true, createdAt: true } }),
    db.rotaAlert.findMany({ where: { organisationId: r.organisationId, visitId: r.visit.id, kind: { in: ["LATE", "MISSED"] } }, select: { id: true, kind: true, raisedAt: true }, orderBy: { raisedAt: "asc" } }),
  ]);
  return assemble(r, { absences, suAbsences, alerts });
}

/** Turns the loaded records into evidence items, facts and a timeline. Pure apart from its input, so it is tested directly. */
export function assemble(
  r: Raw,
  extra: { absences: { id: string; staffId: string; kind: string }[]; suAbsences: { id: string; reason: string; createdAt: Date }[]; alerts: { id: string; kind: string; raisedAt: Date }[] },
): Collected {
  const v = r.visit;
  const items: EvidenceItem[] = [];
  const timeline: TimelineEntry[] = [];
  const visitHref = `/rota/visits/${v.id}`;
  const names = new Map<string, string>([...v.assignments.map((a) => [a.staffId, a.staff.displayName] as const), ...r.carerConfirmations.map((c) => [c.staffId, c.staff.displayName] as const)]);
  const nameOf = (id: string | null | undefined) => (id ? names.get(id) ?? "A carer" : null);
  const add = (i: Omit<EvidenceItem, "recordedAt" | "staffId" | "verified"> & Partial<Pick<EvidenceItem, "recordedAt" | "staffId" | "verified">>) => {
    const item: EvidenceItem = { recordedAt: null, staffId: null, verified: i.kind !== "CARER_REPORTED", ...i };
    items.push(item);
    return item;
  };
  const event = (e: TimelineEntry) => timeline.push(e);

  // A. The visit
  add({ key: "visit.scheduled", group: "visit", source: "Visit", sourceId: v.id, label: "Scheduled visit", value: `${v.reference}, ${v.callType.name}, ${londonTime(v.scheduledStart)}–${londonTime(v.scheduledEnd)}`, eventAt: iso(v.scheduledStart), availability: "PRESENT", kind: "SYSTEM", href: visitHref });
  add({ key: "visit.carersRequired", group: "visit", source: "Visit", sourceId: v.id, label: "Carers required", value: String(v.carersRequired), eventAt: null, availability: "PRESENT", kind: "SYSTEM" });
  add({ key: "visit.medication", group: "visit", source: "Visit", sourceId: v.id, label: "Medication support on this visit", value: v.medicationRequired ? "Yes" : "No", eventAt: null, availability: "PRESENT", kind: "SYSTEM" });
  add({ key: "visit.status", group: "visit", source: "Visit", sourceId: v.id, label: "Visit status now", value: v.status.replace("_", " ").toLowerCase(), eventAt: iso(v.statusChangedAt), availability: "PRESENT", kind: "SYSTEM", href: visitHref });
  event({ at: v.scheduledStart.toISOString(), recordedAt: null, text: `Visit scheduled to begin (${v.callType.name})`, source: "Visit", sourceId: v.id, kind: "SYSTEM", staffId: null, href: visitHref });
  for (const e of v.events) {
    const src = typeof e.data === "object" && e.data && "source" in e.data ? String((e.data as Record<string, unknown>).source) : "";
    // The status change and the case are written in the same transaction; they share the detection time.
    if (e.toStatus === "MISSED") event({ at: (Math.abs(e.createdAt.getTime() - r.detectedAt.getTime()) < 60_000 ? r.detectedAt : e.createdAt).toISOString(), recordedAt: null, text: "Visit marked missed: no clock-in recorded", source: "VisitEvent", sourceId: e.id, kind: "SYSTEM", staffId: null, href: visitHref });
    else if (e.createdAt >= r.detectedAt) event({ at: e.createdAt.toISOString(), recordedAt: null, text: `Visit status changed to ${String(e.toStatus).replace("_", " ").toLowerCase()}${src.startsWith("clock") ? " by a clock entry" : ""}`, source: "VisitEvent", sourceId: e.id, kind: src === "clock.office" ? "OFFICE" : "SYSTEM", staffId: null, href: visitHref });
  }
  event({ at: r.detectedAt.toISOString(), recordedAt: null, text: "Missed-call case opened", source: "MissedCallCase", sourceId: r.id, kind: "SYSTEM", staffId: null });

  // B. Booking: the snapshot taken when the call was missed, and what changed on the rota around it.
  if (!r.carerConfirmations.length) add({ key: "booking.none", group: "booking", source: "MissedCallCase", sourceId: r.id, label: "Carers booked when the call was missed", value: "Nobody was booked", eventAt: iso(r.detectedAt), availability: "ABSENT", kind: "SYSTEM" });
  for (const c of r.carerConfirmations) {
    add({ key: `booking.snapshot:${c.staffId}`, group: "booking", source: "VisitAssignment", sourceId: c.assignmentId, label: "Booked when the call was missed", value: `${c.staff.displayName}${c.slot === "PRIMARY" ? "" : ` (${c.slot === "SECOND" ? "second carer" : `carer ${c.position}`})`}`, eventAt: iso(r.detectedAt), availability: "PRESENT", kind: "SYSTEM", staffId: c.staffId });
  }
  if (r.carerConfirmations.length && r.carerConfirmations.length < v.carersRequired) add({ key: "booking.short", group: "booking", source: "Visit", sourceId: v.id, label: "Carer places filled", value: `${r.carerConfirmations.length} of ${v.carersRequired}`, eventAt: null, availability: "PRESENT", kind: "SYSTEM" });
  for (const a of v.assignments) {
    add({ key: `booking.assignment:${a.id}`, group: "booking", source: "VisitAssignment", sourceId: a.id, label: "Rota booking", value: `${a.staff.displayName}: booked ${londonTime(a.assignedAt)}${a.removedAt ? `, removed ${londonTime(a.removedAt)}` : ""}${a.acknowledgedAt ? `, seen by the carer ${londonTime(a.acknowledgedAt)}` : ", not acknowledged by the carer"}${a.reviewReason ? `, flagged for review` : ""}`, eventAt: iso(a.assignedAt), availability: "PRESENT", kind: "OFFICE", staffId: a.staffId, href: visitHref });
    if (a.removedAt && a.removedAt >= r.detectedAt) event({ at: a.removedAt.toISOString(), recordedAt: null, text: `${a.staff.displayName} taken off the visit`, source: "VisitAssignment", sourceId: a.id, kind: "OFFICE", staffId: a.staffId, href: visitHref });
    else if (a.assignedAt >= r.detectedAt) event({ at: a.assignedAt.toISOString(), recordedAt: null, text: `${a.staff.displayName} booked on the visit`, source: "VisitAssignment", sourceId: a.id, kind: "OFFICE", staffId: a.staffId, href: visitHref });
  }
  for (const ab of extra.absences) add({ key: `booking.absence:${ab.id}`, group: "booking", source: "StaffAbsence", sourceId: ab.id, label: "Approved absence covering the visit", value: `${nameOf(ab.staffId)}: ${ab.kind.toLowerCase().replace("_", " ")}`, eventAt: null, availability: "PRESENT", kind: "OFFICE", staffId: ab.staffId });

  // C. Attendance: every clock row, the rows in force, and correction requests.
  const live = new Set(effectiveClocks(v.clocks).map((c) => c.id));
  if (!v.clocks.length) add({ key: "attendance.none", group: "attendance", source: "VisitClock", sourceId: null, label: "Clock records", value: "No clock-in or clock-out recorded", eventAt: null, availability: "ABSENT", kind: "SYSTEM" });
  for (const c of v.clocks) {
    const office = c.method === "OFFICE";
    const who = nameOf(c.staffId);
    add({ key: `attendance.clock:${c.id}`, group: "attendance", source: "VisitClock", sourceId: c.id, label: `${c.kind === "IN" ? "Clock-in" : "Clock-out"}${office ? " entered by the office" : ""}${live.has(c.id) ? "" : " (replaced by a correction)"}`, value: `${who ?? "Carer"} at ${londonTime(c.at)}`, eventAt: c.at.toISOString(), recordedAt: later(c.at, c.createdAt), availability: "PRESENT", kind: office ? "OFFICE" : "SYSTEM", staffId: c.staffId, href: visitHref });
    event({ at: c.at.toISOString(), recordedAt: later(c.at, c.createdAt), text: `${who ?? "A carer"} ${c.kind === "IN" ? "clocked in" : "clocked out"}${office ? " (office entry)" : ""}${live.has(c.id) ? "" : ", later corrected"}`, source: "VisitClock", sourceId: c.id, kind: office ? "OFFICE" : "SYSTEM", staffId: c.staffId, href: visitHref });
  }
  for (const q of v.correctionRequests) {
    add({ key: `attendance.correction:${q.id}`, group: "attendance", source: "ClockCorrectionRequest", sourceId: q.id, label: `Clock correction ${q.origin === "OFFICE" ? "entered by the office" : "requested by the carer"}`, value: `${nameOf(q.staffId)}: clock-${q.kind === "IN" ? "in" : "out"} ${londonTime(q.requestedTime)}, ${q.status.toLowerCase()}`, eventAt: q.createdAt.toISOString(), availability: "PRESENT", kind: q.origin === "OFFICE" ? "OFFICE" : "CARER_REPORTED", staffId: q.staffId, verified: q.status === "APPROVED", href: `${visitHref}#corrections` });
    if (q.origin === "CARER") event({ at: q.createdAt.toISOString(), recordedAt: null, text: `${nameOf(q.staffId)} asked for a clock correction (${londonTime(q.requestedTime)})`, source: "ClockCorrectionRequest", sourceId: q.id, kind: "CARER_REPORTED", staffId: q.staffId, href: `${visitHref}#corrections` });
    if (q.decidedAt && q.origin === "CARER") event({ at: q.decidedAt.toISOString(), recordedAt: null, text: `Clock correction ${q.status.toLowerCase()} by the office`, source: "ClockCorrectionRequest", sourceId: q.id, kind: "OFFICE", staffId: q.staffId, href: `${visitHref}#corrections` });
  }

  // D. The visit record: notes and tasks are supporting evidence only, never proof the care was delivered.
  const notes = v.visitNotes.length;
  add({ key: "record.notes", group: "record", source: "VisitNote", sourceId: v.visitNotes.at(-1)?.id ?? null, label: "Visit notes (supporting evidence, not proof of care)", value: notes ? `${notes} note${notes === 1 ? "" : "s"}${v.visitNotes.some((n) => n.category === "HANDOVER") ? ", including a handover" : ""}, last at ${londonTime(v.visitNotes.at(-1)!.createdAt)}` : "None recorded", eventAt: iso(v.visitNotes.at(-1)?.createdAt), availability: notes ? "PRESENT" : "ABSENT", kind: "CARER_REPORTED", verified: false, href: visitHref });
  for (const n of v.visitNotes) event({ at: n.createdAt.toISOString(), recordedAt: null, text: `${nameOf(n.staffId) ?? "Someone"} added a ${n.category === "HANDOVER" ? "handover" : "visit"} note`, source: "VisitNote", sourceId: n.id, kind: "CARER_REPORTED", staffId: n.staffId, href: visitHref });
  add({ key: "record.tasks", group: "record", source: "VisitTaskOutcome", sourceId: v.taskOutcomes.at(-1)?.id ?? null, label: "Task outcomes (supporting evidence, not proof of care)", value: v.taskOutcomes.length ? `${v.taskOutcomes.length} recorded` : "None recorded", eventAt: iso(v.taskOutcomes.at(-1)?.at), availability: v.taskOutcomes.length ? "PRESENT" : "ABSENT", kind: "CARER_REPORTED", verified: false, href: visitHref });
  if (v.medicationRequired) add({ key: "record.mar", group: "record", source: "MarRecord", sourceId: null, label: "Medication records for this visit", value: v.marRecords.length ? `${v.marRecords.length} dose record${v.marRecords.length === 1 ? "" : "s"}` : "No dose recorded", eventAt: null, availability: v.marRecords.length ? "PRESENT" : "ABSENT", kind: "SYSTEM", restricted: "medication", href: visitHref });

  // E. Office activity
  for (const a of extra.alerts) {
    add({ key: `office.alert:${a.id}`, group: "office", source: "RotaAlert", sourceId: a.id, label: `${a.kind === "MISSED" ? "Missed" : "Late"}-call alert`, value: `Raised ${londonTime(a.raisedAt)}`, eventAt: a.raisedAt.toISOString(), availability: "PRESENT", kind: "SYSTEM" });
    event({ at: a.raisedAt.toISOString(), recordedAt: null, text: `${a.kind === "MISSED" ? "Missed" : "Late"}-call alert raised to the office`, source: "RotaAlert", sourceId: a.id, kind: "SYSTEM", staffId: null });
  }
  add({ key: "office.comments", group: "office", source: "MissedCallComment", sourceId: null, label: "Investigation comments", value: r.comments.length ? `${r.comments.length}` : "None yet", eventAt: null, availability: r.comments.length ? "PRESENT" : "ABSENT", kind: "OFFICE" });
  for (const cv of r.covers) {
    add({ key: `office.cover:${cv.id}`, group: "office", source: "MissedCallCover", sourceId: cv.id, label: "Recovery visit booked", value: `${nameOf(cv.staffId) ?? "A carer"}, booked ${londonTime(cv.confirmedAt)}`, eventAt: cv.confirmedAt.toISOString(), availability: "PRESENT", kind: "OFFICE", staffId: cv.staffId, href: `/rota/visits/${cv.recoveryVisitId}` });
    event({ at: cv.confirmedAt.toISOString(), recordedAt: null, text: "Recovery visit booked", source: "MissedCallCover", sourceId: cv.id, kind: "OFFICE", staffId: cv.staffId, href: `/rota/visits/${cv.recoveryVisitId}` });
  }
  if (!r.covers.length) add({ key: "office.cover.none", group: "office", source: "MissedCallCover", sourceId: null, label: "Recovery visit", value: "None booked", eventAt: null, availability: "ABSENT", kind: "OFFICE" });
  add({ key: "office.contacts", group: "office", source: "CoverContactAttempt", sourceId: null, label: "Contact attempts recorded", value: r.contactAttempts.length ? `${r.contactAttempts.length}` : "None recorded", eventAt: null, availability: r.contactAttempts.length ? "PRESENT" : "ABSENT", kind: "OFFICE" });
  for (const ca of r.contactAttempts) event({ at: ca.contactedAt.toISOString(), recordedAt: later(ca.contactedAt, ca.createdAt), text: "Contact attempt recorded by the office", source: "CoverContactAttempt", sourceId: ca.id, kind: "OFFICE", staffId: null });
  if (r.escalatedAt) event({ at: r.escalatedAt.toISOString(), recordedAt: null, text: r.escalatedById ? "Escalated to the care managers" : "Escalated to the care managers automatically (no reason by the deadline)", source: "MissedCallCase", sourceId: r.id, kind: r.escalatedById ? "OFFICE" : "SYSTEM", staffId: null });
  if (r.reasonRecordedAt) event({ at: r.reasonRecordedAt.toISOString(), recordedAt: null, text: "Reason recorded by the coordinator", source: "MissedCallCase", sourceId: r.id, kind: "OFFICE", staffId: null });
  if (r.replacementAt) event({ at: r.replacementAt.toISOString(), recordedAt: null, text: "Replacement care arrangements recorded", source: "MissedCallCase", sourceId: r.id, kind: "OFFICE", staffId: null });
  for (const sa of extra.suAbsences) add({ key: `office.suabsence:${sa.id}`, group: "office", source: "ServiceUserAbsence", sourceId: sa.id, label: "Service-user absence on record for the visit time", value: sa.reason.toLowerCase().replace(/_/g, " "), eventAt: sa.createdAt.toISOString(), availability: "PRESENT", kind: "OFFICE", href: `/rota/service-users/${v.serviceUserId}` });

  // F. Risk: only what is explicitly recorded. Nothing is inferred from free text or AI output.
  const highRisk = v.serviceUser.riskLevel === "HIGH" || v.serviceUser.risks.length > 0;
  add({ key: "risk.level", group: "risk", source: "ServiceUser", sourceId: v.serviceUserId, label: "High-risk service user", value: highRisk ? `Yes${v.serviceUser.risks.length ? `, ${v.serviceUser.risks.length} active high-risk assessment${v.serviceUser.risks.length === 1 ? "" : "s"}` : ""}` : "No", eventAt: null, availability: "PRESENT", kind: "OFFICE", href: `/rota/service-users/${v.serviceUserId}` });
  add({ key: "risk.contingency", group: "risk", source: "CarePlan", sourceId: null, label: "Time-critical care or missed-visit contingency", value: "Not recorded as a separate field. Check the care plan.", eventAt: null, availability: "NOT_APPLICABLE", kind: "OFFICE", href: `/rota/service-users/${v.serviceUserId}` });

  // The carers: what was asked of them and what they said, attributed to them.
  const carers: CarerFacts[] = r.carerConfirmations.map((c) => {
    const mine = effectiveClocks(v.clocks).filter((k) => k.staffId === c.staffId);
    const inRow = mine.find((k) => k.kind === "IN") ?? null;
    const outRow = mine.find((k) => k.kind === "OUT") ?? null;
    const latest = c.responses.at(-1) ?? null;
    if (c.requestedAt) event({ at: c.requestedAt.toISOString(), recordedAt: null, text: `Confirmation requested from ${c.staff.displayName} in the app`, source: "MissedCallCarerConfirmation", sourceId: c.id, kind: "SYSTEM", staffId: c.staffId });
    if (c.notificationOpenedAt) event({ at: c.notificationOpenedAt.toISOString(), recordedAt: null, text: `${c.staff.displayName} opened the request notification (not proof it was read)`, source: "MissedCallCarerConfirmation", sourceId: c.id, kind: "SYSTEM", staffId: c.staffId });
    if (c.status === "NO_LOGIN") add({ key: `carer.nologin:${c.staffId}`, group: "carer", source: "MissedCallCarerConfirmation", sourceId: c.id, label: "Digital confirmation", value: `${c.staff.displayName} has no linked sign-in, so could not be asked in the app. Contact them by phone.`, eventAt: null, availability: "NOT_APPLICABLE", kind: "SYSTEM", staffId: c.staffId });
    for (const s of c.responses) {
      add({ key: `carer.response:${s.id}`, group: "carer", source: "MissedCallCarerResponse", sourceId: s.id, label: `${c.staff.displayName} reported${s.supplementsId ? " (further statement)" : ""}`, value: `${ANSWER_LABEL[s.answer] ?? s.answer}${s.reportedArrival ? `, arrived ${londonTime(s.reportedArrival)}` : ""}${s.reportedDeparture ? `, left ${londonTime(s.reportedDeparture)}` : ""}${s.careDelivered ? `, care delivered: ${s.careDelivered.toLowerCase()}` : ""}`, eventAt: s.submittedAt.toISOString(), availability: "PRESENT", kind: "CARER_REPORTED", staffId: c.staffId, verified: false });
      event({ at: s.submittedAt.toISOString(), recordedAt: null, text: `${c.staff.displayName} submitted ${s.supplementsId ? "a further statement" : "an explanation"}: “${ANSWER_LABEL[s.answer] ?? s.answer}”`, source: "MissedCallCarerResponse", sourceId: s.id, kind: "CARER_REPORTED", staffId: c.staffId });
      if (s.reportedArrival) event({ at: s.reportedArrival.toISOString(), recordedAt: s.submittedAt.toISOString(), text: `${c.staff.displayName} says they arrived`, source: "MissedCallCarerResponse", sourceId: s.id, kind: "CARER_REPORTED", staffId: c.staffId });
    }
    const current = v.assignments.some((a) => a.staffId === c.staffId && !a.removedAt);
    return {
      staffId: c.staffId,
      name: c.staff.displayName,
      slot: c.slot,
      hasLogin: !!c.userIdAtDetection,
      confirmation: c.status,
      clockInAt: iso(inRow?.at),
      clockOutAt: iso(outRow?.at),
      clockInAfterDetection: !!inRow && inRow.createdAt > r.detectedAt,
      stillBooked: current,
      pendingCorrection: v.correctionRequests.some((q) => q.staffId === c.staffId && q.status === "PENDING"),
      approvedCorrection: v.correctionRequests.some((q) => q.staffId === c.staffId && q.status === "APPROVED"),
      absenceOverlap: extra.absences.some((a) => a.staffId === c.staffId),
      response: latest ? { id: latest.id, answer: latest.answer, reportedArrival: iso(latest.reportedArrival), reportedDeparture: iso(latest.reportedDeparture), careDelivered: latest.careDelivered, unableReason: latest.unableReason, submittedAt: latest.submittedAt.toISOString() } : null,
      responseCount: c.responses.length,
    };
  });

  const facts: CaseFacts = {
    caseId: r.id, organisationId: r.organisationId, visitId: v.id, serviceUserId: v.serviceUserId, stage: r.stage,
    detectedAt: r.detectedAt.toISOString(), scheduledStart: v.scheduledStart.toISOString(), scheduledEnd: v.scheduledEnd.toISOString(),
    visitStatus: v.status, carersRequired: v.carersRequired, medicationRequired: v.medicationRequired, highRisk,
    suAbsenceRecorded: extra.suAbsences.length > 0, recoveryBooked: r.covers.length > 0, replacementRecorded: !!r.replacementType,
    reasonRecorded: !!r.reasonCode, escalated: !!r.escalatedAt, carers,
  };
  // Stable sort: events at the same minute keep the order they happen in (marked missed, case opened, alert, request).
  timeline.sort((a, b) => a.at.localeCompare(b.at));
  const refs = [...new Map(items.filter((i) => i.sourceId).map((i) => [`${i.source}:${i.sourceId}`, { source: i.source, id: i.sourceId! }])).values()];
  return { facts, items, timeline, refs, fingerprint: fingerprintOf(items, facts) };
}

/** Two runs with the same records give the same fingerprint, whatever time they ran. */
export function fingerprintOf(items: EvidenceItem[], facts: CaseFacts) {
  const stable = { items: [...items].sort((a, b) => a.key.localeCompare(b.key)), facts: { ...facts, stage: undefined } };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

