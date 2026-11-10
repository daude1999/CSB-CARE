import { notFound } from "next/navigation";
import { DownloadSimple, LockSimple } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { PcBadge, PcTabs } from "@/components/compliance-ui";
import { LINK_TONE, Panel, RCA_TONE, SEVERITY_TONE } from "@/components/cqc-ui";
import { Flash, fmtDate } from "@/components/ui";
import {
  closeRcaAction, conclusionsAction, effectivenessAction, escalationAction, factorsAction, findingAction, linkRcaCqcAction, managerReviewAction,
  rcaActionAction, rcaEvidenceAction, rcaSourceAction, removeTimelineAction, reopenRcaAction, startEffectivenessAction, submitRcaAction, timelineAction, whatHappenedAction,
} from "@/app/cqc-actions";
import { orNotFound } from "@/server/auth/page-guard";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { membersWithRoles } from "@/server/cqc/common";
import { LINK_STATUS } from "@/server/cqc/evidence";
import { activeFramework, frameworkCriteria } from "@/server/cqc/framework";
import { ACTION_STATUS } from "@/server/cqc/improvements";
import {
  canSeeRcas, EFFECTIVENESS, EFFECTIVENESS_CHECKS, ESCALATION_DECISIONS, ESCALATIONS, FACTOR_AREAS, FINDING_KINDS, getRca, HARM, RCA_STATUS, SEVERITIES, SOURCE_KINDS, TIMELINE_KINDS,
  type Factors, type TimelineEntry,
} from "@/server/cqc/rca";
import { KQ_LABEL, type KeyQuestion } from "@/server/cqc/scoring";
import { ACTION_PRIORITIES, ACTION_TYPES } from "@/server/compliance/audits";
import { londonDate } from "@/lib/london";

export const dynamic = "force-dynamic";

const STEPS = [
  { key: "1", label: "1 What happened" },
  { key: "2", label: "2 Timeline" },
  { key: "3", label: "3 Contributing factors" },
  { key: "4", label: "4 Findings" },
  { key: "5", label: "5 Actions" },
  { key: "6", label: "6 Management review" },
  { key: "7", label: "7 Effectiveness & closure" },
] as const;

const HISTORY: Record<string, string> = {
  "rca.created": "Investigation opened", "rca.what-happened.saved": "What happened updated", "rca.timeline.added": "Timeline entry added", "rca.timeline.removed": "Timeline entry removed",
  "rca.factors.saved": "Contributing factors updated", "rca.conclusions.saved": "Conclusions updated", "rca.finding.added": "Finding added", "rca.source.linked": "Record linked",
  "rca.escalation.recorded": "Escalation decision recorded", "rca.action.added": "Action allocated", "rca.evidence.added": "File attached", "rca.submitted": "Sent for management review",
  "rca.approved": "Findings and actions approved", "rca.returned": "Sent back for more investigation", "rca.effectiveness.due": "Effectiveness review started",
  "rca.effectiveness.reviewed": "Effectiveness reviewed", "rca.closed": "Closed", "rca.closed.exception": "Closed by approved exception", "rca.reopened": "Reopened",
};
const DELIVERY: Record<string, string> = { PENDING: "Email queued", SENT: "Email sent", FAILED: "Email failed, retrying", DEAD: "Email could not be sent" };

/** One investigation: the seven steps as tabs, with the escalation decisions, people, CQC links and history beside them. */
export default async function RcaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!ctx.organisationId || !canSeeRcas(ctx)) notFound();
  const g = await orNotFound(getRca(ctx, id));
  const r = g.rca;
  const step = STEPS.some((s) => s.key === sp.step) ? sp.step! : defaultStep(r.status);
  const back = `/compliance/cqc/rca/${r.id}?step=${step}`;
  const n = (uid: string | null | undefined) => (uid ? g.names.get(uid) ?? "Former member" : "—");
  const timeline = (r.timeline as TimelineEntry[]).slice().sort((a, b) => a.at.localeCompare(b.at));
  const factors = r.factors as Factors;
  const whys = r.fiveWhys as string[];
  const today = londonDate();
  const [owners, criteria] = await Promise.all([
    g.can.addActions ? membersWithRoles(r.organisationId, ["ORG_ADMIN", "COMPLIANCE_LEAD", "CARE_MANAGER", "CARE_COORDINATOR", "POLICY_AUTHOR", "POLICY_REVIEWER", "POLICY_APPROVER"]) : Promise.resolve([]),
    g.can.linkCqc && r.status !== "NEW" && r.status !== "INVESTIGATING" ? activeFramework().then((fw) => frameworkCriteria(fw.id)) : Promise.resolve([]),
  ]);
  const linkedCriteria = new Set(g.cqcLinks.map((l) => l.criterionId));
  const restrictedHidden = r.restricted && !hasOrgPermission(ctx, "rca.safeguarding") && r.ownerId !== ctx.userId && r.managerId !== ctx.userId;
  if (restrictedHidden) notFound();
  const hidden = (k: string, v: string | number) => <input type="hidden" name={k} value={v} />;
  const base = <>{hidden("back", back)}{hidden("rcaId", r.id)}</>;
  const locked = !g.can.work;

  return (
    <>
      <CompliancePageHeader
        back="/compliance/cqc/rca"
        title={<>{r.reference} {r.title}</>}
        subtitle={<>{r.category} · event {fmtDate(r.eventDate)} · {g.branchName}{g.serviceUser ? <> · <Link href={`/rota/service-users/${g.serviceUser.id}`} className="pc-link">{g.serviceUser.preferredName || g.serviceUser.firstName} {g.serviceUser.lastName} ({g.serviceUser.reference})</Link></> : null}</>}
        actions={hasOrgPermission(ctx, "report.export") ? <>
          <a href={`/api/cqc-reports/rca?id=${r.id}&format=pdf`} data-no-progress="" className="pc-btn-secondary"><DownloadSimple size={16} aria-hidden="true" />RCA report (PDF)</a>
          <a href={`/api/cqc-reports/rca?id=${r.id}&format=csv`} data-no-progress="" className="pc-btn-secondary">CSV</a>
        </> : null}
      />
      <Flash searchParams={sp} />
      <div className="space-y-4">
        <div className="pc-panel flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3 text-[13.5px]" data-testid="rca-summary">
          <PcBadge tone={RCA_TONE[r.status] ?? "grey"}>{RCA_STATUS[r.status as keyof typeof RCA_STATUS]}</PcBadge>
          <PcBadge tone={SEVERITY_TONE[r.severity] ?? "grey"}>{SEVERITIES[r.severity as keyof typeof SEVERITIES]} severity</PcBadge>
          {r.restricted ? <span className="inline-flex items-center gap-1 font-semibold text-[#93370d]"><LockSimple size={15} weight="fill" aria-hidden="true" />Restricted</span> : null}
          <span>Investigator <strong>{n(r.ownerId)}</strong></span>
          <span>Manager <strong>{n(r.managerId)}</strong></span>
          <span className={g.overdue ? "font-semibold text-[#b42318]" : ""}>Due {fmtDate(r.dueDate)}{g.overdue ? " (overdue)" : ""}</span>
          <span>Actions {g.actionsDone} of {g.actionsTotal} verified</span>
          {r.reopenCount ? <span>Reopened {r.reopenCount}×</span> : null}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_350px]">
          <section className="pc-panel" aria-label="Investigation steps">
            <div className="px-5 pt-2"><PcTabs label="Investigation steps" testId="rca-steps" active={step} items={STEPS.map((s) => ({ key: s.key, label: s.label, href: `/compliance/cqc/rca/${r.id}?step=${s.key}` }))} /></div>
            <div className="space-y-5 px-5 py-4 text-[14px]" data-testid={`rca-step-${step}`}>
              {locked && ["1", "2", "3", "4"].includes(step) ? <p className="rounded-lg bg-[#f9fafb] px-3 py-2 text-[13px] text-[#475467]">{r.status === "CLOSED" ? "Closed. Reopen the investigation to change it." : r.status === "NEW" || r.status === "INVESTIGATING" ? "You can read this investigation but not change it." : "Submitted. A manager must send it back for more investigation before these steps can change."}</p> : null}

              {step === "1" ? (
                <>
                  <LinkedRecords g={g} />
                  {g.can.work ? (
                    <form action={rcaSourceAction} className="flex flex-wrap items-end gap-2">
                      {base}
                      <label><span className="label">Link another record</span><select name="type" className="input w-auto" defaultValue="INCIDENT">{Object.entries(SOURCE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                      <label className="min-w-[200px] flex-1"><span className="label">Its id (from the record’s page address)</span><input name="sourceId" className="input" required /></label>
                      <button className="pc-btn-secondary" type="submit">Link</button>
                    </form>
                  ) : null}
                  <form action={whatHappenedAction} className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {base}{hidden("lockVersion", r.lockVersion)}
                    <label className="md:col-span-2"><span className="label">Summary of what happened</span><textarea name="summary" className="input" rows={4} required minLength={20} defaultValue={r.summary ?? ""} disabled={locked} /></label>
                    <label><span className="label">People involved (roles, not personal details)</span><textarea name="peopleInvolved" className="input" rows={2} defaultValue={r.peopleInvolved ?? ""} disabled={locked} /></label>
                    <label><span className="label">Immediate impact</span><textarea name="immediateImpact" className="input" rows={2} defaultValue={r.immediateImpact ?? ""} disabled={locked} /></label>
                    <label><span className="label">Level of harm</span><select name="harm" className="input" required defaultValue={r.harm ?? ""} disabled={locked}><option value="" disabled>Choose…</option>{Object.entries(HARM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                    <label><span className="label">Immediate actions taken</span><textarea name="immediateActions" className="input" rows={2} defaultValue={r.immediateActions ?? ""} disabled={locked} /></label>
                    {!locked ? <div className="md:col-span-2"><button className="pc-btn" type="submit">Save</button></div> : null}
                  </form>
                </>
              ) : null}

              {step === "2" ? (
                <>
                  <ol className="relative space-y-3 border-l-2 border-[#eaecf0] pl-5" data-testid="rca-timeline">
                    {timeline.map((t, i) => (
                      <li key={`${t.at}-${i}`} className="relative">
                        <span aria-hidden="true" className={`absolute -left-[27px] top-1.5 h-3 w-3 rounded-full ${t.kind === "FACT" ? "bg-[#7a5af8]" : t.kind === "WITNESS" ? "bg-[#2e90fa]" : "bg-[#f79009]"}`} />
                        <div className="flex flex-wrap items-baseline gap-x-2"><strong className="tabular-nums">{t.at.slice(0, 10)} {t.at.slice(11, 16)}</strong><PcBadge tone={t.kind === "FACT" ? "purple" : t.kind === "WITNESS" ? "blue" : "amber"}>{TIMELINE_KINDS[t.kind]}</PcBadge></div>
                        <p className="text-[#344054]">{t.text}</p>
                        {g.can.work ? <form action={removeTimelineAction}>{base}{hidden("at", t.at)}{hidden("text", t.text)}<button className="text-[12.5px] text-[#b42318] underline" type="submit">Remove</button></form> : null}
                      </li>
                    ))}
                    {!timeline.length ? <li className="text-[#667085]">No entries yet.</li> : null}
                  </ol>
                  {g.can.work ? (
                    <form action={timelineAction} className="grid grid-cols-1 gap-3 border-t border-[#eaecf0] pt-4 md:grid-cols-[150px_110px_170px_minmax(0,1fr)]">
                      {base}
                      <label><span className="label">Date</span><input type="date" name="date" className="input" required max={today} /></label>
                      <label><span className="label">Time</span><input type="time" name="time" className="input" required /></label>
                      <label><span className="label">This is a</span><select name="kind" className="input" defaultValue="FACT">{Object.entries(TIMELINE_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                      <label><span className="label">What happened</span><input name="text" className="input" required minLength={3} /></label>
                      <div className="md:col-span-4"><button className="pc-btn" type="submit">Add to timeline</button><span className="ml-3 text-[12.5px] text-[#667085]">Keep facts, witness accounts and assumptions apart.</span></div>
                    </form>
                  ) : null}
                </>
              ) : null}

              {step === "3" ? (
                <form action={factorsAction} className="space-y-4">
                  {base}{hidden("lockVersion", r.lockVersion)}
                  <fieldset><legend className="pc-panel-title mb-2">Which areas contributed?</legend>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                      {(Object.keys(FACTOR_AREAS) as (keyof typeof FACTOR_AREAS)[]).map((k) => (
                        <div key={k} className="rounded-lg border border-[#eaecf0] px-3 py-2">
                          <label className="flex items-center gap-2 font-medium"><input type="checkbox" name={`f_${k}`} defaultChecked={factors[k]?.relevant} disabled={locked} />{FACTOR_AREAS[k]}</label>
                          <input name={`n_${k}`} className="input mt-1.5 h-8 py-0 text-[13px]" placeholder="How it contributed" aria-label={`${FACTOR_AREAS[k]} notes`} defaultValue={factors[k]?.notes ?? ""} disabled={locked} />
                        </div>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset><legend className="pc-panel-title mb-2">Five whys</legend>
                    <div className="space-y-2">{[1, 2, 3, 4, 5].map((i) => <label key={i} className="flex items-center gap-2"><span className="w-[60px] shrink-0 text-[13px] text-[#475467]">Why {i}?</span><input name={`why${i}`} className="input" defaultValue={whys[i - 1] ?? ""} disabled={locked} /></label>)}</div>
                  </fieldset>
                  <label><span className="label">Cause and effect notes (optional)</span><textarea name="causeEffectNotes" className="input" rows={3} defaultValue={r.causeEffectNotes ?? ""} disabled={locked} /></label>
                  {!locked ? <button className="pc-btn" type="submit">Save contributing factors</button> : null}
                </form>
              ) : null}

              {step === "4" ? (
                <>
                  <div>
                    <h3 className="pc-panel-title mb-2">Root cause findings</h3>
                    <ul className="space-y-2" data-testid="rca-findings">
                      {g.findings.map((f) => (
                        <li key={f.id} className="rounded-lg border border-[#eaecf0] px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2"><PcBadge tone="blue">{FINDING_KINDS[f.kind as keyof typeof FINDING_KINDS] ?? f.kind}</PcBadge>{f.factorArea ? <span className="text-[12.5px] text-[#475467]">{FACTOR_AREAS[f.factorArea as keyof typeof FACTOR_AREAS]}</span> : null}<PcBadge tone={f.status === "CONFIRMED" ? "green" : f.status === "NOT_SUPPORTED" ? "red" : "grey"}>{f.status === "CONFIRMED" ? "Confirmed by manager" : f.status === "NOT_SUPPORTED" ? "Not supported" : "Proposed"}</PcBadge></div>
                          <p className="mt-1 text-[#101828]">{f.text}</p>
                          <p className="text-[13px] text-[#475467]">Evidence: {f.evidence}</p>
                        </li>
                      ))}
                      {!g.findings.length ? <li className="text-[#667085]">No findings yet. Each finding needs the evidence that supports it.</li> : null}
                    </ul>
                  </div>
                  {g.can.work ? (
                    <form action={findingAction} className="grid grid-cols-1 gap-3 border-t border-[#eaecf0] pt-4 md:grid-cols-2">
                      {base}
                      <label><span className="label">Type</span><select name="kind" className="input" defaultValue="CONTRIBUTING">{Object.entries(FINDING_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                      <label><span className="label">Area (optional)</span><select name="factorArea" className="input" defaultValue=""><option value="">—</option>{Object.entries(FACTOR_AREAS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                      <label className="md:col-span-2"><span className="label">Finding</span><input name="text" className="input" required minLength={10} /></label>
                      <label className="md:col-span-2"><span className="label">Evidence that supports it</span><input name="evidence" className="input" required minLength={5} placeholder="e.g. call log, rota for 3 March, statement from the coordinator" /></label>
                      <div className="md:col-span-2"><button className="pc-btn" type="submit">Add finding</button></div>
                    </form>
                  ) : null}
                  <form action={conclusionsAction} className="grid grid-cols-1 gap-3 border-t border-[#eaecf0] pt-4 md:grid-cols-2">
                    {base}{hidden("lockVersion", r.lockVersion)}
                    <label><span className="label">Immediate cause</span><textarea name="immediateCause" className="input" rows={2} defaultValue={r.immediateCause ?? ""} disabled={locked} /></label>
                    <label><span className="label">Underlying causes</span><textarea name="underlyingCauses" className="input" rows={2} defaultValue={r.underlyingCauses ?? ""} disabled={locked} /></label>
                    <label><span className="label">What is still uncertain</span><textarea name="uncertainties" className="input" rows={2} defaultValue={r.uncertainties ?? ""} disabled={locked} /></label>
                    <label><span className="label">Investigator’s conclusions</span><textarea name="conclusions" className="input" rows={2} defaultValue={r.conclusions ?? ""} disabled={locked} /></label>
                    {!locked ? <div className="md:col-span-2"><button className="pc-btn" type="submit">Save conclusions</button></div> : null}
                  </form>
                </>
              ) : null}

              {step === "5" ? (
                <>
                  <ul className="divide-y divide-[#eaecf0] rounded-lg border border-[#eaecf0]" data-testid="rca-actions">
                    {g.actions.map((x) => {
                      const overdue = !["VERIFIED", "CLOSED"].includes(x.status) && x.dueDate < new Date();
                      return (
                        <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                          <span className="min-w-0 flex-1"><Link href={`/actions/${x.id}`} className="pc-strong">{x.title}</Link><span className="pc-sub">{ACTION_TYPES[x.actionType as keyof typeof ACTION_TYPES] ?? "Action"} · {ACTION_PRIORITIES[x.priority as keyof typeof ACTION_PRIORITIES] ?? x.priority} priority · evidence: {x.evidenceRequired ?? "—"}</span></span>
                          <span className="text-[13px] text-[#475467]">{n(x.ownerId)} · due {fmtDate(x.dueDate)}</span>
                          <PcBadge tone={overdue ? "red" : x.status === "VERIFIED" || x.status === "CLOSED" ? "green" : x.status === "COMPLETED" ? "purple" : "blue"}>{overdue ? "Overdue" : ACTION_STATUS[x.status as keyof typeof ACTION_STATUS] ?? x.status}</PcBadge>
                        </li>
                      );
                    })}
                    {!g.actions.length ? <li className="px-3 py-3 text-[#667085]">No actions yet.</li> : null}
                  </ul>
                  <p className="text-[12.5px] text-[#667085]">Owners update and complete actions on the action page. Someone other than the owner verifies each one.</p>
                  {g.can.addActions ? (
                    <form action={rcaActionAction} className="grid grid-cols-1 gap-3 border-t border-[#eaecf0] pt-4 md:grid-cols-2" data-testid="rca-action-form">
                      {base}
                      <label className="md:col-span-2"><span className="label">Action</span><input name="title" className="input" required minLength={3} /></label>
                      <label><span className="label">Type</span><select name="actionType" className="input" defaultValue="CORRECTIVE">{Object.entries(ACTION_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                      <label><span className="label">Priority</span><select name="priority" className="input" defaultValue="MEDIUM">{Object.entries(ACTION_PRIORITIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                      <label><span className="label">Responsible person</span><select name="ownerId" className="input" required defaultValue=""><option value="" disabled>Choose…</option>{owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
                      <label><span className="label">Due date</span><input type="date" name="dueDate" className="input" required min={today} /></label>
                      <label><span className="label">Addresses finding (optional)</span><select name="findingId" className="input" defaultValue=""><option value="">—</option>{g.findings.map((f) => <option key={f.id} value={f.id}>{f.text.slice(0, 80)}</option>)}</select></label>
                      <label><span className="label">Evidence of completion</span><input name="evidenceRequired" className="input" required minLength={5} placeholder="e.g. training certificates, updated procedure" /></label>
                      <label className="md:col-span-2"><span className="label">Detail (optional)</span><textarea name="description" className="input" rows={2} /></label>
                      <div className="md:col-span-2"><button className="pc-btn" type="submit">Allocate action and tell the owner</button></div>
                    </form>
                  ) : null}
                  <div className="border-t border-[#eaecf0] pt-4">
                    <h3 className="pc-panel-title mb-2">Files</h3>
                    <ul className="space-y-1 text-[13.5px]">
                      {g.evidence.map((e) => <li key={e.id}>{e.scanStatus === "INFECTED" ? <span className="text-[#b42318]">{e.filename} (blocked by malware scan)</span> : <a href={`/api/evidence/${e.id}`} className="pc-link" data-no-progress="">{e.filename}</a>}<span className="text-[#667085]"> · {e.description} · {fmtDate(e.createdAt)}</span></li>)}
                      {!g.evidence.length ? <li className="text-[#667085]">No files attached.</li> : null}
                    </ul>
                    {g.can.uploadEvidence ? (
                      <form action={rcaEvidenceAction} encType="multipart/form-data" className="mt-3 flex flex-wrap items-end gap-2">
                        {base}
                        <label><span className="label">File</span><input type="file" name="file" className="input" required /></label>
                        <label className="min-w-[200px] flex-1"><span className="label">What it is</span><input name="description" className="input" /></label>
                        <button className="pc-btn-secondary" type="submit">Attach</button>
                      </form>
                    ) : null}
                  </div>
                </>
              ) : null}

              {step === "6" ? (
                <>
                  {r.status === "NEW" || r.status === "INVESTIGATING" ? (
                    g.gaps.length ? (
                      <div className="rounded-lg border border-[#fedf89] bg-[#fffaeb] px-4 py-3" data-testid="rca-gaps"><p className="font-semibold text-[#93370d]">Before this can go for review:</p><ul className="mt-1 list-disc pl-5 text-[13.5px] text-[#93370d]">{g.gaps.map((x) => <li key={x}>{x}</li>)}</ul></div>
                    ) : g.can.work ? (
                      <form action={submitRcaAction}>{base}{hidden("lockVersion", r.lockVersion)}<button className="pc-btn" type="submit">Send for management review</button><span className="ml-3 text-[13px] text-[#475467]">{n(r.managerId)} will be told.</span></form>
                    ) : null
                  ) : null}
                  {g.can.review ? (
                    <form action={managerReviewAction} className="space-y-3 rounded-lg border border-module/[.22] bg-[#f9f8ff] px-4 py-3" data-testid="rca-review-form">
                      {base}{hidden("lockVersion", r.lockVersion)}
                      <p className="font-semibold">Confirm the findings the evidence supports</p>
                      {g.findings.map((f) => <label key={f.id} className="flex items-start gap-2 text-[13.5px]"><input type="checkbox" name="confirm" value={f.id} defaultChecked className="mt-1" /><span>{f.text}<span className="block text-[12.5px] text-[#667085]">Evidence: {f.evidence}</span></span></label>)}
                      <label><span className="label">Review note</span><textarea name="note" className="input" rows={2} required minLength={5} /></label>
                      <div className="flex flex-wrap gap-2"><button className="pc-btn" type="submit" name="decision" value="APPROVE">Approve findings and actions</button><button className="pc-btn-secondary" type="submit" name="decision" value="MORE_INVESTIGATION">Needs more investigation</button></div>
                    </form>
                  ) : r.status === "AWAITING_REVIEW" ? <p className="text-[#475467]">Waiting for review by a manager other than the investigator.</p> : null}
                  <ReviewList g={g} n={n} />
                </>
              ) : null}

              {step === "7" ? (
                <>
                  {g.can.startEffectiveness ? <form action={startEffectivenessAction}>{base}<button className="pc-btn" type="submit">All actions verified: start effectiveness review</button></form> : null}
                  {r.status === "ACTIONS_IN_PROGRESS" && !g.can.startEffectiveness ? <p className="text-[#475467]">{g.actionsDone} of {g.actionsTotal} actions verified. The effectiveness review starts once every action is verified.</p> : null}
                  {g.can.effectiveness ? (
                    <form action={effectivenessAction} className="space-y-3 rounded-lg border border-module/[.22] bg-[#f9f8ff] px-4 py-3" data-testid="rca-effectiveness-form">
                      {base}{hidden("lockVersion", r.lockVersion)}
                      <p className="font-semibold">Did the actions work?</p>
                      {Object.entries(EFFECTIVENESS_CHECKS).map(([k, v]) => <label key={k} className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name={k} />{v}</label>)}
                      <label><span className="label">Decision</span><select name="decision" className="input" required defaultValue=""><option value="" disabled>Choose…</option>{Object.entries(EFFECTIVENESS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
                      <label><span className="label">Note</span><textarea name="note" className="input" rows={2} required minLength={5} /></label>
                      <button className="pc-btn" type="submit">Record effectiveness review</button>
                    </form>
                  ) : null}
                  {g.can.close ? (
                    <form action={closeRcaAction} className="space-y-3 rounded-lg border border-[#eaecf0] px-4 py-3" data-testid="rca-close-form">
                      {base}{hidden("lockVersion", r.lockVersion)}
                      <p className="font-semibold">Close the investigation</p>
                      <p className="text-[13px] text-[#475467]">Normally needs: confirmed findings, every action verified, an Effective decision, and every escalation decision recorded for serious cases. Closing does not close linked incidents or risks, and does not change any CQC score.</p>
                      <label><span className="label">Closure note</span><textarea name="note" className="input" rows={2} required minLength={5} /></label>
                      <label className="flex items-start gap-2 text-[13.5px]"><input type="checkbox" name="exception" className="mt-1" /><span>Close by approved exception (the normal conditions are not all met)</span></label>
                      <label><span className="label">Reason for the exception</span><input name="exceptionReason" className="input" /></label>
                      <button className="pc-btn" type="submit">Close investigation</button>
                    </form>
                  ) : null}
                  {r.status === "CLOSED" ? <p data-testid="rca-closed">Closed by <strong>{n(r.closedById)}</strong> on {fmtDate(r.closedAt)}{r.closureException ? <> by approved exception: {r.exceptionReason}</> : null}. {r.closureNote}</p> : null}
                  {g.can.reopen ? (
                    <form action={reopenRcaAction} className="flex flex-wrap items-end gap-2 border-t border-[#eaecf0] pt-3">
                      {base}
                      <label className="min-w-[240px] flex-1"><span className="label">Reason for reopening</span><input name="reason" className="input" required minLength={5} /></label>
                      <button className="pc-btn-secondary" type="submit">Reopen</button>
                    </form>
                  ) : null}
                  <ReviewList g={g} n={n} />
                </>
              ) : null}
            </div>
          </section>

          <div className="space-y-4">
            <Panel title="Escalation decisions" testId="rca-escalations" actions={g.serious ? <PcBadge tone="red">Required</PcBadge> : null}>
              <p className="border-b border-[#eaecf0] px-5 py-2 text-[12.5px] text-[#475467]">Record each decision. CSB does not decide these or send anything to the local authority or CQC for you.</p>
              <ul className="divide-y divide-[#eaecf0]">
                {(Object.keys(ESCALATIONS) as (keyof typeof ESCALATIONS)[]).map((k) => {
                  const e = g.escalations.find((x) => x.kind === k);
                  return (
                    <li key={k} className="px-5 py-2.5 text-[13px]">
                      <span className="block font-medium text-[#101828]">{ESCALATIONS[k]}</span>
                      {e ? <span className="block"><PcBadge tone={e.decision === "REQUIRED_PENDING" ? "amber" : e.decision === "DONE" ? "green" : "grey"}>{ESCALATION_DECISIONS[e.decision as keyof typeof ESCALATION_DECISIONS]}</PcBadge> <span className="text-[#475467]">{e.rationale}{e.externalRef ? ` · ref ${e.externalRef}` : ""}{e.notifiedAt ? ` · ${fmtDate(e.notifiedAt)}` : ""} · {n(e.decidedById)}</span></span> : <span className={`block ${g.serious ? "font-semibold text-[#b42318]" : "text-[#667085]"}`}>Not yet considered</span>}
                    </li>
                  );
                })}
              </ul>
              {g.can.escalate ? (
                <details className="border-t border-[#eaecf0] px-5 py-3">
                  <summary className="cursor-pointer text-[13.5px] font-semibold text-module">Record a decision</summary>
                  <form action={escalationAction} className="mt-2 space-y-2">
                    {base}
                    <select name="kind" className="input" aria-label="Escalation question" defaultValue="">{<option value="" disabled>Which question…</option>}{Object.entries(ESCALATIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <select name="decision" className="input" aria-label="Decision" defaultValue=""><option value="" disabled>Decision…</option>{Object.entries(ESCALATION_DECISIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <textarea name="rationale" className="input" rows={2} placeholder="Reasons" aria-label="Reasons" required minLength={10} />
                    <div className="grid grid-cols-2 gap-2"><input name="externalRef" className="input" placeholder="Reference (optional)" aria-label="External reference" /><input type="date" name="notifiedOn" className="input" aria-label="Date notified" max={today} /></div>
                    <button className="pc-btn-secondary pc-btn-sm" type="submit">Save decision</button>
                  </form>
                </details>
              ) : null}
            </Panel>

            {hasOrgPermission(ctx, "cqc.view") ? (
              <Panel title="CQC evidence" testId="rca-cqc">
                {g.cqcLinks.length ? <ul className="divide-y divide-[#eaecf0]">{g.cqcLinks.map((l) => <li key={l.id} className="flex items-center gap-2 px-5 py-2 text-[13px]"><span className="flex-1"><span className="text-[#667085]">{l.criterion.code}</span> {l.criterion.title}</span><PcBadge tone={LINK_TONE[l.effective] ?? "grey"}>{LINK_STATUS[l.effective]}</PcBadge></li>)}</ul> : <p className="px-5 py-3 text-[13px] text-[#667085]">Not linked to any CQC area.</p>}
                <p className="border-t border-[#eaecf0] px-5 py-2 text-[12px] text-[#667085]">An investigation counts as evidence only after a manager confirms its findings and a reviewer verifies the link. Closing it does not change any score.</p>
                {criteria.length ? (
                  <details className="border-t border-[#eaecf0] px-5 py-3">
                    <summary className="cursor-pointer text-[13.5px] font-semibold text-module">Offer as evidence for CQC areas</summary>
                    <form action={linkRcaCqcAction} className="mt-2 space-y-2">
                      {base}
                      <select name="criterionId" multiple className="input h-40" aria-label="CQC areas">{criteria.filter((c) => !linkedCriteria.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.code} {c.title} ({KQ_LABEL[c.keyQuestion as KeyQuestion]})</option>)}</select>
                      <input name="note" className="input" placeholder="What it shows (optional)" aria-label="Note" />
                      <button className="pc-btn-secondary pc-btn-sm" type="submit">Link</button>
                    </form>
                  </details>
                ) : null}
              </Panel>
            ) : null}

            <Panel title="Who has been told" testId="rca-notifications">
              {g.notifications.length ? (
                <ul className="max-h-[260px] divide-y divide-[#eaecf0] overflow-y-auto">
                  {g.notifications.map((x) => (
                    <li key={x.id} className="px-5 py-2 text-[12.5px]">
                      <span className="block font-medium text-[#101828]">{x.title}</span>
                      <span className="block text-[#475467]">{n(x.userId)} · {fmtDate(x.createdAt, true)} · {x.readAt ? "read in CSB" : "unread in CSB"}{x.deliveries.map((d) => ` · ${DELIVERY[d.status] ?? d.status}${d.status === "FAILED" ? ` (${d.attempts} tries)` : ""}`).join("")}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="px-5 py-3 text-[13px] text-[#667085]">No notifications sent yet.</p>}
            </Panel>

            <Panel title="History">
              <ol className="max-h-[340px] divide-y divide-[#eaecf0] overflow-y-auto" data-testid="rca-history">
                {g.history.map((h) => <li key={h.id} className="px-5 py-2 text-[12.5px]"><span className="font-medium text-[#101828]">{HISTORY[h.action] ?? h.action}</span><span className="block text-[#667085]">{n(h.actorId)} · {fmtDate(h.createdAt, true)}</span></li>)}
              </ol>
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}

function defaultStep(status: string) {
  return status === "AWAITING_REVIEW" ? "6" : status === "ACTIONS_IN_PROGRESS" ? "5" : status === "EFFECTIVENESS_REVIEW" || status === "CLOSED" ? "7" : "1";
}

type Rca = Awaited<ReturnType<typeof getRca>>;

/** The incidents and missed calls being investigated, shown in place so nobody has to search for them. */
function LinkedRecords({ g }: { g: Rca }) {
  const others = g.sources.filter((s) => s.sourceType !== "INCIDENT" && s.sourceType !== "MISSED_CALL");
  if (!g.sources.length) return <p className="text-[#667085]">Not linked to an existing record. Link the incident, missed call, audit finding or risk below if there is one.</p>;
  return (
    <div className="space-y-2" data-testid="rca-sources">
      <h3 className="pc-panel-title">Records being investigated</h3>
      {g.incidents.map((i) => (
        <div key={i.id} className="rounded-lg border border-[#eaecf0] bg-[#fcfcfd] px-4 py-3 text-[13.5px]">
          <div className="flex flex-wrap items-center gap-2"><Link href={`/rota/incidents/${i.id}`} className="pc-strong">Incident {i.reference}</Link><span className="text-[#475467]">{i.category} · {fmtDate(i.occurredAt, true)} · {i.status}</span>{i.safeguarding ? <PcBadge tone="red">Safeguarding</PcBadge> : null}{i.notifiable ? <PcBadge tone="amber">Notifiable</PcBadge> : null}</div>
          <p className="mt-1 text-[#344054]">{i.description}</p>
          {i.immediateAction ? <p className="text-[#475467]">Immediate action: {i.immediateAction}</p> : null}
          {i.outcome ? <p className="text-[#475467]">Outcome: {i.outcome}</p> : null}
        </div>
      ))}
      {g.missed.map((m) => (
        <div key={m.id} className="rounded-lg border border-[#eaecf0] bg-[#fcfcfd] px-4 py-3 text-[13.5px]">
          <div className="flex flex-wrap items-center gap-2"><Link href={`/rota/missed/${m.id}`} className="pc-strong">Missed call, visit {m.visit.reference}</Link><span className="text-[#475467]">{fmtDate(m.scheduledStart, true)} · {m.signedOffAt ? "signed off" : m.stage}</span>{m.preventable ? <PcBadge tone="amber">Preventable</PcBadge> : null}</div>
          {m.reasonDetail || m.reasonCode ? <p className="mt-1 text-[#344054]">Reason: {m.reasonDetail || m.reasonCode}</p> : null}
          {m.findings ? <p className="text-[#475467]">Findings: {m.findings}</p> : null}
          {m.outcome ? <p className="text-[#475467]">Outcome: {m.outcome}</p> : null}
        </div>
      ))}
      {others.map((s) => <p key={s.id} className="rounded-lg border border-[#eaecf0] px-4 py-2 text-[13.5px]"><strong>{SOURCE_KINDS[s.sourceType as keyof typeof SOURCE_KINDS] ?? s.sourceType}</strong> {s.sourceRef}{s.externalRef ? ` · ref ${s.externalRef}` : ""}</p>)}
    </div>
  );
}

function ReviewList({ g, n }: { g: Rca; n: (id: string | null | undefined) => string }) {
  if (!g.reviews.length) return null;
  const stage: Record<string, string> = { SUBMISSION: "Submitted", MANAGER_REVIEW: "Management review", EFFECTIVENESS: "Effectiveness review", CLOSURE: "Closure", REOPEN: "Reopened" };
  const label: Record<string, string> = { SUBMITTED: "Sent for review", APPROVED: "Approved", CLOSED: "Closed", CLOSED_BY_EXCEPTION: "Closed by approved exception", REOPENED: "Reopened", MORE_INVESTIGATION: "More investigation needed", EFFECTIVE: "Effective", PARTIALLY_EFFECTIVE: "Partially effective", INEFFECTIVE: "Ineffective", AWAITING_VERIFICATION: "Awaiting verification" };
  return (
    <div className="border-t border-[#eaecf0] pt-3">
      <h3 className="pc-panel-title mb-2">Reviews and decisions</h3>
      <ul className="space-y-2" data-testid="rca-reviews">
        {g.reviews.map((x) => <li key={x.id} className="text-[13.5px]"><strong>{stage[x.stage] ?? x.stage}: {label[x.decision] ?? x.decision}</strong> · {n(x.reviewerId)} · {fmtDate(x.createdAt, true)}<span className="block text-[#475467]">{x.note}</span></li>)}
      </ul>
    </div>
  );
}
