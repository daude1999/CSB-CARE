"use server";

import { after } from "next/server";
import { ValidationError } from "@/lib/errors";
import { handle, str } from "./action-kit";
import { acceptRecommendation, autoRecommend, createTaskFromRecommendation, dismissRecommendation, generateRecommendations, setBodyMapAiEnabled, startRecommendationReview } from "@/server/care/body-map-ai";
import { closeBodyMapTask, createBodyMapTask } from "@/server/care/body-map-tasks";
import { endApplicationSite, recordApplicationSite } from "@/server/care/medication-sites";
import { decideVersion } from "@/server/care/document-versions";
import { replaceDocument, setDocumentArchived, updateDocumentDetails, uploadDocument, type DocumentDetails, type UploadedFile } from "@/server/care/su-documents";
import { MAX_PHOTOS_PER_SAVE, addObservationNote, addObservationPhoto, assignObservationReviewer, decideIncident, recordObservation, reviewObservation, type IncidentDecision } from "@/server/care/body-map";

/** Server actions for a service user's Council Documents, Other Documents and Digital Body Map. */

async function fileFrom(fd: FormData, key: string, required: boolean): Promise<UploadedFile | null> {
  const f = fd.get(key);
  if (!(f instanceof File) || f.size === 0) {
    if (required) throw new ValidationError("Choose a file to upload");
    return null;
  }
  return { name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) };
}

function whole(fd: FormData, k: string) {
  const n = Number(str(fd, k));
  if (!Number.isInteger(n) || n < 1) throw new ValidationError("This form is out of date. Reload the page and try again.");
  return n;
}

function section(fd: FormData) {
  const s = str(fd, "section");
  if (s !== "COUNCIL" && s !== "OTHER") throw new ValidationError("Choose Council Documents or Other Documents");
  return s;
}

function details(fd: FormData): DocumentDetails {
  return {
    name: str(fd, "name"),
    category: str(fd, "category"),
    issuingAuthority: str(fd, "issuingAuthority"),
    receivedOn: str(fd, "receivedOn"),
    effectiveFrom: str(fd, "effectiveFrom"),
    expiresOn: str(fd, "expiresOn"),
    notes: str(fd, "notes"),
    markSensitive: fd.get("markSensitive") === "on",
  };
}

const docUrl = (fd: FormData, id: string) => {
  const s = section(fd) === "COUNCIL" ? "council" : "other";
  return `/rota/service-users/${encodeURIComponent(str(fd, "serviceUserId"))}?tab=documents&section=${s}&doc=${id}`;
};

export async function uploadSuDocumentAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const file = (await fileFrom(fd, "file", true))!;
    const doc = await uploadDocument(ctx, str(fd, "serviceUserId"), section(fd), details(fd), file);
    return { to: docUrl(fd, doc.id), ok: "Document uploaded" };
  }, "Document uploaded");
}

export async function replaceSuDocumentAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const file = (await fileFrom(fd, "file", true))!;
    const v = await replaceDocument(ctx, str(fd, "documentId"), whole(fd, "lockVersion"), file, str(fd, "changeNote"));
    return { ok: `New version ${v} saved. Earlier versions are kept.` };
  }, "Replaced");
}

/** Approve or reject a version waiting for review, or withdraw one (document version control). */
export async function decideSuDocumentVersionAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const decision = str(fd, "decision");
    if (decision !== "APPROVE" && decision !== "REJECT" && decision !== "WITHDRAW") throw new ValidationError("Choose approve, reject or withdraw");
    const version = whole(fd, "version");
    const r = await decideVersion(ctx, str(fd, "documentId"), version, { decision, note: str(fd, "note") || undefined });
    return { ok: decision === "APPROVE" ? `V${version} approved and now in force. The earlier version is kept as superseded.` : decision === "REJECT" ? `V${version} rejected. V${r.currentVersion} stays in force.` : `V${version} withdrawn.${r.currentVersion !== version ? ` V${r.currentVersion} is in force.` : ""}` };
  }, "Saved");
}

export async function updateSuDocumentAction(fd: FormData) {
  return handle(fd, (ctx) => updateDocumentDetails(ctx, str(fd, "documentId"), whole(fd, "lockVersion"), details(fd)), "Details saved");
}

export async function archiveSuDocumentAction(fd: FormData) {
  const archive = str(fd, "archive") === "true";
  return handle(fd, (ctx) => setDocumentArchived(ctx, str(fd, "documentId"), whole(fd, "lockVersion"), archive, str(fd, "reason")), archive ? "Moved to historical documents" : "Document restored");
}

async function filesFrom(fd: FormData, key: string, max: number): Promise<UploadedFile[]> {
  const files = fd.getAll(key).filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > max) throw new ValidationError(`Add up to ${max} photographs at a time`);
  return Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) })));
}

export async function recordBodyMapAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const photos = await filesFrom(fd, "photo", MAX_PHOTOS_PER_SAVE);
    const suId = str(fd, "serviceUserId");
    const caption = str(fd, "caption");
    const o = await recordObservation(ctx, suId, Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")), photos.map((p) => ({ ...p, caption })));
    // Recommendations are prepared after the response is sent, so saving is never slowed or stopped by the AI.
    after(() => autoRecommend(ctx, o.id));
    return { to: `/rota/service-users/${encodeURIComponent(suId)}?tab=bodymap&obs=${o.id}&saved=1`, ok: "Observation saved" };
  }, "Observation saved");
}

export async function noteBodyMapAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const photo = await fileFrom(fd, "photo", false);
    await addObservationNote(ctx, str(fd, "observationId"), str(fd, "text"), photo ? { ...photo, caption: str(fd, "caption") } : undefined);
  }, "Note saved. The original observation and earlier notes are unchanged.");
}

export async function reviewerBodyMapAction(fd: FormData) {
  return handle(fd, (ctx) => assignObservationReviewer(ctx, str(fd, "observationId"), whole(fd, "version"), str(fd, "reviewerId")), "Reviewer assigned");
}

export async function generateBodyMapRecsAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await generateRecommendations(ctx, str(fd, "observationId"), "MANUAL");
    if (r.status === "UP_TO_DATE") return { ok: "Recommendations are already up to date with the information recorded" };
    if (r.status === "FAILED") throw new ValidationError(r.message);
    if (r.status === "NONE") return { ok: "No reliable recommendation could be made from the records. See what was missing below." };
    return { ok: `${r.count} recommendation${r.count === 1 ? "" : "s"} ready for review` };
  }, "Recommendations ready");
}

export async function bodyMapRecDecisionAction(fd: FormData) {
  const decision = str(fd, "decision");
  return handle(fd, async (ctx) => {
    const id = str(fd, "recommendationId");
    if (decision === "REVIEW") await startRecommendationReview(ctx, id);
    else if (decision === "ACCEPT") await acceptRecommendation(ctx, id, str(fd, "note"));
    else if (decision === "DISMISS") await dismissRecommendation(ctx, id, str(fd, "note"));
    else throw new ValidationError("Choose what to do with the suggestion");
  }, decision === "REVIEW" ? "Marked as under review" : decision === "ACCEPT" ? "Suggestion accepted. This is not a clinical or safeguarding decision." : "Suggestion dismissed");
}

export async function bodyMapRecTaskAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await createTaskFromRecommendation(ctx, str(fd, "recommendationId"), { kind: str(fd, "kind"), assigneeId: str(fd, "assigneeId"), dueOn: str(fd, "dueOn"), details: str(fd, "details") });
  }, "Task created and assigned");
}

export async function bodyMapTaskAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await createBodyMapTask(ctx, str(fd, "observationId"), { kind: str(fd, "kind"), assigneeId: str(fd, "assigneeId"), dueOn: str(fd, "dueOn"), details: str(fd, "details") });
  }, "Task created and assigned");
}

export async function closeBodyMapTaskAction(fd: FormData) {
  const done = str(fd, "done") !== "0";
  return handle(fd, (ctx) => closeBodyMapTask(ctx, str(fd, "taskId"), whole(fd, "version"), { outcome: str(fd, "outcome"), done }), done ? "Task completed" : "Task cancelled");
}

export async function medicationSiteAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await recordApplicationSite(ctx, str(fd, "serviceUserId"), { medicationId: str(fd, "medicationId"), view: str(fd, "view"), x: str(fd, "x"), y: str(fd, "y"), region: str(fd, "region"), note: str(fd, "note") });
    return { to: `/rota/service-users/${encodeURIComponent(str(fd, "serviceUserId"))}?tab=bodymap`, ok: "Application site recorded" };
  }, "Application site recorded");
}

export async function endMedicationSiteAction(fd: FormData) {
  return handle(fd, (ctx) => endApplicationSite(ctx, str(fd, "siteId"), str(fd, "reason")), "Application site ended");
}

export async function bodyMapAiSwitchAction(fd: FormData) {
  const on = str(fd, "on") === "1";
  return handle(fd, (ctx) => setBodyMapAiEnabled(ctx, on, str(fd, "authorisedBy")), on ? "Body map recommendations switched on" : "Body map recommendations switched off");
}

export async function reviewBodyMapAction(fd: FormData) {
  const resolved = fd.get("resolved") === "on";
  return handle(fd, (ctx) => reviewObservation(ctx, str(fd, "observationId"), whole(fd, "version"), { outcome: str(fd, "outcome"), nextFollowUpOn: str(fd, "nextFollowUpOn"), resolved }), resolved ? "Observation resolved" : "Follow-up recorded");
}

export async function bodyMapPhotoAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const photo = (await fileFrom(fd, "photo", true))!;
    await addObservationPhoto(ctx, str(fd, "observationId"), photo, str(fd, "caption"));
  }, "Photo added");
}

export async function bodyMapIncidentAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const kind = str(fd, "decision");
    let decision: IncidentDecision;
    if (kind === "LINK") decision = { kind, incidentId: str(fd, "incidentId"), note: str(fd, "note") };
    else if (kind === "NOT_REQUIRED") decision = { kind, note: str(fd, "note") };
    else if (kind === "NEW") decision = { kind, severity: str(fd, "severity"), category: str(fd, "category"), description: str(fd, "description"), safeguarding: fd.get("safeguarding") === "on" };
    else throw new ValidationError("Choose what to do about an incident report");
    const id = await decideIncident(ctx, str(fd, "observationId"), whole(fd, "version"), decision);
    return { ok: kind === "NEW" ? "Incident reported and linked" : id ? "Linked to the incident" : "Recorded: no incident report needed" };
  }, "Saved");
}
