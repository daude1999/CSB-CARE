"use server";

import { ValidationError } from "@/lib/errors";
import { REFERENCE_TYPES, type ReferenceType } from "@/lib/reference-numbers";
import { addExternalReference, supersedeExternalReference, verifyExternalReference } from "@/server/care/external-references";
import { handle, str } from "./action-kit";

/** Server actions for Service User → Reference Numbers. Every check is made again in the reference service. */

function refType(fd: FormData): ReferenceType {
  const t = str(fd, "type");
  const hit = REFERENCE_TYPES.find((x) => x === t);
  if (!hit) throw new ValidationError("Choose the reference type");
  return hit;
}

function page(fd: FormData) {
  const v = str(fd, "sourcePage");
  if (!v) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 2000) throw new ValidationError("The source page must be a whole number");
  return n;
}

export async function addReferenceAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await addExternalReference(ctx, str(fd, "serviceUserId"), {
      type: refType(fd),
      issuer: str(fd, "issuer"),
      value: str(fd, "value"),
      systemLabel: str(fd, "systemLabel"),
      sourceDocumentId: str(fd, "sourceDocumentId"),
      sourcePage: page(fd),
      sourceQuote: str(fd, "sourceQuote"),
      verificationNote: str(fd, "verificationNote"),
    });
    const base = r.created ? "Reference added. It is awaiting verification." : r.reinstated ? "This reference had been superseded. It is back in use and awaiting verification." : "This reference is already on the profile. Nothing was added.";
    return { ok: [base, ...r.warnings].join(" ") };
  }, "Reference added");
}

export async function verifyReferenceAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const d = str(fd, "decision");
    if (d !== "VERIFIED" && d !== "REJECTED") throw new ValidationError("Choose Verified or Rejected");
    await verifyExternalReference(ctx, str(fd, "referenceId"), d === "VERIFIED", str(fd, "reason"));
    return { ok: d === "VERIFIED" ? "Reference verified" : "Reference marked as rejected" };
  }, "Reference updated");
}

export async function supersedeReferenceAction(fd: FormData) {
  return handle(fd, async (ctx) => {
    const r = await supersedeExternalReference(ctx, str(fd, "referenceId"), { value: str(fd, "value"), reason: str(fd, "reason") });
    return { ok: r.replacedById ? "Reference corrected. The original is kept as superseded; the new number is awaiting verification." : "Reference withdrawn. It is kept as superseded in the history." };
  }, "Reference updated");
}
