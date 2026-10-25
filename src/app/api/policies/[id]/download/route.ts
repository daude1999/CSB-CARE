import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/current";
import { audit } from "@/server/audit-log";
import { buildDocModel, fileName } from "@/server/documents/model";
import { renderDocx } from "@/server/documents/docx";
import { renderPdf } from "@/server/documents/pdf";

export const dynamic = "force-dynamic";

const TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
} as const;

/** Downloads the current published version of a policy as a CSB-branded Word or PDF document. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format") === "pdf" ? "pdf" : "docx";
  let model;
  try {
    model = await buildDocModel(ctx, id);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const file = format === "pdf" ? await renderPdf(model) : await renderDocx(model);
  await audit({ organisationId: ctx.organisationId, actorId: ctx.userId, action: "policy.downloaded", entityType: "Policy", entityId: id, data: { format, version: model.version } });
  const name = fileName(model, format);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
