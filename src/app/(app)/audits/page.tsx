import Link from "@/components/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { auditScore } from "@/server/compliance/audits";
import { startAuditAction } from "../../actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader, Stat, StatRow, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AuditsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "audit.conduct")) notFound();
  const orgId = ctx.organisationId!;
  const [templates, audits, branches] = await Promise.all([
    db.auditTemplate.findMany({ where: { OR: [{ organisationId: null }, { organisationId: orgId }], status: "ACTIVE" }, include: { _count: { select: { questions: true } } }, orderBy: { title: "asc" } }),
    db.audit.findMany({ where: { organisationId: orgId }, orderBy: { startedAt: "desc" }, include: { answers: true, _count: { select: { findings: true } }, template: { select: { title: true, _count: { select: { questions: true } } } } } }),
    db.branch.findMany({ where: { organisationId: orgId }, orderBy: { name: "asc" } }),
  ]);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const scores = audits.map((a) => auditScore(a.answers, a.template._count.questions)).filter((x): x is number => x !== null);
  const average = scores.length ? Math.round(scores.reduce((n, x) => n + x, 0) / scores.length) : null;
  return (
    <>
      <PageHeader eyebrow="Care operations · internal audit" title="Audits & Inspections" subtitle="Internal audits against CSB or your own templates. Scores are calculated from recorded answers; findings can be turned into tracked actions." />
      <Flash searchParams={sp} />
      <StatRow>
        <Stat label="Audits" value={audits.length} hint="Recorded so far" tone="violet" />
        <Stat label="In Progress" value={audits.filter((a) => a.status === "IN_PROGRESS").length} hint="Still being completed" tone="amber" />
        <Stat label="Average Score" value={average === null ? "—" : `${average}%`} hint="Fully answered audits only" tone="green" />
        <Stat label="Findings" value={audits.reduce((n, a) => n + a._count.findings, 0)} hint="Raised by audits" tone="rose" href="/actions" />
      </StatRow>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Audits">
          {audits.length ? (
            <table className="table">
              <thead><tr><th>Audit</th><th>Branch</th><th>Status</th><th>Score</th><th>Findings</th><th>Started</th></tr></thead>
              <tbody>
                {audits.map((a) => {
                  const score = auditScore(a.answers, a.template._count.questions);
                  return (
                    <tr key={a.id}>
                      <td><Link href={`/audits/${a.id}`}>{a.title}</Link>{a.isDemo ? <span className="ml-2"><Badge tone="violet">Demo</Badge></span> : null}<div className="text-[12.5px] text-slate-600">{a.template.title}</div></td>
                      <td className="text-[13px]">{a.branchId ? branchName.get(a.branchId) : "Whole organisation"}</td>
                      <td><StatusBadge status={a.status} /></td>
                      <td>{score === null ? "—" : `${score}%`}</td>
                      <td>{a._count.findings}</td>
                      <td className="text-[13px]">{fmtDate(a.startedAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <Empty>No audits yet.</Empty>
          )}
        </Card>
        <Card title="Start an audit">
          <form action={startAuditAction} className="space-y-2">
            <input type="hidden" name="back" value="/audits" />
            <select name="templateId" className="input" aria-label="Template" required>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.title} ({t._count.questions} questions){t.needsReview ? " · under review" : ""}</option>)}
            </select>
            <select name="branchId" className="input" aria-label="Branch">
              <option value="">Whole organisation</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <input name="title" className="input" placeholder="Title (optional)" aria-label="Audit title" />
            <button className="btn-primary" type="submit">Start</button>
          </form>
          {templates.some((t) => t.needsReview) ? (
            <ul className="mt-4 space-y-1 text-xs text-amber-800">
              {templates.filter((t) => t.needsReview).map((t) => <li key={t.id}>{t.title}: {t.reviewReason}</li>)}
            </ul>
          ) : null}
        </Card>
      </div>
    </>
  );
}
