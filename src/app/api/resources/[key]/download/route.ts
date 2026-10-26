import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/current";
import { audit } from "@/server/audit-log";
import { businessDetails } from "@/server/business";
import { fillTags } from "@/lib/business";
import { fileName, parseBody, type DocModel } from "@/server/documents/model";
import { renderDocx } from "@/server/documents/docx";
import { renderPdf } from "@/server/documents/pdf";
import { TEMPLATES, type TemplateKey } from "@/content/registration";

export const dynamic = "force-dynamic";

const TYPES = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
} as const;

/** Downloads a Resource Centre template (such as the business plan) in the CSB Word or PDF style, filled with the organisation's business details. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { key } = await params;
  const t = Object.hasOwn(TEMPLATES, key) ? TEMPLATES[key as TemplateKey] : null;
  if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const format = new URL(req.url).searchParams.get("format") === "pdf" ? "pdf" : "docx";
  const details = await businessDetails(ctx.organisationId);
  const fill = (s: string) => (details ? fillTags(s, details) : s.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, tag: string) => `[${tag.replace(/_/g, " ")}]`));
  const now = new Date();
  const model: DocModel = {
    ref: t.ref,
    title: t.title,
    typeLabel: "Template",
    description: t.description,
    category: "CQC registration",
    organisation: details?.company_name || null,
    isTemplate: !details,
    version: "1.0",
    status: "Template",
    publishedAt: now,
    effectiveDate: now,
    approvedAt: null,
    approvedBy: "Not applicable (working template)",
    owner: details?.registered_manager || "Registered manager",
    nextReviewDate: null,
    reviewIntervalMonths: 12,
    appliesTo: details?.service_type || "All services",
    history: [],
    requirements: [],
    sections: t.sections.map((s, i) => ({ number: i + 1, heading: fill(s.heading), isLocal: false, blocks: parseBody(fill(s.body)) })),
    generatedAt: now,
    generatedBy: ctx.userName,
  };
  const file = format === "pdf" ? await renderPdf(model) : await renderDocx(model);
  await audit({ organisationId: ctx.organisationId, actorId: ctx.userId, action: "resource.downloaded", entityType: "Resource", entityId: key, data: { format } });
  const name = fileName(model, format);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": TYPES[format],
      "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
