import { CalendarPlus, WarningCircle } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { fmtLondonDate, isIsoDate, londonTime, mondayOf } from "@/lib/london";
import { durationLabel } from "@/lib/rota-pattern";
import { placeLabel } from "@/lib/carer-places";
import { FUTURE_ROTA_MAX_WEEKS, type previewServiceUserRota } from "@/server/rota/build";
import { confirmServiceUserRotaAction } from "@/app/rota-actions";

type Preview = Awaited<ReturnType<typeof previewServiceUserRota>>;

const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-module";
const TH = "whitespace-nowrap px-2 py-2 text-left text-body font-bold text-[#101828]";
const TD = "px-2 py-2 align-top";
const BTN = `inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-body font-semibold text-[#101828] no-underline hover:bg-slate-50 ${FOCUS}`;
const PRIMARY = `inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#4b1f9e] px-4 text-body font-semibold text-white hover:bg-[#3d1883] ${FOCUS}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Create Future Rota for one service user: choose the first week and how many weeks, preview exactly what will be
 * created from their active templates, then create it. Existing visits are never duplicated or changed.
 */
export function ServiceUserFutureRota({ base, from, weeks, thisMonday, preview, error }: { base: string; from: string; weeks: number; thisMonday: string; preview: Preview | null; error: string | null }) {
  const close = `${base}?tab=rota&week=${from}`;
  return (
    <section aria-labelledby="su-future-h" className="mb-4 rounded-[12px] border border-[#d6cbf2] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.06)]" data-testid="future-rota">
      <div className="flex flex-wrap items-center gap-2 border-b border-[#eaecf0] px-4 py-3">
        <h2 id="su-future-h" className="mr-2 flex items-center gap-2 text-subtitle font-bold text-[#101828]"><CalendarPlus size={20} aria-hidden />Create Future Rota</h2>
        <form method="get" action={base} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="tab" value="rota" />
          <input type="hidden" name="future" value="1" />
          <label className="text-meta text-[#344054]">
            <span className="block font-semibold">First week</span>
            <input type="date" name="from" defaultValue={from} min={thisMonday} required className={`h-9 rounded-[8px] border border-[#d0d5dd] px-2 text-body ${FOCUS}`} />
          </label>
          <label className="text-meta text-[#344054]">
            <span className="block font-semibold">Number of weeks</span>
            <select name="nweeks" defaultValue={String(weeks)} className={`h-9 rounded-[8px] border border-[#d0d5dd] bg-white px-2 text-body ${FOCUS}`}>
              {Array.from({ length: FUTURE_ROTA_MAX_WEEKS }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{plural(n, "week")}</option>)}
            </select>
          </label>
          <button className={BTN}>Preview</button>
        </form>
        <Link href={close} className={`${BTN} ml-auto`}>Close</Link>
      </div>
      <div className="px-4 py-3 text-body">
        <p className="text-body text-[#475467]">Visits are created from this person&apos;s active templates only, with the same checks as Build Rota. A visit that is already on the rota is never duplicated or changed, absences are skipped, and every carer is checked first. New visits are not published until you publish them.</p>
        {error ? (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-[8px] border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-[#b42318]"><WarningCircle size={18} weight="fill" aria-hidden className="mt-0.5 shrink-0" />{error}</p>
        ) : preview ? (
          <PreviewBody base={base} preview={preview} close={close} />
        ) : null}
      </div>
    </section>
  );
}

function PreviewBody({ base, preview, close }: { base: string; preview: Preview; close: string }) {
  const t = preview.totals;
  const last = preview.plans[preview.plans.length - 1]!;
  const span = `${fmtLondonDate(preview.weekStart, { day: "numeric", month: "long" })} to ${fmtLondonDate(last.weekEnd, { day: "numeric", month: "long", year: "numeric" })}`;
  return (
    <>
      <p className="mt-3 font-semibold text-[#101828]" data-testid="future-summary">
        {span}: {plural(t.create, "new visit")} to create{t.alreadyBuilt ? `, ${plural(t.alreadyBuilt, "visit")} already on the rota` : ""}{t.skipped ? `, ${t.skipped} skipped` : ""}.
        {t.unassignedSlots ? <span className="font-normal text-[#93370d]"> {plural(t.unassignedSlots, "carer place")} will be left open.</span> : null}
        {t.flaggedSlots ? <span className="font-normal text-[#93370d]"> {plural(t.flaggedSlots, "carer")} will need review.</span> : null}
      </p>
      {!preview.activeTemplates ? <p className="mt-2 text-[#475467]">{preview.serviceUser.name} has no active templates. <Link href={`${base}?tab=template`}>Open the Template tab</Link> to add one.</p> : null}
      <div className="relative mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-body" data-testid="future-table">
          <caption className="sr-only">Visits that Create Future Rota will add, {span}</caption>
          <thead>
            <tr className="border-y border-[#eaecf0] bg-[#fcfcfd]">
              <th scope="col" className={TH}>Week</th>
              <th scope="col" className={TH}>Date</th>
              <th scope="col" className={TH}>Time</th>
              <th scope="col" className={TH}>Duration</th>
              <th scope="col" className={TH}>Call</th>
              <th scope="col" className={TH}>Carers</th>
              <th scope="col" className={TH}>Result</th>
            </tr>
          </thead>
          <tbody>
            {preview.plans.flatMap((p) => [
              ...p.visits.map((v) => (
                <tr key={`${v.templateId}|${v.date}`} className="border-b border-[#f2f4f7]" data-result="create">
                  <td className={`${TD} whitespace-nowrap`}>Week {p.cycleWeek}</td>
                  <td className={`${TD} whitespace-nowrap`}>{fmtLondonDate(v.date, { weekday: "short", day: "numeric", month: "short" })}</td>
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>{londonTime(v.start)}–{londonTime(v.end)}</td>
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>{durationLabel(v.durationMin)}</td>
                  <td className={TD}>{v.callType}</td>
                  <td className={TD}>
                    <ul className="space-y-0.5">
                      {v.slots.map((s) => (
                        <li key={s.slot} className="text-body">
                          <span className="text-[#667085]">{placeLabel(s.slot)}:</span>{" "}
                          {s.state === "UNASSIGNED" ? <span className="font-semibold text-[#b42318]">Open{s.reason ? ` (${s.reason})` : ""}</span> : <>{s.staffName}{s.state === "FLAGGED" ? <span className="text-[#93370d]"> (needs review{s.reason ? `: ${s.reason}` : ""})</span> : null}</>}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className={TD}>Will be created</td>
                </tr>
              )),
              ...p.skipped.map((s) => (
                <tr key={`skip-${s.templateId}|${s.date}`} className="border-b border-[#f2f4f7] text-[#667085]" data-result="skipped">
                  <td className={`${TD} whitespace-nowrap`}>Week {p.cycleWeek}</td>
                  <td className={`${TD} whitespace-nowrap`}>{fmtLondonDate(s.date, { weekday: "short", day: "numeric", month: "short" })}</td>
                  <td className={TD} colSpan={4}>Not created</td>
                  <td className={TD}>Skipped: {s.reason}</td>
                </tr>
              )),
            ])}
            {!t.create && !t.skipped ? (
              <tr><td colSpan={7} className={`${TD} text-[#475467]`}>Nothing new to create in these weeks{t.alreadyBuilt ? ": every visit is already on the rota" : ""}.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {t.create ? (
        <form action={confirmServiceUserRotaAction} className="mt-3 flex flex-wrap items-center gap-3 border-t border-[#eaecf0] pt-3">
          <input type="hidden" name="serviceUserId" value={preview.serviceUser.id} />
          <input type="hidden" name="weekStart" value={preview.weekStart} />
          <input type="hidden" name="weeks" value={preview.weeks} />
          <input type="hidden" name="fingerprint" value={preview.fingerprint} />
          <input type="hidden" name="back" value={`${base}?tab=rota&future=1&from=${preview.weekStart}&nweeks=${preview.weeks}`} />
          <label className="flex items-center gap-2 text-body">
            <input type="checkbox" name="publish" value="1" className={`h-4 w-4 accent-[#4b1f9e] ${FOCUS}`} />
            Publish to carers now (linked carers are told in the app)
          </label>
          <span className="ml-auto flex gap-2">
            <Link href={close} className={BTN}>Cancel</Link>
            <button className={PRIMARY}>Create {plural(t.create, "visit")}</button>
          </span>
        </form>
      ) : null}
    </>
  );
}

/** The form's starting values: the Monday of the chosen week (never before this week) and 1 to 8 weeks, 4 by default. */
export function futureRotaDefaults(sp: { from?: string; nweeks?: string }, weekShown: string, thisMonday: string) {
  const weeks = Math.min(FUTURE_ROTA_MAX_WEEKS, Math.max(1, Number.parseInt(sp.nweeks ?? "", 10) || 4));
  const chosen = sp.from && isIsoDate(sp.from) ? mondayOf(sp.from) : weekShown;
  return { from: chosen < thisMonday ? thisMonday : chosen, weeks };
}
