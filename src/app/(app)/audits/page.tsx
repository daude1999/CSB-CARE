import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { notFound } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { auditBranchWhere, auditScore } from "@/server/compliance/audits";
import { startAuditAction } from "../../actions";
import { ActionDialog } from "@/components/dialog";
import { PcBadge, PcFoot, PcSearch, PcTableWrap } from "@/components/compliance-ui";
import { PcSelect } from "@/components/pc-select";
import { Flash, fmtDate } from "@/components/ui";
import { Plus } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

/**
 * Audits & Inspections (owner's brief of 3 Nov 2026, screenshot 05): every audit with its branch, template, date,
 * findings, internal score and status. The score is an internal indicator calculated from recorded answers, never a
 * CQC rating. A new audit starts from the header.
 */
/** Audits per page: the list grows for ever (every audit is kept), and each row carries its answers for the score. */
const PAGE_SIZE = 50;

export default async function AuditsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "audit.conduct")) notFound();
  const orgId = ctx.organisationId!;
  const q = sp.q?.trim().slice(0, 100);
  const status = sp.status === "IN_PROGRESS" || sp.status === "COMPLETED" ? sp.status : undefined;
  const [templates, branches] = await Promise.all([
    db.auditTemplate.findMany({ where: { OR: [{ organisationId: null }, { organisationId: orgId }], status: "ACTIVE" }, include: { _count: { select: { questions: true } } }, orderBy: { title: "asc" } }),
    db.branch.findMany({ where: { organisationId: orgId, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) }, orderBy: { name: "asc" } }),
  ]);
  const branch = sp.branch === "org" ? "org" : branches.some((b) => b.id === sp.branch) ? sp.branch : undefined;
  const template = templates.some((t) => t.id === sp.template) ? sp.template : undefined;
  const where: Prisma.AuditWhereInput = {
    organisationId: orgId,
    ...auditBranchWhere(ctx),
    ...(status ? { status } : {}),
    ...(template ? { templateId: template } : {}),
    ...(branch === "org" ? { branchId: null } : branch ? { branchId: branch } : {}),
    ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
  };
  const matching = await db.audit.count({ where });
  const pages = Math.max(1, Math.ceil(matching / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1));
  const pageHref = (n: number) => {
    const qs = new URLSearchParams(Object.entries({ q, status, branch, template, page: n > 1 ? String(n) : undefined }).filter((e): e is [string, string] => Boolean(e[1])));
    return `/audits${qs.size ? `?${qs}` : ""}`;
  };
  const [audits, total] = await Promise.all([
    db.audit.findMany({ where, orderBy: { startedAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE, include: { answers: true, _count: { select: { findings: true } }, template: { select: { title: true, _count: { select: { questions: true } } } } } }),
    db.audit.count({ where: { organisationId: orgId, ...auditBranchWhere(ctx) } }),
  ]);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  return (
    <>
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="improvements" active="audits" />}
        title="Audits & Improvements"
        subtitle="Internal audits and inspections, the findings they raise and the actions, risks and evidence that follow."
        actions={
          <ActionDialog triggerClassName="pc-btn" trigger={<><Plus size={16} weight="bold" aria-hidden="true" />Start audit</>} title="Start an audit" description="Choose a CSB or your own audit template. Answers are recorded as you go and the score is calculated from them.">
            <form action={startAuditAction} className="space-y-3">
              <input type="hidden" name="back" value="/audits" />
              <div>
                <label className="label" htmlFor="audit-template">Template</label>
                <select id="audit-template" name="templateId" className="input" required>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.title} ({t._count.questions} questions){t.needsReview ? " · under review" : ""}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="audit-branch">Branch</label>
                <select id="audit-branch" name="branchId" className="input">
                  {ctx.branchIds ? null : <option value="">Whole organisation</option>}
                  {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="audit-title">Title (optional)</label>
                <input id="audit-title" name="title" className="input" placeholder="For example: Q4 medication audit, Liverpool" />
              </div>
              {templates.some((t) => t.needsReview) ? (
                <ul className="space-y-1 text-[12.5px] text-[#b54708]">
                  {templates.filter((t) => t.needsReview).map((t) => <li key={t.id}>{t.title}: {t.reviewReason}</li>)}
                </ul>
              ) : null}
              <button className="btn-primary w-full" type="submit">Start audit</button>
            </form>
          </ActionDialog>
        }
      />
      <Flash searchParams={sp} />
      <section aria-label="Audits and inspections" className="pc-panel">
        <form className="pc-toolbar" role="search" aria-label="Filter audits">
          <PcSearch defaultValue={q} placeholder="Search audits" />
          <PcSelect name="template" label="Type" defaultValue={template ?? ""} options={[{ value: "", label: "All" }, ...templates.map((t) => ({ value: t.id, label: t.title }))]} />
          <PcSelect name="branch" label="Branch" defaultValue={branch ?? ""} options={[{ value: "", label: "All" }, ...(ctx.branchIds ? [] : [{ value: "org", label: "Whole organisation" }]), ...branches.map((b) => ({ value: b.id, label: b.name }))]} />
          <PcSelect name="status" label="Status" defaultValue={status ?? ""} options={[{ value: "", label: "Any" }, { value: "IN_PROGRESS", label: "In progress" }, { value: "COMPLETED", label: "Completed" }]} />
          <button className="pc-btn-secondary sr-only focus:not-sr-only" type="submit">Apply</button>
        </form>
        {audits.length ? (
          <PcTableWrap>
            <table className="pc-table" data-testid="audits-table">
              <thead><tr><th>Audit</th><th>Type</th><th>Date</th><th>Findings</th><th>Outcome</th><th>Status</th></tr></thead>
              <tbody>
                {audits.map((a) => {
                  const score = auditScore(a.answers, a.template._count.questions);
                  return (
                    <tr key={a.id}>
                      <td>
                        <span className="flex flex-wrap items-center gap-2"><Link href={`/audits/${a.id}`} className="pc-strong">{a.title}</Link>{a.isDemo ? <PcBadge tone="purple">Demo</PcBadge> : null}</span>
                        <span className="pc-sub">{a.branchId ? branchName.get(a.branchId) ?? "Branch" : "Whole organisation"}</span>
                      </td>
                      <td><span className="block">Internal audit</span><span className="pc-sub max-w-[260px] truncate" title={a.template.title}>{a.template.title}</span></td>
                      <td className="whitespace-nowrap">{fmtDate(a.completedAt ?? a.startedAt)}<span className="pc-sub">{a.completedAt ? "Completed" : "Started"}</span></td>
                      <td className={a._count.findings ? "font-semibold text-[#101828]" : ""}>{a._count.findings}</td>
                      <td className="whitespace-nowrap">{score === null ? <span className="text-[#667085]">Not scored yet</span> : `${score}% internal score`}</td>
                      <td>{a.status === "COMPLETED" ? <PcBadge tone="green">Completed</PcBadge> : <PcBadge tone="blue">In progress</PcBadge>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PcTableWrap>
        ) : (
          <p className="pc-empty">{total ? "No audits match these filters." : "No audits yet. Start one from the button above."}</p>
        )}
        <PcFoot shown={audits.length} total={total} page={page} pages={pages} href={pageHref}><span className="pc-note">Scores are an internal indicator, not a CQC rating.</span></PcFoot>
      </section>
    </>
  );
}
