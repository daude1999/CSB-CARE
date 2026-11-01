import Link from "@/components/link";
import { db } from "@/lib/db";
import { requirePortal, portalsFor } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { dashboardMetrics } from "@/server/reports/metrics";
import { REPORTS } from "@/server/reports/tables";
import { hrHeadline, hrPeoplePreview, type HrPersonStatus } from "@/server/hr/summary";
import { rotaHeadline } from "@/server/rota/summary";
import { rotaSnapshot, signOffSeries } from "@/server/overview/snapshot";
import { employeeRoute } from "@/hr/lib/routes";
import { ModuleGrid, OverviewBanner, OverviewChart, type ChartSeries } from "@/components/overview-ui";
import { arrange, overviewOrder } from "@/server/overview/layout";
import { saveOverviewOrderAction } from "@/app/actions";
import { Flash } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import type { Portal, PortalId } from "@/lib/portals";
import {
  ArrowRight, ArrowSquareOut, Bell, Buildings, CalendarBlank, CalendarDots, CalendarPlus, CaretRight, ChartBar, CheckCircle, ClipboardText,
  ClockCounterClockwise, FilePlus, FileText, Gear, GearSix, IdentificationBadge, UserCirclePlus, UserPlus, UsersThree, WarningCircle,
} from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

type Figure = [number, string];

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/* ── Module cards ───────────────────────────────────────────────────────── */

interface CardSpec {
  key: string;
  portal: Portal;
  icon: React.ReactNode;
  items: string[];
  figures: Figure[];
  note?: string;
  preview: React.ReactNode;
  /** The Rostering card shows its figures in place of a preview drawing, without the preview frame. */
  bare?: boolean;
}

function ModuleLink({ portal, className, style, label, children }: { portal: Portal; className: string; style?: React.CSSProperties; label?: string; children: React.ReactNode }) {
  return <Link href={portal.home} className={className} style={style} aria-label={label}>{children}</Link>;
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
      <div className={spec.bare ? "ov-rota-figures" : "ov-preview"}>{spec.preview}</div>
      <div className="flex flex-1 gap-3 px-4 pt-2.5">
        <ul className="min-w-0 flex-1 space-y-[3px]">
          {spec.items.map((i) => (
            <li key={i} className="flex items-baseline gap-2.5 text-[12.5px] leading-[16px] text-[#2f3d52]">
              <span aria-hidden="true" className="h-[6px] w-[6px] shrink-0 -translate-y-px rounded-full" style={{ background: portal.colour }} />
              {i}
            </li>
          ))}
        </ul>
        {spec.figures.length || spec.note ? (
          <div className="flex w-[118px] shrink-0 flex-col justify-center gap-1.5 border-l border-[#eef0f3] pl-3">
            {spec.figures.length ? spec.figures.map(([v, label]) => (
              <p key={label} className="whitespace-nowrap text-[11.5px] leading-[13px] text-[#4f5b6c]">
                <span className="block text-[19px] font-bold leading-[21px]" style={{ color: portal.colour }}>{v}</span>{label}
              </p>
            )) : <p className="text-[11.5px] text-[#4f5b6c]">{spec.note}</p>}
          </div>
        ) : null}
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

interface RotaFigure {
  key: string;
  value: number;
  /** The label, with an optional second line so narrow tiles break in a sensible place. */
  label: [string, string?];
  href: string;
  icon: React.ReactNode;
  colour: string;
  tint: string;
}

/**
 * Today's rota in five figures, in place of a planner drawing. Each is counted from today's visits within the person's
 * branch and area grants, with the Rota Dashboard's definitions, and opens the page it was counted from.
 */
function RotaFigures({ figures }: { figures: RotaFigure[] }) {
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-6" data-testid="rota-figures">
      {figures.map((f, i) => (
        <li key={f.key} className={i < 3 ? "sm:col-span-2" : i === figures.length - 1 && figures.length % 2 ? "col-span-2 sm:col-span-3" : "sm:col-span-3"}>
          <Link href={f.href} data-testid={`rota-figure-${f.key}`} className="flex h-full min-h-[60px] items-center gap-2 rounded-[9px] border border-[#ebe7f6] bg-[#fbfaff] px-2 py-2 hover:border-[#d9d1f1] hover:bg-[#f6f3fe]">
            <span aria-hidden="true" className="flex h-[24px] w-[24px] shrink-0 items-center justify-center rounded-full" style={{ background: f.tint, color: f.colour }}>{f.icon}</span>
            <span className="min-w-0">
              <span className="block text-[21px] font-bold leading-[24px] text-[#0b1530]">{f.value}</span>
              <span className="block text-[11px] leading-[14px] text-[#3a4658]">{f.label[0]}{f.label[1] ? <> <br className="hidden sm:inline" />{f.label[1]}</> : null}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
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
 * The Overview (owner-approved design, 1 Nov 2026): quick actions, one card per module this person may open with a
 * preview drawn from real records, and the items that need attention. The header (logo, date and time, the signed-in
 * person) is drawn by the app layout. There is deliberately no row of figures above the cards: each module's figures
 * sit in its own card. Every figure is counted from the database.
 */
export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePortal("overview");
  const sp = await searchParams;
  const savedOrder = await overviewOrder(ctx);
  const arranging = sp.arrange === "1" && Boolean(ctx.organisationId);
  const portals = new Map(portalsFor(ctx).map((p) => [p.id, p] as const));
  const has = (id: PortalId) => portals.has(id);
  const orgId = ctx.organisationId;
  const [m, hr, people, branches, rotaFigures, rota, signOffs, policyCounts] = await Promise.all([
    has("policy") ? dashboardMetrics(ctx) : null,
    has("hr") ? hrHeadline(ctx) : null,
    has("hr") ? hrPeoplePreview(ctx) : null,
    has("admin") && orgId ? db.branch.count({ where: { organisationId: orgId } }) : null,
    has("rota") ? rotaHeadline(ctx) : null,
    has("rota") ? rotaSnapshot(ctx) : null,
    signOffSeries(ctx),
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
    // The five figures follow the Rota Dashboard's definitions. "Missed" counts only visits confirmed as missed, never a
    // visit that is merely late or still waiting for a clock-in; "unassigned" matches the Needs your attention row.
    const figures: RotaFigure[] = rota && rotaFigures
      ? [
          { key: "completed", value: rota.completedToday, label: ["Visits completed", "today"], href: "/rota/visits", icon: <CheckCircle size={16} weight="fill" />, ...green },
          { key: "pending", value: rota.pendingToday, label: ["Pending visits", "today"], href: "/rota/visits", icon: <CalendarBlank size={16} weight="fill" />, ...amber },
          { key: "missed", value: rota.missedToday, label: ["Missed visits", "today"], href: "/rota/monitor", icon: <WarningCircle size={16} weight="fill" />, ...red },
          { key: "unassigned", value: rotaFigures.unassignedToday, label: ["Unassigned visits today"], href: "/rota/visits?view=unassigned", icon: <UsersThree size={16} weight="fill" />, ...purple },
          { key: "staff", value: rota.staffOnRota, label: ["Active staff on rota"], href: "/rota/staff", icon: <IdentificationBadge size={16} weight="fill" />, colour: "#1565c0", tint: "#edf4fd" },
        ]
      : [];
    cards.push({
      key: "rota", portal: rotaPortal, icon: <CalendarDots size={22} />,
      items: ["Service users, care plans and risks", "Templates, Build Rota and the planner", "Live call monitoring and carer mobile", "Timesheets, invoicing and payroll preparation"],
      figures: [], note: figures.length ? undefined : "Open your visits.",
      bare: figures.length > 0,
      preview: figures.length ? <RotaFigures figures={figures} /> : <p className="flex h-full items-center justify-center px-4 text-center text-[12.5px] text-[#5f6b7a]">Open your visits in My Visits.</p>,
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
  // `rank` puts today's care-delivery problems first, then overdue work, then reviews: the first rows are always the
  // ones that affect people being cared for today.
  type Attention = { count: number; text: string; where: string; href: string; colour: string; tint: string; icon: React.ReactNode; external?: boolean; rank: number };
  const attention: Attention[] = [];
  const policyTone = { colour: policy?.colour ?? blue.colour, tint: policy?.tint ?? blue.tint };
  if (policy && m) {
    if (m.draftsAwaitingApproval) attention.push({ rank: 4, count: m.draftsAwaitingApproval, text: m.draftsAwaitingApproval === 1 ? "Policy awaiting approval" : "Policies awaiting approval", where: "Policy & Compliance", href: "/queue", icon: <FileText size={17} />, ...policyTone });
    if (m.overdueReviews) attention.push({ rank: 3, count: m.overdueReviews, text: m.overdueReviews === 1 ? "Policy review overdue" : "Policy reviews overdue", where: "Policy & Compliance", href: "/policies?quick=overdue", icon: <FileText size={17} />, ...policyTone });
    if (m.newChanges + m.awaitingAssessment) attention.push({ rank: 5, count: m.newChanges + m.awaitingAssessment, text: "Regulatory changes to review", where: "Policy & Compliance", href: "/changes", icon: <ClipboardText size={17} />, ...policyTone });
    if (m.overdueAcks && can("staff.view")) attention.push({ rank: 3, count: m.overdueAcks, text: m.overdueAcks === 1 ? "Staff sign-off overdue" : "Staff sign-offs overdue", where: "Policy & Compliance", href: "/staff", icon: <FileText size={17} />, ...policyTone });
    if (m.overdueActions) attention.push({ rank: 3, count: m.overdueActions, text: m.overdueActions === 1 ? "Action past due date" : "Actions past due date", where: "Policy & Compliance", href: "/actions", icon: <ClipboardText size={17} />, ...policyTone });
  }
  if (rotaPortal && rotaFigures?.unassignedToday) attention.push({ rank: 1, count: rotaFigures.unassignedToday, text: rotaFigures.unassignedToday === 1 ? "Unassigned visit today" : "Unassigned visits today", where: "Rostering & Care Management", href: "/rota/visits?view=unassigned", icon: <CalendarDots size={17} />, colour: rotaPortal.colour, tint: rotaPortal.tint });
  if (rota?.missedToday) attention.push({ rank: 0, count: rota.missedToday, text: rota.missedToday === 1 ? "Missed visit today" : "Missed visits today", where: "Rostering & Care Management", href: "/rota/monitor", icon: <WarningCircle size={17} weight="fill" />, ...red });
  if (rotaPortal && rotaFigures?.openAlerts) attention.push({ rank: 1, count: rotaFigures.openAlerts, text: rotaFigures.openAlerts === 1 ? "Rota alert needs attention" : "Rota alerts need attention", where: "Rostering & Care Management", href: "/rota/exceptions", icon: <WarningCircle size={17} />, colour: rotaPortal.colour, tint: rotaPortal.tint });
  if (hrPortal && hr?.overdue) attention.push({ rank: 2, count: hr.overdue, text: hr.overdue === 1 ? "HR check overdue" : "HR checks overdue", where: "HR & Workforce", href: hrPortal.home, external: true, icon: <UsersThree size={17} />, colour: hrPortal.colour, tint: hrPortal.tint });

  attention.sort((a, b) => a.rank - b.rank);
  const SHOWN = 6;

  const ordered = ctx.organisationId ? arrange(cards.map((c) => c.key), savedOrder).flatMap((k) => cards.filter((c) => c.key === k)) : cards;

  return (
    <div className="ov-root">
      <div className="space-y-2.5 px-4 pb-6 pt-4 md:px-[16px]">
        <Flash searchParams={sp} />
        <AutoRefresh seconds={60} />
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
                {attention.slice(0, SHOWN).map((a) => {
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
            {attention.length > SHOWN ? (
              <p className="border-t border-[#f0f1f4] pt-2 text-[12px] text-[#4f5b6c]">
                {attention.length - SHOWN} more {attention.length - SHOWN === 1 ? "item" : "items"}: {attention.slice(SHOWN).map((a, i) => (
                  <span key={a.text}>{i ? ", " : ""}{a.external ? <a href={a.href} className="text-[#1565c0]">{a.text.toLowerCase()} ({a.count})</a> : <Link href={a.href} className="text-[#1565c0]">{a.text.toLowerCase()} ({a.count})</Link>}</span>
                ))}
              </p>
            ) : null}
          </section>
          }
        />

        <OverviewBanner />
      </div>
    </div>
  );
}
