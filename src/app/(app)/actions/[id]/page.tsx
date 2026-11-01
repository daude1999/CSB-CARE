import { notFound } from "next/navigation";
import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { NotFoundError } from "@/lib/errors";
import { ACTION_FLOW, actionDetail } from "@/server/compliance/audits";
import { memberNames } from "@/server/rota/queries";
import { progressActionAction } from "@/app/compliance-actions";
import { EvidenceList } from "@/components/evidence-ui";
import { RatingChip } from "@/components/risk-register-ui";
import { Badge, Card, Field, Flash, fmtDate, PageHeader, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

const STEP_LABEL: Record<string, string> = { IN_PROGRESS: "Start work (in progress)", COMPLETED: "Mark completed", VERIFIED: "Verify (independent check)", CLOSED: "Close", OPEN: "Reopen" };
const STAGES = ["OPEN", "IN_PROGRESS", "COMPLETED", "VERIFIED", "CLOSED"] as const;

/**
 * One corrective action from the original problem to the verified outcome: the audit, question and finding (or risk)
 * it came from, what was done, the evidence, who verified it and every step in between.
 */
export default async function ActionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireCtx();
  const a = await actionDetail(ctx, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const names = await memberNames(ctx, [a.ownerId, a.verifiedById, ...a.history.map((h) => h.actorId), ...a.evidence.map((e) => e.uploadedById)]);
  const now = new Date();
  const overdue = ["OPEN", "IN_PROGRESS"].includes(a.status) && a.dueDate < now;
  const next = (ACTION_FLOW[a.status] ?? []).filter((s) => (s === "VERIFIED" || s === "CLOSED" ? a.canVerify : a.canWork));
  const back = `/actions/${a.id}`;
  const stage = STAGES.indexOf(a.status as (typeof STAGES)[number]);

  return (
    <>
      <PageHeader back="/actions" title={a.title} subtitle={`Owned by ${names.get(a.ownerId) ?? "a member"} · due ${fmtDate(a.dueDate)}`} actions={<span className="flex gap-1"><StatusBadge status={a.status} />{overdue ? <Badge tone="rose">Overdue</Badge> : null}</span>} />
      <Flash searchParams={sp} />
      <ol aria-label="Progress" className="panel mb-3 grid grid-cols-5 gap-1 text-center text-[12.5px]">
        {STAGES.map((s, n) => (
          <li key={s} aria-current={n === stage ? "step" : undefined} className="space-y-1">
            <span className={`block h-[6px] rounded-full ${n < stage ? "bg-navy-900" : n === stage ? "bg-[#3289f8]" : "bg-slate-200"}`} />
            <span className={n === stage ? "font-semibold text-navy-900" : "text-slate-600"}>{s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</span>
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-3">
          <Card title="Where it came from">
            {a.finding ? (
              <div className="space-y-2 text-[14px]">
                <p>Audit: <Link href={`/audits/${a.finding.audit.id}`}>{a.finding.audit.title}</Link> <span className="text-[13px] text-slate-600">({a.finding.audit.status === "COMPLETED" ? `completed ${fmtDate(a.finding.audit.completedAt)}` : "in progress"})</span></p>
                {a.question ? <p>Question {a.question.position + 1}: {a.question.text}</p> : null}
                <p className="rounded-[3px] bg-[#f5f9fc] px-3 py-2">Finding <StatusBadge status={a.finding.riskRating} />: {a.finding.description}</p>
              </div>
            ) : a.risk ? (
              <p className="text-[14px]">Mitigation for risk <Link href={`/compliance/risks/${a.risk.id}`}>{a.risk.ref} {a.risk.title}</Link> <RatingChip score={a.risk.residualLikelihood * a.risk.residualImpact} /></p>
            ) : <p className="text-[14px] text-slate-600">Raised directly, not from an audit or a risk.</p>}
            {a.description ? <p className="mt-3 whitespace-pre-line text-[14px] text-slate-800">{a.description}</p> : null}
          </Card>
          <Card title="Outcome">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="What was done">{a.completionNote ?? <span className="text-slate-500">Not completed yet</span>}{a.completedAt ? <div className="text-[12px] text-slate-600">{fmtDate(a.completedAt, true)}</div> : null}</Field>
              <Field label="Independent verification">{a.verifiedAt ? <>{names.get(a.verifiedById ?? "") ?? "A member"}<div className="text-[12px] text-slate-600">{fmtDate(a.verifiedAt, true)}</div></> : <span className="text-slate-500">Not verified yet</span>}</Field>
              <Field label="Closed">{a.closedAt ? fmtDate(a.closedAt, true) : <span className="text-slate-500">Open</span>}</Field>
            </div>
          </Card>
          <Card title="History">
            <ol className="space-y-2 border-l border-slate-300 pl-4 text-[13.5px]">
              {a.history.map((h) => (
                <li key={h.id}><span className="tabular-nums text-slate-600">{fmtDate(h.createdAt, true)}</span> · <span className="font-medium">{h.from ? `${h.from.replace(/_/g, " ").toLowerCase()} → ` : ""}{h.to.replace(/_/g, " ").toLowerCase()}</span> <span className="text-slate-600">by {names.get(h.actorId) ?? "a member"}</span>{h.note ? <span className="text-slate-800">: {h.note}</span> : null}</li>
              ))}
            </ol>
          </Card>
        </div>
        <div className="space-y-3">
          {next.length || (a.canWork && a.status !== "CLOSED") ? (
            <Card title="Next step">
              <form action={progressActionAction} className="space-y-2">
                <input type="hidden" name="back" value={back} /><input type="hidden" name="actionId" value={a.id} />
                <label className="block"><span className="label">Move to</span>
                  <select name="to" className="input" defaultValue={next[0] ?? ""}>
                    {a.canWork ? <option value="">No change, just attach evidence</option> : null}
                    {next.map((s) => <option key={s} value={s}>{a.status === "COMPLETED" && s === "IN_PROGRESS" ? "Send back: not finished" : (STEP_LABEL[s] ?? s)}</option>)}
                  </select>
                </label>
                <label className="block"><span className="label">Note (needed to complete or verify)</span><textarea name="note" rows={3} className="input" placeholder="What was done, or what you checked" /></label>
                {a.canWork ? <label className="block"><span className="label">Attach evidence (optional)</span><input type="file" name="file" accept=".pdf,.docx,.png,.jpg,.jpeg,.txt,.csv" className="block w-full text-[13px]" /></label> : null}
                <button className="btn-primary">Save</button>
                {a.status === "COMPLETED" && !a.canVerify ? <p className="text-[12.5px] text-slate-600">A compliance lead other than the owner verifies this action.</p> : null}
              </form>
            </Card>
          ) : null}
          <Card title={`Evidence (${a.evidence.length})`}>
            <EvidenceList docs={a.evidence} />
            {a.evidence.length ? <p className="mt-2 text-[12px] text-slate-600">Uploaded by {[...new Set(a.evidence.map((e) => names.get(e.uploadedById) ?? "a member"))].join(", ")}.</p> : null}
          </Card>
        </div>
      </div>
    </>
  );
}
