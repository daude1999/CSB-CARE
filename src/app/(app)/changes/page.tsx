import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import type { ChangeStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { Empty, Flash, Pagination, SegmentNav, SimulatedBadge, Stat, StatRow, StatusBadge } from "@/components/ui";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

const GROUPS: Record<string, ChangeStatus[]> = {
  open: ["NEWLY_DETECTED", "AWAITING_CLASSIFICATION", "POTENTIALLY_SUBSTANTIVE", "UNDER_REVIEW", "CONFIRMED_RELEVANT", "IMPACT_ASSESSMENT_COMPLETED", "POLICY_REVISION_REQUIRED"],
  triage: ["NEWLY_DETECTED", "AWAITING_CLASSIFICATION", "POTENTIALLY_SUBSTANTIVE", "UNDER_REVIEW"],
  assessment: ["CONFIRMED_RELEVANT", "IMPACT_ASSESSMENT_COMPLETED", "POLICY_REVISION_REQUIRED"],
  closed: ["EDITORIAL_OR_IMMATERIAL", "CONFIRMED_NOT_APPLICABLE", "NO_POLICY_REVISION_REQUIRED", "CLOSED"],
};

export default async function ChangesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const group = sp.group && GROUPS[sp.group] ? sp.group : sp.group === "all" ? "all" : "open";
  const page = Math.max(1, Number(sp.page ?? 1));
  const pageSize = 25;
  const where: Prisma.RegulatoryChangeWhereInput = {
    ...(group !== "all" ? { status: { in: GROUPS[group] } } : {}),
    ...(sp.source ? { sourceId: sp.source } : {}),
    ...(sp.urgency ? { suggestedUrgency: sp.urgency as "HIGH" } : {}),
    ...(sp.q ? { OR: [{ title: { contains: sp.q, mode: "insensitive" } }, { summary: { contains: sp.q, mode: "insensitive" } }] } : {}),
  };
  const [items, total, sources] = await Promise.all([
    db.regulatoryChange.findMany({
      where,
      orderBy: { detectedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        source: true,
        candidates: { where: { organisationId: ctx.organisationId ?? null }, select: { policyId: true } },
      },
    }),
    db.regulatoryChange.count({ where }),
    db.regulatorySource.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const tabs = [
    ["open", "Open"],
    ["triage", "Awaiting triage"],
    ["assessment", "Impact assessment"],
    ["closed", "Closed or not applicable"],
    ["all", "All"],
  ] as const;
  const counts = Object.fromEntries(await Promise.all(Object.entries(GROUPS).map(async ([k, statuses]) => [k, await db.regulatoryChange.count({ where: { status: { in: statuses } } })] as const)));
  return (
    <>
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="regulatory" active="updates" />}
        eyebrow="Monitoring · legislation and guidance"
        title="Regulatory Monitoring"
        subtitle="Changes found on the sources CSB monitors. Each one moves through detection, triage, applicability and a decision, and every step is recorded."
      />
      <Flash searchParams={sp} />
      <StatRow>
        <Stat label="Open Updates" value={counts.open} hint="Still being worked through" tone="amber" href="/changes?group=open" />
        <Stat label="Awaiting Triage" value={counts.triage} hint="Not yet classified" tone="rose" href="/changes?group=triage" />
        <Stat label="Impact Assessment" value={counts.assessment} hint="Checking our policies" tone="navy" href="/changes?group=assessment" />
        <Stat label="Closed" value={counts.closed} hint="Decided and recorded" tone="green" href="/changes?group=closed" />
      </StatRow>
      <SegmentNav alert label="Update stage" items={tabs.map(([k, label]) => ({ href: `/changes?group=${k}`, label, active: group === k, count: k === "all" ? undefined : counts[k] }))} />
      <section aria-label="Regulatory updates" className="panel rounded-tl-none">
        <form className="mb-3 flex flex-wrap items-center gap-2" role="search">
          <input type="hidden" name="group" value={group} />
          <label className="flex h-[36px] min-w-0 basis-full items-center gap-2 rounded-[4px] border border-slate-300 bg-white px-2.5 sm:max-w-[320px] sm:flex-1 sm:basis-auto">
            <MagnifyingGlass size={18} className="shrink-0 text-slate-600" aria-hidden="true" />
            <input className="h-full min-w-0 flex-1 bg-transparent text-[14px] placeholder:text-slate-500 focus:outline-none" name="q" defaultValue={sp.q} placeholder="Search updates" aria-label="Search updates" />
          </label>
          <select className="input h-[36px] w-auto max-w-[15rem] py-1 text-[14px]" name="source" defaultValue={sp.source ?? ""} aria-label="Source">
            <option value="">All sources</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="input h-[36px] w-auto py-1 text-[14px]" name="urgency" defaultValue={sp.urgency ?? ""} aria-label="Urgency">
            <option value="">Any urgency</option>
            {["LOW", "MEDIUM", "HIGH", "URGENT"].map((u) => <option key={u} value={u}>{u.charAt(0) + u.slice(1).toLowerCase()}</option>)}
          </select>
          <button className="btn-secondary h-[36px] py-0" type="submit">Apply</button>
        </form>
      {items.length ? (
        <>
        <div className="hidden gap-x-6 px-4 pb-1 text-[13px] text-slate-700 md:grid md:grid-cols-[6.5rem_minmax(0,1fr)_15rem]"><span>Detected</span><span>Update</span><span>Progress</span></div>
        <ol className="rows" data-testid="changes-table">
          {items.map((c) => {
            const flagged = new Set(c.candidates.map((x) => x.policyId)).size;
            const stage = STAGE[c.status] ?? 0;
            return (
              <li key={c.id} className="grid gap-x-6 gap-y-3 py-3.5 md:grid-cols-[6.5rem_minmax(0,1fr)_15rem]">
                <time dateTime={c.detectedAt.toISOString()} className="text-[14px] leading-5 text-slate-800">
                  {c.detectedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/London" })}
                  <span className="block text-[12px] text-slate-500">{c.detectedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}</span>
                </time>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/changes/${c.id}`} className="row-title text-[15.5px] leading-snug">{c.isSimulated ? c.title.replace(/^SIMULATED:\s*/, "") : c.title}</Link>
                    <SimulatedBadge show={c.isSimulated} />
                  </div>
                  <p className="mt-1 max-w-2xl text-[13px] leading-5 text-slate-700">{c.summary.slice(0, 220)}{c.summary.length > 220 ? "…" : ""}</p>
                  <p className="mt-1.5 text-[12.5px] text-slate-600">
                    {c.source.name}{c.officialDate ? ` · source dated ${c.officialDate.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" })}` : ""} · <span className={c.classification === "POTENTIALLY_SUBSTANTIVE" ? "text-[#a3242c]" : ""}>{c.classification.replace(/_/g, " ").toLowerCase()}</span> (by {c.classificationBasis})
                  </p>
                </div>
                <div className="space-y-2 text-[13px]">
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between"><span className="text-slate-600">Stage</span><span className="font-medium text-navy-900">{STAGES[stage]}</span></div>
                    <div className="grid grid-cols-4 gap-1" aria-label={`Stage ${stage + 1} of 4: ${STAGES[stage]}`} role="img">
                      {STAGES.map((st, i) => <span key={st} className={`h-[6px] rounded-full ${i < stage ? "bg-navy-900" : i === stage ? (CLOSED.has(c.status) ? "bg-slate-400" : "bg-[#3289f8]") : "bg-slate-200"}`} />)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between"><span className="text-slate-600">Urgency</span><StatusBadge status={c.suggestedUrgency} /></div>
                  <div className="flex items-baseline justify-between"><span className="text-slate-600">{ctx.organisationId ? "Our policies flagged" : "Policies flagged"}</span><span className="text-navy-900">{flagged || "None"}</span></div>
                </div>
              </li>
            );
          })}
        </ol>
        </>
      ) : (
        <Empty>No updates match. Detected changes appear here once a monitored source has been checked at least twice and its content has changed.</Empty>
      )}
      <Pagination page={page} pageSize={pageSize} total={total} base="/changes" params={{ group, q: sp.q, source: sp.source, urgency: sp.urgency }} />
      </section>
    </>
  );
}

const STAGES = ["Detected", "Triage", "Applicability", "Decision"];
const STAGE: Partial<Record<ChangeStatus, number>> = {
  NEWLY_DETECTED: 0, AWAITING_CLASSIFICATION: 0,
  POTENTIALLY_SUBSTANTIVE: 1, UNDER_REVIEW: 1, EDITORIAL_OR_IMMATERIAL: 1,
  CONFIRMED_RELEVANT: 2, CONFIRMED_NOT_APPLICABLE: 2,
  IMPACT_ASSESSMENT_COMPLETED: 3, POLICY_REVISION_REQUIRED: 3, NO_POLICY_REVISION_REQUIRED: 3, CLOSED: 3,
};
const CLOSED = new Set<ChangeStatus>(GROUPS.closed);
