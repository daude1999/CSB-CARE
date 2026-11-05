import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { fmtLondonDate, londonDate } from "@/lib/london";
import { INTAKE_STATUS } from "@/lib/care-coordinator-rules";
import { serviceUserChatContext } from "./chat";
import type { CrmPage } from "./crm-assistant";
import { addDocuments, coordinatorAccess, createIntake, getIntake, listIntakes, MAX_INTAKE_DOCUMENTS } from "./intake";
import { digestText, intakeDigest } from "./intake-digest";
import { readOnce } from "./agent-tools";
import type { UploadedFile } from "../su-documents";

/**
 * The AI CSB Coordinator's paperclip. Attaching a document in the chat is the same as uploading it on the intake's
 * Documents step: addDocuments checks size and type, virus-scans when a scanner is configured, stores the original
 * privately, keeps each page's text, audits the upload and reads it with the organisation's reading pipeline (AI only
 * when the organisation switched it on). Nothing is approved or saved to a person's record here.
 *
 * Duplicates: the same file (by SHA-256) already on the chosen intake is not added again, and is not read again, so it
 * is never charged twice. A file already on another open intake this employee can see is not used to start a new one;
 * the employee is pointed to that intake instead. Two identical uploads at the same moment share one upload.
 */

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const OPEN = ["DRAFT", "SUBMITTED", "APPROVED", "APPLYING"];

export async function chatUploadTargets(ctx: Parameters<typeof coordinatorAccess>[0], page: CrmPage) {
  coordinatorAccess(ctx);
  const intakes = (await listIntakes(ctx)).filter((r) => r.status === "DRAFT");
  const current = page.kind === "intake" && page.id ? intakes.find((r) => r.id === page.id) ?? null : null;
  const su = page.kind === "service-user" && page.id ? await serviceUserChatContext(ctx, page.id) : null;
  return {
    current: current ? { id: current.id, reference: current.reference, title: current.title } : null,
    serviceUser: su && page.id ? { id: page.id, name: (su.serviceUser as { name: string }).name } : null,
    recent: intakes.filter((r) => r.id !== current?.id).slice(0, 3).map((r) => ({ id: r.id, reference: r.reference, title: r.title })),
  };
}

export async function uploadFromChat(
  ctx: Parameters<typeof coordinatorAccess>[0],
  input: { target: "intake" | "new"; intakeId: string | null; serviceUserId: string | null; title: string | null; files: UploadedFile[] },
) {
  coordinatorAccess(ctx);
  if (!input.files.length) throw new ValidationError("Choose a document to attach");
  const hashes = input.files.map((f) => sha(f.bytes));
  const key = `upload:${ctx.organisationId}:${input.target}:${input.intakeId ?? input.serviceUserId ?? "-"}:${[...hashes].sort().join(",")}`;
  const { result } = await readOnce(key, () => upload(ctx, input, hashes));
  return result;
}

async function upload(ctx: Parameters<typeof coordinatorAccess>[0], input: Parameters<typeof uploadFromChat>[1], hashes: string[]) {
  const organisationId = ctx.organisationId!;
  let intakeId: string;
  let created = false;
  if (input.target === "intake") {
    if (!input.intakeId) throw new ValidationError("Choose the intake for this document");
    const view = await getIntake(ctx, input.intakeId); // scoped: another organisation's or area's intake is "not found"
    if (view.intake.status !== "DRAFT") throw new ValidationError(`${view.intake.reference} is ${INTAKE_STATUS[view.intake.status as keyof typeof INTAKE_STATUS]?.toLowerCase() ?? "closed"}, so documents can't be added. Start a new intake instead.`);
    intakeId = view.intake.id;
  } else {
    // The same file already on an open intake this employee can see: point there instead of starting another.
    const visible = new Set((await listIntakes(ctx)).filter((r) => OPEN.includes(r.status)).map((r) => r.id));
    const elsewhere = await db.careIntakeDocument.findFirst({ where: { organisationId, sha256: { in: hashes }, intakeId: { in: [...visible] } }, select: { intake: { select: { id: true, reference: true, title: true } } } });
    if (elsewhere) {
      const view = await getIntake(ctx, elsewhere.intake.id);
      return {
        intakeId: elsewhere.intake.id, reference: elsewhere.intake.reference, created: false, added: [] as string[], duplicates: input.files.map((f) => f.name), alreadyOnIntake: true,
        failed: [] as { name: string; error: string }[], summary: digestText(intakeDigest(view)), href: `/rota/coordinator/${elsewhere.intake.id}?step=facts`,
      };
    }
    const intake = await createIntake(ctx, {
      title: input.title || `Support plan from AI chat, ${fmtLondonDate(londonDate(), { day: "numeric", month: "short", year: "numeric" })}`,
      mode: input.serviceUserId ? "EXISTING" : "NEW",
      serviceUserId: input.serviceUserId ?? undefined,
    });
    intakeId = intake.id;
    created = true;
  }

  const existing = await db.careIntakeDocument.findMany({ where: { intakeId, organisationId }, select: { sha256: true } });
  const seen = new Set(existing.map((d) => d.sha256));
  const fresh: typeof input.files = [];
  const duplicates: string[] = [];
  input.files.forEach((f, i) => {
    if (seen.has(hashes[i]!)) duplicates.push(f.name);
    else {
      seen.add(hashes[i]!);
      fresh.push(f);
    }
  });
  if (existing.length + fresh.length > MAX_INTAKE_DOCUMENTS) throw new ValidationError(`An intake can hold at most ${MAX_INTAKE_DOCUMENTS} documents`);
  const failed: { name: string; error: string }[] = [];
  if (fresh.length) {
    const r = await addDocuments(ctx, intakeId, fresh);
    const docs = await db.careIntakeDocument.findMany({ where: { intakeId }, select: { id: true, name: true } });
    for (const x of r.results) if ("error" in x && x.error) failed.push({ name: docs.find((d) => d.id === x.documentId)?.name ?? "document", error: String(x.error).slice(0, 200) });
  }
  const view = await getIntake(ctx, intakeId);
  return {
    intakeId, reference: view.intake.reference, created, added: fresh.map((f) => f.name), duplicates, alreadyOnIntake: false, failed,
    summary: digestText(intakeDigest(view)), href: `/rota/coordinator/${intakeId}?step=facts`,
  };
}
