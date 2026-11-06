import { db } from "@/lib/db";
import { ConflictError } from "@/lib/errors";
import { displayValue, sectionLabel } from "@/lib/care-coordinator-rules";
import { audit } from "@/server/audit-log";
import type { Ctx } from "@/server/auth/rbac";
import { rotaScope } from "@/server/rota/scope";
import { checkAcceptable, coordinatorAccess, intakeInScope, isRestrictedFact } from "./intake";

/**
 * Revised support plans (AI CSB Coordinator brief, 6 Nov 2026, phase 6). For an intake that updates someone already
 * on the system, every fact read from the new documents is compared with the person's current record, field by
 * field: NEW, UNCHANGED, CHANGED or CONFLICTING (the documents disagree), plus visits on record that the revised plan
 * no longer has (REMOVED_SUPERSEDED) and key details neither gives (MISSING). Nothing is changed by the comparison.
 * "Accept all routine" approves only what cannot surprise anyone: non-clinical values that match the record, and new
 * personal or contact details read word for word from a page. Everything else is decided one by one (accept, edit, reject, clarify or
 * keep the current record) with the existing fact controls.
 */

export const CHANGE_STATUS = {
  NEW: "New",
  UNCHANGED: "Unchanged",
  CHANGED: "Changed",
  CONFLICTING: "Conflicting",
  REMOVED_SUPERSEDED: "Removed or superseded",
  MISSING: "Missing",
} as const;
export type ChangeStatus = keyof typeof CHANGE_STATUS;

/** Sections whose new facts may be accepted together: details about the person, never care, risk or medicines. */
const ROUTINE_NEW = new Set(["PERSONAL", "CONTACTS", "CARER_PREFERENCES"]);
/** Care, risk, medicines, incidents and skin are always decided one by one, even when nothing changed. */
const NEVER_ROUTINE = new Set(["CARE_PLAN", "RISKS", "MEDICATION", "INCIDENTS", "BODY_MAP"]);
/** Notes compareFacts writes when documents disagree with each other (not with the record). */
const DISAGREEMENT = /says "|appears differently|same time on the same day|another person's profile|recorded elsewhere|From an older document/;
const KEY_DETAILS: [string, string][] = [["person.dateOfBirth", "Date of birth"], ["person.addressLine1", "Address"], ["person.postcode", "Postcode"], ["person.nhsNumber", "NHS number"]];

type FactLike = { destination: string; section: string; value: unknown; existingValue: unknown; conflict: string | null; verification: string };
type TemplateLike = { id: string; weekdays: number[]; startMinute: number; durationMin: number; carersRequired: number };

const same = (a: unknown, b: unknown) => String(a ?? "").trim().toLowerCase().replace(/\s+/g, " ") === String(b ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};
const matchTemplate = (v: { weekdays: number[]; startTime: string }, templates: TemplateLike[]) => templates.find((t) => t.startMinute === minutes(v.startTime) && t.weekdays.some((d) => v.weekdays.includes(d)));

/** How one fact compares with the record. Pure, so it can be tested on its own. */
export function factChange(f: FactLike, templates: TemplateLike[], contactNames: string[]): ChangeStatus {
  if (f.conflict && DISAGREEMENT.test(f.conflict)) return "CONFLICTING";
  if (f.destination === "visit") {
    const v = f.value as { weekdays: number[]; startTime: string; durationMin?: number; carers?: number };
    const t = matchTemplate(v, templates);
    if (!t) return "NEW";
    return t.durationMin === v.durationMin && t.carersRequired === (v.carers ?? t.carersRequired) && v.weekdays.every((d) => t.weekdays.includes(d)) ? "UNCHANGED" : "CHANGED";
  }
  if (f.destination === "contact") {
    const name = String((f.value as { name?: string }).name ?? "");
    return contactNames.some((n) => same(n, name)) ? "UNCHANGED" : "NEW";
  }
  if (f.existingValue === null || f.existingValue === undefined || f.existingValue === "") return "NEW";
  return same(f.existingValue, f.value) ? "UNCHANGED" : "CHANGED";
}

/** True when a fact can be accepted with the others in one go. */
export function isRoutine(f: FactLike, status: ChangeStatus) {
  if (NEVER_ROUTINE.has(f.section)) return false;
  if (status === "UNCHANGED") return true;
  return status === "NEW" && ROUTINE_NEW.has(f.section) && f.verification === "VERIFIED";
}

/** The field-by-field comparison for an intake that updates someone on record. */
export async function revisionSummary(ctx: Ctx, intakeId: string) {
  const access = coordinatorAccess(ctx);
  const scope = await rotaScope(ctx, "serviceUser.edit");
  const intake = await intakeInScope(db, scope, intakeId);
  if (intake.mode !== "EXISTING" || !intake.serviceUserId) return null;
  const suId = intake.serviceUserId;
  const [su, facts, docs, templates, contacts] = await Promise.all([
    db.serviceUser.findUniqueOrThrow({ where: { id: suId } }),
    db.careIntakeFact.findMany({ where: { intakeId, decision: { notIn: ["REJECTED", "DUPLICATE"] } }, orderBy: { position: "asc" } }),
    db.careIntakeDocument.findMany({ where: { intakeId }, select: { id: true, sensitive: true } }),
    db.visitTemplate.findMany({ where: { serviceUserId: suId, enabled: true }, select: { id: true, weekdays: true, startMinute: true, durationMin: true, carersRequired: true }, orderBy: { startMinute: "asc" } }),
    db.serviceUserContact.findMany({ where: { serviceUserId: suId }, select: { name: true } }),
  ]);
  const names = contacts.map((c) => c.name);
  const rows: { factId: string | null; status: ChangeStatus; section: string; label: string; record: string | null; document: string | null; decision: string | null; routine: boolean; lockVersion: number | null }[] = [];
  let hidden = 0;
  for (const f of facts) {
    if (isRestrictedFact(f, !!docs.find((d) => d.id === f.sourceDocumentId)?.sensitive) && !access.sensitive) { hidden++; continue; }
    const status = factChange(f, templates, names);
    const record = f.destination === "visit" ? (() => {
      const t = matchTemplate(f.value as { weekdays: number[]; startTime: string }, templates);
      return t ? `${hhmm(t.startMinute)}, ${t.durationMin} minutes, ${t.carersRequired} carer${t.carersRequired === 1 ? "" : "s"}` : null;
    })() : f.existingValue === null || f.existingValue === undefined ? null : displayValue(f.destination, f.existingValue);
    rows.push({ factId: f.id, status, section: sectionLabel(f.section), label: f.label, record, document: displayValue(f.destination, f.value), decision: f.decision, routine: f.decision === "PENDING" && isRoutine(f, status), lockVersion: f.lockVersion });
  }
  // Visits on record that the revised plan no longer lists (only when the documents give a timetable at all).
  const visitFacts = facts.filter((f) => f.destination === "visit");
  if (visitFacts.length) {
    for (const t of templates) {
      if (visitFacts.some((f) => matchTemplate(f.value as { weekdays: number[]; startTime: string }, [t]))) continue;
      rows.push({ factId: null, status: "REMOVED_SUPERSEDED", section: "Visits", label: `Repeating visit at ${hhmm(t.startMinute)}`, record: `${hhmm(t.startMinute)}, ${t.durationMin} minutes`, document: "Not in the revised plan", decision: null, routine: false, lockVersion: null });
    }
  }
  // Key details neither the documents nor the record give.
  const record = su as unknown as Record<string, unknown>;
  for (const [dest, label] of KEY_DETAILS) {
    if (record[dest.slice(7)] || facts.some((f) => f.destination === dest)) continue;
    rows.push({ factId: null, status: "MISSING", section: "Personal details", label, record: null, document: null, decision: null, routine: false, lockVersion: null });
  }
  const counts = Object.fromEntries(Object.keys(CHANGE_STATUS).map((k) => [k, rows.filter((r) => r.status === k).length])) as Record<ChangeStatus, number>;
  return { rows, counts, routine: rows.filter((r) => r.routine).length, hidden };
}

const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const ROUTINE_NOTE_SAME = "Accepted as routine: the same as the current record.";
const ROUTINE_NOTE_NEW = "Accepted as routine: a new detail read word for word from the page.";

/** "Accept all routine": approves only unchanged values and verified new non-clinical details, in one transaction. */
export async function acceptRoutineChanges(ctx: Ctx, intakeId: string) {
  const access = coordinatorAccess(ctx);
  const scope = await rotaScope(ctx, "serviceUser.edit");
  return db.$transaction(async (tx) => {
    const intake = await intakeInScope(tx, scope, intakeId, true);
    if (intake.mode !== "EXISTING" || !intake.serviceUserId) throw new ConflictError("Routine changes apply to an updated plan for someone already on the system");
    if (intake.status !== "DRAFT") throw new ConflictError("This intake is with a manager or finished");
    const [facts, docs, templates, contacts] = await Promise.all([
      tx.careIntakeFact.findMany({ where: { intakeId, decision: "PENDING", appliedAt: null } }),
      tx.careIntakeDocument.findMany({ where: { intakeId }, select: { id: true, sensitive: true } }),
      tx.visitTemplate.findMany({ where: { serviceUserId: intake.serviceUserId, enabled: true }, select: { id: true, weekdays: true, startMinute: true, durationMin: true, carersRequired: true } }),
      tx.serviceUserContact.findMany({ where: { serviceUserId: intake.serviceUserId }, select: { name: true } }),
    ]);
    let accepted = 0;
    for (const f of facts) {
      if (isRestrictedFact(f, !!docs.find((d) => d.id === f.sourceDocumentId)?.sensitive) && !access.sensitive) continue;
      const status = factChange(f, templates, contacts.map((c) => c.name));
      if (!isRoutine(f, status)) continue;
      try {
        checkAcceptable(f.destination, f.value, f.temporal);
      } catch {
        continue;
      }
      const n = await tx.careIntakeFact.updateMany({ where: { id: f.id, lockVersion: f.lockVersion }, data: { decision: "APPROVED", decisionNote: status === "UNCHANGED" ? ROUTINE_NOTE_SAME : ROUTINE_NOTE_NEW, decidedById: ctx.userId, decidedAt: new Date(), lockVersion: { increment: 1 } } });
      accepted += n.count;
    }
    await audit({ organisationId: scope.organisationId, actorId: ctx.userId, action: "coordinator.revision.routine-accepted", entityType: "CareIntake", entityId: intakeId, data: { accepted } }, tx);
    return { accepted };
  });
}
