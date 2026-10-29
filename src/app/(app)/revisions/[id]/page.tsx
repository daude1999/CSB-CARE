import { SectionEditor } from "@/components/section-editor";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { orNotFound } from "@/server/auth/page-guard";
import { canOnPolicy } from "@/server/auth/rbac";
import { getRevision } from "@/server/policies/library";
import { versionDiff } from "@/server/policies/versions";
import type { RevisionValidation } from "@/server/policies/revise";
import { commentAction, decideAction, editSectionAction, publishAction, submitAction } from "../../../actions";
import { PolicyDiffView } from "@/components/diff";
import { Badge, Card, Empty, Field, Flash, fmtDate, PageHeader, SimulatedBadge, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function RevisionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const r = await orNotFound(getRevision(ctx, id));
  const v = r.draftVersion;
  const diff = await versionDiff(r.baseVersionId, r.draftVersionId);
  const validation = (r.validation ?? {}) as Partial<RevisionValidation>;
  const userIds = [...new Set([...r.decisions.map((d) => d.deciderId), ...r.comments.map((c) => c.authorId), ...r.assignments.map((a) => a.assigneeId), r.authorId, r.createdById].filter((x): x is string => Boolean(x)))];
  const names = new Map((await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const isAuthor = r.authorId === ctx.userId || r.createdById === ctx.userId;
  const canAuthor = canOnPolicy(ctx, r.policy, "author");
  const canDecide = !isAuthor && (canOnPolicy(ctx, r.policy, "approve") || canOnPolicy(ctx, r.policy, "review"));
  const canPublish = canOnPolicy(ctx, r.policy, "publish");
  const editable = ["DRAFT", "CHANGES_REQUESTED"].includes(v.status) && !r.closedAt;
  const back = `/revisions/${r.id}`;
  const currentDecisions = r.decisions.filter((d) => d.versionId === v.id);

  return (
    <>
      <PageHeader back="/queue"
        eyebrow="Revision · draft"
        title={<span className="flex flex-wrap items-center gap-2">{r.policy.ref} {r.policy.title} <StatusBadge status={v.status} /> <SimulatedBadge show={r.isSimulated} /></span>}
        subtitle={<>{r.title}. Draft {v.label}{r.baseVersion ? `, based on approved ${r.baseVersion.label}` : ""}. <Link href={`/policies/${r.policyId}`}>View current policy</Link></>}
      />
      <Flash searchParams={sp} />
      <div className="mb-3 rounded-[3px] border-l-4 border-[#f0a92e] bg-[#fdf0d8] px-4 py-3 text-sm text-[#8a5a00]" data-testid="draft-banner">
        {v.status === "PUBLISHED" ? "This version has been published." : "This is a draft. The approved policy remains in force until this draft is approved by someone other than its author and then published."}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Card title="Proposed changes">
            {r.explanation ? (
              <div className="mb-4 rounded bg-slate-50 p-3 text-sm">
                <div className="label flex items-center gap-2">Explanation {r.provider ? <Badge tone="amber">AI proposal ({r.provider})</Badge> : null}</div>
                {r.explanation}
              </div>
            ) : null}
            <PolicyDiffView diff={diff} />
          </Card>

          {editable && canAuthor ? (
            <Card title="Edit draft sections">
              <p className="muted mb-3">Edits create no new approved version; they change this draft only. Customer-specific sections are never changed automatically.</p>
              <div className="space-y-4">
                {v.sections.map((s) => (
                  <details key={s.key} className="border-b border-slate-200 py-3 [&[open]]:pb-5">
                    <summary className="cursor-pointer font-serif text-[16px] font-semibold text-navy-900">{s.heading} {s.isLocal ? <Badge tone="teal">local</Badge> : null}</summary>
                    <form action={editSectionAction} className="mt-3 space-y-2">
                      <input type="hidden" name="revisionId" value={r.id} />
                      <input type="hidden" name="key" value={s.key} />
                      <input type="hidden" name="back" value={back} />
                      <input name="heading" className="input" defaultValue={s.heading} aria-label="Heading" />
                      <SectionEditor name="body" initial={s.body} label={`Body of ${s.heading}`} />
                      <button className="btn-secondary" type="submit">Save section</button>
                    </form>
                  </details>
                ))}
              </div>
            </Card>
          ) : null}

          <Card title="Comments">
            {r.comments.length ? (
              <ul className="mb-3 space-y-2 text-sm">
                {r.comments.map((c) => (
                  <li key={c.id} className="rounded-[2px] bg-white p-3 ring-1 ring-inset ring-slate-200">
                    <div className="text-xs text-slate-500">{names.get(c.authorId) ?? "User"} · {fmtDate(c.createdAt, true)}{c.sectionKey ? ` · on ${c.sectionKey}` : ""}</div>
                    {c.body}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted mb-3">No comments yet.</p>
            )}
            {canAuthor || canDecide ? (
              <form action={commentAction} className="flex gap-2">
                <input type="hidden" name="revisionId" value={r.id} />
                <input type="hidden" name="back" value={back} />
                <input name="body" className="input" required placeholder="Add a comment" aria-label="Comment" />
                <button className="btn-secondary" type="submit">Comment</button>
              </form>
            ) : null}
          </Card>
        </div>

        <div className="space-y-3">
          <Card title="Workflow">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Author">{r.authorId ? names.get(r.authorId) : "—"}</Field>
              <Field label="Kind">{r.kind.replace(/_/g, " ").toLowerCase()}</Field>
              <Field label="Urgency"><StatusBadge status={r.urgency} /></Field>
              <Field label="Submitted">{fmtDate(r.submittedAt, true)}</Field>
            </div>
            {r.assignments.length ? (
              <ul className="mt-3 space-y-1 text-xs">
                {r.assignments.map((a) => <li key={a.id}>{a.role.toLowerCase()}: {names.get(a.assigneeId) ?? "user"} <StatusBadge status={a.status === "PENDING" ? "OPEN" : "COMPLETED"} /></li>)}
              </ul>
            ) : null}

            {editable && canAuthor ? (
              <form action={submitAction} className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                <input type="hidden" name="revisionId" value={r.id} />
                <input type="hidden" name="back" value={back} />
                <textarea name="note" className="input" placeholder="Note for reviewers (optional)" aria-label="Note for reviewers" />
                <button className="btn-primary" type="submit">Submit for review</button>
              </form>
            ) : null}

            {v.status === "UNDER_REVIEW" && canDecide ? (
              <form action={decideAction} className="mt-4 space-y-2 border-t border-slate-100 pt-4" data-testid="decision-form">
                <input type="hidden" name="revisionId" value={r.id} />
                <input type="hidden" name="back" value={back} />
                <select name="decision" className="input" aria-label="Decision">
                  <option value="APPROVE">Approve</option>
                  <option value="REQUEST_CHANGES">Request changes</option>
                  <option value="REJECT">Reject</option>
                </select>
                <textarea name="comment" className="input" required placeholder="Comment (required)" aria-label="Decision comment" />
                <button className="btn-primary" type="submit">Record decision</button>
              </form>
            ) : null}
            {v.status === "UNDER_REVIEW" && isAuthor ? <p className="mt-3 text-xs text-slate-500">You are the author, so you cannot approve this revision.</p> : null}

            {v.status === "APPROVED" && canPublish ? (
              <form action={publishAction} className="mt-4 space-y-2 border-t border-slate-100 pt-4" data-testid="publish-form">
                <input type="hidden" name="revisionId" value={r.id} />
                <input type="hidden" name="back" value={back} />
                <label className="label" htmlFor="scheduleFor">Publish at (leave empty to publish now)</label>
                <input id="scheduleFor" type="datetime-local" name="scheduleFor" className="input" />
                <label className="label" htmlFor="effectiveDate">Effective date</label>
                <input id="effectiveDate" type="date" name="effectiveDate" className="input" />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="requireAcknowledgement" defaultChecked={r.policy.kind === "CUSTOMER"} /> Staff must acknowledge</label>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="materialRevision" defaultChecked /> Material change: staff read and acknowledge this version again (untick for wording-only changes; earlier acknowledgements stay as evidence)</label>
                <input type="number" name="ackDays" min={1} max={90} defaultValue={14} className="input" aria-label="Acknowledgement due in days" />
                <button className="btn-primary" type="submit">Publish</button>
              </form>
            ) : null}
          </Card>

          <Card title="Decisions">
            {r.decisions.length ? (
              <ul className="space-y-2 text-sm">
                {r.decisions.map((d) => (
                  <li key={d.id} className={d.versionId === v.id ? "" : "opacity-60"}>
                    <Badge tone={d.decision === "APPROVE" ? "green" : d.decision === "REJECT" ? "rose" : "amber"}>{d.decision.replace(/_/g, " ").toLowerCase()}</Badge> {names.get(d.deciderId) ?? "user"} ({d.role.toLowerCase()}) · {fmtDate(d.createdAt, true)}
                    <div className="text-xs text-slate-600">{d.comment}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No decisions yet.</Empty>
            )}
            {currentDecisions.length !== r.decisions.length ? <p className="mt-2 text-xs text-slate-400">Faded decisions relate to an earlier review round.</p> : null}
          </Card>

          <Card title="Validation checks">
            {validation.provider ? (
              <div className="space-y-3 text-sm" data-testid="validation-panel">
                <div className="flex flex-wrap gap-2">
                  {validation.unchangedSectionsVerified ? <Badge tone="green">sections outside the edits verified unchanged</Badge> : <Badge tone="rose">unchanged-section check failed</Badge>}
                  <Badge tone={validation.rejected?.length ? "amber" : "green"}>{validation.applied?.length ?? 0} edit(s) applied, {validation.rejected?.length ?? 0} rejected</Badge>
                </div>
                {validation.applied?.map((a, i) => (
                  <div key={i} className="rounded-[2px] bg-[#f5f9fc] p-3 text-xs">
                    <div className="font-medium">{a.operation} {a.sectionKey}: {a.rationale}</div>
                    <ul className="mt-1 space-y-1">
                      {a.citations.map((c, j) => <li key={j}>{c.verified ? <Badge tone="green">verified</Badge> : <Badge tone="rose">unverified</Badge>} “{c.quote}”</li>)}
                    </ul>
                  </div>
                ))}
                {validation.rejected?.length ? (
                  <Field label="Rejected edits (not applied)">
                    <ul className="list-disc pl-5 text-xs">{validation.rejected.map((x, i) => <li key={i}>{x.sectionKey}: {x.reason}</li>)}</ul>
                  </Field>
                ) : null}
                {validation.unsupportedStatements?.length ? (
                  <Field label="Statements without a supporting citation">
                    <ul className="list-disc pl-5 text-xs text-amber-800">{validation.unsupportedStatements.map((x, i) => <li key={i}>{x.sectionKey}: {x.sentence}</li>)}</ul>
                  </Field>
                ) : null}
                {[...(validation.warnings ?? []), ...(validation.conflicts ?? []), ...(validation.uncertainties ?? [])].length ? (
                  <Field label="Warnings, conflicts and uncertainties">
                    <ul className="list-disc pl-5 text-xs">{[...(validation.warnings ?? []), ...(validation.conflicts ?? []), ...(validation.uncertainties ?? [])].map((x, i) => <li key={i}>{x}</li>)}</ul>
                  </Field>
                ) : null}
              </div>
            ) : (
              <Empty>This draft was written by a person; no automatic validation applies.</Empty>
            )}
          </Card>

          {r.citations.length ? (
            <Card title="Source citations">
              <ul className="space-y-2 text-xs">
                {r.citations.map((c) => (
                  <li key={c.id}>
                    {c.verified ? <Badge tone="green">verified</Badge> : <Badge tone="rose">unverified</Badge>} “{c.quote}”
                    {c.sourceVersion ? <div><Link href={`/sources/versions/${c.sourceVersion.id}`}>{c.sourceVersion.document.title} v{c.sourceVersion.versionNumber}</Link></div> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
          {r.impactAssessment ? (
            <Card title="Triggered by">
              <Link href={`/changes/${r.impactAssessment.change.id}`}>{r.impactAssessment.change.title}</Link> <SimulatedBadge show={r.impactAssessment.change.isSimulated} />
              <p className="mt-1 text-xs text-slate-500">{r.impactAssessment.rationale}</p>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
