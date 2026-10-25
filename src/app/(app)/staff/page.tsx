import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { Empty, fmtDate, PageHeader } from "@/components/ui";

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
      <dl className="mb-8 grid grid-cols-2 border-y border-slate-300 lg:grid-cols-4">
        <Summary label="People" value={members.length} />
        <Summary label="Policies read and signed" value={`${done}/${acks.length}`} note={acks.length ? `${Math.round((done / acks.length) * 100)}% complete` : "Nothing issued yet"} />
        <Summary label="Reading overdue" value={overdueAll} note={overdueAll ? "Past the due date" : "None past due"} warn={overdueAll > 0} />
        <Summary label="Training expired" value={expired} note={expired ? "Needs refreshing" : "All in date"} warn={expired > 0} />
      </dl>
      {members.length ? (
        <ul className="border-t-2 border-navy-900">
          {members.map((m) => {
            const mine = acks.filter((a) => a.userId === m.userId);
            const read = mine.filter((a) => a.acknowledgedAt).length;
            const overdue = mine.filter((a) => !a.acknowledgedAt && a.dueAt && a.dueAt < now).length;
            const pct = mine.length ? Math.round((read / mine.length) * 100) : 100;
            const tr = training.filter((t) => t.userId === m.userId);
            return (
              <li key={m.id} className="grid gap-x-8 gap-y-3 border-b border-slate-200 py-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
                <div className="flex min-w-0 items-start gap-3">
                  <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-900 font-mono text-xs text-white">{m.user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("")}</span>
                  <div className="min-w-0">
                    <div className="font-serif text-[16px] font-semibold text-navy-900">{m.user.name}</div>
                    <div className="text-xs text-slate-500">{[m.jobTitle, m.branch?.name.replace(/\s*\(DEMO[^)]*\)/i, "")].filter(Boolean).join(" · ") || m.user.email}</div>
                    <div className="mt-1 text-[11px] text-slate-400">{m.roles.map((r) => r.replace(/_/g, " ").toLowerCase()).join(", ")}</div>
                  </div>
                </div>
                <div>
                  <div className="flex items-baseline justify-between text-xs"><span className="text-slate-500">Policies read</span><span className="font-mono text-navy-900">{read} of {mine.length}</span></div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${m.user.name} reading progress`}>
                    <div className={`h-full ${overdue ? "bg-rose-600" : pct === 100 ? "bg-emerald-600" : "bg-teal-500"}`} style={{ width: `${pct}%` }} />
                  </div>
                  {overdue ? <div className="mt-1.5 text-xs font-medium text-rose-700">{overdue} overdue</div> : null}
                </div>
                <div className="text-xs">
                  <div className="mb-1 text-slate-500">Training</div>
                  {tr.length ? (
                    <ul className="space-y-1">
                      {tr.map((t) => {
                        const lapsed = t.expiresAt && t.expiresAt < now;
                        return <li key={t.id} className="text-navy-900">{t.training.title} <span className={lapsed ? "font-medium text-rose-700" : "text-slate-500"}>{lapsed ? `expired ${fmtDate(t.expiresAt)}` : t.expiresAt ? `to ${fmtDate(t.expiresAt)}` : `done ${fmtDate(t.completedAt)}`}</span></li>;
                      })}
                    </ul>
                  ) : <span className="text-slate-400">No records</span>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>No staff.</Empty>
      )}
    </>
  );
}

function Summary({ label, value, note, warn = false }: { label: string; value: number | string; note?: string; warn?: boolean }) {
  return (
    <div className="border-slate-300 px-4 py-4 [&:not(:first-child)]:border-l max-lg:[&:nth-child(3)]:border-l-0 max-lg:[&:nth-child(n+3)]:border-t">
      <dt className="eyebrow">{label}</dt>
      <dd className="figure mt-1.5 text-3xl text-navy-900">{value}</dd>
      {note ? <dd className={`mt-1 text-xs ${warn ? "font-medium text-rose-700" : "text-slate-500"}`}>{note}</dd> : null}
    </div>
  );
}
