import Link from "@/components/link";
import { fmtLondonDate, londonDate, londonTime } from "@/lib/london";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { missedHistory, outcomeLabel, reasonLabel, STAGE_LABEL } from "@/server/rota/missed-calls";
import { Badge, Empty, type Tone } from "@/components/ui";

const STAGE_TONE: Record<string, Tone> = { NEW: "rose", INVESTIGATING: "amber", AWAITING_SIGNOFF: "violet", CLOSED: "green" };

/** Every missed call for one care worker or one service user over the last year, newest first, each opening its case. */
export async function MissedHistory({ ctx, staffId, serviceUserId }: { ctx: Ctx; staffId?: string; serviceUserId?: string }) {
  if (!hasOrgPermission(ctx, "rota.monitor")) return null;
  const h = await missedHistory(ctx, { staffId, serviceUserId });
  const open = h.rows.filter((r) => r.stage !== "CLOSED").length;
  return (
    <section id="missed" aria-labelledby="missed-history" className="card mt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3">
        <h2 id="missed-history" className="text-[16px] font-semibold">Missed calls</h2>
        <span className="text-[13px] text-slate-600">{fmtLondonDate(h.from)} to {fmtLondonDate(h.to)} · {h.rows.length} missed · {open} open · <Link href={`/rota/missed?period=custom&from=${h.from}&to=${h.to}&${staffId ? `carer=${staffId}` : `su=${serviceUserId}`}`}>Open in Missed Calls</Link></span>
      </div>
      {h.rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13.5px]">
            <thead className="text-left text-[12.5px] text-slate-600"><tr><th className="px-4 py-2">Date</th><th className="px-2 py-2">{staffId ? "Service user" : "Care worker"}</th><th className="px-2 py-2">Visit type</th><th className="px-2 py-2">Reason</th><th className="px-2 py-2">Outcome</th><th className="px-2 py-2">Status</th></tr></thead>
            <tbody>
              {h.rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-4 py-1.5 whitespace-nowrap"><Link href={`/rota/missed/${r.id}`}>{fmtLondonDate(londonDate(r.scheduledStart), { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</Link> {londonTime(r.scheduledStart)}</td>
                  <td className="px-2 py-1.5">{staffId ? r.serviceUserName : r.carerName ?? "Unassigned"}</td>
                  <td className="px-2 py-1.5">{r.visit.callType.name}</td>
                  <td className="px-2 py-1.5">{reasonLabel(r.reasonCode) ?? <span className="text-slate-500">Not recorded</span>}</td>
                  <td className="px-2 py-1.5">{outcomeLabel(r.outcome) ?? "—"}</td>
                  <td className="px-2 py-1.5"><Badge tone={STAGE_TONE[r.stage]}>{STAGE_LABEL[r.stage]}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <Empty>No missed calls in the last year.</Empty>}
    </section>
  );
}
