import { notFound } from "next/navigation";
import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { PcBadge, PcTableWrap } from "@/components/compliance-ui";
import { LINK_TONE, NotOfficialBanner, Panel, RESULT_TONE } from "@/components/cqc-ui";
import { Flash, fmtDate } from "@/components/ui";
import { improvementActionAction, linkEvidenceAction, proposeSuggestionAction, recordResultAction, reviewEvidenceAction } from "@/app/cqc-actions";
import { orNotFound } from "@/server/auth/page-guard";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { getAssessment, RESULTS } from "@/server/cqc/assessments";
import { membersWithRoles } from "@/server/cqc/common";
import { evidenceCandidates, LINK_STATUS, SOURCE_TYPES } from "@/server/cqc/evidence";
import { ACTION_STATUS } from "@/server/cqc/improvements";
import { KQ_LABEL, RESULT_LABEL, type KeyQuestion } from "@/server/cqc/scoring";
import { ACTION_PRIORITIES } from "@/server/compliance/audits";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** One assessment area: the result and its rationale, the evidence behind it (and its review), and improvement actions. */
export default async function AreaPage({ params, searchParams }: { params: Promise<{ id: string; criterionId: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id, criterionId } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "cqc.view")) notFound();
  const g = await orNotFound(getAssessment(ctx, id));
  const a = g.assessment;
  const c = g.criteria.find((x) => x.id === criterionId);
  if (!c) notFound();
  const res = g.results.get(c.id);
  const score = g.readiness.criteria.find((x) => x.id === c.id);
  const links = g.links.filter((l) => l.criterionId === c.id);
  const actions = g.actions.filter((x) => x.cqcCriterionId === c.id);
  const canAssess = hasOrgPermission(ctx, "cqc.assess");
  const canVerify = hasOrgPermission(ctx, "cqc.evidence.verify");
  const [candidates, owners] = canAssess && a.status !== "SUPERSEDED" ? await Promise.all([evidenceCandidates(ctx, a.branchId), membersWithRoles(a.organisationId, ["ORG_ADMIN", "COMPLIANCE_LEAD", "CARE_MANAGER", "CARE_COORDINATOR", "POLICY_AUTHOR", "POLICY_REVIEWER", "POLICY_APPROVER"])]) : [[], []];
  const history = g.history.filter((h) => (h.data as { criterion?: string }).criterion === c.code);
  const linkHistory = links.length ? await db.auditLog.findMany({ where: { organisationId: a.organisationId, entityType: "CqcEvidenceLink", entityId: { in: links.map((l) => l.id) } }, orderBy: { createdAt: "desc" }, take: 60 }) : [];
  const userIds = [res?.recordedById, ...links.flatMap((l) => [l.linkedById, l.reviewedById]), ...actions.map((x) => x.ownerId), ...history.map((h) => h.actorId), ...linkHistory.map((h) => h.actorId)].filter((x): x is string => Boolean(x));
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const back = `/compliance/cqc/assessments/${a.id}/areas/${c.id}`;
  const idx = g.criteria.findIndex((x) => x.id === c.id);
  const prev = g.criteria[idx - 1];
  const next = g.criteria[idx + 1];
  const today = new Date().toISOString().slice(0, 10);
  const editable = g.canEdit;

  return (
    <>
      <CompliancePageHeader
        back={`/compliance/cqc/assessments/${a.id}?q=${c.keyQuestion}`}
        title={<><span className="mr-2 font-normal text-[#667085]">{c.code}</span>{c.title}</>}
        subtitle={<>{a.reference} · {KQ_LABEL[c.keyQuestion as KeyQuestion]} · {c.qualityStatement} · {c.regulations.join(", ")}{c.essential ? <> · <PcBadge tone="purple">Essential</PcBadge></> : null}</>}
        actions={<>
          {prev ? <Link href={`/compliance/cqc/assessments/${a.id}/areas/${prev.id}`} className="pc-btn-secondary pc-btn-sm">Previous area</Link> : null}
          {next ? <Link href={`/compliance/cqc/assessments/${a.id}/areas/${next.id}`} className="pc-btn-secondary pc-btn-sm">Next area</Link> : null}
        </>}
      />
      <Flash searchParams={sp} />
      <div className="space-y-4">
        <NotOfficialBanner />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <Panel title="What good looks like">
              <div className="space-y-2 px-5 py-4 text-body text-[#344054]">
                <p>{c.guidance}</p>
                {c.evidenceExamples.length ? <><p className="text-meta font-semibold text-[#101828]">Evidence an inspector may ask to see</p><ul className="list-disc space-y-0.5 pl-5 text-body">{c.evidenceExamples.map((e) => <li key={e}>{e}</li>)}</ul></> : null}
              </div>
            </Panel>

            <Panel title="Evidence" testId="area-evidence" actions={<span className="text-meta text-[#667085]">Only verified, in-date evidence counts towards the score</span>}>
              {links.length ? (
                <PcTableWrap label="Evidence for this area">
                  <table className="pc-table">
                    <thead><tr><th>Record</th><th>Status</th><th>Linked</th><th>Review</th></tr></thead>
                    <tbody>
                      {links.map((l) => (
                        <tr key={l.id} data-testid={`link-${l.id}`}>
                          <td className="min-w-[240px]">
                            {l.info.href ? <a href={l.info.href} className="pc-strong">{l.info.label}</a> : <span className="pc-strong">{l.info.label}</span>}
                            <span className="pc-sub">{SOURCE_TYPES[l.sourceType as keyof typeof SOURCE_TYPES] ?? l.sourceType}{l.origin === "DISCOVERED" ? " · suggested by the system" : ""}{l.info.stale ? ` · ${l.info.stale}` : ""}</span>
                          </td>
                          <td className="whitespace-nowrap">
                            <PcBadge tone={LINK_TONE[l.effective] ?? "grey"}>{LINK_STATUS[l.effective]}</PcBadge>
                            {l.effective === "VERIFIED" && l.validUntil ? <span className="pc-sub">Counts until {fmtDate(l.validUntil)}</span> : null}
                            {l.effective === "OUTDATED" && l.status === "VERIFIED" ? <span className="pc-sub">Was verified; {l.info.stale ? "source changed" : "past its date"}</span> : null}
                          </td>
                          <td className="whitespace-nowrap text-meta">{l.linkedById ? users.get(l.linkedById) : "System"}<span className="pc-sub">{fmtDate(l.createdAt)}{l.note ? ` · ${l.note}` : ""}</span></td>
                          <td className="min-w-[220px] text-meta">
                            {l.reviewedById ? <span className="block">{users.get(l.reviewedById)} · {fmtDate(l.reviewedAt)}{l.reviewNote ? <span className="pc-sub">{l.reviewNote}</span> : null}</span> : null}
                            {l.status === "SUGGESTED" && canAssess ? (
                              <form action={proposeSuggestionAction} className="mt-1 inline-block">
                                <input type="hidden" name="back" value={back} /><input type="hidden" name="linkId" value={l.id} />
                                <button className="pc-btn-secondary pc-btn-sm" type="submit">Send for review</button>
                              </form>
                            ) : null}
                            {canVerify && !l.info.restricted ? (
                              <form action={reviewEvidenceAction} className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                <input type="hidden" name="back" value={back} /><input type="hidden" name="linkId" value={l.id} /><input type="hidden" name="updatedAt" value={l.updatedAt.toISOString()} />
                                <select name="to" className="input h-8 w-auto py-0 text-meta" aria-label={`Decision for ${l.info.label}`} defaultValue="">
                                  <option value="" disabled>Decision…</option>
                                  {l.status !== "VERIFIED" ? <option value="VERIFIED">Verify</option> : null}
                                  <option value="REJECTED">Reject</option>
                                  <option value="OUTDATED">Mark outdated</option>
                                  <option value="SUPERSEDED">Mark superseded</option>
                                </select>
                                <input name="note" className="input h-8 w-[150px] py-0 text-meta" placeholder="Reason" aria-label="Reason for the decision" />
                                <button className="pc-btn-secondary pc-btn-sm" type="submit">Save</button>
                              </form>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </PcTableWrap>
              ) : <p className="pc-empty">No evidence linked yet. Link an existing record below, or run “Find possible evidence” on the Evidence tab.</p>}
              {canAssess && candidates.length && a.status !== "SUPERSEDED" ? (
                <form action={linkEvidenceAction} className="grid grid-cols-1 gap-2 border-t border-[#eaecf0] px-5 py-3 md:grid-cols-[minmax(0,1fr)_220px_auto]" data-testid="link-evidence">
                  <input type="hidden" name="back" value={back} /><input type="hidden" name="criterionId" value={c.id} />
                  <label><span className="label">Existing record</span>
                    <select name="source" className="input" required defaultValue="">
                      <option value="" disabled>Choose a record…</option>
                      {candidates.map((grp) => <optgroup key={grp.type} label={SOURCE_TYPES[grp.type]}>{grp.options.map((o) => <option key={o.value} value={`${grp.type}:${o.value}`}>{o.label}</option>)}</optgroup>)}
                    </select>
                  </label>
                  <label><span className="label">Note (optional)</span><input name="note" className="input" placeholder="What it shows" /></label>
                  <div className="flex items-end"><button className="pc-btn w-full md:w-auto" type="submit">Link evidence</button></div>
                  <p className="text-meta text-[#667085] md:col-span-3">Linking never verifies. A reviewer with evidence rights decides whether it counts. Files stay in the Evidence Library; nothing is copied.</p>
                </form>
              ) : null}
            </Panel>

            <Panel title="Improvement actions" testId="area-actions">
              {actions.length ? (
                <ul className="divide-y divide-[#eaecf0]">
                  {actions.map((x) => (
                    <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-body">
                      <Link href={`/actions/${x.id}`} className="pc-strong flex-1">{x.title}</Link>
                      <span className="text-[#475467]">{users.get(x.ownerId) ?? "—"} · due {fmtDate(x.dueDate)}</span>
                      <PcBadge tone={x.status === "VERIFIED" || x.status === "CLOSED" ? "green" : x.dueDate < new Date() ? "red" : "blue"}>{x.status !== "VERIFIED" && x.status !== "CLOSED" && x.dueDate < new Date() ? "Overdue" : ACTION_STATUS[x.status as keyof typeof ACTION_STATUS] ?? x.status}</PcBadge>
                    </li>
                  ))}
                </ul>
              ) : <p className="px-5 py-3 text-body text-[#667085]">No improvement actions for this area.</p>}
              {canAssess && a.status !== "SUPERSEDED" ? (
                <details className="border-t border-[#eaecf0] px-5 py-3">
                  <summary className="cursor-pointer text-body font-semibold text-module">Raise an improvement action</summary>
                  <form action={improvementActionAction} className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                    <input type="hidden" name="back" value={back} /><input type="hidden" name="assessmentId" value={a.id} /><input type="hidden" name="criterionId" value={c.id} />
                    <label className="md:col-span-2"><span className="label">What needs to happen</span><input name="title" className="input" required minLength={3} /></label>
                    <label className="md:col-span-2"><span className="label">Detail (optional)</span><textarea name="description" className="input" rows={2} /></label>
                    <label><span className="label">Responsible person</span><select name="ownerId" className="input" required defaultValue=""><option value="" disabled>Choose…</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
                    <label><span className="label">Due date</span><input type="date" name="dueDate" className="input" required min={today} /></label>
                    <label><span className="label">Priority</span><select name="priority" className="input" defaultValue="MEDIUM">{Object.entries(ACTION_PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                    <label><span className="label">Evidence of completion</span><input name="evidenceRequired" className="input" placeholder="e.g. signed audit, updated rota" /></label>
                    <div className="md:col-span-2"><button className="pc-btn" type="submit">Create action and tell the owner</button></div>
                  </form>
                </details>
              ) : null}
            </Panel>
          </div>

          <div className="space-y-4">
            <Panel title="Result" testId="area-result">
              <div className="space-y-3 px-5 py-4 text-body">
                <div className="flex items-center gap-2">{res ? <PcBadge tone={RESULT_TONE[res.result] ?? "grey"}>{RESULT_LABEL[res.result]}</PcBadge> : <PcBadge tone="grey">Not assessed</PcBadge>}<span className="ml-auto tabular-nums text-[#475467]">Area score {score?.score ?? "—"}</span></div>
                {score && score.state === "SCORED" && !score.hasVerifiedEvidence ? <p className="text-meta text-[#b54708]">Halved because no verified evidence supports this result.</p> : null}
                {score?.deduction ? <p className="text-meta text-[#b42318]">Overdue actions take {score.deduction} points off this area.</p> : null}
                {res ? <p className="text-[#344054]"><span className="block text-caption font-semibold uppercase tracking-wide text-[#667085]">Rationale</span>{res.rationale}{res.naReason ? <span className="mt-1 block">Why not applicable: {res.naReason}</span> : null}{res.findings ? <span className="mt-1 block">Findings: {res.findings}</span> : null}<span className="mt-1 block text-caption text-[#667085]">{users.get(res.recordedById)} · {fmtDate(res.recordedAt, true)} · version {res.version}</span></p> : null}
                {editable ? (
                  <form action={recordResultAction} className="space-y-2 border-t border-[#eaecf0] pt-3" data-testid="result-form">
                    <input type="hidden" name="back" value={back} /><input type="hidden" name="assessmentId" value={a.id} /><input type="hidden" name="criterionId" value={c.id} />
                    {res ? <input type="hidden" name="version" value={res.version} /> : null}
                    <fieldset><legend className="label">Result</legend>
                      <div className="grid grid-cols-2 gap-1.5">
                        {RESULTS.map((r) => <label key={r} className="flex items-center gap-2 rounded-lg border border-[#d0d5dd] px-2.5 py-1.5 text-meta"><input type="radio" name="result" value={r} defaultChecked={res?.result === r} required />{RESULT_LABEL[r]}</label>)}
                      </div>
                    </fieldset>
                    <label><span className="label">Rationale</span><textarea name="rationale" className="input" rows={3} required minLength={10} defaultValue={res?.rationale ?? ""} /></label>
                    <label><span className="label">Findings (optional)</span><textarea name="findings" className="input" rows={2} defaultValue={res?.findings ?? ""} /></label>
                    <label><span className="label">If not applicable, why</span><input name="naReason" className="input" defaultValue={res?.naReason ?? ""} /></label>
                    <button className="pc-btn w-full" type="submit">{res ? "Update result" : "Save result"}</button>
                  </form>
                ) : <p className="text-meta text-[#667085]">{a.status === "IN_PROGRESS" ? "You can view this assessment but not change results." : "Results are locked once an assessment is submitted. Start a reassessment to change them."}</p>}
              </div>
            </Panel>

            <Panel title="History">
              <ol className="max-h-[360px] divide-y divide-[#eaecf0] overflow-y-auto" data-testid="area-history">
                {[...history.map((h) => ({ id: h.id, at: h.createdAt, actor: h.actorId, text: (() => { const d = h.data as { from?: { result?: string } | null; to?: { result?: string } }; return h.action === "cqc.result.recorded" ? `Result ${d.from?.result ? `${RESULT_LABEL[d.from.result]} → ` : ""}${RESULT_LABEL[d.to?.result ?? ""] ?? ""}` : "Improvement action raised"; })() })),
                  ...linkHistory.map((h) => ({ id: h.id, at: h.createdAt, actor: h.actorId, text: (() => { const d = h.data as { from?: string | null; to?: string; note?: string | null }; return `Evidence ${d.from ? `${LINK_STATUS[d.from as keyof typeof LINK_STATUS] ?? d.from} → ` : ""}${LINK_STATUS[d.to as keyof typeof LINK_STATUS] ?? d.to}${d.note ? ` (${d.note})` : ""}`; })() }))]
                  .sort((x, y) => y.at.getTime() - x.at.getTime())
                  .map((h) => <li key={h.id} className="px-5 py-2 text-meta"><span className="font-medium text-[#101828]">{h.text}</span><span className="block text-[#667085]">{users.get(h.actor ?? "") ?? "System"} · {fmtDate(h.at, true)}</span></li>)}
                {!history.length && !linkHistory.length ? <li className="px-5 py-3 text-meta text-[#667085]">Nothing recorded yet.</li> : null}
              </ol>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}
