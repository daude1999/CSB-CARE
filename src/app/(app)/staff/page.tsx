import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { Badge, Empty, fmtDate, PageHeader, Panel, Stat, StatRow } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "staff.view")) notFound();
  const orgId = ctx.organisationId!;
  const now = new Date();
  const [members, acks, training] = await Promise.all([
    db.membership.findMany({ where: { organisationId: orgId }, include: { user: { select: { id: true, name: true, email: true } }, branch: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    db.acknowledgement.findMany({ where: { organisationId: orgId }, select: { userId: true, acknowledgedAt: true, dueAt: true } }),
    db.trainingRecord.findMany({ where: { organisationId: orgId }, include: { training: { select: { title: true } } }, orderBy: { completedAt: "desc" } }),
  ]);
  const done = acks.filter((a) => a.acknowledgedAt).length;
  const overdueAll = acks.filter((a) => !a.acknowledgedAt && a.dueAt && a.dueAt < now).length;
  const expired = training.filter((t) => t.expiresAt && t.expiresAt < now).length;
  return (
    <>
      <PageHeader eyebrow="People · reading and training" title="Staff & Training" subtitle="Who has read and signed each published policy, and whose training is in date. Figures come from recorded acknowledgements and training records." />
      <StatRow>
        <Stat label="People" value={members.length} hint="In this organisation" tone="violet" />
        <Stat label="Policies Signed" value={`${acks.length ? Math.round((done / acks.length) * 100) : 100}%`} hint={`${done} of ${acks.length} read and signed`} tone="green" />
        <Stat label="Reading Overdue" value={overdueAll} hint={overdueAll ? "Past the due date" : "None past due"} tone={overdueAll ? "rose" : "navy"} />
        <Stat label="Training Expired" value={expired} hint={expired ? "Needs refreshing" : "All in date"} tone={expired ? "amber" : "navy"} />
      </StatRow>
      <Panel title="My Staff">
      {members.length ? (
        <>
        <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-x-8 px-4 pb-1 text-[13px] text-slate-700 md:grid"><span>Name</span><span>Reading list</span><span>Training</span></div>
        <ul className="rows">
          {members.map((m) => {
            const mine = acks.filter((a) => a.userId === m.userId);
            const read = mine.filter((a) => a.acknowledgedAt).length;
            const overdue = mine.filter((a) => !a.acknowledgedAt && a.dueAt && a.dueAt < now).length;
            const pct = mine.length ? Math.round((read / mine.length) * 100) : 100;
            const tr = training.filter((t) => t.userId === m.userId);
            return (
              <li key={m.id} className="grid items-center gap-x-8 gap-y-3 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
                <div className="flex min-w-0 items-center gap-3">
                  <span aria-hidden="true" className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border-[1.5px] border-slate-500 bg-white text-[13px] font-bold text-slate-800">{m.user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}</span>
                  <div className="min-w-0">
                    <div className="text-[15px] font-medium text-[#1d4f91]">{m.user.name}</div>
                    <div className="text-[13px] text-slate-600">{[m.jobTitle, m.branch?.name.replace(/\s*\(DEMO[^)]*\)/i, "")].filter(Boolean).join(" · ") || m.user.email}</div>
                    <div className="mt-0.5 text-[12px] text-slate-500">{m.roles.map((r) => r.replace(/_/g, " ").toLowerCase()).join(", ")}</div>
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline justify-between text-[13px]"><span className="text-slate-600">{overdue ? <span className="font-medium text-[#a3242c]">{overdue} overdue</span> : pct === 100 ? "All signed" : "In progress"}</span><span className="text-slate-800">{read} of {mine.length}</span></div>
                  <div className="mt-1.5 h-[12px] overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${m.user.name} reading progress`}>
                    <div className={`h-full rounded-full ${overdue ? "bg-[#e4544f]" : pct === 100 ? "bg-[#28b463]" : "bg-[#3289f8]"}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="text-[13px]">
                  {tr.length ? (
                    <ul className="space-y-1">
                      {tr.map((t) => {
                        const lapsed = t.expiresAt && t.expiresAt < now;
                        return <li key={t.id} className="flex flex-wrap items-center gap-x-2 text-slate-800">{t.training.title} {lapsed ? <Badge tone="rose">Expired {fmtDate(t.expiresAt)}</Badge> : <Badge tone="green">{t.expiresAt ? `In date to ${fmtDate(t.expiresAt)}` : `Done ${fmtDate(t.completedAt)}`}</Badge>}</li>;
                      })}
                    </ul>
                  ) : <span className="text-slate-500">No training records</span>}
                </div>
              </li>
            );
          })}
        </ul>
        </>
      ) : (
        <Empty>No staff.</Empty>
      )}
      </Panel>
    </>
  );
}
