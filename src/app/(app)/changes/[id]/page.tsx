import Link from "@/components/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";
import { TRIAGE, POST_CONFIRMATION } from "@/server/changes/workflow";
import { wordDiff, type SectionChange } from "@/server/changes/diff";
import type { ChangeAnalysis } from "@/server/ai/schemas";
import { generateDraftAction, manualAssessmentAction, reviewAssessmentAction, triageAction } from "../../../actions";
import { InlineDiff } from "@/components/diff";
import { Badge, Card, Empty, Field, Flash, fmtDate, PageHeader, SimulatedBadge, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ChangePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  // Tenant scope: organisation users see their own assessments; platform reviewers see master-template assessments.
  const scope = { organisationId: ctx.organisationId ?? null };
  const c = await db.regulatoryChange.findUnique({
    where: { id },
    include: {
      source: true,
      newVersion: { include: { document: true } },
      previousVersion: true,
      events: { orderBy: { createdAt: "asc" } },
      citations: { where: { impactAssessmentId: null, revisionId: null } },
      candidates: { where: scope, include: { policy: { select: { id: true, ref: true, title: true } } } },
      assessments: {
        where: scope,
        include: { policy: { include: { currentPublishedVersion: { include: { sections: { orderBy: { position: "asc" }, select: { key: true, heading: true } } } } } }, citations: true, revisions: { select: { id: true, closedAt: true, draftVersion: { select: { status: true } } } } },
      },
    },
  });
  if (!c) notFound();
  const users = new Map((await db.user.findMany({ where: { id: { in: c.events.map((e) => e.actorId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const changed = (c.changedSections as unknown as SectionChange[]) ?? [];
  const ai = c.aiAnalysis as unknown as ChangeAnalysis | null;
  const canTriage = hasPlatformPermission(ctx, "changes.triage");
  const canReview = ctx.organisationId ? hasOrgPermission(ctx, "impact.review") : hasPlatformPermission(ctx, "master.review");
  const canDraft = ctx.organisationId ? hasOrgPermission(ctx, "policy.author") : hasPlatformPermission(ctx, "master.author") || hasPlatformPermission(ctx, "master.review");
  const confirmed = POST_CONFIRMATION.includes(c.status);
  const next = TRIAGE[c.status] ?? [];
  const back = `/changes/${c.id}`;
  const byPolicy = new Map<string, { policy: { id: string; ref: string; title: string }; reasons: { reason: string; evidence: string }[] }>();
  for (const cand of c.candidates) {
    const e = byPolicy.get(cand.policyId) ?? { policy: cand.policy, reasons: [] };
    e.reasons.push({ reason: cand.reason, evidence: cand.evidence });
    byPolicy.set(cand.policyId, e);
  }
  const assessedIds = new Set(c.assessments.map((a) => a.policyId));
  const assessable = await db.policy.findMany({
    where: { ...(ctx.organisationId ? { organisationId: ctx.organisationId } : { kind: "MASTER" }), status: "ACTIVE", currentPublishedVersionId: { not: null }, id: { notIn: [...assessedIds] } },
    select: { id: true, ref: true, title: true },
    orderBy: { ref: "asc" },
  });

  return (
    <>
      <PageHeader
        eyebrow="Regulatory update"
        title={<span className="flex flex-wrap items-center gap-2">{c.title} <SimulatedBadge show={c.isSimulated} /></span>}
        subtitle={c.summary}
      />
      <Flash searchParams={sp} />
      {c.isSimulated ? (
        <div className="mb-4 border-l-2 border-violet-500 bg-violet-50/60 px-4 py-3 text-sm text-violet-800">
          This is a simulated update produced from recorded test content to demonstrate the workflow. It is not a real regulatory change and must not be relied on.
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        <div className="space-y-6 lg:col-span-2">
          <Card title="What changed in the source">
            <p className="muted mb-3">
              Comparing stored version {c.previousVersion ? `v${c.previousVersion.versionNumber} (retrieved ${fmtDate(c.previousVersion.retrievedAt, true)})` : "(none: new document)"} with v{c.newVersion.versionNumber} (retrieved {fmtDate(c.newVersion.retrievedAt, true)}). Both versions are stored unchanged.{" "}
              {c.previousVersion ? <Link href={`/sources/versions/${c.previousVersion.id}`}>Previous text</Link> : null} · <Link href={`/sources/versions/${c.newVersion.id}`}>Current text</Link>
            </p>
            {changed.length ? (
              <div className="space-y-4">
                {changed.map((s) => (
                  <div key={s.ref} className="rounded-lg border border-slate-200 p-4" data-testid={`source-diff-${s.ref}`}>
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <h3>{s.heading}</h3>
                      <Badge tone={s.kind === "added" ? "green" : s.kind === "removed" ? "rose" : "amber"}>{s.kind}</Badge>
                      {s.editorialOnly ? <Badge>formatting or punctuation only</Badge> : null}
                      <span className="font-mono text-[11px] text-slate-400">{s.ref}</span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="label">Before</div>
                        <p className="prose-policy rounded bg-slate-50 p-2 text-sm">{s.before || <em className="text-slate-400">(not present)</em>}</p>
                      </div>
                      <div>
                        <div className="label">After</div>
                        <p className="prose-policy rounded bg-slate-50 p-2 text-sm">{s.after || <em className="text-slate-400">(removed)</em>}</p>
                      </div>
                    </div>
                    {s.kind === "modified" ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-teal-700">Show word-level changes</summary>
                        <InlineDiff parts={wordDiff(s.before, s.after)} />
                      </details>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <Empty>No section-level differences were recorded.</Empty>
            )}
          </Card>

          <Card title={<span className="flex flex-wrap items-center gap-2">AI analysis <Badge tone="amber">proposal, not a decision</Badge> {c.aiIsSimulated ? <SimulatedBadge /> : null}</span>}>
            {ai ? (
              <div className="space-y-3 text-sm">
                <p className="text-xs text-slate-500">Produced by {c.aiProvider}. Confidence {Math.round((c.confidence ?? 0) * 100)}%. Verify everything against the source text before acting.</p>
                <Field label="What changed">{ai.whatChanged}</Field>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Previous position">{ai.previousPosition}</Field>
                  <Field label="New position">{ai.newPosition}</Field>
                </div>
                <Field label="Why it may matter">{ai.whyItMatters}</Field>
                {ai.needsHumanVerification.length ? (
                  <Field label="Needs human verification">
                    <ul className="list-disc pl-5">{ai.needsHumanVerification.map((n, i) => <li key={i}>{n}</li>)}</ul>
                  </Field>
                ) : null}
                {ai.uncertainty ? <Field label="Uncertainty">{ai.uncertainty}</Field> : null}
              </div>
            ) : (
              <Empty>No AI analysis is available (AI may be disabled or the analysis job has not run). The rule-based comparison above is still valid.</Empty>
            )}
            {c.citations.length ? (
              <div className="mt-4">
                <div className="label">Quoted source text</div>
                <ul className="space-y-2 text-sm">
                  {c.citations.map((ct) => (
                    <li key={ct.id} className="rounded border border-slate-200 p-2">
                      <blockquote className="italic">“{ct.quote}”</blockquote>
                      <div className="mt-1 text-xs">{ct.verified ? <Badge tone="green">verified verbatim in stored source</Badge> : <Badge tone="rose">not found in source: disregard</Badge>} <span className="text-slate-400">{ct.sectionRef}</span></div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Card>

          <Card title={ctx.organisationId ? "Impact on our policies" : "Impact on CSB templates"}>
            {!confirmed ? (
              <div className="mb-3 border-l-2 border-amber-500 bg-amber-50/60 px-4 py-3 text-sm text-amber-800">
                A regulatory reviewer has not yet confirmed this change as relevant. Assessments below are provisional and cannot be decided until it is.
              </div>
            ) : null}
            {c.assessments.length ? (
              <div className="space-y-4">
                {c.assessments.map((a) => {
                  const keys = a.policy.currentPublishedVersion?.sections ?? [];
                  const openRev = a.revisions.find((r) => !r.closedAt);
                  return (
                    <div key={a.id} className="rounded-lg border border-slate-200 p-4" data-testid={`assessment-${a.policy.ref}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/policies/${a.policy.id}`} className="font-medium">{a.policy.ref} {a.policy.title}</Link>
                        <StatusBadge status={a.status} />
                        <Badge>applicability: {a.applicability.replace(/_/g, " ").toLowerCase()}</Badge>
                        <Badge tone={a.outcome === "REVISION_RECOMMENDED" ? "rose" : "slate"}>proposed: {a.outcome.replace(/_/g, " ").toLowerCase()}</Badge>
                        <StatusBadge status={a.urgency} />
                        <SimulatedBadge show={a.isSimulated} />
                      </div>
                      <p className="mt-2 text-sm">{a.rationale}</p>
                      <p className="mt-1 text-xs text-slate-500">Source: {a.provider.startsWith("manual:") ? "manual assessment" : a.provider}. Sections: {a.affectedSectionKeys.join(", ") || "none identified"}</p>
                      {a.needsVerification.length ? <ul className="mt-1 list-disc pl-5 text-xs text-amber-700">{a.needsVerification.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
                      {a.citations.length ? (
                        <ul className="mt-2 space-y-1 text-xs">
                          {a.citations.map((ct) => (
                            <li key={ct.id}>{ct.verified ? <Badge tone="green">verified</Badge> : <Badge tone="rose">unverified</Badge>} “{ct.quote}”</li>
                          ))}
                        </ul>
                      ) : null}
                      {a.status === "PROPOSED" && canReview && confirmed ? (
                        <form action={reviewAssessmentAction} className="mt-3 grid gap-2 rounded bg-slate-50 p-3 md:grid-cols-4">
                          <input type="hidden" name="assessmentId" value={a.id} />
                          <input type="hidden" name="back" value={back} />
                          <select name="decision" className="input" aria-label="Decision" defaultValue={a.outcome === "REVISION_RECOMMENDED" ? "REVISION_REQUIRED" : "NO_REVISION"}>
                            <option value="REVISION_REQUIRED">Revision required</option>
                            <option value="NO_REVISION">No revision needed</option>
                            <option value="DISMISS">Dismiss (does not apply)</option>
                          </select>
                          <input name="affectedSectionKeys" className="input" defaultValue={a.affectedSectionKeys.join(",")} aria-label="Affected section keys" title={`Available: ${keys.map((k) => k.key).join(", ")}`} placeholder="section keys, comma separated" />
                          <input name="reason" className="input md:col-span-2" required placeholder="Reason for your decision (recorded)" aria-label="Reason" />
                          <button className="btn-primary md:col-span-4 md:justify-self-start" type="submit">Record decision</button>
                        </form>
                      ) : null}
                      {a.reviewedAt ? <p className="mt-2 text-xs text-slate-500">Decided {fmtDate(a.reviewedAt, true)}: {a.reviewerReason}</p> : null}
                      {a.status === "CONFIRMED_REVISION_REQUIRED" ? (
                        openRev ? (
                          <p className="mt-2 text-sm"><Link href={`/revisions/${openRev.id}`}>Open draft revision</Link> <StatusBadge status={openRev.draftVersion.status} /></p>
                        ) : canDraft ? (
                          <form action={generateDraftAction} className="mt-2 flex items-center gap-2">
                            <input type="hidden" name="assessmentId" value={a.id} />
                            <input type="hidden" name="back" value={back} />
                            <button className="btn-primary" type="submit">Generate draft revision</button>
                            <span className="text-xs text-slate-500">Creates a draft for review only. The approved policy is not changed.</span>
                          </form>
                        ) : null
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty>No impact assessments yet{byPolicy.size ? "" : ", and no policies were identified as candidates"}.</Empty>
            )}
            {canReview && assessable.length ? (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm text-teal-700">Add a manual assessment for another policy</summary>
                <form action={manualAssessmentAction} className="mt-2 grid gap-2 md:grid-cols-2">
                  <input type="hidden" name="changeId" value={c.id} />
                  <input type="hidden" name="back" value={back} />
                  <select name="policyId" className="input" aria-label="Policy">
                    {assessable.map((p) => <option key={p.id} value={p.id}>{p.ref} {p.title}</option>)}
                  </select>
                  <select name="applicability" className="input" aria-label="Applicability">
                    <option value="APPLIES">Applies</option>
                    <option value="UNCERTAIN">Uncertain</option>
                    <option value="DOES_NOT_APPLY">Does not apply</option>
                  </select>
                  <select name="outcome" className="input" aria-label="Proposed outcome">
                    <option value="REVISION_RECOMMENDED">Revision recommended</option>
                    <option value="NO_REVISION_NEEDED">No revision needed</option>
                    <option value="UNCERTAIN">Uncertain</option>
                    <option value="CONFLICT_REQUIRES_EXPERT">Needs expert review</option>
                  </select>
                  <input name="affectedSectionKeys" className="input" placeholder="Affected section keys (comma separated)" aria-label="Affected section keys" />
                  <textarea name="rationale" className="input md:col-span-2" required placeholder="Rationale" aria-label="Rationale" />
                  <button className="btn-secondary md:justify-self-start" type="submit">Save assessment</button>
                </form>
              </details>
            ) : null}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Status">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2"><StatusBadge status={c.status} /> <StatusBadge status={c.suggestedUrgency} /></div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Source"><a href={c.canonicalUrl} target="_blank" rel="noreferrer noopener">{c.source.name}</a></Field>
                <Field label="Legal status">{c.newVersion.document.legalStatus.replace(/_/g, " ").toLowerCase()}</Field>
                <Field label="Detected">{fmtDate(c.detectedAt, true)}</Field>
                <Field label="Official date">{c.officialDate ? fmtDate(c.officialDate) : "Not stated by source"}</Field>
                <Field label="Classification">{c.classification.replace(/_/g, " ").toLowerCase()} ({c.classificationBasis})</Field>
                <Field label="Categories">{c.affectedCategories.join(", ") || "—"}</Field>
                <Field label="Service types">{c.affectedServiceTypes.join(", ") || "—"}</Field>
              </div>
              {c.uncertainty ? <p className="text-xs text-slate-500">{c.uncertainty}</p> : null}
            </div>
            {canTriage && next.length ? (
              <form action={triageAction} className="mt-4 space-y-2 border-t border-slate-100 pt-4" data-testid="triage-form">
                <input type="hidden" name="changeId" value={c.id} />
                <input type="hidden" name="back" value={back} />
                <div className="label">Regulatory review</div>
                <select name="to" className="input" aria-label="Move to status">
                  {next.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}
                </select>
                <select name="urgency" className="input" defaultValue={c.suggestedUrgency} aria-label="Urgency">
                  {["LOW", "MEDIUM", "HIGH", "URGENT"].map((u) => <option key={u} value={u}>{u.toLowerCase()}</option>)}
                </select>
                <textarea name="reason" className="input" required placeholder="Reason (required, recorded in the audit trail)" aria-label="Reason" />
                <button className="btn-primary" type="submit">Record review</button>
              </form>
            ) : null}
          </Card>
          <Card title="Policies identified">
            {byPolicy.size ? (
              <ul className="space-y-2 text-sm">
                {[...byPolicy.values()].map(({ policy, reasons }) => (
                  <li key={policy.id}>
                    <Link href={`/policies/${policy.id}`}>{policy.ref} {policy.title}</Link>
                    <ul className="text-xs text-slate-500">
                      {reasons.map((r, i) => <li key={i}>{r.reason === "TEXT_MATCH" ? "text similarity (supporting only)" : r.reason.replace(/_/g, " ").toLowerCase()}: {r.evidence.slice(0, 140)}</li>)}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>None identified automatically.</Empty>
            )}
          </Card>
          <Card title="History">
            <ol className="space-y-2 text-xs">
              {c.events.map((e) => (
                <li key={e.id}>
                  <span className="text-slate-400">{fmtDate(e.createdAt, true)}</span> {e.from ? `${e.from.replace(/_/g, " ").toLowerCase()} → ` : ""}<strong>{e.to.replace(/_/g, " ").toLowerCase()}</strong>
                  {e.actorId ? ` by ${users.get(e.actorId) ?? "user"}` : " (system)"}
                  {e.reason ? <div className="text-slate-500">{e.reason}</div> : null}
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
