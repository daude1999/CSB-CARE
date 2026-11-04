import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { LINK_TYPES, linkFor, resolveLinks } from "@/server/compliance/evidence";
import { hiddenRcaIds } from "@/server/cqc/visibility";
import { memberNames } from "@/server/rota/queries";
import { uploadLinkedEvidenceAction } from "@/app/compliance-actions";
import { ComplianceTabs } from "@/components/compliance-nav";
import { ScanBadge } from "@/components/evidence-ui";
import { Flash, fmtDate } from "@/components/ui";
import { ActionDialog } from "@/components/dialog";
import { PcFoot, PcSearch, PcTableWrap } from "@/components/compliance-ui";
import { PcSelect } from "@/components/pc-select";
import { UploadSimple } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { "application/pdf": "PDF", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word", "image/png": "Image", "image/jpeg": "Image", "text/plain": "Text", "text/csv": "CSV" };

/**
 * Every evidence file the organisation holds, with the record it supports. Files are checked by type and size on
 * upload; a file is shown as clean only when a malware scanner has passed it. Downloads are permission-checked and logged.
 */
export default async function EvidencePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "evidence.read")) notFound();
  const orgId = ctx.organisationId!;
  const filter = sp.linked === "none" ? "none" : sp.linked && sp.linked in LINK_TYPES ? sp.linked : sp.linked === "MISSED_CALL" ? "MISSED_CALL" : "all";
  const q = sp.q?.trim().slice(0, 100);
  const hidden = await hiddenRcaIds(ctx);
  const docs = await db.evidenceDocument.findMany({
    where: { organisationId: orgId, ...(hidden.length ? { NOT: { linkedType: "RCA", linkedId: { in: hidden } } } : {}), ...(filter === "none" ? { linkedType: null } : filter !== "all" ? { linkedType: filter } : {}), ...(q ? { OR: [{ filename: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const canUpload = hasOrgPermission(ctx, "evidence.upload");
  // Link to the supporting record only when this person may open it; otherwise name it as text.
  const canOpen = (type: string) => (["AUDIT", "AUDIT_ANSWER", "FINDING"].includes(type) ? hasOrgPermission(ctx, "audit.conduct") : type === "RISK" ? hasOrgPermission(ctx, "risk.view") : type === "ACTION" ? hasOrgPermission(ctx, "action.manage") : true);
  const [links, names, targets] = await Promise.all([
    resolveLinks(orgId, docs),
    memberNames(ctx, docs.map((d) => d.uploadedById)),
    canUpload
      ? Promise.all([
          db.policy.findMany({ where: { organisationId: orgId, kind: "CUSTOMER", status: "ACTIVE" }, select: { id: true, ref: true, title: true }, orderBy: { ref: "asc" } }),
          db.audit.findMany({ where: { organisationId: orgId, ...(ctx.branchIds ? { OR: [{ branchId: { in: ctx.branchIds } }, { branchId: null }] } : {}) }, select: { id: true, title: true, startedAt: true }, orderBy: { startedAt: "desc" }, take: 50 }),
          db.complianceAction.findMany({ where: { organisationId: orgId, status: { not: "CLOSED" } }, select: { id: true, title: true }, orderBy: { dueDate: "asc" }, take: 100 }),
          hasOrgPermission(ctx, "risk.view") ? db.complianceRisk.findMany({ where: { organisationId: orgId, status: { not: "CLOSED" } }, select: { id: true, ref: true, title: true }, orderBy: { ref: "asc" } }) : [],
        ])
      : null,
  ]);
  const filters: [string, string][] = [["all", "All"], ...Object.entries(LINK_TYPES), ["none", "Not linked"]];
  return (
    <>
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="improvements" active="evidence" />}
        title="Audits & Improvements"
        subtitle="The Evidence Library: documents that support policies, audits, findings, corrective actions and risks. Files are checked by type and size; a file is marked clean only after a malware scan. Every download is permission-checked and logged."
        actions={targets ? (
          <ActionDialog triggerClassName="pc-btn" trigger={<><UploadSimple size={16} aria-hidden="true" />Upload evidence</>} title="Upload evidence" description="PDF, Word, images, text or CSV up to 10 MB. To attach evidence to an audit question or finding, use the button beside it on the audit.">
            <form action={uploadLinkedEvidenceAction} className="space-y-3">
              <input type="hidden" name="back" value="/evidence" />
              <label className="block"><span className="label">File</span><input type="file" name="file" required className="block w-full text-sm" accept=".pdf,.docx,.png,.jpg,.jpeg,.txt,.csv" /></label>
              <label className="block"><span className="label">What it shows</span><input name="description" maxLength={300} className="input" /></label>
              <label className="block"><span className="label">The record it supports</span>
                <select name="link" className="input" defaultValue="">
                  <option value="">Not linked to a record</option>
                  {targets[0].length ? <optgroup label="Policies">{targets[0].map((p) => <option key={p.id} value={`POLICY:${p.id}`}>{p.ref} {p.title}</option>)}</optgroup> : null}
                  {targets[1].length ? <optgroup label="Audits">{targets[1].map((x) => <option key={x.id} value={`AUDIT:${x.id}`}>{x.title} ({fmtDate(x.startedAt)})</option>)}</optgroup> : null}
                  {targets[2].length ? <optgroup label="Corrective actions">{targets[2].map((x) => <option key={x.id} value={`ACTION:${x.id}`}>{x.title}</option>)}</optgroup> : null}
                  {targets[3].length ? <optgroup label="Risks">{targets[3].map((x) => <option key={x.id} value={`RISK:${x.id}`}>{x.ref} {x.title}</option>)}</optgroup> : null}
                </select>
              </label>
              <button className="btn-primary w-full" type="submit">Upload</button>
            </form>
          </ActionDialog>
        ) : null}
      />
      <Flash searchParams={sp} />
      <section aria-label="Evidence library" className="pc-panel">
        <form method="get" action="/evidence" role="search" aria-label="Filter evidence" className="pc-toolbar">
          <PcSearch defaultValue={q} placeholder="Search file names and descriptions" />
          <PcSelect name="linked" label="Linked to" defaultValue={filter === "all" ? "" : filter} options={filters.map(([value, label]) => ({ value: value === "all" ? "" : value, label }))} />
          <button className="pc-btn-secondary sr-only focus:not-sr-only" type="submit">Search</button>
        </form>
        {docs.length ? (
          <PcTableWrap>
            <table className="pc-table">
              <thead><tr><th>File</th><th>Type</th><th>Linked to</th><th>Uploaded by</th><th>Date</th><th>Access</th></tr></thead>
              <tbody>
                {docs.map((d) => {
                  const link = linkFor(links, d);
                  return (
                    <tr key={d.id}>
                      <td className="min-w-[220px] max-w-[360px]"><a href={`/api/evidence/${d.id}`} data-no-progress="" className="pc-strong break-all">{d.filename}</a>{d.description ? <span className="pc-sub">{d.description}</span> : null}</td>
                      <td className="whitespace-nowrap">{KIND[d.contentType] ?? d.contentType}<span className="pc-sub">{Math.max(1, Math.ceil(d.sizeBytes / 1024))} KB</span></td>
                      <td className="min-w-[160px] max-w-[300px]">{link ? <><span className="pc-sub">{link.typeLabel}</span>{link.href && canOpen(link.type) ? <Link href={link.href}>{link.label}</Link> : link.label}</> : d.linkedType ? <span className="text-[#667085]">Record not available</span> : <span className="text-[#667085]">Not linked</span>}</td>
                      <td className="whitespace-nowrap">{names.get(d.uploadedById) ?? "A member"}</td>
                      <td className="whitespace-nowrap">{fmtDate(d.createdAt)}</td>
                      <td><ScanBadge status={d.scanStatus} /><span className="pc-sub">Permission-checked</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PcTableWrap>
        ) : (
          <p className="pc-empty">{filter === "all" && !q ? "No evidence uploaded yet." : "No evidence matches."}</p>
        )}
        <PcFoot shown={docs.length} total={docs.length}>{docs.length >= 500 ? <span className="pc-note">Showing the newest 500. Search to narrow the list.</span> : null}</PcFoot>
      </section>
    </>
  );
}
