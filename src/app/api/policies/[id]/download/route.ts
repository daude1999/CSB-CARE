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

/**
 * The current published version of a policy as a CSB-branded Word or PDF document.
 * `disposition=inline` serves the PDF for the Policy Library's document viewer; only downloads are audited.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  const search = new URL(req.url).searchParams;
  const format = search.get("format") === "pdf" ? "pdf" : "docx";
  const inline = format === "pdf" && search.get("disposition") === "inline";
  let model;
  try {
    model = await buildDocModel(ctx, id);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let file: Buffer | Uint8Array;
  try {
    file = format === "pdf" ? await renderPdf(model) : await renderDocx(model);
  } catch {
    return NextResponse.json({ error: "The document could not be produced. Please try again." }, { status: 500 });
  }
  if (!inline) await audit({ organisationId: ctx.organisationId, actorId: ctx.userId, action: "policy.downloaded", entityType: "Policy", entityId: id, data: { format, version: model.version } });
  const name = fileName(model, format);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
