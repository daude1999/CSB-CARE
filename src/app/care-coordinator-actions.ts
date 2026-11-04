"use server";
import { requirePortal } from "@/server/auth/portals";
import { previewIntake, executeIntake } from "@/server/care/coordinator-import";
import { ValidationError } from "@/lib/errors";
import { MAX_DOCUMENT_BYTES, type UploadedFile } from "@/server/care/su-documents";

export type ImportState = {
  phase: "idle" | "preview" | "complete" | "error";
  message: string;
  count?: { contacts: number; visits: number; weeklyMinutes: number };
  serviceUserId?: string;
  steps?: string[];
  blocked?: string[];
};
export async function careCoordinatorImportAction(_previous: ImportState, fd: FormData): Promise<ImportState> {
  // CSRF/session protections provided by Next server actions and requirePortal.
  const ctx = await requirePortal("rota");
  try {
    const source = fd.get("manifest");
    if (typeof source !== "string" || source.length > 150000) throw new ValidationError("Provide a JSON manifest below 150 KB");
    let raw: unknown;
    try { raw = JSON.parse(source); } catch { throw new ValidationError("The import JSON is not valid"); }
    const checked = await previewIntake(ctx, raw);
    const intent = fd.get("intent");
    if (intent !== "execute") return {
      phase:"preview", message:"Validation passed. Review the proposed record, document attachments and approval tasks before creating it.",
      count:{contacts:checked.contacts,visits:checked.visitTemplates,weeklyMinutes:checked.weeklyMinutes}
    };
    if (fd.get("confirm") !== "on") throw new ValidationError("Tick the explicit creation approval checkbox");
    if (!ctx.organisationId) throw new ValidationError("No organisation selected");
    const data = { ...checked.data, approvalPhrase:"I APPROVE DRAFT RECORD CREATION" as const };
    const prepare = async (name: string): Promise<UploadedFile | undefined> => {
      const f = fd.get(name);
      if (!(f instanceof File) || f.size === 0) return undefined;
      if (f.size > MAX_DOCUMENT_BYTES) throw new ValidationError(name+" exceeds 4 MB. Compress securely before uploading.");
      if (!f.name.toLowerCase().endsWith(".pdf")) throw new ValidationError("Please supply original PDF documents");
      return {name:f.name,type:f.type || "application/pdf",bytes:Buffer.from(await f.arrayBuffer())};
    };
    const result = await executeIntake(ctx,data,{
      supportPlan:await prepare("supportPlan"),discharge:await prepare("discharge"),
    });
    return {phase:"complete",message:"Import completed to Assessment. Care plan is DRAFT. Staff still need to approve clinical decisions and activate care.",
      serviceUserId:result.serviceUserId,steps:result.steps,blocked:result.blocked};
  } catch(error) {
    return {phase:"error",message:error instanceof Error?error.message:"Import failed"};
  }
}
