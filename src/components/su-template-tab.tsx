import { Fragment } from "react";
import { CaretDown, CheckSquare, ClockCounterClockwise, Copy, Eye, PencilSimple, Plus, Prohibit, CheckCircle, Square } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { hhmm, WEEKDAYS } from "@/lib/london";
import { durationLabel, weekdaysLabel } from "@/lib/rota-pattern";
import type { TemplateListRow } from "@/server/rota/templates";
import { duplicateTemplateAction, templateBulkAction } from "@/app/rota-actions";
import { CoverageBadge, StatusBadge } from "@/components/template-ui";

const SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b2bb5]";
const TH = "whitespace-nowrap px-2 py-2.5 text-left text-[13.5px] font-bold text-[#101828]";
const TD = "px-2 py-2 align-top";
const CHIP = `inline-flex h-9 items-center rounded-full border px-3.5 text-[14px] no-underline ${FOCUS}`;
const ON = "border-[#4b1f9e] bg-[#4b1f9e] font-semibold text-white";
const OFF = "border-[#d0d5dd] bg-white text-[#101828] hover:bg-[#f4f1fd]";
const ACTION = `inline-flex items-center gap-1 rounded-[6px] px-1.5 py-1 text-[13.5px] text-[#5b2bb5] no-underline hover:bg-[#f4f1fd] ${FOCUS}`;

/** Parses "1,3" into sorted, unique whole numbers between 1 and max; anything else is dropped. */
export function parseList(v: string | undefined, max: number) {
  if (!v) return [];
  return [...new Set(v.split(",").map((x) => Number(x)).filter((n) => Number.isInteger(n) && n >= 1 && n <= max))].sort((a, b) => a - b);
}

const listText = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`);

/**
 * Service User Profile -> Visits -> Template: this person's repeating visits, filtered by cycle weeks and days. The
 * rows are the same VisitTemplate records as Daily Templates; every action goes through the existing template actions.
 */
export function ServiceUserTemplateTab({ base, rows, weeks, days, cycleLength, canEdit, serviceUserId, confirmOff }: { base: string; rows: TemplateListRow[]; weeks: number[]; days: number[]; cycleLength: number; canEdit: boolean; serviceUserId: string; confirmOff?: string }) {
  const href = (w: number[], d: number[]) => `${base}?tab=template${w.length ? `&weeks=${w.join(",")}` : ""}${d.length ? `&days=${d.join(",")}` : ""}`;
  const toggle = (list: number[], n: number) => (list.includes(n) ? list.filter((x) => x !== n) : [...list, n].sort((a, b) => a - b));
  const allWeeks = Array.from({ length: cycleLength }, (_, i) => i + 1);
  const back = href(weeks, days);
  const weekText = weeks.length && weeks.length < cycleLength ? listText(weeks.map((w) => `Week ${w}`)) : "all weeks";
  const dayText = days.length && days.length < 7 ? listText(days.map((d) => WEEKDAYS[d - 1]!)) : "every day";
  const filtered = weeks.length > 0 || days.length > 0;

  return (
    <section aria-labelledby="su-template-h" className="rounded-[12px] border border-[#eaecf0] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-[#eaecf0] px-4 py-3">
        <h2 id="su-template-h" className="text-[18px] font-bold text-[#101828]">Template</h2>
        <details key={weeks.join(",") || "all"} className="relative" data-testid="week-select">
          <summary className={`flex h-9 cursor-pointer list-none items-center gap-2 rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14px] font-semibold text-[#101828] hover:bg-slate-50 [&::-webkit-details-marker]:hidden ${FOCUS}`}>
            {weeks.length && weeks.length < cycleLength ? weeks.map((w) => `Week ${w}`).join(", ") : "All Weeks"}<CaretDown size={14} weight="bold" aria-hidden />
          </summary>
          <div role="group" aria-label="Select weeks" className="absolute left-0 z-30 mt-1 w-[200px] overflow-hidden rounded-[10px] border border-[#e4e7ec] bg-white py-1 shadow-[0_8px_24px_rgba(16,24,40,0.14)]">
            <p className="px-3 pb-1 pt-1.5 text-[12.5px] font-semibold uppercase tracking-wide text-[#667085]">Select Weeks</p>
            <Link href={href([], days)} aria-pressed={!weeks.length} className={`flex items-center gap-2 px-3 py-2 text-[14px] text-[#101828] no-underline hover:bg-[#f4f1fd] ${FOCUS}`}>
              {!weeks.length ? <CheckSquare size={18} weight="fill" className="text-[#4b1f9e]" aria-hidden /> : <Square size={18} aria-hidden />}Select All
            </Link>
            {allWeeks.map((w) => {
              const on = weeks.includes(w);
              const next = toggle(weeks, w);
              return (
                <Link key={w} href={href(next.length === cycleLength ? [] : next, days)} aria-pressed={on} className={`flex items-center gap-2 px-3 py-2 text-[14px] text-[#101828] no-underline hover:bg-[#f4f1fd] ${FOCUS}`}>
                  {on ? <CheckSquare size={18} weight="fill" className="text-[#4b1f9e]" aria-hidden /> : <Square size={18} aria-hidden />}Week {w}
                </Link>
              );
            })}
          </div>
        </details>
        {canEdit ? (
          <Link href={`/rota/templates/new?su=${serviceUserId}`} className={`ml-auto inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#4b1f9e] px-4 text-[14px] font-bold text-white no-underline hover:bg-[#3d1880] ${FOCUS}`}><Plus size={17} weight="bold" aria-hidden />Add Template</Link>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3" role="group" aria-label="Days">
        <Link href={href(weeks, [])} aria-pressed={!days.length} className={`${CHIP} ${!days.length ? ON : OFF}`}>All Days</Link>
        {SHORT.map((d, i) => {
          const n = i + 1;
          const on = days.includes(n);
          const next = toggle(days, n);
          return <Link key={d} href={href(weeks, next.length === 7 ? [] : next)} aria-pressed={on} aria-label={`${WEEKDAYS[i]}${on ? ", selected" : ""}`} className={`${CHIP} ${on ? ON : OFF}`}>{d}</Link>;
        })}
        {filtered ? <Link href={href([], [])} className="ml-1 text-[14px] font-medium text-[#5b2bb5]">Clear Filters</Link> : null}
      </div>
      <p className="px-4 pb-2 text-[14px] text-[#344054]" role="status" data-testid="template-summary">
        Showing {rows.length} template{rows.length === 1 ? "" : "s"} for {weekText}, {dayText}.
      </p>
      {rows.length ? (
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-[14.5px]">
            <caption className="sr-only">Repeating visits for {weekText}, {dayText}</caption>
            <thead>
              <tr className="border-y border-[#eaecf0] bg-[#fcfcfd]">
                <th scope="col" className={TH}>Day</th>
                <th scope="col" className={TH}>Week</th>
                <th scope="col" className={TH}>Start</th>
                <th scope="col" className={TH}>End</th>
                <th scope="col" className={TH}>Duration</th>
                <th scope="col" className={TH}>Call</th>
                <th scope="col" className={TH}>Carers</th>
                <th scope="col" className={TH}>Carers Required</th>
                <th scope="col" className={TH}>Status</th>
                <th scope="col" className={TH}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const filled = t.carers.filter(Boolean).length;
                const end = (t.startMinute + t.durationMin) % 1440;
                return (
                  <Fragment key={t.id}>
                  <tr className={`border-b border-[#f2f4f7] last:border-0 ${t.enabled ? "" : "bg-[#fafafa] text-[#667085]"}`}>
                    <td className={`${TD} min-w-[110px]`}>{weekdaysLabel(t.weekdays)}</td>
                    <td className={`${TD} whitespace-nowrap`}>{t.cycleWeeks.length >= cycleLength ? "All weeks" : t.cycleWeeks.map((w) => `Wk ${w}`).join(", ")}</td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>{hhmm(t.startMinute)}</td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>{hhmm(end)}</td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>{durationLabel(t.durationMin)}</td>
                    <td className={`${TD} min-w-[110px]`}>{t.callType.name}</td>
                    <td className={`${TD} min-w-[150px] leading-snug`}>
                      {t.carers.slice(0, t.carersRequired).map((c, i) => (
                        <span key={i} className="block">
                          {t.carersRequired > 1 ? <span className="text-[12.5px] text-[#667085]">Carer {i + 1}: </span> : null}
                          {c ? <span className={c.employmentStatus === "ARCHIVED" || c.hrMissing ? "text-[#b54708]" : ""}>{c.displayName}</span> : <span className="font-semibold text-[#b42318]">No carer</span>}
                        </span>
                      ))}
                    </td>
                    <td className={`${TD} whitespace-nowrap`}><CoverageBadge filled={filled} required={t.carersRequired} /></td>
                    <td className={`${TD} whitespace-nowrap`}><StatusBadge enabled={t.enabled} /></td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <span className="flex items-center gap-0.5">
                        <Link href={`/rota/templates?tpl=${t.id}&su=${serviceUserId}&week=all&day=all&state=all`} className={ACTION}><Eye size={15} aria-hidden />View</Link>
                        {canEdit ? <Link href={`/rota/templates/${t.id}?from=su`} className={ACTION}><PencilSimple size={15} aria-hidden />Edit</Link> : null}
                        {canEdit ? <form action={duplicateTemplateAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="templateId" value={t.id} /><button className={ACTION}><Copy size={15} aria-hidden />Duplicate</button></form> : null}
                        {canEdit ? (
                          t.enabled
                            ? <Link href={`${back}&off=${t.id}`} scroll={false} className={`${ACTION} text-[#b42318]`}><Prohibit size={15} aria-hidden />Deactivate…</Link>
                            : <form action={templateBulkAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="templateIds" value={t.id} /><button name="kind" value="enable" className={`${ACTION} text-[#15803d]`}><CheckCircle size={15} aria-hidden />Activate</button></form>
                        ) : null}
                        <Link href={`/rota/templates/${t.id}?from=su#history`} className={ACTION}><ClockCounterClockwise size={15} aria-hidden />History</Link>
                      </span>
                    </td>
                  </tr>
                  {canEdit && t.enabled && confirmOff === t.id ? (
                    <tr className="border-b border-[#f2f4f7] bg-[#fef3f2]">
                      <td colSpan={10} className="px-3 py-2.5">
                        <form action={templateBulkAction} role="alertdialog" aria-labelledby={`off-${t.id}`} className="flex flex-wrap items-center gap-3">
                          <input type="hidden" name="back" value={back} /><input type="hidden" name="templateIds" value={t.id} />
                          <p id={`off-${t.id}`} className="text-[14px] text-[#7a271a]">Deactivate the {hhmm(t.startMinute)} {t.callType.name}? Build Rota will skip it. Visits already built are not changed.</p>
                          <button name="kind" value="disable" className="btn-primary bg-[#b42318] py-1.5">Deactivate</button>
                          <Link href={back} scroll={false} className="btn-secondary py-1.5">Cancel</Link>
                        </form>
                      </td>
                    </tr>
                  ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 pb-5 pt-1 text-[14.5px] text-[#475467]">{filtered ? "No repeating visits match these weeks and days." : "No repeating visits yet."}{canEdit ? " Use Add Template to set one up." : ""}</p>
      )}
    </section>
  );
}
