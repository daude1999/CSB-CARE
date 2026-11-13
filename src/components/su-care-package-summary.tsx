import Link from "@/components/link";
import { Money } from "@phosphor-icons/react/dist/ssr";
import { fmtDate } from "@/components/ui";
import { hoursPerWeek, type CarePackageSummary } from "@/server/care/package-view";

/**
 * The Overview's Care Package card: a short summary from the structured package fields, the person's repeating
 * visits and stored review items. The package's requirements text is not passed in; it is shown in full on the
 * Care Package tab instead.
 */
export function CarePackageSummaryCard({ summary, href, canEdit, className = "" }: { summary: CarePackageSummary | null; href: string; canEdit: boolean; className?: string }) {
  return (
    <section aria-labelledby="pkg-summary-h" className={`hb-pn hb-c-orange ${className}`} data-testid="care-package-summary">
      <div className="hb-pn-h">
        <Money size={15} weight="bold" aria-hidden="true" />
        <h2 id="pkg-summary-h">Care package</h2>
        <span className="hb-sp" />
        {summary ? <span className="hb-pn-act">{summary.status === "ACTIVE" ? "Active" : "Ended"}</span> : null}
      </div>
      <div className="hb-pn-b">
      {summary ? (
        <>
          <p className="break-words text-[15px] font-semibold text-[#1d2939]" data-testid="package-reference">
            {summary.reference ?? <span className="font-normal text-slate-500">Reference not recorded</span>}
          </p>
          <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 text-[14px] min-[400px]:grid-cols-2">
            <div>
              <dt className="text-[12.5px] text-slate-600">Commissioned care</dt>
              <dd className="font-medium tabular-nums text-[#1d2939]">{hoursPerWeek(summary.commissionedMinutesPerWeek) ?? <span className="font-normal text-slate-500">Hours not recorded</span>}</dd>
            </div>
            <div>
              <dt className="text-[12.5px] text-slate-600">{summary.endDate ? "Dates" : "Start date"}</dt>
              <dd className="font-medium tabular-nums text-[#1d2939]">
                {fmtDate(summary.startDate)}
                {summary.endDate ? <span className="block text-[13px] font-normal text-slate-600">Ends {fmtDate(summary.endDate)}</span> : null}
              </dd>
            </div>
            <div className="min-[400px]:col-span-2">
              <dt className="text-[12.5px] text-slate-600">Commissioning authority</dt>
              <dd>{summary.funderName ? <span className="font-medium text-[#1d2939]">{summary.funderName}</span> : <><span className="text-slate-700">Funder not linked</span><span className="block text-[12.5px] text-slate-500">Finance links the funder</span></>}</dd>
            </div>
            <div className="min-[400px]:col-span-2">
              <dt className="text-[12.5px] text-slate-600">Scheduled care</dt>
              <dd>
                {summary.scheduledCalls.length ? (
                  <>
                    <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Scheduled calls">
                      {summary.scheduledCalls.map((c) => <li key={c} className="rounded-full bg-[#f1effa] px-2.5 py-0.5 text-[13px] text-[#45307d]">{c}</li>)}
                    </ul>
                    <span className="mt-1 block text-[12.5px] text-slate-500">{summary.recurringVisits} repeating {summary.recurringVisits === 1 ? "visit" : "visits"}</span>
                  </>
                ) : <span className="text-slate-500">No recurring visits configured</span>}
              </dd>
            </div>
          </dl>
          {summary.attention.length ? (
            <div className="mt-3 rounded-[6px] border border-[#f0dcae] bg-[#fdf7ea] px-3 py-2.5" data-testid="package-attention">
              <p className="text-[13.5px] font-semibold text-[#7a4f00]">Attention required</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[13.5px] text-[#5c3d00]">
                {summary.attention.map((a) => <li key={a}>{a}</li>)}
              </ul>
            </div>
          ) : null}
        </>
      ) : <p className="mt-2 text-[14px] text-slate-600">No active care package.</p>}
      </div>
      <div className="hb-pn-f"><Link href={href} className="hb-btn">{summary ? "View full package" : canEdit ? "Record a package" : "Package history"}</Link></div>
    </section>
  );
}
