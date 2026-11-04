"use server";

import { ValidationError } from "@/lib/errors";
import { handle, str } from "./action-kit";
import {
  closeFollowUp, correctCallNote, createCallNote, createFollowUp, linkRecord, recordEscalation, resolveRoutedItem, reviewCallNote, submitOrganised, supersedeCallNote, withdrawDraft,
  type SubmitInput,
} from "@/server/care/call-notes";

/** Server actions for a service user's Call Notes. Every check is in src/server/care/call-notes.ts. */

const tab = (fd: FormData, extra = "") => `/rota/service-users/${encodeURIComponent(str(fd, "serviceUserId"))}?tab=call-notes${extra}`;

function whole(fd: FormData, k: string) {
  const n = Number(str(fd, k));
  if (!Number.isInteger(n) || n < 1) throw new ValidationError("This form is out of date. Reload the page and try again.");
  return n;
}

export async function createCallNoteAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const organise = str(fd, "intent") === "organise";
    const { note, repeated } = await createCallNote(ctx, str(fd, "serviceUserId"), {
      submissionKey: str(fd, "submissionKey"), date: str(fd, "date"), time: str(fd, "time"), method: str(fd, "method") as never, contactName: str(fd, "contactName"), contactRole: str(fd, "contactRole"),
      contactId: str(fd, "contactId"), summary: str(fd, "summary"), details: str(fd, "details"), clarification: str(fd, "clarification"), followUpRequired: fd.get("followUpRequired") === "on",
      followUpText: str(fd, "followUpText"), followUpOwnerId: str(fd, "followUpOwnerId"), followUpDueOn: str(fd, "followUpDueOn"), sourceDocumentId: str(fd, "sourceDocumentId"), restricted: fd.get("restricted") === "on", organise,
    });
    if (note.status === "DRAFT") return { to: tab(fd, `&draft=${note.id}`), ok: repeated ? "This draft was already created" : "Check the organised note before saving it" };
    return { to: tab(fd, `&note=${note.id}`), ok: repeated ? `${note.reference} was already saved` : note.status === "APPROVED" ? `${note.reference} saved` : `${note.reference} saved and sent for review` };
  }, "Call Note saved");
}

export async function submitOrganisedAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const ids = fd.getAll("itemId").map(String);
    const items: SubmitInput["items"] = ids.map((id) => ({ id, text: str(fd, `text_${id}`), kind: str(fd, `kind_${id}`) as never, destination: str(fd, `dest_${id}`) as never, decision: str(fd, `decision_${id}`) as never }));
    const followUps: NonNullable<SubmitInput["followUps"]> = [];
    for (const n of fd.getAll("fu").map(String)) {
      if (fd.get(`fu_on_${n}`) !== "on") continue;
      followUps.push({ description: str(fd, `fu_text_${n}`), assigneeId: str(fd, `fu_who_${n}`), dueOn: str(fd, `fu_due_${n}`), priority: (str(fd, `fu_pri_${n}`) || "MEDIUM") as never });
    }
    const note = await submitOrganised(ctx, str(fd, "noteId"), whole(fd, "lockVersion"), { summary: str(fd, "summary"), clarification: str(fd, "clarification"), restricted: fd.get("restricted") === "on", items, followUps });
    return { to: tab(fd, `&note=${note.id}`), ok: `${note.reference} saved and sent for review` };
  }, "Call Note saved");
}

export async function withdrawDraftAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await withdrawDraft(ctx, str(fd, "noteId"));
    return tab(fd);
  }, "Draft withdrawn. It stays in the history.");
}

export async function reviewCallNoteAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const decision = str(fd, "decision") as "APPROVE" | "CLARIFY" | "REJECT";
    const n = await reviewCallNote(ctx, str(fd, "noteId"), whole(fd, "lockVersion"), { decision, note: str(fd, "reviewNote") });
    return { to: tab(fd, `&note=${n.id}`), ok: decision === "APPROVE" ? `${n.reference} approved` : decision === "CLARIFY" ? "Clarification requested from the author" : `${n.reference} rejected` };
  }, "Review saved");
}

export async function correctCallNoteAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const n = await correctCallNote(ctx, str(fd, "noteId"), whole(fd, "lockVersion"), { summary: str(fd, "summary"), details: str(fd, "details"), clarification: str(fd, "clarification"), reason: str(fd, "reason") });
    return { to: tab(fd, `&note=${n.id}`), ok: `${n.reference} corrected (version ${n.version}) and sent for review` };
  }, "Correction saved");
}

export async function supersedeCallNoteAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await supersedeCallNote(ctx, str(fd, "noteId"), { byReference: str(fd, "byReference"), reason: str(fd, "reason") });
    return tab(fd, `&note=${str(fd, "noteId")}`);
  }, "Marked as superseded");
}

export async function createFollowUpAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await createFollowUp(ctx, str(fd, "noteId"), { description: str(fd, "description"), assigneeId: str(fd, "assigneeId"), dueOn: str(fd, "dueOn"), priority: (str(fd, "priority") || "MEDIUM") as never, evidenceRequired: fd.get("evidenceRequired") === "on" });
    return tab(fd, `&note=${str(fd, "noteId")}`);
  }, "Follow-up created and assigned");
}

export async function closeFollowUpAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const done = str(fd, "outcome") !== "cancel";
    await closeFollowUp(ctx, str(fd, "taskId"), whole(fd, "version"), { done, note: str(fd, "completionNote"), evidenceDocumentId: str(fd, "evidenceDocumentId") });
    return { to: tab(fd, `&note=${str(fd, "noteId")}`), ok: done ? "Follow-up completed" : "Follow-up cancelled" };
  }, "Follow-up closed");
}

export async function resolveRoutedItemAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await resolveRoutedItem(ctx, str(fd, "reviewItemId"), str(fd, "resolution"));
    return tab(fd, `&note=${str(fd, "noteId")}`);
  }, "Item closed");
}

export async function recordEscalationAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    await recordEscalation(ctx, str(fd, "noteId"), { action: str(fd, "action"), incidentId: str(fd, "incidentId") || null });
    return tab(fd, `&note=${str(fd, "noteId")}`);
  }, "Action recorded");
}

export async function linkRecordAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const ref = str(fd, "ref");
    if (!ref) throw new ValidationError("Choose a record to link");
    const [target, label] = ref.split("|", 2) as [string, string | undefined];
    await linkRecord(ctx, str(fd, "noteId"), target, label ?? "Linked record");
    return tab(fd, `&note=${str(fd, "noteId")}`);
  }, "Record linked");
}
