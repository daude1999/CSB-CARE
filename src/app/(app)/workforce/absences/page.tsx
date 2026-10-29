import Link from "@/components/link";
import { ForbiddenError } from "@/lib/errors";
import { addDays, fmtLondonDate, londonDate } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { absenceStaff, listAbsences } from "@/server/workforce/absences";
import { memberNames } from "@/server/rota/queries";
import { cancelStaffAbsenceAction, decideAbsenceAction, recordAbsenceAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader, SegmentNav } from "@/components/ui";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { HOLIDAY: "Holiday", SICKNESS: "Sickness", COMPASSIONATE: "Compassionate", TRAINING: "Training", UNPAID: "Unpaid", OTHER: "Other" };
const TONE = { REQUESTED: "amber", APPROVED: "green", DECLINED: "rose", CANCELLED: "slate" } as const;

export default async function AbsencesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("hr");
  let data;
  try {
    data = await listAbsences(ctx, { status: sp.status ?? "REQUESTED", from: sp.from });
  } catch (e) {
    if (e instanceof ForbiddenError) return <><PageHeader title="Holidays & Sickness" back="/hr" /><Card><Empty>{e.message}</Empty></Card></>;
    throw e;
  }
  const { actor, rows } = data;
  const [staff, names] = await Promise.all([absenceStaff(ctx), memberNames(ctx, rows.flatMap((r) => [r.requestedById, r.decidedById]))]);
  const status = sp.status ?? "REQUESTED";
  const back = `/workforce/absences?status=${status}`;
  const today = londonDate();
  const day = (d: Date) => fmtLondonDate(londonDate(d), { weekday: "short", day: "numeric", month: "short" });

  return (
    <>
      <PageHeader title="Holidays & Sickness" back="/hr" subtitle="Staff absences, decided in HR and used by the rota. Holiday and other leave start as requests that someone other than the person who entered them approves. Every decision re-checks the person's booked visits and flags any that clash; nothing is removed automatically." />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div>
          <SegmentNav label="Absence status" items={[["REQUESTED", "Waiting for a decision"], ["APPROVED", "Approved"], ["DECLINED", "Declined"], ["CANCELLED", "Cancelled"], ["ALL", "All"]].map(([k, l]) => ({ href: `/workforce/absences?status=${k}`, label: l!, active: status === k }))} />
          <Card>
            {rows.length ? (
              <ul className="rows">
                {rows.map((r) => (
                  <li key={r.id} className="py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/rota/staff/${r.staff.id}`} className="row-title">{r.staff.displayName}</Link>
                      <span className="text-[13px] text-slate-500">{r.staff.jobTitle}</span>
                      <Badge tone={TONE[r.status]}>{r.status.toLowerCase()}</Badge>
                      <Badge>{KIND[r.kind]}</Badge>
                    </div>
                    <p className="mt-1 text-[14px]">{day(r.startsAt)} to {day(new Date(r.endsAt.getTime() - 1))}{r.reason ? ` · ${r.reason}` : ""}</p>
                    <p className="text-[12.5px] text-slate-500">Entered by {names.get(r.requestedById) ?? "a former member"} on {fmtDate(r.requestedAt, true)}{r.decidedById ? ` · ${r.status.toLowerCase()} by ${names.get(r.decidedById) ?? "a former member"}${r.decisionNote ? `: ${r.decisionNote}` : ""}` : ""}</p>
                    {actor.canEdit && r.status === "REQUESTED" ? (
                      r.requestedById === ctx.userId ? (
                        <p className="mt-1 text-[13px] text-[#8a5a00]">You entered this request, so someone else must decide it.</p>
                      ) : (
                        <form action={decideAbsenceAction} className="mt-2 flex flex-wrap items-center gap-2">
                          <input type="hidden" name="back" value={back} />
                          <input type="hidden" name="absenceId" value={r.id} />
                          <input type="hidden" name="version" value={r.version} />
                          <input name="note" className="input w-64 py-1.5 text-[14px]" placeholder="Note (required to decline)" aria-label="Decision note" />
                          <button className="btn-primary py-1" name="decision" value="APPROVED">Approve</button>
                          <button className="btn-secondary py-1" name="decision" value="DECLINED">Decline</button>
                        </form>
                      )
                    ) : null}
                    {actor.canEdit && (r.status === "APPROVED" || r.status === "REQUESTED") && r.endsAt > new Date() ? (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-[13px] text-[#1d4f91]">Cancel this absence</summary>
                        <form action={cancelStaffAbsenceAction} className="mt-1.5 flex gap-2">
                          <input type="hidden" name="back" value={back} />
                          <input type="hidden" name="absenceId" value={r.id} />
                          <input name="reason" required minLength={3} className="input w-64 py-1.5 text-[14px]" placeholder="Reason" aria-label="Reason for cancelling" />
                          <button className="btn-secondary py-1">Cancel absence</button>
                        </form>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : <Empty>Nothing here for the branches you cover.</Empty>}
          </Card>
        </div>
        {actor.canEdit ? (
          <Card title="Record an absence">
            <form action={recordAbsenceAction} className="space-y-2.5">
              <input type="hidden" name="back" value={back} />
              <label className="block"><span className="label">Member of staff</span><select name="staffId" required className="input"><option value="">Choose…</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.displayName} · {s.jobTitle}</option>)}</select></label>
              <label className="block"><span className="label">Type</span><select name="kind" className="input">{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-2">
                <label><span className="label">First day</span><input type="date" name="from" required defaultValue={addDays(today, 7)} className="input" /></label>
                <label><span className="label">Last day</span><input type="date" name="to" className="input" /></label>
                <label><span className="label">From time (optional)</span><input type="time" name="startTime" className="input" /></label>
                <label><span className="label">Until time (optional)</span><input type="time" name="endTime" className="input" /></label>
              </div>
              <label className="block"><span className="label">Reason or note</span><input name="reason" className="input" /></label>
              <button className="btn-primary">Record</button>
              <p className="text-[12.5px] text-slate-500">Sickness is recorded straight away. Other leave waits for approval. Covering {actor.branches.length} branch{actor.branches.length === 1 ? "" : "es"} as {actor.name}.</p>
            </form>
          </Card>
        ) : <Card><p className="text-[14px]">Your HR role can view absences but not change them.</p></Card>}
      </div>
    </>
  );
}
