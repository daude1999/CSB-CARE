import { CaretRight, CheckCircle, Circle, Plugs } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { platformDashboard } from "@/server/platform/dashboard";
import { operationsOverview, platformTrends, setupChecklist, type Severity } from "@/server/platform/command-centre";
import { listClients } from "@/server/platform/customers";
import { fmtDate } from "@/components/ui";
import { DailyChart, Progress } from "@/components/platform/charts";
import { EmptyState, fmtMoney, fmtNumber, Indicator, MetricStrip, NotConfigured, Pill, PxHeader, PxPanel, pxLink, pxPrimary, pxSecondary, pxSm, Table } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Platform Overview" };

const DOT: Record<Severity, string> = { critical: "bg-px-danger-strong", warning: "bg-[#d48806]", info: "bg-[#2f6fc0]" };
const HEALTH = { Healthy: "text-px-ok", Degraded: "text-px-warn", Down: "text-px-danger" } as const;

/** Platform Overview: a few key figures, the exceptions that need someone, the customers, and what has changed. */
export default async function PlatformOverview() {
  const ctx = await requireCtx();
  const [d, ops, trends, setup, clients] = await Promise.all([platformDashboard(ctx), operationsOverview(ctx), platformTrends(ctx), setupChecklist(ctx), listClients(ctx, { sort: "name" })]);
  const setupDone = setup.filter((s) => s.done).length;
  const nextStep = setup.find((s) => !s.done && !s.external)?.key;
  const activeDays = trends.signIns.points.filter((p, i) => p.value + trends.aiRequests.points[i]!.value > 0).length;
  return (
    <>
      <PxHeader
        title="Platform Overview"
        description="Manage your customers, subscriptions and platform operations."
        actions={<><Link href="/platform-admin/clients" className={pxSecondary}>View clients</Link><Link href="/platform-admin/clients/new" className={pxPrimary}>Add client</Link></>}
      />

      <MetricStrip label="Key figures" cols={6}>
        <Indicator label="Total clients" value={fmtNumber(d.clients.total)} note={d.clients.closed ? `${d.clients.closed} closed` : `${d.clients.trial} on trial`} href="/platform-admin/clients" />
        <Indicator label="Active clients" value={fmtNumber(d.clients.active)} note={d.clients.suspended ? `${d.clients.suspended} suspended` : "None suspended"} href="/platform-admin/clients?status=ACTIVE" />
        <Indicator label="Recurring revenue" value={d.revenue.mrrPence === null ? <NotConfigured>Prices not set</NotConfigured> : fmtMoney(d.revenue.mrrPence)} note={d.revenue.mrrPence === null ? "No priced plan in use" : d.revenue.unpriced ? `${d.revenue.unpriced} unpriced` : "From priced plans"} href="/platform-admin/plans" />
        <Indicator label="Active subscriptions" value={fmtNumber(d.revenue.active)} note={`of ${fmtNumber(d.clients.total - d.clients.closed)} open clients`} href="/platform-admin/subscriptions" />
        <Indicator label="Platform health" value={<span className={HEALTH[ops.status.state]}>{ops.status.state}</span>} note={ops.status.reasons[0] ?? `Database ${ops.status.latencyMs ?? "—"} ms`} href={ops.status.jobs.dead || ops.status.jobs.failed24h ? "/platform-admin/jobs" : "/platform-admin/health"} />
        <Indicator label="Needs attention" value={fmtNumber(ops.issues)} alert={ops.issues > 0} note={ops.issues ? "See operations below" : "Nothing outstanding"} href="#operations" />
      </MetricStrip>

      <div className="mb-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <PxPanel id="operations" title="Operations" description="Exceptions first. Each row opens the place where it is dealt with." flush>
          <ul className="divide-y divide-px-row">
            {ops.rows.map((r) => (
              <li key={r.key}>
                <Link href={r.href} className="group flex items-center gap-3 px-4 py-3 no-underline hover:bg-px-hover">
                  <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${r.count ? DOT[r.severity] : "bg-[#cfd4de]"}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[13.5px] ${r.count ? "font-medium text-px-ink" : "text-px-body"}`}>{r.label}</span>
                    <span className="block truncate text-[12.5px] text-px-muted">{r.detail}</span>
                  </span>
                  <span className={`min-w-[2.5rem] text-right text-[15px] font-semibold tabular-nums ${r.count ? (r.severity === "critical" ? "text-px-danger" : "text-px-ink") : "text-px-faint"}`}>{r.count || "–"}</span>
                  <CaretRight size={14} className="shrink-0 text-px-faint group-hover:text-px-accent" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </PxPanel>

        <PxPanel title="Platform setup" description={`${setupDone} of ${setup.length} complete`} flush>
          <div className="px-4 pb-1 pt-3"><Progress value={setupDone} max={setup.length} label="Platform setup progress" tone={setupDone === setup.length ? "green" : "violet"} /></div>
          <ol className="py-1">
            {setup.map((s) => (
              <li key={s.key}>
                <Link href={s.href} className="flex items-start gap-2.5 px-4 py-[7px] no-underline hover:bg-px-hover" title={s.detail}>
                  {s.done ? <CheckCircle size={16} weight="fill" className="mt-[2px] shrink-0 text-[#1f9254]" aria-hidden="true" /> : s.external ? <Plugs size={16} className="mt-[2px] shrink-0 text-px-subtle" aria-hidden="true" /> : <Circle size={16} className="mt-[2px] shrink-0 text-px-faint" aria-hidden="true" />}
                  <span className="min-w-0">
                    <span className={`block text-[13px] leading-5 ${s.done ? "text-px-muted line-through decoration-px-faint" : "text-px-ink"}`}><span className="sr-only">{s.done ? "Done: " : "To do: "}</span>{s.label}</span>
                    {s.key === nextStep ? <span className="block text-[12px] leading-4 text-px-subtle">{s.detail}</span> : s.external && !s.done ? <span className="block text-[12px] leading-4 text-px-subtle">Needs a developer</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </PxPanel>
      </div>

      <div className="mb-4 grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <PxPanel title="Customers" description={`${fmtNumber(clients.total)} organisation${clients.total === 1 ? "" : "s"}`} actions={<Link href="/platform-admin/clients" className={pxLink}>All clients</Link>} flush>
          {clients.rows.length ? (
            <div className="px-4">
              <Table label="Customers" minWidth={620} head={["Organisation", "Subscription", "Status", "Users", "Renewal", ""]} align={["left", "left", "left", "right", "left", "right"]}>
                {clients.rows.slice(0, 8).map((c) => (
                  <tr key={c.id}>
                    <td><Link href={`/platform-admin/clients/${c.id}`} className="font-medium text-px-ink no-underline hover:text-px-accent hover:underline">{c.name}</Link><span className="block font-mono text-[11.5px] text-px-subtle">{c.reference}</span></td>
                    <td>{c.plan ?? <span className="text-px-subtle">None</span>}</td>
                    <td><Pill value={c.status} /></td>
                    <td className="text-right tabular-nums">{fmtNumber(c.users)}</td>
                    <td className="whitespace-nowrap tabular-nums">{c.renewal ? <>{fmtDate(c.renewal)} <span className="text-[12px] text-px-subtle">{c.renewalKind}</span></> : <span className="text-px-subtle">—</span>}</td>
                    <td className="text-right"><Link href={`/platform-admin/clients/${c.id}`} className={`${pxSecondary} ${pxSm}`} aria-label={`Manage ${c.name}`}>Manage</Link></td>
                  </tr>
                ))}
              </Table>
              {clients.total > 8 ? <p className="border-t border-px-row py-2.5 text-[13px]"><Link href="/platform-admin/clients" className={pxLink}>See all {clients.total} clients</Link></p> : null}
            </div>
          ) : <EmptyState title="No clients yet" action={<Link href="/platform-admin/clients/new" className={pxPrimary}>Add the first client</Link>}>Each customer organisation you set up appears here with its plan, status and renewal.</EmptyState>}
        </PxPanel>

        <PxPanel title="Recent activity" actions={<Link href="/platform-admin/activity" className={pxLink}>View all</Link>}>
          {d.activity.length ? (
            <ol className="relative">
              {d.activity.slice(0, 7).map((a, i, all) => (
                <li key={a.id} className="relative pb-3.5 pl-5 last:pb-0">
                  {i < all.length - 1 ? <span aria-hidden="true" className="absolute bottom-0 left-[3.5px] top-[14px] w-px bg-px-line" /> : null}
                  <span aria-hidden="true" className={`absolute left-0 top-[6px] h-2 w-2 rounded-full ${a.tone === "rose" ? "bg-px-danger-strong" : a.tone === "amber" ? "bg-[#d48806]" : a.tone === "green" ? "bg-[#1f9254]" : "bg-px-focus"}`} />
                  <p className="text-[13px] font-medium leading-5 text-px-ink">{a.label}</p>
                  <p className="text-[12px] leading-[17px] text-px-muted">
                    {a.organisationId ? <Link href={`/platform-admin/clients/${a.organisationId}`} className="text-px-muted hover:text-px-accent">{a.organisation}</Link> : null}
                    {a.subject ? <>{a.organisationId ? " · " : ""}<Link href={`/platform-admin/users/${a.subjectId}`} className="text-px-muted hover:text-px-accent">{a.subject}</Link></> : null}
                    {a.organisationId || a.subject ? " · " : ""}{a.actor}
                  </p>
                  <time className="text-[11.5px] tabular-nums text-px-subtle" dateTime={a.at.toISOString()}>{fmtDate(a.at, true)}</time>
                </li>
              ))}
            </ol>
          ) : <p className="py-3 text-[13px] text-px-muted">No changes yet. Client, account, subscription and settings changes appear here.</p>}
        </PxPanel>
      </div>

      {activeDays >= 3 ? (
        <PxPanel title="Platform activity" description="Sign-ins and AI requests per day over the last 30 days, across every client." actions={<Link href="/platform-admin/security?logins=1" className={pxLink}>Sign-in log</Link>}>
          <DailyChart series={[{ label: "Sign-ins", points: trends.signIns.points, color: "#6d28d9" }, { label: "AI requests", points: trends.aiRequests.points, color: "#94a3c4" }]} />
        </PxPanel>
      ) : null}
    </>
  );
}
