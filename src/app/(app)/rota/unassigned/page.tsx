import { CalendarBlank, ClockCounterClockwise, Plus, WarningOctagon } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { londonDate } from "@/lib/london";
import { Flash } from "@/components/ui";
import { BTN_PRIMARY } from "@/components/rota-list-ui";
import { LiveRangeControls, UnassignedLive } from "@/components/unassigned-live";
import { CoverageHistory } from "@/components/coverage-history";

export const dynamic = "force-dynamic";

/**
 * Unassigned Visits, the Daily Rota's sister screen: the live list of upcoming visits short of a carer, with Find Cover
 * (Recommended and Manual) in a right-hand panel, and a Coverage History tab reporting what happened to past visits.
 * Tabs live in the URL (?tab=live | ?tab=history) and keep the branch and area filters.
 */
export default async function UnassignedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const sp = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const ctx = await requireRotaPage();
  const tab = sp.tab === "history" ? "history" : "live";
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const keep = new URLSearchParams(Object.entries({ branch: sp.branch, area: sp.area }).filter((e): e is [string, string] => !!e[1])).toString();
  const tabHref = (t: string) => `/rota/unassigned?tab=${t}${keep ? `&${keep}` : ""}`;

  return (
    <div className="daily-rota -mt-1">
      <header className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-3">
        <span aria-hidden className="flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-[10px] bg-[#efeafc] text-[#5b2bb5]"><CalendarBlank size={30} weight="duotone" /></span>
        <div className="mr-auto min-w-0">
          <h1 className="text-[26px] font-bold leading-tight text-[#101828]">Unassigned Visits</h1>
          <p className="text-[15px] font-semibold text-[#101828]">{tab === "live" ? "Find and allocate suitable care workers." : "Review visit attendance, staffing changes and unresolved care."}</p>
        </div>
        {tab === "live" ? <LiveRangeControls sp={sp} /> : null}
        {tab === "live" && canEdit ? <Link href={`/rota/visits/new?date=${sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : londonDate()}`} className={BTN_PRIMARY}><Plus size={18} weight="bold" aria-hidden />Create Visit</Link> : null}
      </header>
      <nav aria-label="Unassigned Visits sections" className="mb-3 flex gap-1 border-b border-[#e4e7ec]">
        {([["live", "Unassigned Visits", <WarningOctagon key="i" size={18} aria-hidden />], ["history", "Coverage History", <ClockCounterClockwise key="i" size={18} aria-hidden />]] as const).map(([k, label, icon]) => (
          <Link key={k} href={tabHref(k)} aria-current={tab === k ? "page" : undefined} className={`-mb-px inline-flex items-center gap-2 border-b-[3px] px-3.5 py-2.5 text-[15px] no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5b2bb5] ${tab === k ? "border-[#5b2bb5] font-semibold text-[#5b2bb5]" : "border-transparent font-medium text-[#475467] hover:text-[#101828]"}`}>
            {icon}{label}
          </Link>
        ))}
      </nav>
      <Flash searchParams={sp} />
      {tab === "live" ? <UnassignedLive ctx={ctx} sp={sp} /> : <CoverageHistory ctx={ctx} sp={sp} />}
    </div>
  );
}
