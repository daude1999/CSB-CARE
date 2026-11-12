import { notFound } from "next/navigation";
import { DownloadSimple } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { PcBadge, PcTableWrap, PcTabs } from "@/components/compliance-ui";
import { ASSESSMENT_TONE, ConfidenceNote, NotOfficialBanner, Panel, RESULT_TONE, ScoreValue } from "@/components/cqc-ui";
import { Flash, fmtDate } from "@/components/ui";
import { assessmentCommentAction, decideAssessmentAction, snapshotAction, submitAssessmentAction } from "@/app/cqc-actions";
import { orNotFound } from "@/server/auth/page-guard";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { ASSESSMENT_STATUS, getAssessment } from "@/server/cqc/assessments";
import { KEY_QUESTIONS, KQ_LABEL, RESULT_LABEL, type KeyQuestion } from "@/server/cqc/scoring";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const HISTORY_LABEL: Record<string, string> = { "cqc.assessment.created": "Started", "cqc.result.recorded": "Result recorded", "cqc.assessment.submitted": "Submitted for approval", "cqc.assessment.approved": "Approved", "cqc.assessment.returned": "Returned to the assessor", "cqc.assessment.comment": "Comments updated", "cqc.snapshot.saved": "Snapshot saved", "cqc.action.created": "Improvement action raised" };

/** One assessment: the areas of a key question with result, evidence and score, and the approval and history beside them. */
export default async function AssessmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "cqc.view")) notFound();
  const g = await orNotFound(getAssessment(ctx, id));
  const a = g.assessment;
  const r = g.readiness;
  const q = (KEY_QUESTIONS as readonly string[]).includes(sp.q ?? "") ? (sp.q as KeyQuestion) : "SAFE";
  const resultFilter = sp.result;
  const scoreBy = new Map(r.criteria.map((c) => [c.id, c]));
  const ev = new Map<string, { verified: number; awaiting: number; outdated: number }>();
  for (const l of g.links) {
    const e = ev.get(l.criterionId) ?? { verified: 0, awaiting: 0, outdated: 0 };
    if (l.effective === "VERIFIED") e.verified++;
    else if (l.effective === "SUGGESTED" || l.effective === "AWAITING_REVIEW") e.awaiting++;
    else if (l.effective === "OUTDATED") e.outdated++;
    ev.set(l.criterionId, e);
  }
  const openActions = new Map<string, number>();
  for (const x of g.actions) if (["OPEN", "IN_PROGRESS", "COMPLETED"].includes(x.status) && x.cqcCriterionId) openActions.set(x.cqcCriterionId, (openActions.get(x.cqcCriterionId) ?? 0) + 1);
  const areas = g.criteria.filter((c) => (resultFilter ? (resultFilter === "NONE" ? !g.results.get(c.id) : g.results.get(c.id)?.result === resultFilter) : c.keyQuestion === q));
  const users = new Map((await db.user.findMany({ where: { id: { in: [a.assessorId, a.approvedById, ...g.history.map((h) => h.actorId)].filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const back = `/compliance/cqc/assessments/${a.id}${resultFilter ? `?result=${resultFilter}` : `?q=${q}`}`;
  const notRecorded = g.criteria.length - g.results.size;
  const canExport = hasOrgPermission(ctx, "report.export");

  return (
    <>
      <CompliancePageHeader
        back="/compliance/cqc/assessments"
        title={`${a.reference} ${a.title}`}
        subtitle={<>{g.branchName} · {g.serviceName} · {fmtDate(a.periodFrom)} to {fmtDate(a.periodTo)} · framework {a.framework.version} · <PcBadge tone={ASSESSMENT_TONE[a.status] ?? "grey"}>{ASSESSMENT_STATUS[a.status as keyof typeof ASSESSMENT_STATUS]}</PcBadge></>}
        actions={canExport ? <>
          <a href={`/api/cqc-reports/readiness?id=${a.id}&format=pdf`} data-no-progress="" className="pc-btn-secondary"><DownloadSimple size={16} aria-hidden="true" />Readiness report (PDF)</a>
          <a href={`/api/cqc-reports/readiness?id=${a.id}&format=csv`} data-no-progress="" className="pc-btn-secondary">CSV</a>
        </> : null}
      />
      <Flash searchParams={sp} />
      <div className="space-y-4">
        <NotOfficialBanner>Recalculated now from current records. <Link href="/compliance/cqc/framework#method" className="pc-link">How it is worked out</Link></NotOfficialBanner>
        {a.returnedReason && a.status === "IN_PROGRESS" ? <p className="rounded-[10px] border border-[#fedf89] bg-[#fffaeb] px-4 py-2.5 text-body text-[#93370d]" role="status"><strong>Returned by the approver:</strong> {a.returnedReason}</p> : null}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="pc-panel" aria-label="Assessment areas" data-testid="assessment-areas">
            <div className="px-5 pt-2">
              <PcTabs label="Key questions" testId="kq-tabs" active={resultFilter ? "" : q} items={KEY_QUESTIONS.map((k) => ({ key: k, label: KQ_LABEL[k], href: `/compliance/cqc/assessments/${a.id}?q=${k}`, count: g.criteria.filter((c) => c.keyQuestion === k).length }))} />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-[#eaecf0] px-5 py-2.5 text-meta text-[#475467]">
              {resultFilter ? <span>Showing areas {resultFilter === "NONE" ? "not yet assessed" : `marked ${RESULT_LABEL[resultFilter] ?? resultFilter}`} across all key questions. <Link href={`/compliance/cqc/assessments/${a.id}?q=${q}`} className="pc-link">Show by key question</Link></span> : <span>{KQ_LABEL[q]}: <ScoreValue g={r.byQuestion[q]} /> · <ConfidenceNote g={r.byQuestion[q]} /></span>}
              <span className="ml-auto flex gap-3"><Link href={`?result=NONE`} className="pc-link">{notRecorded} not assessed</Link><Link href={`?result=NOT_MET`} className="pc-link">Not met</Link></span>
            </div>
            <PcTableWrap label="Areas">
              <table className="pc-table">
                <thead><tr><th>Area</th><th>Result</th><th>Evidence</th><th className="text-right">Score</th><th className="text-right">Open actions</th></tr></thead>
                <tbody>
                  {areas.map((c) => {
                    const res = g.results.get(c.id);
                    const s = scoreBy.get(c.id);
                    const e = ev.get(c.id) ?? { verified: 0, awaiting: 0, outdated: 0 };
                    return (
                      <tr key={c.id} data-testid={`area-${c.code}`}>
                        <td className="min-w-[260px] max-w-[440px]">
                          <Link href={`/compliance/cqc/assessments/${a.id}/areas/${c.id}`} className="pc-strong"><span className="mr-1.5 font-normal text-[#667085]">{c.code}</span>{c.title}</Link>
                          <span className="pc-sub">{c.qualityStatement} · {c.regulations.join(", ")}{c.essential ? " · Essential" : ""}</span>
                        </td>
                        <td className="whitespace-nowrap">{res ? <PcBadge tone={RESULT_TONE[res.result] ?? "grey"}>{RESULT_LABEL[res.result]}</PcBadge> : <PcBadge tone="grey">Not assessed</PcBadge>}</td>
                        <td className="whitespace-nowrap">
                          {e.verified ? <span className="font-semibold text-[#067647]">{e.verified} verified</span> : <span className={c.essential && res?.result !== "NOT_APPLICABLE" ? "font-semibold text-[#b42318]" : "text-[#667085]"}>None verified</span>}
                          <span className="pc-sub">{e.awaiting ? `${e.awaiting} awaiting review` : ""}{e.awaiting && e.outdated ? " · " : ""}{e.outdated ? `${e.outdated} out of date` : ""}</span>
                        </td>
                        <td className="text-right tabular-nums">{s?.score ?? <span className="text-[#98a2b3]">—</span>}</td>
                        <td className="text-right">{openActions.get(c.id) ?? 0}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </PcTableWrap>
            {!areas.length ? <p className="pc-empty">No areas match.</p> : null}
          </section>

          <div className="space-y-4">
            <Panel title="Readiness" testId="assessment-readiness">
              <div className="border-b border-[#eaecf0] px-5 py-3"><span className="block text-meta text-[#475467]">Overall</span><ScoreValue g={r.overall} big /><span className="block text-meta text-[#667085]"><ConfidenceNote g={r.overall} /></span></div>
              <ul className="divide-y divide-[#eaecf0]">
                {KEY_QUESTIONS.map((k) => <li key={k} className="flex items-center justify-between px-5 py-2 text-body"><Link href={`?q=${k}`} className="pc-link">{KQ_LABEL[k]}</Link><ScoreValue g={r.byQuestion[k]} /></li>)}
              </ul>
              <p className="border-t border-[#eaecf0] px-5 py-2.5 text-meta text-[#475467]">Evidence coverage {Math.round(r.overall.evidenceCoverage * 100)}% · {r.criteria.filter((c) => c.essentialGap).length} essential areas without verified evidence</p>
            </Panel>

            <Panel title="Approval" testId="assessment-approval">
              <div className="space-y-3 px-5 py-4 text-body">
                <p>Assessor: <strong>{users.get(a.assessorId) ?? "—"}</strong>{a.submittedAt ? <> · submitted {fmtDate(a.submittedAt)}</> : null}</p>
                {a.approvedById ? <p>Approved by <strong>{users.get(a.approvedById)}</strong> on {fmtDate(a.approvedAt)}</p> : null}
                {g.canEdit ? (
                  <form action={submitAssessmentAction}>
                    <input type="hidden" name="back" value={back} /><input type="hidden" name="assessmentId" value={a.id} /><input type="hidden" name="lockVersion" value={a.lockVersion} />
                    {notRecorded ? <p className="mb-2 text-meta text-[#667085]">{notRecorded} areas still need a result before it can be submitted.</p> : null}
                    <button className="pc-btn w-full" type="submit">Submit for approval</button>
                  </form>
                ) : null}
                {g.canApprove ? (
                  <form action={decideAssessmentAction} className="space-y-2">
                    <input type="hidden" name="back" value={back} /><input type="hidden" name="assessmentId" value={a.id} /><input type="hidden" name="lockVersion" value={a.lockVersion} />
                    <label><span className="label">Approval note</span><textarea name="note" className="input" rows={2} /></label>
                    <div className="flex gap-2"><button className="pc-btn flex-1" type="submit" name="decision" value="APPROVE">Approve</button><button className="pc-btn-secondary flex-1" type="submit" name="decision" value="RETURN">Return</button></div>
                  </form>
                ) : a.status === "AWAITING_APPROVAL" ? <p className="text-meta text-[#667085]">Waiting for approval by someone other than the assessor.</p> : null}
                {hasOrgPermission(ctx, "cqc.assess") ? (
                  <form action={snapshotAction} className="flex gap-2 border-t border-[#eaecf0] pt-3">
                    <input type="hidden" name="back" value={back} /><input type="hidden" name="assessmentId" value={a.id} />
                    <input name="reason" className="input h-9 py-0 text-body" placeholder="Reason, e.g. board pack" aria-label="Snapshot reason" />
                    <button className="pc-btn-secondary pc-btn-sm" type="submit">Save snapshot</button>
                  </form>
                ) : null}
              </div>
            </Panel>

            <Panel title="Management comments">
              {g.canEdit ? (
                <form action={assessmentCommentAction} className="space-y-2 px-5 py-4">
                  <input type="hidden" name="back" value={back} /><input type="hidden" name="assessmentId" value={a.id} />
                  <textarea name="managementComment" className="input" rows={3} defaultValue={a.managementComment ?? ""} aria-label="Management comments" />
                  <label><span className="label">Next assessment due</span><input type="date" name="nextDueAt" className="input" defaultValue={a.nextDueAt?.toISOString().slice(0, 10)} /></label>
                  <button className="pc-btn-secondary pc-btn-sm" type="submit">Save comments</button>
                </form>
              ) : <p className="px-5 py-4 text-body">{a.managementComment || "None recorded."}</p>}
            </Panel>

            <Panel title="Snapshots">
              {g.snapshots.length ? <ul className="divide-y divide-[#eaecf0]">{g.snapshots.map((s) => <li key={s.id} className="flex justify-between px-5 py-2 text-meta"><span>{fmtDate(s.takenAt, true)}<span className="block text-caption text-[#667085]">{s.reason}</span></span><strong>{s.overall ?? (s.confidence === "LOW" ? "Low confidence" : "Not assessed")}</strong></li>)}</ul> : <p className="px-5 py-3 text-meta text-[#667085]">A snapshot is saved on approval, or whenever you save one.</p>}
            </Panel>

            <Panel title="History">
              <ol className="max-h-[320px] divide-y divide-[#eaecf0] overflow-y-auto" data-testid="assessment-history">
                {g.history.slice(0, 40).map((h) => {
                  const d = h.data as { criterion?: string; from?: { result?: string } | string | null; to?: { result?: string } | string };
                  const change = typeof d.to === "object" && d.to ? `${d.criterion}: ${typeof d.from === "object" && d.from?.result ? `${RESULT_LABEL[d.from.result]} → ` : ""}${RESULT_LABEL[d.to.result ?? ""] ?? ""}` : d.criterion ?? "";
                  return <li key={h.id} className="px-5 py-2 text-meta"><span className="font-medium text-[#101828]">{HISTORY_LABEL[h.action] ?? h.action}</span>{change ? <> · {change}</> : null}<span className="block text-[#667085]">{users.get(h.actorId ?? "") ?? "System"} · {fmtDate(h.createdAt, true)}</span></li>;
                })}
              </ol>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
