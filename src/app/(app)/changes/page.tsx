import Link from "@/components/link";
import type { ChangeStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { Empty, Flash, PageHeader, Pagination, SegmentNav, SimulatedBadge } from "@/components/ui";
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
      <PageHeader
        eyebrow="Monitoring · legislation and guidance"
        title="Regulatory Updates"
        subtitle="Changes found on the sources CSB monitors. Each one moves through detection, triage, applicability and a decision, and every step is recorded."
      />
      <Flash searchParams={sp} />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-slate-300">
        <SegmentNav label="Update stage" items={tabs.map(([k, label]) => ({ href: `/changes?group=${k}`, label, active: group === k, count: k === "all" ? undefined : counts[k] }))} />
        <form className="mb-2 flex flex-wrap items-center gap-2" role="search">
          <input type="hidden" name="group" value={group} />
          <MagnifyingGlass size={16} className="text-slate-400" aria-hidden="true" />
          <input className="w-44 border-0 border-b border-transparent bg-transparent px-1 py-1 text-sm placeholder:text-slate-400 focus:border-navy-900 focus:outline-hidden focus:ring-0" name="q" defaultValue={sp.q} placeholder="Search updates" aria-label="Search updates" />
          <select className="input w-auto max-w-52 py-1 text-xs" name="source" defaultValue={sp.source ?? ""} aria-label="Source">
            <option value="">All sources</option>
            {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select className="input w-auto py-1 text-xs" name="urgency" defaultValue={sp.urgency ?? ""} aria-label="Urgency">
            <option value="">Any urgency</option>
            {["LOW", "MEDIUM", "HIGH", "URGENT"].map((u) => <option key={u} value={u}>{u.toLowerCase()}</option>)}
          </select>
          <button className="btn-secondary px-2.5 py-1 text-xs" type="submit">Apply</button>
        </form>
      </div>
      {items.length ? (
        <ol className="border-t-2 border-navy-900" data-testid="changes-table">
          {items.map((c) => {
            const flagged = new Set(c.candidates.map((x) => x.policyId)).size;
            const stage = STAGE[c.status] ?? 0;
            return (
              <li key={c.id} className="grid gap-x-6 gap-y-3 border-b border-slate-200 py-5 md:grid-cols-[6.5rem_minmax(0,1fr)_15rem]">
                <time dateTime={c.detectedAt.toISOString()} className="font-mono text-[11px] uppercase leading-5 text-slate-500">
                  {c.detectedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/London" })}
                  <span className="block text-slate-400">{c.detectedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}</span>
                </time>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/changes/${c.id}`} className="font-serif text-[18px] font-semibold leading-snug text-navy-900 no-underline hover:underline hover:decoration-teal-400 hover:decoration-2">{c.isSimulated ? c.title.replace(/^SIMULATED:\s*/, "") : c.title}</Link>
                    <SimulatedBadge show={c.isSimulated} />
                  </div>
                  <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-slate-600">{c.summary.slice(0, 220)}{c.summary.length > 220 ? "…" : ""}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    {c.source.name} · <span className={c.classification === "POTENTIALLY_SUBSTANTIVE" ? "text-rose-700" : ""}>{c.classification.replace(/_/g, " ").toLowerCase()}</span> (by {c.classificationBasis})
                  </p>
                </div>
                <div className="space-y-2.5 text-xs">
                  <div>
                    <div className="mb-1.5 flex items-baseline justify-between"><span className="text-slate-500">Stage</span><span className="font-medium text-navy-900">{STAGES[stage]}</span></div>
                    <div className="grid grid-cols-4 gap-1" aria-label={`Stage ${stage + 1} of 4: ${STAGES[stage]}`} role="img">
                      {STAGES.map((st, i) => <span key={st} className={`h-1 rounded-full ${i < stage ? "bg-navy-900" : i === stage ? (CLOSED.has(c.status) ? "bg-slate-400" : "bg-teal-400") : "bg-slate-200"}`} />)}
                    </div>
                  </div>
                  <div className="flex items-baseline justify-between"><span className="text-slate-500">Urgency</span><span className={["HIGH", "URGENT"].includes(c.suggestedUrgency) ? "font-medium text-rose-700" : "text-navy-900"}>{c.suggestedUrgency.toLowerCase()}</span></div>
                  <div className="flex items-baseline justify-between"><span className="text-slate-500">{ctx.organisationId ? "Our policies flagged" : "Policies flagged"}</span><span className="font-mono text-navy-900">{flagged || "none"}</span></div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <Empty>No updates match. Detected changes appear here once a monitored source has been checked at least twice and its content has changed.</Empty>
      )}
      <Pagination page={page} pageSize={pageSize} total={total} base="/changes" params={{ group, q: sp.q, source: sp.source, urgency: sp.urgency }} />
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
