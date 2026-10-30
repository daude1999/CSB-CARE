import Link from "@/components/link";
import { db } from "@/lib/db";
import { requirePortal, portalsFor } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { dashboardMetrics } from "@/server/reports/metrics";
import { REPORTS } from "@/server/reports/tables";
import { hrHeadline, hrPeoplePreview, type HrPersonStatus } from "@/server/hr/summary";
import { rotaHeadline } from "@/server/rota/summary";
import { activeServiceUsers, activeStaff, rotaSnapshot, signOffSeries, type DailySeries, type RotaBoardRow, type Trend } from "@/server/overview/snapshot";
import { employeeRoute } from "@/hr/lib/routes";
import { ModuleGrid, OverviewBanner, OverviewChart, type ChartSeries } from "@/components/overview-ui";
import { arrange, overviewOrder } from "@/server/overview/layout";
import { saveOverviewOrderAction } from "@/app/actions";
import { Flash } from "@/components/ui";
import type { Portal, PortalId } from "@/lib/portals";
import {
  ArrowDown, ArrowRight, ArrowSquareOut, ArrowUp, Bell, Buildings, CalendarBlank, CalendarDots, CalendarPlus, CaretRight, ChartBar, CheckCircle, ClipboardText,
  ClockCounterClockwise, FilePlus, FileText, Gear, GearSix, IdentificationBadge, ShieldCheck, UserCirclePlus, UserPlus, Users, UsersThree, WarningCircle,
} from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

type Figure = [number, string];

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/* ── Top row: organisation card and figures ─────────────────────────────── */

function Sparkline({ series, colour }: { series: DailySeries; colour: string }) {
  const values = series.days.map((d) => d.value);
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 44},${16 - (v / max) * 14}`).join(" ");
  return (
    <svg aria-hidden="true" viewBox="-1 -1 46 20" className="h-[18px] w-[40px] shrink-0" fill="none">
      <polyline points={pts} stroke={colour} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function TrendLine({ trend, series }: { trend: Trend; series: DailySeries }) {
  const diff = trend.today - trend.yesterday;
  const good = diff === 0 ? null : (diff > 0) === trend.upIsGood;
  const colour = good === null ? "#6b7585" : good ? "#15803d" : "#c62828";
  const pct = trend.yesterday ? Math.round((Math.abs(diff) / trend.yesterday) * 100) : null;
  const words = diff === 0 ? "same as this time yesterday" : `${diff > 0 ? "up" : "down"} ${pct === null ? Math.abs(diff) : `${pct}%`} on this time yesterday`;
  return (
    <span className="flex items-center justify-between gap-1" title={`Today so far: ${trend.today}. Same time yesterday: ${trend.yesterday}.`}>
      <span className="flex items-center gap-0.5 whitespace-nowrap text-[10.5px] font-semibold" style={{ color: colour }}>
        {diff > 0 ? <ArrowUp size={11} weight="bold" aria-hidden="true" /> : diff < 0 ? <ArrowDown size={11} weight="bold" aria-hidden="true" /> : null}
        <span aria-hidden="true">{pct === null ? (diff ? `${diff > 0 ? "+" : "−"}${Math.abs(diff)}` : "0%") : `${pct}%`}</span>
        <span aria-hidden="true" className="font-normal text-[#7a8494]">vs yday</span>
        <span className="sr-only">{words}</span>
      </span>
      <Sparkline series={series} colour={good === false ? "#e05252" : "#22a35a"} />
    </span>
  );
}

interface StatSpec {
  key: string;
  value: number;
  label: string;
  href: string;
  /** HR Hub pages load as a full page. */
  external?: boolean;
  icon: React.ReactNode;
  colour: string;
  tint: string;
  trend?: { trend: Trend; series: DailySeries };
  /** Shown where there is no day-by-day history to compare against. */
  where: string;
}

function StatTile({ s }: { s: StatSpec }) {
  const body = (
    <>
      <span aria-hidden="true" className="flex h-[28px] w-[28px] items-center justify-center rounded-[8px]" style={{ background: s.tint, color: s.colour }}>{s.icon}</span>
      <span className="mt-1.5 block text-[20px] font-bold leading-[24px] text-[#0b1530]">{s.value}</span>
      <span className="block min-h-[28px] text-[11px] leading-[14px] text-[#4f5b6c]">{s.label}</span>
      <span className="mt-auto block pt-1.5">
        {s.trend ? <TrendLine {...s.trend} /> : <span className="flex items-center gap-1 whitespace-nowrap text-[10.5px] text-[#6b7585]"><span className="truncate">{s.where}</span><ArrowRight size={10} aria-hidden="true" className="shrink-0" /></span>}
      </span>
    </>
  );
  const cls = "ov-stat flex h-full flex-col rounded-[10px] border border-[#e8ebf0] bg-white px-2.5 pb-2 pt-2.5 text-inherit hover:border-[#c9d3e1]";
  return (
    <li data-testid={`stat-${s.key}`}>
      {s.external ? <a href={s.href} className={cls}>{body}</a> : <Link href={s.href} className={cls}>{body}</Link>}
    </li>
  );
}

/* ── Module cards ───────────────────────────────────────────────────────── */

interface CardSpec {
  key: string;
  portal: Portal;
  icon: React.ReactNode;
  items: string[];
  figures: Figure[];
  note?: string;
  preview: React.ReactNode;
}

function ModuleLink({ portal, className, style, label, children }: { portal: Portal; className: string; style?: React.CSSProperties; label?: string; children: React.ReactNode }) {
  return portal.separateApp ? <a href={portal.home} className={className} style={style} aria-label={label}>{children}</a> : <Link href={portal.home} className={className} style={style} aria-label={label}>{children}</Link>;
}

function ModuleCard({ spec, n }: { spec: CardSpec; n: number }) {
  const { portal } = spec;
  return (
    <article className="ov-tile" data-testid={`tile-${spec.key}`}>
      <div className="ov-tile-head" style={{ background: portal.colour }}>
        <span aria-hidden="true" className="ov-num">{n}</span>
        <span aria-hidden="true" className="flex shrink-0">{spec.icon}</span>
        <h2 className="min-w-0 text-[15px] font-semibold leading-tight text-white">{portal.name}</h2>
        <ModuleLink portal={portal} label={`Go to ${portal.name}`} className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-white hover:bg-white/15">
          <ArrowSquareOut size={18} aria-hidden="true" />
        </ModuleLink>
      </div>
      <div className="ov-preview">{spec.preview}</div>
      <div className="flex flex-1 gap-3 px-4 pt-2.5">
        <ul className="min-w-0 flex-1 space-y-[3px]">
          {spec.items.map((i) => (
            <li key={i} className="flex items-baseline gap-2.5 text-[12.5px] leading-[16px] text-[#2f3d52]">
              <span aria-hidden="true" className="h-[6px] w-[6px] shrink-0 -translate-y-px rounded-full" style={{ background: portal.colour }} />
              {i}
            </li>
          ))}
        </ul>
        <div className="flex w-[118px] shrink-0 flex-col justify-center gap-1.5 border-l border-[#eef0f3] pl-3">
          {spec.figures.length ? spec.figures.map(([v, label]) => (
            <p key={label} className="whitespace-nowrap text-[11.5px] leading-[13px] text-[#4f5b6c]">
              <span className="block text-[19px] font-bold leading-[21px]" style={{ color: portal.colour }}>{v}</span>{label}
            </p>
          )) : <p className="text-[11.5px] text-[#4f5b6c]">{spec.note}</p>}
        </div>
      </div>
      <ModuleLink portal={portal} className="ov-cta" style={{ color: portal.colour, borderColor: `${portal.colour}88`, background: portal.tint }}>
        <span>Open {portal.name}</span>
        <ArrowRight size={15} weight="bold" aria-hidden="true" />
      </ModuleLink>
    </article>
  );
}

/** An original drawing of a policy library: an index of documents beside a stack of policy pages, in the module colour. */
function PolicyPreview({ colour, published, total }: { colour: string; published: number; total: number }) {
  const page = (x: number, y: number, w: number, h: number, head: string, lines: number[], rotate = 0) => (
    <g transform={`rotate(${rotate} ${x + w / 2} ${y + h / 2})`} filter="url(#ov-doc-shadow)">
      <rect x={x} y={y} width={w} height={h} rx="4" fill="#fff" />
      <rect x={x + 9} y={y + 10} width={w * 0.42} height="6" rx="3" fill={head} />
      {lines.map((lw, i) => <rect key={i} x={x + 9} y={y + 24 + i * 9} width={(w - 18) * lw} height="4" rx="2" fill="#e3e8ef" />)}
    </g>
  );
  return (
    <svg viewBox="0 0 400 122" preserveAspectRatio="xMidYMid meet" className="block h-full w-full bg-[#f7f9fc]" role="img" aria-label={`Policy library: ${total} policies, ${published} in use`}>
      <defs>
        <filter id="ov-doc-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#0b1530" floodOpacity="0.12" />
        </filter>
      </defs>
      <rect width="400" height="122" fill="#f7f9fc" />
      <rect x="236" y="0" width="164" height="122" fill="#eef2f7" />
      <g transform="translate(0 5)">
      <rect x="16" y="14" width="44" height="7" rx="3.5" fill={colour} />
      {[176, 138, 190, 122, 166, 148].map((w, i) => <rect key={i} x="16" y={30 + i * 12.5} width={w} height="7" rx="3.5" fill="#e6eaf0" />)}
      {page(258, 10, 86, 104, "#94a3b8", [1, 0.8, 0.9, 0.6, 0.85, 0.7, 0.9], -7)}
      {page(282, 18, 86, 100, "#64748b", [0.9, 1, 0.7, 0.95, 0.6, 0.8, 0.75], 3)}
      {page(304, 30, 82, 92, "#475569", [1, 0.75, 0.9, 0.65, 0.85, 0.7])}
      <circle cx="372" cy="94" r="10" fill={colour} stroke="#fff" strokeWidth="2.5" />
      <path d="M367.5 94 l3 3 l5.5 -6" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

const VISIT_COLOURS: Record<string, string> = { SCHEDULED: "#8b6fe0", IN_PROGRESS: "#1f78d1", COMPLETED: "#1f9d6b", MISSED: "#d64545", NOT_DELIVERED: "#9aa3b2" };

function hhmm(min: number) {
  return `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:00`;
}

/** Today's planner for the three busiest carers, drawn from real visits. */
function RotaPreview({ board, window }: { board: RotaBoardRow[]; window: { start: number; end: number } }) {
  if (!board.length) return <p className="flex h-full items-center justify-center px-4 text-center text-[12.5px] text-[#5f6b7a]">No carers are booked on visits today.</p>;
  const span = Math.max(60, window.end - window.start);
  const hours = Math.max(1, Math.round(span / 60));
  const step = hours > 10 ? 3 : hours > 5 ? 2 : 1;
  const marks = Array.from({ length: Math.floor(hours / step) + 1 }, (_, i) => window.start + i * step * 60);
  return (
    <div className="flex h-full flex-col px-3 py-2" role="img" aria-label={`Today's rota for ${board.map((r) => `${r.name}, ${r.visits.length} visits`).join("; ")}`}>
      <div className="flex text-[9.5px] text-[#7a8494]" aria-hidden="true">
        <span className="w-[86px] shrink-0 font-medium text-[#3a4658]">Today</span>
        <span className="relative h-3 flex-1">
          {marks.map((m) => <span key={m} className="absolute -translate-x-1/2" style={{ left: `${((m - window.start) / span) * 100}%` }}>{hhmm(m)}</span>)}
        </span>
      </div>
      <div className="mt-1 flex min-h-0 flex-1 flex-col justify-around" aria-hidden="true">
        {board.map((r) => (
          <div key={r.staffId} className="flex items-center">
            <span className="flex w-[86px] shrink-0 items-center gap-1.5 pr-1">
              <span className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full bg-[#ede8fb] text-[8.5px] font-bold text-[#5b3bb5]">{initials(r.name)}</span>
              <span className="truncate text-[10.5px] text-[#2f3d52]">{r.name.split(" ")[0]}</span>
            </span>
            <span className="relative h-[16px] flex-1 rounded-[3px] bg-[repeating-linear-gradient(90deg,#f1f3f7_0,#f1f3f7_1px,transparent_1px,transparent_12.5%)]">
              {r.visits.map((v, i) => (
                <span key={i} className="absolute top-[2px] h-[12px] rounded-[3px]" style={{ left: `${((v.start - window.start) / span) * 100}%`, width: `${Math.max(1.5, ((v.end - v.start) / span) * 100)}%`, background: VISIT_COLOURS[v.status] ?? "#8b6fe0" }} />
              ))}
            </span>
          </div>
        ))}
      </div>
      <p className="flex shrink-0 gap-3 text-[9.5px] leading-[12px] text-[#5f6b7a]">
        {(["SCHEDULED", "COMPLETED", "MISSED"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1"><span aria-hidden="true" className="h-[7px] w-[7px] rounded-[2px]" style={{ background: VISIT_COLOURS[s] }} />{s === "SCHEDULED" ? "Planned" : s === "COMPLETED" ? "Completed" : "Missed"}</span>
        ))}
      </p>
    </div>
  );
}

const HR_STATUS: Record<HrPersonStatus, { fg: string; bg: string }> = {
  Compliant: { fg: "#15803d", bg: "#e8f6ee" },
  "Due soon": { fg: "#9a5b00", bg: "#fff3df" },
  "DBS pending": { fg: "#b45309", bg: "#fff1e3" },
  Attention: { fg: "#9a5b00", bg: "#fff3df" },
  "Checks overdue": { fg: "#b42318", bg: "#fdecea" },
  "Not assessed": { fg: "#4f5b6c", bg: "#eef0f3" },
};

function HrPreview({ people }: { people: { id: string; branch: string; name: string; job: string; status: HrPersonStatus }[] }) {
  if (!people.length) return <p className="flex h-full items-center justify-center px-4 text-center text-[12.5px] text-[#5f6b7a]">No employees to show yet.</p>;
  return (
    <ul className="flex h-full flex-col justify-center divide-y divide-[#eef0f3] px-2.5">
      {people.map((p) => (
        <li key={p.id}>
          <a href={`/hr${employeeRoute(p.id, p.branch, "/overview")}`} className="flex items-center gap-2.5 px-1 py-[4px] hover:bg-[#fafbfc]">
            <span aria-hidden="true" className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-[#fdeee4] text-[10px] font-bold text-[#c2410c]">{initials(p.name)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12px] font-medium leading-[15px] text-[#0b1530]">{p.name}</span>
              <span className="block truncate text-[11px] leading-[14px] text-[#5f6b7a]">{p.job}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1 rounded-[5px] px-1.5 py-[3px] text-[10.5px] font-medium" style={{ color: HR_STATUS[p.status].fg, background: HR_STATUS[p.status].bg }}>
              {p.status === "Compliant" ? <CheckCircle size={11} weight="fill" aria-hidden="true" /> : <span aria-hidden="true" className="h-[6px] w-[6px] rounded-full" style={{ background: HR_STATUS[p.status].fg }} />}
              {p.status}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function AdminPreview({ links }: { links: { href: string; label: string; icon: React.ReactNode }[] }) {
  if (!links.length) return <p className="flex h-full items-center justify-center px-4 text-center text-[12.5px] text-[#5f6b7a]">Settings are managed by your organisation admin.</p>;
  return (
    <ul className="flex h-full flex-col justify-center gap-[2px] px-2 py-1.5">
      {links.map((l) => (
        <li key={l.href}>
          <Link href={l.href} className="flex items-center gap-2.5 rounded-[6px] bg-[#f4f5f8] px-2.5 py-[4px] text-[12.5px] text-[#1b2533] hover:bg-[#eaedf2]">
            <span aria-hidden="true" className="flex text-[#3a4658]">{l.icon}</span>{l.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ── The page ───────────────────────────────────────────────────────────── */

/**
 * The Overview: the organisation's figures for today, quick actions, one card per module this person may open with a
 * preview drawn from real records, and the items that need attention. Every figure is counted from the database.
 */
export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePortal("overview");
  const sp = await searchParams;
  const savedOrder = await overviewOrder(ctx);
  const arranging = sp.arrange === "1" && Boolean(ctx.organisationId);
  const portals = new Map(portalsFor(ctx).map((p) => [p.id, p] as const));
  const has = (id: PortalId) => portals.has(id);
  const orgId = ctx.organisationId;
  const [m, hr, people, branches, rotaFigures, rota, serviceUsers, staff, signOffs, org, policyCounts] = await Promise.all([
    has("policy") ? dashboardMetrics(ctx) : null,
    has("hr") ? hrHeadline(ctx) : null,
    has("hr") ? hrPeoplePreview(ctx) : null,
    has("admin") && orgId ? db.branch.count({ where: { organisationId: orgId } }) : null,
    has("rota") ? rotaHeadline(ctx) : null,
    has("rota") ? rotaSnapshot(ctx) : null,
    has("rota") ? activeServiceUsers(ctx) : null,
    activeStaff(ctx),
    signOffSeries(ctx),
    orgId ? db.organisation.findUnique({ where: { id: orgId }, select: { name: true } }) : null,
    has("policy") && orgId
      ? Promise.all([db.policy.count({ where: { organisationId: orgId } }), db.policy.count({ where: { organisationId: orgId, status: "ACTIVE" } })])
      : null,
  ]);
  const can = (p: Parameters<typeof hasOrgPermission>[1]) => hasOrgPermission(ctx, p);

  const policy = portals.get("policy");
  const rotaPortal = portals.get("rota");
  const hrPortal = portals.get("hr");
  const reporting = portals.get("reporting");
  const admin = portals.get("admin");
  const blue = { colour: "#1f5fd1", tint: "#eaf1fd" };
  const purple = { colour: "#6b46c9", tint: "#f1ecfc" };
  const green = { colour: "#15803d", tint: "#e8f6ee" };
  const amber = { colour: "#c2410c", tint: "#fff1e6" };
  const red = { colour: "#c62828", tint: "#fdecec" };
  const slate = { colour: "#4b5666", tint: "#eef0f3" };
  const pink = { colour: "#c0267a", tint: "#fde9f3" };

  const stats: StatSpec[] = [];
  if (serviceUsers !== null) stats.push({ key: "service-users", value: serviceUsers, label: "Active Service Users", href: "/rota/service-users", icon: <Users size={17} weight="fill" />, ...purple, where: "Service Users" });
  if (rota) {
    stats.push({ key: "completed", value: rota.completedToday, label: "Visits Completed Today", href: "/rota/visits", icon: <CheckCircle size={17} weight="fill" />, ...green, trend: { trend: rota.completedTrend, series: rota.completedSeries }, where: "Daily Rota" });
    stats.push({ key: "pending", value: rota.pendingToday, label: "Pending Visits Today", href: "/rota/visits", icon: <CalendarBlank size={17} weight="fill" />, ...amber, where: "Daily Rota" });
    stats.push({ key: "missed", value: rota.missedToday, label: "Missed Visits Today", href: "/rota/monitor", icon: <WarningCircle size={17} weight="fill" />, ...red, trend: { trend: rota.missedTrend, series: rota.missedSeries }, where: "The Monitor" });
  }
  if (staff !== null) stats.push({ key: "staff", value: staff, label: "Active Staff", href: "/rota/staff", icon: <IdentificationBadge size={17} weight="fill" />, colour: "#1565c0", tint: "#e8f1fc", where: "Team Members" });
  if (m) stats.push({ key: "policies-overdue", value: m.overdueReviews, label: "Policy Reviews Overdue", href: "/policies?quick=overdue", icon: <FileText size={17} weight="fill" />, ...pink, where: "Policy Library" });
  if (hr && hrPortal) stats.push({ key: "checks-overdue", value: hr.overdue, label: "HR Checks Overdue", href: hrPortal.home, external: true, icon: <ShieldCheck size={17} weight="fill" />, ...blue, where: "HR & Workforce" });
  if (branches !== null) stats.push({ key: "branches", value: branches, label: "Total Branches", href: can("org.manage") ? "/admin/branches" : "/settings", icon: <Buildings size={17} weight="fill" />, ...slate, where: "Branches" });

  const actions: { label: string; href: string; icon: React.ReactNode; colour: string; tint: string; external?: boolean }[] = [];
  if (policy && can("policy.author")) actions.push({ label: "Create Policy", href: "/policies/new", icon: <FilePlus size={17} />, ...blue });
  if (rotaPortal && can("serviceUser.edit")) actions.push({ label: "Add Service User", href: "/rota/service-users/new", icon: <UserCirclePlus size={17} />, colour: "#0f8a5f", tint: "#e6f5ee" });
  if (rotaPortal && can("rota.edit")) actions.push({ label: "Assign Visits", href: "/rota/unassigned", icon: <UsersThree size={17} />, ...purple });
  if (rotaPortal && can("rota.edit")) actions.push({ label: "Add Visit", href: "/rota/visits/new", icon: <CalendarPlus size={17} />, ...red });
  if (hrPortal) actions.push({ label: "Add Staff", href: "/hr/people", icon: <UserPlus size={17} />, ...amber, external: true });
  if (can("report.view")) actions.push({ label: "Generate Report", href: "/reports", icon: <ChartBar size={17} />, ...blue });
  actions.push({ label: "View Alerts", href: "/notifications", icon: <Bell size={17} />, ...slate });

  const cards: CardSpec[] = [];
  if (policy && m) {
    cards.push({
      key: "policy", portal: policy, icon: <FileText size={22} />,
      items: ["Policy Library and templates", "Regulatory updates and AI drafting", "Approvals, sign-off and audits", "Actions, risks and evidence"],
      figures: [[m.draftsAwaitingApproval, "awaiting approval"], [m.overdueReviews, "reviews overdue"]],
      preview: <PolicyPreview colour={policy.colour} total={policyCounts?.[0] ?? 0} published={policyCounts?.[1] ?? 0} />,
    });
  }
  if (rotaPortal) {
    cards.push({
      key: "rota", portal: rotaPortal, icon: <CalendarDots size={22} />,
      items: ["Service users, care plans and risks", "Templates, Build Rota and the planner", "Live call monitoring and carer mobile", "Timesheets, invoicing and payroll preparation"],
      figures: rotaFigures ? [[rotaFigures.visitsToday, "visits today"], [rotaFigures.unassignedToday, "unassigned"]] : [], note: "Open your visits.",
      preview: rota ? <RotaPreview board={rota.board} window={rota.boardWindow} /> : <p className="flex h-full items-center justify-center px-4 text-center text-[12.5px] text-[#5f6b7a]">Open your visits in My Visits.</p>,
    });
  }
  if (hrPortal) {
    cards.push({
      key: "hr", portal: hrPortal, icon: <UsersThree size={22} />,
      items: ["Staff records and DBS tracking", "Training and qualifications", "Right to work and supervision", "Sickness and compliance alerts"],
      figures: hr ? [[hr.employees, "employees"], [hr.overdue, "checks overdue"]] : [], note: "Opens your HR Hub.",
      preview: <HrPreview people={people ?? []} />,
    });
  }
  if (reporting) {
    const series: ChartSeries[] = [];
    if (rota) series.push({ key: "visits", label: "Visits completed", days: rota.completedSeries.days });
    if (signOffs) series.push({ key: "signoffs", label: "Policy sign-offs", days: signOffs.days });
    if (rota) series.push({ key: "missed", label: "Missed visits", days: rota.missedSeries.days });
    cards.push({
      key: "reporting", portal: reporting, icon: <ChartBar size={22} />,
      items: ["Policy, sign-off and change reports", "Actions register", "CSV exports for inspections", "Ask the AI assistant"],
      figures: [[Object.keys(REPORTS).length, "report exports"]],
      preview: <OverviewChart series={series} colour="#2f7de1" />,
    });
  }
  if (admin) {
    const links = can("org.manage")
      ? [
          { href: "/settings", label: "Organisation Settings", icon: <GearSix size={16} /> },
          { href: "/admin/users", label: "Users & Roles", icon: <UsersThree size={16} /> },
          { href: "/admin/branches", label: "Branches & Locations", icon: <Buildings size={16} /> },
          { href: "/admin/audit", label: "Audit Log", icon: <ClockCounterClockwise size={16} /> },
        ]
      : [];
    cards.push({
      key: "admin", portal: { ...admin, name: "Administration & Settings" }, icon: <Gear size={22} />,
      items: ["Users, roles and branches", "Organisation settings", "Sources and background jobs", "Audit log"],
      figures: branches !== null ? [[branches, branches === 1 ? "branch" : "branches"]] : [], note: "Platform settings, sources and jobs.",
      preview: <AdminPreview links={links} />,
    });
  }

  // Only items that are real and non-zero, each linking to the page that deals with it.
  type Attention = { count: number; text: string; where: string; href: string; colour: string; tint: string; icon: React.ReactNode; external?: boolean };
  const attention: Attention[] = [];
  const policyTone = { colour: policy?.colour ?? blue.colour, tint: policy?.tint ?? blue.tint };
  if (policy && m) {
    if (m.draftsAwaitingApproval) attention.push({ count: m.draftsAwaitingApproval, text: m.draftsAwaitingApproval === 1 ? "Policy awaiting approval" : "Policies awaiting approval", where: "Policy & Compliance", href: "/queue", icon: <FileText size={17} />, ...policyTone });
    if (m.overdueReviews) attention.push({ count: m.overdueReviews, text: m.overdueReviews === 1 ? "Policy review overdue" : "Policy reviews overdue", where: "Policy & Compliance", href: "/policies?quick=overdue", icon: <FileText size={17} />, ...policyTone });
    if (m.newChanges + m.awaitingAssessment) attention.push({ count: m.newChanges + m.awaitingAssessment, text: "Regulatory changes to review", where: "Policy & Compliance", href: "/changes", icon: <ClipboardText size={17} />, ...policyTone });
    if (m.overdueAcks && can("staff.view")) attention.push({ count: m.overdueAcks, text: m.overdueAcks === 1 ? "Staff sign-off overdue" : "Staff sign-offs overdue", where: "Policy & Compliance", href: "/staff", icon: <FileText size={17} />, ...policyTone });
    if (m.overdueActions) attention.push({ count: m.overdueActions, text: m.overdueActions === 1 ? "Action past due date" : "Actions past due date", where: "Policy & Compliance", href: "/actions", icon: <ClipboardText size={17} />, ...policyTone });
  }
  if (rotaPortal && rotaFigures?.unassignedToday) attention.push({ count: rotaFigures.unassignedToday, text: rotaFigures.unassignedToday === 1 ? "Unassigned visit slot today" : "Unassigned visit slots today", where: "Rostering & Care Management", href: "/rota/unassigned", icon: <CalendarDots size={17} />, colour: rotaPortal.colour, tint: rotaPortal.tint });
  if (rota?.missedToday) attention.push({ count: rota.missedToday, text: rota.missedToday === 1 ? "Missed visit today" : "Missed visits today", where: "Rostering & Care Management", href: "/rota/monitor", icon: <WarningCircle size={17} weight="fill" />, ...red });
  if (rotaPortal && rotaFigures?.openAlerts) attention.push({ count: rotaFigures.openAlerts, text: rotaFigures.openAlerts === 1 ? "Rota alert needs attention" : "Rota alerts need attention", where: "Rostering & Care Management", href: "/rota/exceptions", icon: <WarningCircle size={17} />, colour: rotaPortal.colour, tint: rotaPortal.tint });
  if (hrPortal && hr?.overdue) attention.push({ count: hr.overdue, text: hr.overdue === 1 ? "HR check overdue" : "HR checks overdue", where: "HR & Workforce", href: hrPortal.home, external: true, icon: <UsersThree size={17} />, colour: hrPortal.colour, tint: hrPortal.tint });

  const ordered = ctx.organisationId ? arrange(cards.map((c) => c.key), savedOrder).flatMap((k) => cards.filter((c) => c.key === k)) : cards;

  const orgName = org?.name.replace(/\s+\(DEMO\)$/i, "") ?? "CSB platform administration";

  return (
    <div className="ov-root">
      <div className="space-y-2.5 px-4 pb-6 pt-3 md:px-[16px]">
        <Flash searchParams={sp} />
        <section aria-label="Today at a glance" className="flex flex-col gap-3 xl:flex-row">
          <div className="ov-hero flex shrink-0 flex-col justify-center rounded-[12px] px-[18px] py-3 text-white xl:w-[252px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/csb-monogram-on-dark.png" alt="" className="h-[36px] w-fit" width={356} height={180} />
            <h1 className="mt-2 font-sans text-[19px] font-semibold leading-[24px] tracking-[-0.01em] text-white" style={{ fontFamily: "inherit" }}>{orgName}</h1>
            <p className="mt-1 text-[12.5px] leading-[16px] text-white/[0.82]">Integrated care management across policy, workforce, service users, monitoring and compliance.</p>
          </div>
          {stats.length ? (
            <ul className="grid min-w-0 flex-1 grid-cols-2 gap-2 sm:grid-cols-4 2xl:grid-cols-8 xl:grid-cols-4" data-testid="overview-stats">
              {stats.map((s) => <StatTile key={s.key} s={s} />)}
            </ul>
          ) : null}
        </section>

        <nav aria-label="Quick actions" className="flex flex-col gap-2 rounded-[10px] border border-[#e8ebf0] bg-white p-[5px] lg:flex-row lg:items-center">
          <h2 className="shrink-0 whitespace-nowrap px-3 text-[14px] font-semibold text-[#0b1530]">Quick Actions</h2>
          <ul className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 lg:flex">
            {actions.map((a) => {
              const inner = (
                <>
                  <span aria-hidden="true" className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-[6px] text-white" style={{ background: a.colour }}>{a.icon}</span>
                  <span className="truncate">{a.label}</span>
                </>
              );
              const cls = "flex h-[40px] items-center gap-2 rounded-[8px] border px-2 text-[12px] font-medium text-[#1b2533] hover:brightness-[0.98]";
              const style = { background: a.tint, borderColor: `${a.colour}22` };
              return (
                <li key={a.label} className="min-w-0 lg:flex-1">
                  {a.external ? <a href={a.href} className={cls} style={style}>{inner}</a> : <Link href={a.href} className={cls} style={style}>{inner}</Link>}
                </li>
              );
            })}
          </ul>
        </nav>

        <ModuleGrid
          arranging={arranging}
          saveAction={saveOverviewOrderAction}
          items={ordered.map((c, i) => ({ key: c.key, name: c.portal.name, node: <ModuleCard spec={c} n={i + 1} /> }))}
          after={
          <section aria-labelledby="attention-title" className="ov-tile px-4 pb-2 pt-3.5" data-testid="needs-attention">
            <div className="mb-1 flex items-center justify-between">
              <h2 id="attention-title" className="text-[16px] font-semibold text-[#0b1530]">Needs your attention</h2>
              <Link href="/notifications" className="flex items-center gap-1 text-[12.5px] font-medium text-[#1565c0]">View all <ArrowRight size={13} aria-hidden="true" /></Link>
            </div>
            {attention.length ? (
              <ul>
                {attention.slice(0, 5).map((a) => {
                  const inner = (
                    <>
                      <span aria-hidden="true" className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-[8px]" style={{ background: a.tint, color: a.colour }}>{a.icon}</span>
                      <span className="w-[30px] shrink-0 text-[16px] font-bold text-[#0b1530]">{a.count}</span>
                      <span className="min-w-0 flex-1 text-[13px] leading-snug text-[#0b1530]">{a.text}<span className="mt-0.5 block text-[11.5px] text-[#646e7f]">{a.where}</span></span>
                      <CaretRight size={14} aria-hidden="true" className="shrink-0 text-[#7a8494]" />
                    </>
                  );
                  const cls = "flex items-center gap-2.5 rounded-[6px] py-[9px] hover:bg-[#fafbfc]";
                  return (
                    <li key={a.text} className="border-t border-[#f0f1f4] first:border-t-0">
                      {a.external ? <a href={a.href} className={cls}>{inner}</a> : <Link href={a.href} className={cls}>{inner}</Link>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-[13px] text-[#4f5b6c]">Nothing needs your attention right now.</p>
            )}
          </section>
          }
        />

        <OverviewBanner />
      </div>
    </div>
  );
}
