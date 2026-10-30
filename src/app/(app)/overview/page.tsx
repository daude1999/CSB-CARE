import Link from "@/components/link";
import { db } from "@/lib/db";
import { requirePortal, portalsFor } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { dashboardMetrics } from "@/server/reports/metrics";
import { REPORTS } from "@/server/reports/tables";
import { hrHeadline } from "@/server/hr/summary";
import { rotaHeadline } from "@/server/rota/summary";
import type { Portal, PortalId } from "@/lib/portals";
import { ArrowRight, ChartBar, FileText, Gear, Lock, CalendarDots, UsersThree } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

type Figure = [number, string];

/** One Overview tile. Planned modules keep their colour but say plainly that they are not built. */
interface TileSpec {
  key: string;
  portal: Portal;
  name: string;
  icon: React.ReactNode;
  items: string[];
  /** Overrides the portal's planned stage for tiles that share a planned portal. */
  planned?: string;
}

/** Calls a module "planned" in words and in the accessible name, never just by colour. */
function PlannedTile({ spec, n }: { spec: TileSpec; n: number }) {
  const { portal } = spec;
  const stage = spec.planned ?? portal.planned;
  return (
    <article className="ov-tile ov-tile-planned" data-testid={`tile-${spec.key}`} aria-label={`${spec.name}, planned for ${stage}`}>
      <TileHead spec={spec} n={n} stage={stage} />
      <TileItems spec={spec} />
      <div className="ov-figures flex items-center gap-2 text-[12.5px] text-[#4f5b6c]" style={{ background: portal.tint }}>
        <Lock size={15} aria-hidden="true" style={{ color: portal.colour }} />
        Not built yet. No figures are shown until it is.
      </div>
      <Link href={portal.home} className="ov-cta text-[#5f6b7a]">See what&apos;s planned <ArrowRight size={14} aria-hidden="true" /></Link>
    </article>
  );
}

function TileHead({ spec, n, stage }: { spec: TileSpec; n: number; stage?: string }) {
  return (
    <div className="ov-tile-head" style={{ background: spec.portal.colour }}>
      <span aria-hidden="true" className="ov-num">{n}</span>
      <span aria-hidden="true" className="flex shrink-0">{spec.icon}</span>
      <h2 className="min-w-0 text-[15px] font-semibold leading-tight text-white">{spec.name}</h2>
      {stage ? <span className="ml-auto shrink-0 whitespace-nowrap rounded-full bg-white/[0.22] px-2 py-[3px] text-[10.5px] font-medium text-white">Planned · {stage}</span> : null}
    </div>
  );
}

function TileItems({ spec }: { spec: TileSpec }) {
  return (
    <ul className="flex-1 space-y-[7px] px-4 pb-1.5 pt-3.5">
      {spec.items.map((i) => (
        <li key={i} className="flex items-baseline gap-2.5 text-[13px] text-[#2f3d52]">
          <span aria-hidden="true" className="h-[6px] w-[6px] shrink-0 -translate-y-px rounded-full" style={{ background: spec.portal.colour }} />
          {i}
        </li>
      ))}
    </ul>
  );
}

function LiveTile({ spec, n, figures, note }: { spec: TileSpec; n: number; figures: Figure[]; note?: string }) {
  const { portal } = spec;
  const cta = `Open ${portal.name}`;
  return (
    <article className="ov-tile" data-testid={`tile-${spec.key}`}>
      <TileHead spec={spec} n={n} />
      <TileItems spec={spec} />
      <div className="ov-figures flex gap-6" style={{ background: portal.tint }}>
        {figures.length ? figures.map(([v, label]) => (
          <p key={label} className="text-[11.5px] leading-tight text-[#4f5b6c]">
            <span className="block text-[22px] font-semibold leading-7" style={{ color: portal.colour }}>{v}</span>
            {label}
          </p>
        )) : <p className="py-1 text-[12.5px] text-[#4f5b6c]">{note}</p>}
      </div>
      <Link href={portal.home} className="ov-cta" style={{ color: portal.colour }}>{cta} <ArrowRight size={14} weight="bold" aria-hidden="true" /></Link>
    </article>
  );
}

function greeting(now: Date) {
  const hour = Number(now.toLocaleString("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/London" }));
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

/**
 * The Overview: one coloured tile per module this person may open, in the module's own colour, with figures counted
 * from the database. Planned modules show no figures. "Needs your attention" lists only real, non-zero items.
 */
export default async function Overview() {
  const ctx = await requirePortal("overview");
  const portals = new Map(portalsFor(ctx).map((p) => [p.id, p] as const));
  const has = (id: PortalId) => portals.has(id);
  const orgId = ctx.organisationId;
  const [m, hr, branches, rotaFigures] = await Promise.all([
    has("policy") ? dashboardMetrics(ctx) : null,
    has("hr") ? hrHeadline(ctx) : null,
    has("admin") && orgId ? db.branch.count({ where: { organisationId: orgId } }) : null,
    has("rota") ? rotaHeadline(ctx) : null,
  ]);

  const specs: (TileSpec & { live: boolean; figures?: Figure[]; note?: string })[] = [];
  const policy = portals.get("policy");
  if (policy && m) {
    specs.push({ key: "policy", portal: policy, name: policy.name, icon: <FileText size={22} />, live: true, items: ["Policy Library and templates", "Regulatory updates and AI drafting", "Approvals, sign-off and audits", "Actions, risks and evidence"], figures: [[m.draftsAwaitingApproval, "awaiting approval"], [m.overdueReviews, "reviews overdue"]] });
  }
  const rota = portals.get("rota");
  if (rota) {
    specs.push({ key: "rota", portal: rota, name: rota.name, icon: <CalendarDots size={22} />, live: true, items: ["Service users, care plans and risks", "Templates, Build Rota and the planner", "Live call monitoring and carer mobile", "Timesheets, invoicing and payroll preparation"], figures: rotaFigures ? [[rotaFigures.visitsToday, "visits today"], [rotaFigures.unassignedToday, "unassigned"]] : [], note: "Open your visits." });
  }
  const hrPortal = portals.get("hr");
  if (hrPortal) {
    specs.push({ key: "hr", portal: hrPortal, name: hrPortal.name, icon: <UsersThree size={22} />, live: true, items: ["Staff records and DBS tracking", "Training and qualifications", "Right to work and supervision", "Sickness and compliance alerts"], figures: hr ? [[hr.employees, "employees"], [hr.overdue, "checks overdue"]] : [], note: "Opens your HR Hub." });
  }
  const reporting = portals.get("reporting");
  if (reporting) {
    specs.push({ key: "reporting", portal: reporting, name: reporting.name, icon: <ChartBar size={22} />, live: true, items: ["Policy, sign-off and change reports", "Actions register", "CSV exports for inspections", "Ask the AI assistant"], figures: [[Object.keys(REPORTS).length, "report exports"]] });
  }
  const admin = portals.get("admin");
  if (admin) {
    specs.push({ key: "admin", portal: admin, name: "Administration & Settings", icon: <Gear size={22} />, live: true, items: ["Users, roles and branches", "Organisation settings", "Sources and background jobs", "Audit log"], figures: branches !== null ? [[branches, branches === 1 ? "branch" : "branches"]] : [], note: "Platform settings, sources and jobs." });
  }

  // Only items that are real and non-zero, each linking to the page that deals with it.
  const attention: { text: string; where: string; href: string; colour: string }[] = [];
  if (policy && m) {
    if (m.draftsAwaitingApproval) attention.push({ text: `${m.draftsAwaitingApproval} policy ${m.draftsAwaitingApproval === 1 ? "revision is" : "revisions are"} awaiting approval`, where: "Policy & Compliance · Change Queue", href: "/queue", colour: policy.colour });
    if (m.overdueReviews) attention.push({ text: `${m.overdueReviews} policy ${m.overdueReviews === 1 ? "review is" : "reviews are"} overdue`, where: "Policy & Compliance · Policy Library", href: "/policies?quick=overdue", colour: policy.colour });
    if (m.newChanges + m.awaitingAssessment) attention.push({ text: `${m.newChanges + m.awaitingAssessment} regulatory ${m.newChanges + m.awaitingAssessment === 1 ? "change needs" : "changes need"} review`, where: "Policy & Compliance · Regulatory Updates", href: "/changes", colour: policy.colour });
    if (m.overdueAcks && hasOrgPermission(ctx, "staff.view")) attention.push({ text: `${m.overdueAcks} staff ${m.overdueAcks === 1 ? "sign-off is" : "sign-offs are"} overdue`, where: "Policy & Compliance · Staff Sign-off", href: "/staff", colour: policy.colour });
    if (m.overdueActions) attention.push({ text: `${m.overdueActions} ${m.overdueActions === 1 ? "action is" : "actions are"} past their due date`, where: "Policy & Compliance · Actions & Risks", href: "/actions", colour: policy.colour });
  }
  if (rota && rotaFigures?.unassignedToday) attention.push({ text: `${rotaFigures.unassignedToday} ${rotaFigures.unassignedToday === 1 ? "visit slot is" : "visit slots are"} unassigned today`, where: "Rostering & Care Management · Unassigned", href: "/rota/visits?unassigned=1", colour: rota.colour });
  if (rota && rotaFigures?.openAlerts) attention.push({ text: `${rotaFigures.openAlerts} rota ${rotaFigures.openAlerts === 1 ? "alert needs" : "alerts need"} attention`, where: "Rostering & Care Management · Exceptions", href: "/rota/exceptions", colour: rota.colour });
  if (hrPortal && hr?.overdue) attention.push({ text: `${hr.overdue} HR ${hr.overdue === 1 ? "check is" : "checks are"} overdue`, where: "HR & Workforce", href: hrPortal.home, colour: hrPortal.colour });

  const first = ctx.userName.split(/\s+/)[0];
  const legend = specs.map((s) => ({ key: s.key, name: s.name, colour: s.portal.colour }));

  return (
    <div className="ov-root">
      <header className="px-4 pb-4 pt-5 md:px-[33px]">
        <p className="text-[13px] text-[#4f5b6c]">Overview</p>
        <h1 className="pl-h1 mt-1 text-[34px] leading-[40px] md:text-[42px] md:leading-[48px]">{greeting(new Date())}, {first}</h1>
        <p className="mt-1.5 text-[15px] text-[#3a4658]">Choose a module to get started. Each module keeps its colour across CSB: the sidebar, page headers and its tile here.</p>
        <ul aria-label="Module colours" className="mt-3 flex flex-wrap gap-x-[18px] gap-y-1 text-[12.5px] text-[#3a4658]">
          {legend.map((l) => (
            <li key={l.key} className="flex items-center gap-1.5"><span aria-hidden="true" className="h-[10px] w-[10px] rounded-[3px]" style={{ background: l.colour }} />{l.name}</li>
          ))}
        </ul>
      </header>
      <div className="grid gap-3.5 px-4 pb-6 sm:grid-cols-2 md:px-[33px] xl:grid-cols-4">
        {specs.map((s, i) => (s.live ? <LiveTile key={s.key} spec={s} n={i + 1} figures={s.figures ?? []} note={s.note} /> : <PlannedTile key={s.key} spec={s} n={i + 1} />))}
        <section aria-labelledby="attention-title" className="ov-tile px-4 py-3.5" data-testid="needs-attention">
          <h2 id="attention-title" className="mb-2 text-[15px] font-semibold text-[#0b1530]">Needs your attention</h2>
          {attention.length ? (
            <ul>
              {attention.slice(0, 5).map((a) => (
                <li key={a.text} className="border-t border-[#f0ede7] first:border-t-0">
                  <Link href={a.href} className="flex gap-2.5 py-2.5 no-underline hover:bg-[#fafbfc]">
                    <span aria-hidden="true" className="w-[3px] shrink-0 rounded-full" style={{ background: a.colour }} />
                    <span className="text-[13px] leading-snug text-[#0b1530]">{a.text}<span className="mt-0.5 block text-[11.5px] text-[#646e7f]">{a.where}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-[#4f5b6c]">Nothing needs your attention right now.</p>
          )}
        </section>
      </div>
    </div>
  );
}
