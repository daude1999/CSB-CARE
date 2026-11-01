import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { NotFoundError } from "@/lib/errors";
import { BAND_LABEL, CONTROL_EFFECTIVENESS, getRisk, REVIEW_MONTHS, RISK_CATEGORIES, RISK_STATUS, riskBand, riskReviewOverdue } from "@/server/compliance/risks";
import { evidenceFor } from "@/server/compliance/evidence";
import { memberNames } from "@/server/rota/queries";
import { createActionAction } from "@/app/actions";
import { closeRiskAction, reopenRiskAction, reviewRiskAction, updateRiskAction, uploadLinkedEvidenceAction } from "@/app/compliance-actions";
import { RatingChip, RiskFormFields } from "@/components/risk-register-ui";
import { EvidenceList, EvidenceUpload } from "@/components/evidence-ui";
import { Badge, Card, Empty, Field, Flash, fmtDate, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { CREATED: "Recorded", UPDATED: "Changed", REVIEWED: "Management review", CLOSED: "Closed", REOPENED: "Reopened" };
const FIELD: Record<string, string> = { title: "title", description: "description", category: "category", branchId: "scope", likelihood: "inherent likelihood", impact: "inherent impact", existingControls: "controls", controlEffectiveness: "control effectiveness", residualLikelihood: "residual likelihood", residualImpact: "residual impact", ownerId: "owner", reviewDate: "review date", status: "status", nextReviewDate: "next review", inherent: "inherent rating", residual: "residual rating", actionId: "action" };

/** One risk: its scores, controls, owner, mitigation actions, evidence, management reviews and full history. */
export default async function RiskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "risk.view")) notFound();
  const risk = await getRisk(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const orgId = ctx.organisationId!;
  const canManage = hasOrgPermission(ctx, "risk.manage");
  const canAct = hasOrgPermission(ctx, "action.manage");
  const canReadEvidence = hasOrgPermission(ctx, "evidence.read");
  const [branches, members, evidence] = await Promise.all([
    db.branch.findMany({ where: { organisationId: orgId, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.membership.findMany({ where: { organisationId: orgId, user: { deactivatedAt: null } }, select: { userId: true, user: { select: { name: true } } }, orderBy: { user: { name: "asc" } } }),
    canReadEvidence ? evidenceFor(ctx, "RISK", [risk.id]) : Promise.resolve([]),
  ]);
  const names = await memberNames(ctx, [risk.ownerId, risk.lastReviewedById, ...risk.events.map((e) => e.actorId), ...risk.actions.map((a) => a.ownerId)]);
  const back = `/compliance/risks/${risk.id}`;
  const branch = risk.branchId ? (branches.find((b) => b.id === risk.branchId)?.name ?? "A branch") : "Whole organisation";
  const closed = risk.status === "CLOSED";
  const overdue = riskReviewOverdue(risk);
  const now = new Date();
  const band = riskBand(risk.residual);
  const show = (k: string, v: unknown) => (k === "ownerId" ? (names.get(String(v)) ?? "a member") : k === "category" ? (RISK_CATEGORIES[String(v) as keyof typeof RISK_CATEGORIES] ?? String(v)) : k === "branchId" ? (v ? (branches.find((b) => b.id === v)?.name ?? "a branch") : "whole organisation") : k === "controlEffectiveness" ? CONTROL_EFFECTIVENESS[String(v) as keyof typeof CONTROL_EFFECTIVENESS] : String(v ?? "—"));

  return (
    <>
      <CompliancePageHeader back="/compliance/risks" title={`${risk.ref} ${risk.title}`} subtitle={`${RISK_CATEGORIES[risk.category as keyof typeof RISK_CATEGORIES] ?? risk.category} · ${branch} · owned by ${names.get(risk.ownerId) ?? "a member"}`} actions={<span className="flex flex-wrap items-center gap-2"><Badge tone={closed ? "slate" : risk.status === "MONITORING" ? "teal" : "amber"}>{RISK_STATUS[risk.status as keyof typeof RISK_STATUS]}</Badge>{overdue ? <Badge tone="rose">Review overdue</Badge> : null}</span>} />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-3">
          <Card title="The risk">
            <p className="whitespace-pre-line text-[14.5px] text-slate-800">{risk.description}</p>
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
              <Field label="Inherent (before controls)"><RatingChip score={risk.inherent} /> <span className="text-[12.5px] text-slate-600">L{risk.likelihood} x I{risk.impact}</span></Field>
              <Field label="Residual (with controls)"><RatingChip score={risk.residual} /> <span className="text-[12.5px] text-slate-600">L{risk.residualLikelihood} x I{risk.residualImpact}</span></Field>
              <Field label="Next review"><span className={overdue ? "font-medium text-[#a3242c]" : ""}>{fmtDate(risk.reviewDate)}</span><div className="text-[12px] text-slate-600">At least every {REVIEW_MONTHS[band] === 1 ? "month" : `${REVIEW_MONTHS[band]} months`} for a {BAND_LABEL[band]} risk</div></Field>
              <Field label="Last management review">{risk.lastReviewedAt ? `${fmtDate(risk.lastReviewedAt)} by ${names.get(risk.lastReviewedById ?? "") ?? "a member"}` : "Not reviewed yet"}</Field>
            </div>
            <h3 className="mt-5 text-[14px] font-semibold text-slate-800">Existing controls <span className="ml-1 font-normal text-slate-600">({CONTROL_EFFECTIVENESS[risk.controlEffectiveness as keyof typeof CONTROL_EFFECTIVENESS]})</span></h3>
            <p className="mt-1 whitespace-pre-line text-[14px] text-slate-800">{risk.existingControls}</p>
            {risk.finding ? <p className="mt-4 rounded-[3px] bg-[#f5f9fc] px-3 py-2 text-[13.5px]">Raised from a finding in <Link href={`/audits/${risk.finding.audit.id}#findings`}>{risk.finding.audit.title}</Link>: {risk.finding.description}</p> : null}
            {closed ? <p className="mt-4 rounded-[3px] bg-slate-100 px-3 py-2 text-[13.5px]">Closed {fmtDate(risk.closedAt)}: {risk.closedReason}</p> : null}
          </Card>

          <Card title={`Mitigation actions (${risk.actions.length})`}>
            {risk.actions.length ? (
              <ul className="rows">
                {risk.actions.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[14px]">
                    <span><Link href={`/actions/${a.id}`} className="row-title">{a.title}</Link> <span className="text-[13px] text-slate-600">· {names.get(a.ownerId) ?? "a member"} · due {fmtDate(a.dueDate)}</span></span>
                    <span className="flex gap-1"><StatusBadge status={a.status} />{["OPEN", "IN_PROGRESS"].includes(a.status) && a.dueDate < now ? <Badge tone="rose">Overdue</Badge> : null}</span>
                  </li>
                ))}
              </ul>
            ) : <Empty>No mitigation actions yet.</Empty>}
            {canAct && !closed ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-[14px] text-[#0646b1]">Add a mitigation action</summary>
                <form action={createActionAction} className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
                  <input type="hidden" name="back" value={back} /><input type="hidden" name="riskId" value={risk.id} />
                  <label className="md:col-span-3"><span className="label">Action</span><input name="title" required minLength={3} className="input" /></label>
                  <label className="md:col-span-3"><span className="label">Details</span><textarea name="description" rows={2} className="input" /></label>
                  <label><span className="label">Owner</span><select name="ownerId" required className="input">{members.map((m) => <option key={m.userId} value={m.userId}>{m.user.name}</option>)}</select></label>
                  <label><span className="label">Due</span><input type="date" name="dueDate" required className="input" /></label>
                  <div className="flex items-end"><button className="btn-primary">Add action</button></div>
                </form>
              </details>
            ) : null}
          </Card>

          <Card title="History">
            <ol className="space-y-3 border-l border-slate-300 pl-4 text-[13.5px]">
              {risk.events.map((e) => {
                const changes = Object.entries((e.changes ?? {}) as Record<string, unknown>);
                return (
                  <li key={e.id}>
                    <div><span className="tabular-nums text-slate-600">{fmtDate(e.createdAt, true)}</span> · <span className="font-medium">{KIND[e.kind] ?? e.kind}</span> <span className="text-slate-600">by {names.get(e.actorId) ?? "a member"}</span></div>
                    {e.note ? <p className="text-slate-800">{e.note}</p> : null}
                    {changes.length && e.kind === "UPDATED" ? (
                      <ul className="mt-0.5 text-[12.5px] text-slate-600">{changes.filter(([k]) => k !== "actionId").map(([k, v]) => {
                        const c = v as { from?: unknown; to?: unknown };
                        return <li key={k}>{FIELD[k] ?? k}: {k === "description" || k === "existingControls" ? "edited" : `${show(k, c.from)} → ${show(k, c.to)}`}</li>;
                      })}</ul>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        <div className="space-y-3">
          {canManage && !closed ? (
            <Card title="Record a management review">
              <form action={reviewRiskAction} className="space-y-2">
                <input type="hidden" name="back" value={back} /><input type="hidden" name="riskId" value={risk.id} />
                <label className="block"><span className="label">What the review found</span><textarea name="note" required minLength={10} rows={3} className="input" placeholder="Are the controls working? Has anything changed?" /></label>
                <label className="block"><span className="label">Next review</span><input type="date" name="nextReviewDate" required className="input" /></label>
                <label className="block"><span className="label">Status</span><select name="status" defaultValue={risk.status} className="input"><option value="OPEN">Open: needs further action</option><option value="MONITORING">Monitoring: controls in place, watching</option></select></label>
                <button className="btn-primary">Record review</button>
              </form>
            </Card>
          ) : null}
          {canReadEvidence ? (
            <Card title={`Evidence (${evidence.length})`}>
              <EvidenceList docs={evidence} />
              {hasOrgPermission(ctx, "evidence.upload") && !closed ? <EvidenceUpload action={uploadLinkedEvidenceAction} back={back} linkedType="RISK" linkedId={risk.id} /> : null}
            </Card>
          ) : null}
          {canManage && !closed ? (
            <Card title="Change the risk">
              <details>
                <summary className="cursor-pointer text-[14px] text-[#0646b1]">Edit scores, controls, owner or review date</summary>
                <form action={updateRiskAction} className="mt-3 space-y-3">
                  <input type="hidden" name="back" value={back} /><input type="hidden" name="riskId" value={risk.id} /><input type="hidden" name="updatedAt" value={risk.updatedAt.toISOString()} />
                  <RiskFormFields risk={risk} branches={branches} members={members.map((m) => ({ userId: m.userId, name: m.user.name }))} branchRequired={Boolean(ctx.branchIds)} />
                  <label className="block"><span className="label">Reason for the change (needed when scores, controls, owner or scope change)</span><textarea name="reason" rows={2} className="input" /></label>
                  <button className="btn-primary">Save changes</button>
                </form>
              </details>
            </Card>
          ) : null}
          {canManage ? (
            <Card title={closed ? "Reopen the risk" : "Close the risk"}>
              <form action={closed ? reopenRiskAction : closeRiskAction} className="space-y-2">
                <input type="hidden" name="back" value={back} /><input type="hidden" name="riskId" value={risk.id} />
                <label className="block"><span className="label">{closed ? "Why it is being reopened" : "Why the risk can be closed"}</span><textarea name="reason" required minLength={closed ? 5 : 10} rows={2} className="input" /></label>
                <button className="btn-secondary">{closed ? "Reopen" : "Close risk"}</button>
                {!closed ? <p className="text-[12.5px] text-slate-600">A risk with mitigation actions that are not yet verified cannot be closed.</p> : null}
              </form>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
