"use server";

import { acceptRoutineChanges } from "@/server/care/coordinator/compare";
import { after } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { valueFromForm } from "@/lib/care-coordinator-forms";
import { handle, str } from "./action-kit";
import { addDocuments, addManualFact, approveVerified, cancelIntake, createIntake, decideFact, decideSection, resolveFollowUp, setCoordinatorAi, submitIntake, updateIntakeDocument, MAX_INTAKE_DOCUMENTS } from "@/server/care/coordinator/intake";
import { applyApproved, applySection, fileDocuments } from "@/server/care/coordinator/apply";
import { activateCare, createIntakeRota } from "@/server/care/coordinator/rota";
import { prepareDrafts, prepareReportText } from "@/server/care/coordinator/prepare";
import { queueDocumentRead, queueIntakeReads, runQueuedReads } from "@/server/care/coordinator/read-jobs";
import { MAX_DOCUMENT_BYTES, type UploadedFile } from "@/server/care/su-documents";
import { SECTION_KEYS, sectionLabel, type IntakeSection } from "@/lib/care-coordinator-rules";

/**
 * Server actions for the AI Care Coordinator. Each reads plain form fields, calls the coordinator service with the
 * signed-in person's ctx (which checks organisation, scope and permissions again) and returns to the page with a
 * message. Nothing here takes an organisation, branch or person id from the form as authority.
 */

const page = (id: string, rest = "") => `/rota/coordinator/${encodeURIComponent(id)}${rest}`;
const intakeId = (fd: FormData) => {
  const id = str(fd, "intakeId");
  if (!/^[a-z0-9]{10,40}$/i.test(id)) throw new ValidationError("This intake could not be found");
  return id;
};
const sectionOf = (fd: FormData): IntakeSection => {
  const s = z.enum(SECTION_KEYS).safeParse(str(fd, "section"));
  if (!s.success) throw new ValidationError("Choose a section");
  return s.data;
};
const lockOf = (fd: FormData) => {
  const v = str(fd, "lockVersion");
  return /^\d+$/.test(v) ? Number(v) : null;
};

async function filesFrom(fd: FormData): Promise<UploadedFile[]> {
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) throw new ValidationError("Choose at least one document to upload");
  if (files.length > MAX_INTAKE_DOCUMENTS) throw new ValidationError(`Upload at most ${MAX_INTAKE_DOCUMENTS} documents at a time`);
  for (const f of files) if (f.size > MAX_DOCUMENT_BYTES) throw new ValidationError(`${f.name} is larger than ${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} MB`);
  return Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) })));
}

/**
 * Starts reading straight after the response is sent. The job is already saved, so if this run is cut off the intake
 * page (or the worker) carries it on; this only saves waiting for the page to ask.
 */
function startReadingSoon() {
  after(() => runQueuedReads(`after:${process.pid}`, 1).then(() => undefined, () => undefined));
}

const READING_NOTE = "It is being read now: you can watch each stage on this page or leave it, and the person's draft records and a proposed rota are prepared when the reading finishes.";

export async function createIntakeAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const intake = await createIntake(ctx, { title: str(fd, "title"), mode: str(fd, "mode") === "EXISTING" ? "EXISTING" : str(fd, "mode") === "DOCUMENT" ? "DOCUMENT" : "NEW", serviceUserId: str(fd, "serviceUserId"), areaId: str(fd, "areaId") });
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length) {
      const r = await addDocuments(ctx, intake.id, await filesFrom(fd), { read: "later" });
      await queueIntakeReads(ctx, r.toRead, { prepare: true });
      if (r.toRead.length) startReadingSoon();
      return { to: page(intake.id, "?step=documents"), ok: `${intake.reference} started and ${r.documents} document${r.documents === 1 ? "" : "s"} stored. ${r.toRead.length ? READING_NOTE : "Add the facts by hand under Check facts."}` };
    }
    return { to: page(intake.id), ok: `${intake.reference} started. Upload the documents next.` };
  }, "Started");
}

export async function uploadIntakeDocumentsAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await addDocuments(ctx, intakeId(fd), await filesFrom(fd), { read: "later" });
    if (!r.documents && r.duplicates.length) return { ok: `${r.duplicates.join(", ")} ${r.duplicates.length === 1 ? "is" : "are"} already on this intake, so nothing was uploaded again.` };
    await queueIntakeReads(ctx, r.toRead, { prepare: true });
    if (r.toRead.length) startReadingSoon();
    return { ok: `${r.documents} document${r.documents === 1 ? "" : "s"} uploaded and stored. ${r.toRead.length ? READING_NOTE : "Add the facts by hand under Check facts."}` };
  }, "Uploaded");
}

export async function prepareDraftsAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await prepareDrafts(ctx, intakeId(fd), { notADuplicate: fd.get("notADuplicate") === "on" });
    return { ok: prepareReportText(r).replace(/\n/g, " ") };
  }, "Prepared");
}

/** Reads a stored document again, from the original already kept: never a new upload. Joins a reading in progress. */
export async function rereadIntakeDocumentAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await queueDocumentRead(ctx, str(fd, "documentId"), { prepare: true });
    startReadingSoon();
    return { ok: r.joined ? "This document is already being read. Its progress is shown below." : `Reading again from the stored original. ${READING_NOTE} Decisions you had already made are kept.` };
  }, "Reading again");
}

export async function updateIntakeDocumentAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await updateIntakeDocument(ctx, str(fd, "documentId"), { name: str(fd, "name"), section: str(fd, "docSection") === "COUNCIL" ? "COUNCIL" : "OTHER", category: str(fd, "category"), issuer: str(fd, "issuer"), documentDate: str(fd, "documentDate"), sensitive: fd.get("sensitive") === "on" });
  }, "Filing details saved");
}

/** Approve, edit, reject, clarify, duplicate or reopen one fact. An edit sends the plain form fields, never JSON. */
export async function decideFactAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const decision = str(fd, "decision");
    const destination = str(fd, "destination");
    const value = decision === "EDITED" ? valueFromForm(destination, fd) : undefined;
    await decideFact(ctx, str(fd, "factId"), lockOf(fd), { decision: decision as "APPROVED", note: str(fd, "note"), question: str(fd, "question"), assignedToId: str(fd, "assignedToId"), value });
  }, "Saved");
}

/** Revised plan: approves only unchanged values and verified new non-clinical details (compare.ts). */
export async function acceptRoutineChangesAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await acceptRoutineChanges(ctx, intakeId(fd));
    return { ok: r.accepted ? `${r.accepted} routine change${r.accepted === 1 ? "" : "s"} accepted. Check the rest one by one.` : "Nothing routine was left to accept." };
  }, "Accepted");
}

export async function approveVerifiedAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const section = sectionOf(fd);
    const n = await approveVerified(ctx, intakeId(fd), section);
    return { ok: n ? `${n} checked fact${n === 1 ? "" : "s"} approved in ${sectionLabel(section)}. Facts with a warning are left for you.` : "Nothing to approve: every remaining fact has a warning or needs a person to decide." };
  }, "Approved");
}

export async function addManualFactAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const destination = str(fd, "destination");
    const page = str(fd, "sourcePage");
    await addManualFact(ctx, intakeId(fd), { destination, label: str(fd, "label") || undefined, value: valueFromForm(destination, fd), sourceDocumentId: str(fd, "sourceDocumentId"), sourcePage: /^\d+$/.test(page) ? Number(page) : null });
  }, "Fact added and approved under your name");
}

export async function submitIntakeAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await submitIntake(ctx, intakeId(fd), { notADuplicate: fd.get("notADuplicate") === "on", areaId: str(fd, "areaId") || undefined });
  }, "Sent to a manager for approval. Managers have been told.");
}

export async function decideSectionAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const decision = str(fd, "decision");
    await decideSection(ctx, intakeId(fd), sectionOf(fd), { decision: decision as "APPROVED", reason: str(fd, "reason") });
    return { ok: decision === "APPROVED" ? "Section approved" : decision === "REJECTED" ? "Section rejected. Nothing from it will be saved." : "Sent back to the coordinator" };
  }, "Saved");
}

export async function applySectionAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const section = sectionOf(fd);
    const r = await applySection(ctx, intakeId(fd), section);
    if (r.status === "FAILED") throw new ValidationError(`${sectionLabel(section)} was not saved: ${r.error}`);
    return { ok: `${sectionLabel(section)} saved to the record and read back` };
  }, "Saved");
}

export async function applyApprovedAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await applyApproved(ctx, intakeId(fd));
    const done = r.filter((x) => x.status === "DONE").length;
    const failed = r.filter((x) => x.status !== "DONE");
    if (!r.length) return { ok: "Every approved section is already saved" };
    if (failed.length) throw new ValidationError(`${done} section${done === 1 ? "" : "s"} saved. Not saved: ${failed.map((f) => `${sectionLabel(f.section)} (${f.error ?? f.status.toLowerCase()})`).join("; ")}. Fix the cause and press Save again; saved sections are not repeated.`);
    return { ok: `${done} section${done === 1 ? "" : "s"} saved to the record and read back` };
  }, "Saved");
}

export async function fileIntakeDocumentsAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const n = await fileDocuments(ctx, intakeId(fd));
    return { ok: n ? `${n} original document${n === 1 ? "" : "s"} filed in the person's documents` : "Every document is already filed" };
  }, "Filed");
}

export async function cancelIntakeAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await cancelIntake(ctx, intakeId(fd), str(fd, "reason"));
    return { to: "/rota/coordinator", ok: "Intake cancelled. Nothing more will be saved from it." };
  }, "Cancelled");
}

export async function activateCareAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await activateCare(ctx, intakeId(fd));
    return { ok: r.already ? "Care is already active" : "Care is now Active. Preview the draft rota next." };
  }, "Activated");
}

export async function createIntakeRotaAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const id = intakeId(fd);
    const weeks = Number(str(fd, "weeks"));
    const r = await createIntakeRota(ctx, id, { weekStart: str(fd, "weekStart"), weeks, fingerprint: str(fd, "fingerprint") });
    return { to: page(id, "?step=rota"), ok: `${r.visits} visit${r.visits === 1 ? "" : "s"} created, not published. ${r.unassignedSlots} place${r.unassignedSlots === 1 ? "" : "s"} still need a carer. Carers are told only when the office publishes the rota.` };
  }, "Created");
}

export async function coordinatorAiSwitchAction(fd: FormData) {
  const on = str(fd, "on") === "1";
  return handle(fd, (ctx) => setCoordinatorAi(ctx, on, str(fd, "authorisedBy")), on ? "Care Coordinator AI reading switched on" : "Care Coordinator AI reading switched off");
}

export async function resolveFollowUpAction(fd: FormData) {
  return handle(fd, (ctx) => resolveFollowUp(ctx, str(fd, "itemId"), str(fd, "resolution")), "Follow-up closed");
}
