import Link from "@/components/link";
import { db } from "@/lib/db";
import { requirePortal, portalsFor } from "@/server/auth/portals";
import { dashboardMetrics } from "@/server/reports/metrics";
import { hrHeadline } from "@/server/hr/summary";
import { TitleBar } from "@/components/title-bar";
import type { Portal } from "@/lib/portals";

export const dynamic = "force-dynamic";

function Figures({ items }: { items: [number, string][] }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-slate-600">
      {items.map(([n, label]) => (
        <p key={label}><span className="block text-[22px] leading-7 text-slate-800">{n}</span>{label}</p>
      ))}
    </div>
  );
}

function Tile({ portal, children }: { portal: Portal; children: React.ReactNode }) {
  const button = portal.planned ? "See what's planned" : "Open portal";
  const cls = "btn-secondary mt-auto self-start";
  return (
    <section className="flex flex-col gap-2.5 rounded-[4px] bg-white p-4 shadow-[0_0_0_1px_#e6eaef]" data-testid={`tile-${portal.id}`}>
      <h2 className="flex items-center gap-2.5 font-sans text-[18px] font-medium text-navy-900">
        <span aria-hidden="true" className={`flex h-[30px] w-[30px] items-center justify-center rounded-[6px] text-[12px] font-bold text-white ${portal.planned ? "bg-slate-300" : "bg-navy-900"}`}>{portal.code}</span>
        {portal.name}
        {portal.planned ? (
          <span className="ml-auto whitespace-nowrap rounded-full border border-dashed border-slate-400 bg-slate-100 px-2 text-[11.5px] font-medium leading-[20px] text-slate-600">Planned · {portal.planned}</span>
        ) : (
          <span className="ml-auto whitespace-nowrap rounded-full bg-[#e3f4ea] px-2 text-[11.5px] font-medium leading-[20px] text-[#1f7a4d]">Working now</span>
        )}
      </h2>
      {children}
      {portal.separateApp ? <a href={portal.home} className={cls}>{button}</a> : <Link href={portal.home} className={cls}>{button}</Link>}
    </section>
  );
}

/** Today across every portal this person may open. Every figure is counted from the database; planned portals show none. */
export default async function Overview() {
  const ctx = await requirePortal("overview");
  const portals = portalsFor(ctx).filter((p) => p.id !== "overview");
  const [m, openActions, hr] = await Promise.all([
    dashboardMetrics(ctx),
    ctx.organisationId ? db.complianceAction.count({ where: { organisationId: ctx.organisationId, status: { in: ["OPEN", "IN_PROGRESS"] } } }) : 0,
    portals.some((p) => p.id === "hr") ? hrHeadline(ctx) : null,
  ]);
  const body: Record<string, React.ReactNode> = {
    policy: <Figures items={[[m.outstandingAcks, "awaiting signature"], [m.newChanges + m.awaitingAssessment, "changes to review"], [openActions, "open actions"]]} />,
    hr: hr ? <><Figures items={[[hr.employees, "employees"], [hr.overdue, "overdue checks"]]} /><p className="text-[14px] text-slate-600">Opens your HR Hub.</p></> : <p className="text-[14px] text-slate-600">Opens your HR Hub.</p>,
    reporting: <p className="text-[14px] text-slate-600">Policy, audit and training reports from your own records.</p>,
    admin: <p className="text-[14px] text-slate-600">Settings, users, source monitoring and jobs.</p>,
    "service-users": <p className="text-[14px] text-slate-600">People you support, contacts and care plans.</p>,
    rota: <p className="text-[14px] text-slate-600">Weekly rota, visit times, carer check-in.</p>,
  };
  return (
    <div>
      <TitleBar title="Overview" />
      <div className="bg-[#f1f2f5] p-4">
        <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {portals.map((p) => <Tile key={p.id} portal={p}>{body[p.id]}</Tile>)}
        </div>
        <p className="mt-3 text-[13px] text-slate-600">Every figure comes from the database. Planned portals show no numbers.</p>
      </div>
    </div>
  );
}
