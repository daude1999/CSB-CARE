"use server";

import { ValidationError } from "@/lib/errors";
import { handle, str } from "./action-kit";
import { replaceDocument, setDocumentArchived, updateDocumentDetails, uploadDocument, type DocumentDetails, type UploadedFile } from "@/server/care/su-documents";
import { addObservationPhoto, decideIncident, recordObservation, reviewObservation, type IncidentDecision } from "@/server/care/body-map";

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

export async function updateSuDocumentAction(fd: FormData) {
  return handle(fd, (ctx) => updateDocumentDetails(ctx, str(fd, "documentId"), whole(fd, "lockVersion"), details(fd)), "Details saved");
}

export async function archiveSuDocumentAction(fd: FormData) {
  const archive = str(fd, "archive") === "true";
  return handle(fd, (ctx) => setDocumentArchived(ctx, str(fd, "documentId"), whole(fd, "lockVersion"), archive, str(fd, "reason")), archive ? "Moved to historical documents" : "Document restored");
}

export async function recordBodyMapAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const photo = await fileFrom(fd, "photo", false);
    const suId = str(fd, "serviceUserId");
    const o = await recordObservation(ctx, suId, Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string")), photo ? { ...photo, caption: str(fd, "caption") } : undefined);
    return { to: `/rota/service-users/${encodeURIComponent(suId)}?tab=bodymap&obs=${o.id}`, ok: "Observation recorded" };
  }, "Observation recorded");
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
