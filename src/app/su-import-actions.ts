"use server";

import { ValidationError } from "@/lib/errors";
import { handleData, str } from "./action-kit";
import { confirmImport, readSupportPlan, type ReadResult } from "@/server/care/su-import";
import type { UploadedFile } from "@/server/care/su-documents";

/** Server actions for "Set up from support plan": read the uploaded PDF into a draft, and confirm the checked draft. */

const MAX_FILES = 4;

async function filesFrom(fd: FormData): Promise<UploadedFile[]> {
  const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length > MAX_FILES) throw new ValidationError(`Upload at most ${MAX_FILES} files`);
  return Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) })));
}

/** Step 1: reads the support plan (first file) and returns the proposed draft for checking. Nothing is saved. */
export async function readSupportPlanAction(fd: FormData): Promise<{ ok: true; data: ReadResult } | { ok: false; error: string }> {
  return handleData(async (ctx) => readSupportPlan(ctx, await filesFrom(fd)));
}

/** Step 3: creates the person, contacts, package, visit templates and documents in one go. Returns where to go next. */
export async function confirmImportAction(fd: FormData): Promise<{ ok: true; data: { to: string } } | { ok: false; error: string }> {
  return handleData(async (ctx) => {
    let draft: unknown;
    try {
      draft = JSON.parse(str(fd, "draft") || "{}");
    } catch {
      throw new ValidationError("The form could not be read. Reload the page and try again.");
    }
    const r = await confirmImport(ctx, draft, await filesFrom(fd));
    const ok = `${r.reference} set up: ${r.contacts} contact${r.contacts === 1 ? "" : "s"}, ${r.templates} repeating visit${r.templates === 1 ? "" : "s"} and ${r.documents} document${r.documents === 1 ? "" : "s"}. ${r.careActive ? "Build Rota can now schedule the visits." : "Set their care to Active before building the rota."}`;
    return { to: `/rota/service-users/${r.serviceUserId}?ok=${encodeURIComponent(ok)}` };
  }, { revalidate: true });
}
