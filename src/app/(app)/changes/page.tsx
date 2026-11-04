import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { PcBadge, PcFoot, PcSearch, PcTableWrap, type PcTone } from "@/components/compliance-ui";
import { PcSelect } from "@/components/pc-select";
import { Menu } from "@/components/library/menu";
import { ComplianceTabs } from "@/components/compliance-nav";
import type { ChangeStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { Flash } from "@/components/ui";
import { DotsThreeVertical } from "@phosphor-icons/react/dist/ssr";

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
  const counts = Object.fromEntries(await Promise.all(Object.entries(GROUPS).map(async ([k, statuses]) => [k, await db.regulatoryChange.count({ where: { status: { in: statuses } } })] as const)));
  const reviewers = await db.user.findMany({ where: { id: { in: [...new Set(items.map((c) => c.reviewerId).filter((x): x is string => Boolean(x)))] } }, select: { id: true, name: true } });
  const reviewerName = new Map(reviewers.map((u) => [u.id, u.name]));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const params = { group, q: sp.q, source: sp.source, urgency: sp.urgency };
  const pageHref = (n: number) => `/changes?${new URLSearchParams(Object.entries({ ...params, page: String(n) }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <>
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="regulatory" active="updates" />}
        title="Regulatory Monitoring"
        subtitle="Changes found on the sources CSB monitors, the requirements they create and the health of each source. Every step is recorded."
      />
      <Flash searchParams={sp} />
      <section aria-label="Regulatory updates" className="pc-panel">
        <form className="pc-toolbar" role="search" aria-label="Filter updates">
          <PcSearch defaultValue={sp.q} placeholder="Search updates" />
          <PcSelect name="source" label="Source" defaultValue={sp.source ?? ""} options={[{ value: "", label: "All" }, ...sources.map((s) => ({ value: s.id, label: s.name }))]} />
          <PcSelect name="urgency" label="Impact" defaultValue={sp.urgency ?? ""} options={[{ value: "", label: "Any" }, ...["LOW", "MEDIUM", "HIGH", "URGENT"].map((u) => ({ value: u, label: u.charAt(0) + u.slice(1).toLowerCase() }))]} />
          <PcSelect name="group" label="Status" defaultValue={group} options={[["open", "Open"], ["triage", "Awaiting triage"], ["assessment", "Impact assessment"], ["closed", "Closed or not applicable"], ["all", "All"]].map(([value, label]) => ({ value: value!, label: `${label}${value !== "all" ? ` (${counts[value!]})` : ""}` }))} />
          <button className="pc-btn-secondary sr-only focus:not-sr-only" type="submit">Apply</button>
        </form>
        {items.length ? (
          <PcTableWrap>
            <table className="pc-table" data-testid="changes-table">
              <thead><tr><th>Change</th><th>Source</th><th>Date</th><th>Impact</th><th>Review status</th><th>Responsible</th><th className="w-[52px]"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {items.map((c) => {
                  const flagged = new Set(c.candidates.map((x) => x.policyId)).size;
                  const title = c.isSimulated ? c.title.replace(/^SIMULATED:\s*/, "") : c.title;
                  const review = reviewLabel(c.status);
                  return (
                    <tr key={c.id}>
                      <td className="max-w-[420px]">
                        <span className="flex flex-wrap items-center gap-2">
                          <Link href={`/changes/${c.id}`} className="pc-strong">{title}</Link>
                          {c.isSimulated ? <PcBadge tone="purple" title="Simulated demonstration data. Not a real regulatory update.">Simulated</PcBadge> : null}
                        </span>
                        <span className="pc-sub">{flagged ? `${flagged} of ${ctx.organisationId ? "our" : "the"} policies flagged` : "No policies flagged"} · {c.classification.replace(/_/g, " ").toLowerCase()} (by {c.classificationBasis})</span>
                      </td>
                      <td className="max-w-[220px] truncate" title={c.source.name}>{c.source.name}</td>
                      <td className="whitespace-nowrap">{c.officialDate ? <>Published {fmtShortDate(c.officialDate)}</> : <>Detected {fmtShortDate(c.detectedAt)}</>}</td>
                      <td><PcBadge tone={IMPACT_TONE[c.suggestedUrgency] ?? "grey"}>{c.suggestedUrgency.charAt(0) + c.suggestedUrgency.slice(1).toLowerCase()}</PcBadge></td>
                      <td><PcBadge tone={review.tone}>{review.label}</PcBadge></td>
                      <td className="whitespace-nowrap">{c.reviewerId ? (reviewerName.get(c.reviewerId) ?? "Not recorded") : <span className="text-[#667085]">Not assigned</span>}</td>
                      <td className="text-right">
                        <Menu label={`Actions for ${title}`} trigger={<DotsThreeVertical size={18} weight="bold" />}>
                          <Link href={`/changes/${c.id}`} className="pl-menu-item">Open and assess</Link>
                          <a href={c.canonicalUrl} target="_blank" rel="noreferrer noopener" className="pl-menu-item">Open the source page</a>
                        </Menu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PcTableWrap>
        ) : (
          <p className="pc-empty">No updates match. Detected changes appear here once a monitored source has been checked at least twice and its content has changed.</p>
        )}
        <PcFoot shown={items.length} total={total} page={page} pages={pages} href={pageHref} />
      </section>
    </>
  );
}

const IMPACT_TONE: Record<string, PcTone> = { LOW: "grey", MEDIUM: "amber", HIGH: "red", URGENT: "red" };

/** Where an update is in its review, in plain words, with the badge colour for it. */
function reviewLabel(status: ChangeStatus): { label: string; tone: PcTone } {
  switch (status) {
    case "NEWLY_DETECTED":
    case "AWAITING_CLASSIFICATION":
    case "POTENTIALLY_SUBSTANTIVE":
      return { label: "Awaiting triage", tone: "red" };
    case "UNDER_REVIEW":
      return { label: "Under review", tone: "blue" };
    case "CONFIRMED_RELEVANT":
      return { label: "Impact assessment", tone: "amber" };
    case "IMPACT_ASSESSMENT_COMPLETED":
    case "POLICY_REVISION_REQUIRED":
      return { label: "Decision needed", tone: "blue" };
    case "NO_POLICY_REVISION_REQUIRED":
      return { label: "Closed · no change needed", tone: "grey" };
    case "CONFIRMED_NOT_APPLICABLE":
      return { label: "Closed · not applicable", tone: "grey" };
    case "EDITORIAL_OR_IMMATERIAL":
      return { label: "Closed · editorial", tone: "grey" };
    default:
      return { label: "Closed", tone: "grey" };
  }
}

function fmtShortDate(d: Date) {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/London" });
}
