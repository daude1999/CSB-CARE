import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { auditBranchWhere, auditProgress, auditScore } from "@/server/compliance/audits";
import { answerAction, completeAuditAction, createActionAction, findingAction } from "../../../actions";
import { uploadLinkedEvidenceAction } from "@/app/compliance-actions";
import { evidenceFor } from "@/server/compliance/evidence";
import { EvidenceList, EvidenceUpload } from "@/components/evidence-ui";
import { Badge, Card, Empty, Flash, fmtDate, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";
const RESPONSES = [["MET", "Met"], ["PARTIALLY_MET", "Partially met"], ["NOT_MET", "Not met"], ["NOT_APPLICABLE", "Not applicable"]] as const;

export default async function AuditPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "audit.conduct")) notFound();
  const a = await db.audit.findFirst({
    where: { id, organisationId: ctx.organisationId!, ...auditBranchWhere(ctx) },
    include: {
      template: { include: { questions: { orderBy: { position: "asc" }, include: { policy: { select: { id: true, ref: true } }, requirements: { include: { requirement: { select: { id: true, ref: true } } } } } } } },
      answers: true,
      findings: { include: { actions: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!a) notFound();
  const members = await db.membership.findMany({ where: { organisationId: a.organisationId }, include: { user: { select: { id: true, name: true } } } });
  const canEvidence = hasOrgPermission(ctx, "evidence.read");
  const canUpload = hasOrgPermission(ctx, "evidence.upload");
  const canRisk = hasOrgPermission(ctx, "risk.manage");
  const [auditEvidence, answerEvidence, findingEvidence] = canEvidence
    ? await Promise.all([evidenceFor(ctx, "AUDIT", [a.id]), evidenceFor(ctx, "AUDIT_ANSWER", a.answers.map((x) => x.id)), evidenceFor(ctx, "FINDING", a.findings.map((f) => f.id))])
    : [[], [], []];
  const evidenceOn = (list: typeof auditEvidence, id: string) => list.filter((e) => e.linkedId === id);
  const answers = new Map(a.answers.map((x) => [x.questionId, x]));
  const open = a.status === "IN_PROGRESS";
  const back = `/audits/${a.id}`;
  const progress = auditProgress(a.template.questions.map((q) => q.id), a.answers);
  const score = auditScore(a.answers, progress.total);
  const canManageActions = hasOrgPermission(ctx, "action.manage");
  return (
    <>
      <CompliancePageHeader back="/audits" title={a.title} subtitle={`${a.template.title}, template version ${a.templateVersion}. Started ${fmtDate(a.startedAt)}.`}
        actions={open ? (
          <form action={completeAuditAction} className="flex items-center gap-3">
            <input type="hidden" name="auditId" value={a.id} />
            <input type="hidden" name="back" value={back} />
            <span className="text-[13px] text-slate-600" data-testid="audit-progress">{progress.answered} of {progress.total} answered</span>
            <button className="btn-primary" type="submit" title={progress.missing.length ? "Every question needs an answer first" : undefined}>Complete audit</button>
          </form>
        ) : <span className="flex items-center gap-2 text-[13px] text-slate-600"><StatusBadge status={a.status} />{a.completedAt ? `Completed ${fmtDate(a.completedAt)}${a.completedById ? ` by ${members.find((m) => m.userId === a.completedById)?.user.name ?? "a member"}` : ""}` : null}</span>}
      />
      <Flash searchParams={sp} />
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2" title={`Questions (internal score: ${score === null ? (progress.missing.length ? `not scored until all ${progress.total} are answered` : "not scored") : `${score}%`})`}>
          <p className="-mt-1 mb-3 text-[12.5px] text-slate-600">The score is an internal indicator from the answers recorded here (partially met counts half; not applicable is left out). It is not a CQC rating.</p>
          <ol className="space-y-4">
            {a.template.questions.map((q, i) => {
              const ans = answers.get(q.id);
              return (
                <li key={q.id} id={ans ? `q-${ans.id}` : undefined} className="scroll-mt-20 rounded-[2px] bg-[#f5f9fc] p-3">
                  <div className="text-sm font-medium">{i + 1}. {q.text}</div>
                  {q.guidance ? <div className="text-xs text-slate-500">{q.guidance}</div> : null}
                  <div className="mt-1 flex flex-wrap gap-1 text-xs">
                    {q.policy ? <Link href={`/policies/${q.policy.id}`}>{q.policy.ref}</Link> : null}
                    {q.requirements.map((r) => <Link key={r.requirementId} href={`/requirements/${r.requirementId}`}>{r.requirement.ref}</Link>)}
                  </div>
                  {open ? (
                    <form action={answerAction} className="mt-2 flex flex-wrap gap-2">
                      <input type="hidden" name="auditId" value={a.id} />
                      <input type="hidden" name="questionId" value={q.id} />
                      <input type="hidden" name="back" value={back} />
                      <select name="response" className="input w-44" defaultValue={ans?.response ?? ""} required aria-label="Response">
                        <option value="" disabled>Choose a response</option>
                        {RESPONSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                      <input name="notes" className="input flex-1" defaultValue={ans?.notes ?? ""} placeholder="Notes" aria-label="Notes" />
                      <button className="btn-secondary" type="submit">{ans ? "Update" : "Save"}</button>
                    </form>
                  ) : (
                    <div className="mt-2 text-sm">{ans ? <><StatusBadge status={ans.response === "MET" ? "VERIFIED" : ans.response === "NOT_MET" ? "HIGH" : "MEDIUM"} /> {ans.response.replace(/_/g, " ").toLowerCase()} {ans.notes}</> : <em className="text-slate-400">not answered</em>}</div>
                  )}
                  {ans && canEvidence ? (
                    <div className="mt-2">
                      {evidenceOn(answerEvidence, ans.id).length ? <EvidenceList docs={evidenceOn(answerEvidence, ans.id)} /> : null}
                      {canUpload ? (
                        <details className="mt-1"><summary className="cursor-pointer text-xs text-[#0646b1]">Attach evidence for this question</summary><EvidenceUpload compact action={uploadLinkedEvidenceAction} back={`${back}#q-${ans.id}`} linkedType="AUDIT_ANSWER" linkedId={ans.id} /></details>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </Card>
        <div className="space-y-3">
          <div id="findings" className="scroll-mt-20" />
          <Card title="Findings">
            {a.findings.length ? (
              <ul className="space-y-3 text-sm">
                {a.findings.map((f) => (
                  <li key={f.id} className="rounded-[2px] bg-[#f5f9fc] p-3">
                    <StatusBadge status={f.riskRating} /> {f.description}
                    {f.questionId ? <div className="mt-1 text-xs text-slate-600">Question {a.template.questions.findIndex((q) => q.id === f.questionId) + 1}</div> : null}
                    <ul className="mt-1 text-xs">{f.actions.map((x) => <li key={x.id}><Link href={`/actions/${x.id}`}>{x.title}</Link> <StatusBadge status={x.status} /></li>)}</ul>
                    {evidenceOn(findingEvidence, f.id).length ? <div className="mt-1"><EvidenceList docs={evidenceOn(findingEvidence, f.id)} /></div> : null}
                    {canRisk ? <Link href={`/compliance/risks/new?finding=${f.id}`} className="mt-1 inline-block text-xs">Raise a risk from this finding</Link> : null}
                    {canUpload ? <details className="mt-1"><summary className="cursor-pointer text-xs text-[#0646b1]">Attach evidence</summary><EvidenceUpload compact action={uploadLinkedEvidenceAction} back={`${back}#findings`} linkedType="FINDING" linkedId={f.id} /></details> : null}
                    {canManageActions ? (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-xs text-teal-700">Create action</summary>
                        <form action={createActionAction} className="mt-1 space-y-1">
                          <input type="hidden" name="findingId" value={f.id} />
                          <input type="hidden" name="back" value={back} />
                          <input name="title" className="input" required placeholder="Action" aria-label="Action title" />
                          <select name="ownerId" className="input" aria-label="Owner">{members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}</select>
                          <input name="dueDate" type="date" className="input" required aria-label="Due date" />
                          <button className="btn-secondary" type="submit">Create</button>
                        </form>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No findings recorded.</Empty>
            )}
            {open ? (
              <form action={findingAction} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                <input type="hidden" name="auditId" value={a.id} />
                <input type="hidden" name="back" value={back} />
                <textarea name="description" className="input" required placeholder="Describe the finding" aria-label="Finding" />
                <select name="questionId" className="input" aria-label="Question the finding relates to" defaultValue=""><option value="">Not tied to one question</option>{a.template.questions.map((q, n) => <option key={q.id} value={q.id}>Question {n + 1}: {q.text.slice(0, 60)}</option>)}</select>
                <select name="riskRating" className="input" aria-label="Risk rating">{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}</select>
                <button className="btn-secondary" type="submit">Add finding</button>
              </form>
            ) : null}
          </Card>
          {canEvidence ? (
            <Card title={`Audit evidence (${auditEvidence.length})`}>
              <EvidenceList docs={auditEvidence} />
              {canUpload ? <EvidenceUpload action={uploadLinkedEvidenceAction} back={back} linkedType="AUDIT" linkedId={a.id} /> : null}
            </Card>
          ) : null}
          {a.isDemo ? <Badge tone="violet">Demonstration audit data</Badge> : null}
        </div>
      </div>
    </>
  );
}
