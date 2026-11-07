"use server";

import { acceptRoutineChanges } from "@/server/care/coordinator/compare";
import { after } from "next/server";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { valueFromForm } from "@/lib/care-coordinator-forms";
import { handle, step, str } from "./action-kit";
import { addDocuments, addManualFact, approveVerified, cancelIntake, createIntake, decideFact, resolveFollowUp, setCoordinatorAi, updateIntakeDocument, MAX_INTAKE_DOCUMENTS } from "@/server/care/coordinator/intake";
import { approveSaveFailed, applySection, fileDocuments } from "@/server/care/coordinator/apply";
import { activateCare, createIntakeRota } from "@/server/care/coordinator/rota";
import { confirmAndSetUp, confirmReportText, proposeIntakeRota } from "@/server/care/coordinator/prepare";
import { chooseIdentityValue, confirmNewPerson, resolveException } from "@/server/care/coordinator/exceptions";
import { runAutomaticSetup, setupSummaryLines } from "@/server/care/coordinator/auto-setup";
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

const READING_NOTE = "It is being read now. When reading finishes, CSB AI sets up the person's records, drafts and a proposed rota by itself and lists only what needs attention. You can leave this page.";

export async function createIntakeAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const intake = await step("create-intake", "The intake could not be started. Nothing was saved and no document was stored.", () => createIntake(ctx, { title: str(fd, "title"), mode: str(fd, "mode") === "EXISTING" ? "EXISTING" : str(fd, "mode") === "DOCUMENT" ? "DOCUMENT" : "NEW", serviceUserId: str(fd, "serviceUserId"), areaId: str(fd, "areaId") }));
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length) {
      const r = await step("store-documents", `${intake.reference} was started, but the documents could not be stored. Open ${intake.reference} and upload them again; nothing else needs redoing.`, async () => addDocuments(ctx, intake.id, await filesFrom(fd), { read: "later" }));
      await step("queue-reading", `${intake.reference} was started and the documents were stored, but reading could not be started. Open ${intake.reference} and press Read again; nothing needs uploading again.`, () => queueIntakeReads(ctx, r.toRead, { prepare: true }));
      if (r.toRead.length) startReadingSoon();
      return { to: page(intake.id, "?step=setup"), ok: `${intake.reference} started and ${r.documents} document${r.documents === 1 ? "" : "s"} stored. ${r.toRead.length ? READING_NOTE : "Add the facts by hand under Check facts."}` };
    }
    return { to: page(intake.id), ok: `${intake.reference} started. Upload the documents next.` };
  }, "Started");
}

export async function uploadIntakeDocumentsAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const id = intakeId(fd);
    const r = await step("store-documents", "The documents could not be stored. Nothing was uploaded; try again.", async () => addDocuments(ctx, id, await filesFrom(fd), { read: "later" }));
    if (!r.documents && r.duplicates.length) return { ok: `${r.duplicates.join(", ")} ${r.duplicates.length === 1 ? "is" : "are"} already on this intake, so nothing was uploaded again.` };
    await step("queue-reading", "The documents were stored, but reading could not be started. Press Read again on each document; nothing needs uploading again.", () => queueIntakeReads(ctx, r.toRead, { prepare: true }));
    if (r.toRead.length) startReadingSoon();
    return { ok: `${r.documents} document${r.documents === 1 ? "" : "s"} uploaded and stored. ${r.toRead.length ? READING_NOTE : "Add the facts by hand under Check facts."}` };
  }, "Uploaded");
}

/**
 * Confirm & Set Up Records: the authorised coordinator's one confirmation (no separate manager approval). Saves every
 * section that is ready and says exactly which section, if any, was not saved; saved sections are never repeated.
 */
export async function confirmAndSetUpAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const id = intakeId(fd);
    const r = await confirmAndSetUp(ctx, id, { notADuplicate: fd.get("notADuplicate") === "on", areaId: str(fd, "areaId") || undefined, lockVersion: lockOf(fd) });
    if (approveSaveFailed(r.save)) throw new ValidationError(confirmReportText(r));
    return { to: page(id, "?step=save"), ok: confirmReportText(r) };
  }, "Set up");
}

/** Prepares the draft rota again from the saved repeating visits (unpublished; nothing is added twice). */
export async function proposeIntakeRotaAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const id = intakeId(fd);
    const weeks = Number(str(fd, "weeks") || "2");
    const r = await proposeIntakeRota(ctx, id, weeks);
    return { to: page(id, "?step=rota"), ok: `Draft rota prepared: ${r.visits} new unpublished visit${r.visits === 1 ? "" : "s"}${r.alreadyBuilt ? `, ${r.alreadyBuilt} already there` : ""}. ${r.unassignedSlots} place${r.unassignedSlots === 1 ? "" : "s"} still need a carer. Carers see nothing until care is active and the rota is published.` };
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

export async function applySectionAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const section = sectionOf(fd);
    const r = await applySection(ctx, intakeId(fd), section);
    if (r.status === "FAILED") throw new ValidationError(`${sectionLabel(section)} was not saved: ${r.error}. Sections already saved are kept.`);
    return { ok: `${sectionLabel(section)} saved to the CRM and read back` };
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

// ── Automatic setup by CSB AI (7 Nov 2026) ─────────────────────────────────

const itemIdOf = (fd: FormData) => {
  const id = str(fd, "itemId");
  if (!/^[a-z0-9]{10,40}$/i.test(id)) throw new ValidationError("This exception could not be found");
  return id;
};

/** Runs, carries on or retries the automatic setup (also how an intake from before automatic setup is resumed). */
export async function runAutomaticSetupAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const id = intakeId(fd);
    const r = await runAutomaticSetup(ctx, id);
    if (r.status === "FAILED") throw new ValidationError(`Setup did not finish: ${r.failures.join(" ") || r.sections.filter((s) => s.status === "FAILED").map((s) => `${s.label}: ${s.error}`).join(" ")} Everything saved so far is kept; run it again once the cause is corrected.`);
    if (r.blocked) return { to: page(id, "?step=setup"), ok: r.blocked.message };
    return { to: page(id, "?step=setup"), ok: `Setup finished. ${setupSummaryLines(r, str(fd, "mode") || "NEW").join(". ")}.` };
  }, "Setup finished");
}

/** A person settles one exception: closes it, chooses the right value, leaves it out or names a reference type. */
export async function resolveExceptionAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const action = str(fd, "action");
    const id = itemIdOf(fd);
    if (action === "USE_FACT") await resolveException(ctx, id, { action, factId: str(fd, "factId"), note: str(fd, "note") || undefined });
    else if (action === "LEAVE_OUT") await resolveException(ctx, id, { action, note: str(fd, "note") });
    else if (action === "REFERENCE_TYPE") {
      const type = str(fd, "type");
      if (type !== "COUNCIL_CLIENT" && type !== "COUNCIL_PACKAGE" && type !== "COUNCIL_FRAMEWORK") throw new ValidationError("Choose what the number is");
      await resolveException(ctx, id, { action, type });
    } else await resolveException(ctx, id, { action: "RESOLVE", note: str(fd, "note") });
  }, "Exception resolved");
}

export async function chooseIdentityAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const id = intakeId(fd);
    const r = await chooseIdentityValue(ctx, id, str(fd, "factId"));
    return { to: page(id, "?step=setup"), ok: r.blocked ? `Saved your choice. ${r.blocked.message}` : "Saved your choice. CSB AI carried on with the setup." };
  }, "Saved");
}

export async function confirmNewPersonAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const id = intakeId(fd);
    const r = await confirmNewPerson(ctx, id);
    return { to: page(id, "?step=setup"), ok: r.blocked ? r.blocked.message : "Confirmed as a new person. CSB AI created the record and carried on with the setup." };
  }, "Confirmed");
}
