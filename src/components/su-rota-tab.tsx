import { CalendarPlus, CaretLeft, CaretRight, Eye, NotePencil, Plus, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { addDays, fmtLondonDate, londonTime } from "@/lib/london";
import { durationLabel } from "@/lib/rota-pattern";
import { SU_ROTA_FILTERS, SU_ROTA_FILTER_LABEL, type SuRotaFilter, type serviceUserRota } from "@/server/rota/su-rota";
import { CarerSlots, VisitStatusBadge } from "@/components/rota-ui";

type Rota = Awaited<ReturnType<typeof serviceUserRota>>;

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b2bb5]";
const TH = "whitespace-nowrap px-2 py-2.5 text-left text-[13.5px] font-bold text-[#101828]";
const TD = "px-2 py-2 align-top";
const NAV = `inline-flex h-9 items-center gap-1 rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14px] font-semibold text-[#101828] no-underline hover:bg-slate-50 ${FOCUS}`;
const ACTION = `inline-flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-[13.5px] text-[#5b2bb5] no-underline hover:bg-[#f4f1fd] ${FOCUS}`;
const WARN_TONE: Record<string, string> = { "Manual change": "bg-[#f4f1fd] text-[#4b1f9e]", "Time locked": "bg-[#eef4ff] text-[#1d4f91]", "Not published": "bg-[#f2f4f7] text-[#344054]", "Needs review": "bg-[#fffaeb] text-[#93370d]" };

/**
 * Service User Profile -> Visits -> Rota: the person's actual visits for one week. Same Visit rows as the Daily Rota;
 * planned times and the times carers actually clocked are kept in separate columns so they are never confused.
 */
export function ServiceUserRotaTab({ base, rota, filter, thisMonday, canEdit, canBuild, serviceUserId }: { base: string; rota: Rota; filter: SuRotaFilter; thisMonday: string; canEdit: boolean; canBuild: boolean; serviceUserId: string }) {
  const href = (week: string, f: SuRotaFilter = filter) => `${base}?tab=rota&week=${week}${f !== "all" ? `&status=${f}` : ""}`;
  const range = `${fmtLondonDate(rota.weekStart, { weekday: "long", day: "numeric", month: "long" })} – ${fmtLondonDate(rota.weekEnd, { weekday: "long", day: "numeric", month: "long" })} ${rota.weekEnd.slice(0, 4)}`;
  return (
    <section aria-labelledby="su-rota-h" className="rounded-[12px] border border-[#eaecf0] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#eaecf0] px-4 py-3">
        <h2 id="su-rota-h" className="mr-2 text-[18px] font-bold text-[#101828]">Rota</h2>
        <nav aria-label="Week" className="flex flex-wrap items-center gap-2">
          <Link href={href(addDays(rota.weekStart, -7))} className={NAV}><CaretLeft size={15} weight="bold" aria-hidden />Previous Week</Link>
          <Link href={href(thisMonday)} aria-current={rota.weekStart === thisMonday ? "page" : undefined} className={`${NAV} ${rota.weekStart === thisMonday ? "border-[#4b1f9e] text-[#4b1f9e]" : ""}`}>This Week</Link>
          <Link href={href(addDays(rota.weekStart, 7))} className={NAV}>Next Week<CaretRight size={15} weight="bold" aria-hidden /></Link>
          <form method="get" action={base} className="flex items-center gap-1.5">
            <input type="hidden" name="tab" value="rota" />
            {filter !== "all" ? <input type="hidden" name="status" value={filter} /> : null}
            <label className="sr-only" htmlFor="su-rota-week">Go to the week of</label>
            <input id="su-rota-week" type="date" name="week" defaultValue={rota.weekStart} className={`h-9 rounded-[8px] border border-[#d0d5dd] px-2 text-[14px] ${FOCUS}`} />
            <button className={NAV}>Go</button>
          </form>
        </nav>
        <span className="ml-auto flex flex-wrap gap-2">
          {canBuild ? <Link href={`${base}?tab=rota&week=${rota.weekStart}&future=1&from=${rota.weekStart < thisMonday ? thisMonday : rota.weekStart}`} className={NAV}><CalendarPlus size={16} aria-hidden />Create Future Rota</Link> : null}
          {canEdit ? <Link href={`/rota/visits/new?serviceUserId=${serviceUserId}&date=${rota.weekStart < thisMonday ? thisMonday : rota.weekStart}`} className={NAV}><Plus size={16} weight="bold" aria-hidden />Add Visit</Link> : null}
        </span>
      </div>
      <div className="px-4 pt-3">
        <p className="text-[15px] font-semibold text-[#101828]" data-testid="rota-range">{range} <span className="text-[13.5px] font-normal text-[#667085]">· Week {rota.cycleWeek} of the cycle</span></p>
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Show visits">
          {SU_ROTA_FILTERS.map((f) => (
            <Link key={f} href={href(rota.weekStart, f)} aria-pressed={f === filter} className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13.5px] no-underline ${FOCUS} ${f === filter ? "border-[#4b1f9e] bg-[#4b1f9e] font-semibold text-white" : "border-[#d0d5dd] bg-white text-[#101828] hover:bg-[#f4f1fd]"}`}>
              {SU_ROTA_FILTER_LABEL[f]}<span className={`tabular-nums ${f === filter ? "text-white/85" : "text-[#667085]"}`}>{rota.counts[f]}</span>
            </Link>
          ))}
        </div>
      </div>
      {rota.visits.length ? (
        <div className="relative mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-[14.5px]">
            <caption className="sr-only">Visits from {range}</caption>
            <thead>
              <tr className="border-y border-[#eaecf0] bg-[#fcfcfd]">
                <th scope="col" className={TH}>Date</th>
                <th scope="col" className={TH}>Start</th>
                <th scope="col" className={TH}>End</th>
                <th scope="col" className={TH}>Duration</th>
                <th scope="col" className={TH}>Call</th>
                <th scope="col" className={TH}>Carers</th>
                <th scope="col" className={TH}>Required</th>
                <th scope="col" className={TH}>Actual</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Warnings</th>
                <th scope="col" className={TH}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rota.visits.map((v) => (
                <tr key={v.id} className={`border-b border-[#f2f4f7] last:border-0 ${v.status === "CANCELLED" ? "text-[#667085]" : ""}`} data-visit={v.reference}>
                  <td className={`${TD} whitespace-nowrap`}>{fmtLondonDate(v.date, { weekday: "short", day: "numeric", month: "short" })}</td>
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>{londonTime(v.scheduledStart)}</td>
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>{londonTime(v.scheduledEnd)}</td>
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>{durationLabel(v.durationMin)}</td>
                  <td className={TD}>{v.callType.name}</td>
                  <td className={`${TD} min-w-[150px]`}><CarerSlots assignments={v.assignments} carersRequired={v.carersRequired} cancelled={v.status === "CANCELLED"} /></td>
                  <td className={`${TD} tabular-nums`}>{v.carersRequired}</td>
                  <td className={`${TD} whitespace-nowrap tabular-nums text-[13.5px]`}>{v.actualStart ? `${londonTime(v.actualStart)}–${v.actualEnd ? londonTime(v.actualEnd) : "…"}` : <span className="text-[#98a2b3]">Not recorded</span>}</td>
                  <td className={`${TD} whitespace-nowrap`}><VisitStatusBadge status={v.status} />{v.cancelReason ? <span className="block max-w-[160px] truncate text-[12px] text-[#667085]" title={v.cancelReason}>{v.cancelReason}</span> : null}</td>
                  <td className={`${TD} min-w-[120px]`}>
                    <span className="flex flex-wrap gap-1">
                      {v.warnings.map((w) => <span key={w} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12.5px] font-medium ${WARN_TONE[w] ?? "bg-[#fef3f2] text-[#b42318]"}`}>{WARN_TONE[w] ? null : <WarningCircle size={13} weight="fill" aria-hidden />}{w}</span>)}
                    </span>
                  </td>
                  <td className={`${TD} whitespace-nowrap`}>
                    <span className="flex items-center gap-0.5">
                      <Link href={`/rota/visits/${v.id}`} className={ACTION} title={canEdit && v.status === "SCHEDULED" ? "Open, edit, reassign or cancel this visit" : "Open this visit"}><Eye size={15} aria-hidden />{canEdit && v.status === "SCHEDULED" ? "Open / Edit" : "Open"}</Link>
                      <Link href={`${base}?tab=notes`} className={ACTION}><NotePencil size={15} aria-hidden />Notes</Link>
                      {v.missedCallCase ? <Link href={`/rota/missed/${v.missedCallCase.id}`} className={`${ACTION} text-[#b42318]`}><WarningCircle size={15} aria-hidden />Missed call</Link> : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 pb-5 pt-3 text-[14.5px] text-[#475467]">{filter === "all" ? "No visits this week." : `No ${SU_ROTA_FILTER_LABEL[filter].toLowerCase()} visits this week.`}</p>
      )}
    </section>
  );
}
