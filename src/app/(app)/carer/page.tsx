import { ForbiddenError } from "@/lib/errors";
import { fmtLondonDate, fromDbDate, londonDate, londonTime } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { myVisits } from "@/server/rota/carer";
import { suName } from "@/server/rota/queries";
import { acknowledgeMyVisitsAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, PageHeader } from "@/components/ui";
import { VisitStatusBadge } from "@/components/rota-ui";

export const dynamic = "force-dynamic";

export default async function MyVisitsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  let data;
  try {
    data = await myVisits(ctx);
  } catch (e) {
    if (e instanceof ForbiddenError) return <><PageHeader title="My Visits" back="/overview" /><Card><Empty>{e.message}</Empty></Card></>;
    throw e;
  }
  const { staff, visits } = data;
  const today = londonDate();
  const days = [...new Set(visits.map((v) => fromDbDate(v.date)))];
  const unseen = visits.filter((v) => v.assignments.some((a) => a.staffId === staff.id && !a.acknowledgedAt) && v.date >= new Date(`${today}T00:00:00Z`)).length;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="My Visits" back="/overview" subtitle={`${staff.displayName}. Your published visits. Clocking in and out, task recording and notes from the phone are not built yet; the office records attendance for now.`} />
      <Flash searchParams={sp} />
      {unseen ? (
        <form action={acknowledgeMyVisitsAction} className="panel mb-3 flex flex-wrap items-center justify-between gap-2">
          <input type="hidden" name="back" value="/carer" />
          <p className="text-[14px]"><span className="font-medium">{unseen} new or changed visit{unseen === 1 ? "" : "s"}.</span> Let the office know you have seen them.</p>
          <button className="btn-primary">I have seen my visits</button>
        </form>
      ) : null}
      {days.length ? (
        days.map((d) => (
          <Card key={d} title={d === today ? `Today · ${fmtLondonDate(d, { weekday: "long", day: "numeric", month: "long" })}` : fmtLondonDate(d, { weekday: "long", day: "numeric", month: "long" })} className="mb-3">
            <ul className="rows">
              {visits.filter((v) => fromDbDate(v.date) === d).map((v) => {
                const mine = v.assignments.find((a) => a.staffId === staff.id);
                const partner = v.assignments.find((a) => a.staffId !== staff.id && a.slot !== "SHADOW");
                return (
                  <li key={v.id} className="py-3 text-[14.5px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold tabular-nums">{londonTime(v.scheduledStart)}–{londonTime(v.scheduledEnd)}</span>
                      <span className="font-medium text-navy-900">{suName(v.serviceUser)}</span>
                      <span className="text-slate-600">{v.callType.name}</span>
                      <span className="ml-auto flex gap-1"><VisitStatusBadge status={v.status} />{mine && !mine.acknowledgedAt ? <Badge tone="amber">New</Badge> : null}</span>
                    </div>
                    <p className="text-slate-600">{[v.serviceUser.addressLine1, v.serviceUser.town, v.serviceUser.postcode].filter(Boolean).join(", ")}</p>
                    {partner ? <p className="text-[13.5px]">With {partner.staff.displayName}</p> : null}
                    {mine?.slot === "SHADOW" ? <p className="text-[13.5px]">You are shadowing on this visit.</p> : null}
                    {v.serviceUser.accessNotes ? <p className="mt-1 text-[13.5px] text-slate-700">Getting in: {v.serviceUser.accessNotes}</p> : null}
                    {v.tasks.length ? <p className="mt-1 text-[13.5px] text-slate-700">Tasks: {v.tasks.map((t) => t.name).join(", ")}</p> : null}
                    {v.medicationRequired ? <p className="text-[13px] text-slate-500">Medication prompt only. Follow the paper MAR chart; eMAR is not in use.</p> : null}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))
      ) : (
        <Card><Empty>No published visits for you in this period.</Empty></Card>
      )}
    </div>
  );
}
