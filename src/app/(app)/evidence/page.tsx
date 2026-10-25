import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { uploadEvidenceAction } from "../../actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function EvidencePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "evidence.read")) notFound();
  const docs = await db.evidenceDocument.findMany({ where: { organisationId: ctx.organisationId! }, orderBy: { createdAt: "desc" } });
  return (
    <>
      <PageHeader eyebrow="Care operations · supporting records" title="Evidence Library" subtitle="Documents supporting audits, actions and policy implementation. Files are checked by type and size; malware scanning runs when a scanner is configured." />
      <Flash searchParams={sp} />
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="lg:col-span-2">
          {docs.length ? (
            <table className="table table-stack">
              <thead><tr><th>File</th><th>Description</th><th>Size</th><th>Scan</th><th>Uploaded</th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td data-label="File"><a href={`/api/evidence/${d.id}`}>{d.filename}</a><div className="text-[11px] text-slate-400">{d.contentType}</div></td>
                    <td data-label="Description" className="text-xs">{d.description}</td>
                    <td data-label="Size" className="text-xs">{Math.ceil(d.sizeBytes / 1024)} KB</td>
                    <td data-label="Scan"><Badge tone={d.scanStatus === "CLEAN" ? "green" : d.scanStatus === "INFECTED" ? "rose" : "amber"}>{d.scanStatus.replace(/_/g, " ").toLowerCase()}</Badge></td>
                    <td data-label="Uploaded" className="text-xs">{fmtDate(d.createdAt, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>No evidence uploaded.</Empty>
          )}
        </Card>
        {hasOrgPermission(ctx, "evidence.upload") ? (
          <Card title="Upload">
            <form action={uploadEvidenceAction} className="space-y-2">
              <input type="hidden" name="back" value="/evidence" />
              <input type="file" name="file" required className="w-full max-w-full text-sm" aria-label="File" accept=".pdf,.docx,.png,.jpg,.jpeg,.txt,.csv" />
              <input name="description" className="input" placeholder="Description" aria-label="Description" />
              <button className="btn-primary" type="submit">Upload</button>
              <p className="text-xs text-slate-500">PDF, Word, images, text or CSV up to 10 MB.</p>
            </form>
          </Card>
        ) : null}
      </div>
    </>
  );
}
