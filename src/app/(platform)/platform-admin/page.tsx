import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { platformDashboard } from "@/server/platform/dashboard";
import { fmtDate } from "@/components/ui";
import { fmtBytes, fmtMoney, fmtNumber, Indicator, NotConfigured, PxHeader, PxPanel, pxPrimary, Tone } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

/** Platform dashboard: every indicator is counted from records, and anything not measured says so. */
export default async function PlatformDashboard() {
  const ctx = await requireCtx();
  const d = await platformDashboard(ctx);
  const aiCost = d.ai.estimatedCostPence;
  return (
    <>
      <PxHeader
        title="Dashboard"
        description="Every customer organisation on the platform, how they are licensed and how the platform is running. Figures are counted from live records."
        actions={<Link href="/platform-admin/clients/new" className={pxPrimary}>Add new client</Link>}
      />
      <section aria-label="Summary indicators" className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-[8px] border border-[#e4e7ef] bg-[#eef0f5] sm:grid-cols-3 xl:grid-cols-5">
        <Indicator label="Client organisations" value={fmtNumber(d.clients.total)} note={`${d.clients.closed} closed`} href="/platform-admin/clients" />
        <Indicator label="Active clients" value={fmtNumber(d.clients.active)} href="/platform-admin/clients?status=ACTIVE" />
        <Indicator label="On trial" value={fmtNumber(d.clients.trial)} href="/platform-admin/renewals" />
        <Indicator label="Suspended" value={fmtNumber(d.clients.suspended)} alert={d.clients.suspended > 0} href="/platform-admin/clients?status=SUSPENDED" />
        <Indicator label="Customer users" value={fmtNumber(d.users)} note="Active people with a membership" href="/platform-admin/users" />
        <Indicator label="Active subscriptions" value={fmtNumber(d.revenue.active)} href="/platform-admin/subscriptions" />
        <Indicator label="Monthly recurring revenue" value={d.revenue.mrrPence === null ? <NotConfigured>Prices not set</NotConfigured> : fmtMoney(d.revenue.mrrPence)} note={d.revenue.mrrPence === null ? "No active subscription has a priced plan" : d.revenue.unpriced ? `${d.revenue.unpriced} active subscription(s) unpriced` : "From active, priced plans. Billing not connected"} href="/platform-admin/plans" />
        <Indicator label="AI cost this month" value={aiCost === null ? <NotConfigured>{d.ai.tokensMetered ? "Prices not set" : "Not metered yet"}</NotConfigured> : fmtMoney(aiCost)} note={aiCost === null ? "Set token prices in Platform Settings" : "Estimated from measured tokens"} href="/platform-admin/ai" />
        <Indicator label="AI requests this month" value={fmtNumber(d.ai.requests)} note={d.ai.failed ? `${d.ai.failed} failed` : "None failed"} href="/platform-admin/ai" />
        <Indicator label="Document storage" value={fmtBytes(d.storage.bytes)} note={`${fmtNumber(d.storage.files)} files`} href="/platform-admin/storage" />
        <Indicator label="Failed background jobs" value={fmtNumber(d.jobs.failed24h)} note={`Last 24 hours · ${d.jobs.dead} given up`} alert={d.jobs.dead > 0} href="/platform-admin/jobs" />
        <Indicator label="Support access" value={fmtNumber(d.support.requested + d.support.active)} note={`${d.support.requested} waiting · ${d.support.active} active`} href="/platform-admin/support" />
        <Indicator label="Platform health" value={<span className={d.health === "Healthy" ? "text-[#17663a]" : "text-[#a11d2b]"}>{d.health}</span>} note="Database and job queue" href="/platform-admin/health" className="col-span-2 sm:col-span-3" />
      </section>
      <PxPanel title="Recent activity" description="Clients, subscriptions, invitations, password resets, suspensions, permissions and configuration." actions={<Link href="/platform-admin/activity" className="text-[13px]">All activity</Link>}>
        {d.activity.length ? (
          <ol className="divide-y divide-[#f1f2f6]">
            {d.activity.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-[13.5px]">
                <time className="w-[150px] shrink-0 text-[12.5px] tabular-nums text-[#5b6478]" dateTime={a.at.toISOString()}>{fmtDate(a.at, true)}</time>
                <Tone tone={a.tone}>{a.label}</Tone>
                <span className="min-w-0 flex-1 text-[#26304a]">
                  {a.subject ? <><Link href={`/platform-admin/users/${a.subjectId}`}>{a.subject}</Link>{a.organisation ? " · " : ""}</> : null}
                  {a.organisationId ? <Link href={`/platform-admin/clients/${a.organisationId}`}>{a.organisation}</Link> : null}
                  <span className="text-[#5b6478]"> by {a.actor}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : <p className="py-4 text-[13.5px] text-[#5b6478]">Nothing has happened yet.</p>}
        {d.ai.recentFailures.length ? <p className="mt-3 border-t border-[#f1f2f6] pt-3 text-[13px] text-[#a11d2b]"><Link href="/platform-admin/ai">{d.ai.recentFailures.length} AI processing failure(s) this month</Link></p> : null}
      </PxPanel>
    </>
  );
}
