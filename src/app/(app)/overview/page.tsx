import Link from "@/components/link";
import { db } from "@/lib/db";
import { fmtLondonDate, londonDate, londonMinute } from "@/lib/london";
import { coverAlert, greeting, type CallRound } from "@/lib/overview-rounds";
import { requirePortal, portalsFor } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { dashboardMetrics } from "@/server/reports/metrics";
import { REPORTS } from "@/server/reports/tables";
import { hrHeadline } from "@/server/hr/summary";
import { rotaHeadline } from "@/server/rota/summary";
import { rotaSnapshot } from "@/server/overview/snapshot";
import { ModuleGrid } from "@/components/overview-ui";
import { arrange, overviewOrder } from "@/server/overview/layout";
import { saveOverviewOrderAction } from "@/app/actions";
import { Flash } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import type { Portal, PortalId } from "@/lib/portals";
import { ArrowRight, CalendarDots, Check, ChartBar, ClipboardText, FileText, GearSix, UsersThree, WarningCircle } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/* ── Rota lead tile ─────────────────────────────────────────────────────── */

function RoundBlock({ round, wide }: { round: CallRound; wide: boolean }) {
  return (
    <li className={`ovx-round ${wide ? "flex-[1_1_0]" : "flex-[0.6_1_0]"}`} data-state={round.state} data-testid={`round-${round.label.toLowerCase()}`}>
      <span className="flex items-center justify-between gap-2 text-[13px] font-semibold leading-[17px]">
        <span className="truncate">{round.label}</span>
        {round.state === "done" ? <span className="ovx-round-tag flex items-center gap-0.5"><Check size={11} weight="bold" aria-hidden="true" />Done</span> : null}
        {round.state === "now" ? <span className="ovx-round-tag">Now</span> : null}
      </span>
      <span className="mt-1 block leading-none">
        <span className="text-[18px] font-bold tabular-nums">{round.done}</span>
        <span className="ovx-round-of text-[12.5px] tabular-nums"> / {round.total}</span>
        <span className="sr-only"> visits done{round.state === "now" ? ", in progress now" : round.state === "done" ? ", round finished" : ""}</span>
      </span>
    </li>
  );
}

function RotaTile({ portal, done, total, carers, missed, rounds }: { portal: Portal; done: number; total: number; carers: number; missed: number; rounds: CallRound[] }) {
  const alert = coverAlert(rounds);
  const biggest = Math.max(1, ...rounds.map((r) => r.total));
  return (
    <section aria-labelledby="ov-rota-title" className="ovx-solid dm-fixed flex flex-col p-5" style={{ "--tile": portal.colour } as React.CSSProperties} data-testid="tile-rota">
      <CalendarDots aria-hidden="true" className="ovx-ghost -right-8 -top-10 opacity-[.06]" size={240} weight="regular" />
      <div className="relative flex items-center gap-3">
        <span aria-hidden="true" className="ovx-chip"><CalendarDots size={16} /></span>
        <h2 id="ov-rota-title" className="ovx-title min-w-0 flex-1 text-[15px] font-semibold leading-tight">{portal.name}</h2>
        <Link href="/rota/visits" className="ovx-pill">Open rota <ArrowRight size={13} weight="bold" aria-hidden="true" /></Link>
      </div>
      <div className="relative mt-3 flex flex-wrap items-end gap-x-4 gap-y-1">
        <p className="flex items-baseline gap-3" data-testid="rota-headline">
          <span className="text-[52px] font-bold leading-[0.95] tracking-[-0.02em] tabular-nums">{done}</span>
          <span className="text-[16px] font-medium">of {total} {plural(total, "visit", "visits")} done today</span>
        </p>
        <p className="ovx-soft ml-auto pb-1 text-[13px]">{carers} {plural(carers, "carer", "carers")} working · {missed} missed</p>
      </div>
      {rounds.length ? (
        <ul className="relative mt-4 grid grid-cols-2 gap-2.5 lg:flex" aria-label="Today's call rounds">
          {rounds.map((r) => <RoundBlock key={r.name} round={r} wide={r.total * 4 >= biggest} />)}
        </ul>
      ) : (
        <p className="ovx-soft relative mt-4 text-[13px]">No visits are booked for today.</p>
      )}
      <div className="ovx-alert relative mt-4 flex min-h-[46px] items-center gap-3 px-3.5 py-1.5 min-[1100px]:mt-auto" data-testid="rota-cover">
        <span aria-hidden="true" className={`h-[9px] w-[9px] shrink-0 rounded-full ${alert ? "bg-[#dc2626]" : "bg-[#16a34a]"}`} />
        <p className="min-w-0 flex-1 text-[14px] font-semibold">{alert ?? "All visits covered"}</p>
        {alert ? <Link href="/rota/visits?view=unassigned" className="ovx-cover">Find cover <ArrowRight size={13} weight="bold" aria-hidden="true" /></Link> : null}
      </div>
    </section>
  );
}

/* ── Module tiles ───────────────────────────────────────────────────────── */

interface Tile {
  key: "policy" | "hr" | "reporting" | "admin";
  portal: Portal;
  name: string;
  icon: React.ReactNode;
  ghost: React.ReactNode;
  figure: number;
  label: string;
  detail: string;
  /** HR pages are full page loads (the HR Hub has its own shell). */
  external?: boolean;
}

function ModuleTile({ tile }: { tile: Tile }) {
  const body = (
    <>
      {tile.ghost}
      <span className="relative flex items-center gap-3">
        <span aria-hidden="true" className="ovx-chip">{tile.icon}</span>
        <span className="ovx-title text-[15px] font-semibold leading-tight">{tile.name}</span>
      </span>
      <span className="relative mt-auto block">
        <span className="flex items-baseline gap-2.5 whitespace-nowrap">
          <span className="text-[36px] font-bold leading-none tracking-[-0.02em] tabular-nums">{tile.figure}</span>
          <span className="text-[14px] font-medium">{tile.label}</span>
        </span>
        <span className="ovx-soft mt-1.5 block truncate pr-[38px] text-[12.5px]" title={tile.detail}>{tile.detail}</span>
      </span>
      <span aria-hidden="true" className="ovx-arrow"><ArrowRight size={15} weight="bold" /></span>
    </>
  );
  const props = { className: "ovx-solid ovx-tile dm-fixed", style: { "--tile": tile.portal.colour } as React.CSSProperties, "data-testid": `tile-${tile.key}` };
  return tile.external ? <a href={tile.portal.home} {...props}>{body}</a> : <Link href={tile.portal.home} {...props}>{body}</Link>;
}

/** Visits completed on each of the last seven days, as small white bars; today (so far) is drawn at half strength. */
function WeekBars({ days }: { days: { date: string; value: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.value));
  return (
    <span aria-hidden="true" className="absolute right-5 top-[50px] flex h-[52px] items-end gap-[6px]" data-testid="reporting-bars">
      {days.map((d, i) => (
        <span key={d.date} className={`ovx-bar w-[8px] ${i === days.length - 1 ? "opacity-50" : ""}`} style={{ height: `${Math.max(6, (d.value / max) * 100)}%` }} />
      ))}
    </span>
  );
}

/* ── The page ───────────────────────────────────────────────────────────── */

type Attention = { key: string; count: number; text: string; action: string; href: string; colour: string; icon: React.ReactNode; external?: boolean; rank: number };

/**
 * The Overview (owner's redesign of 10 Nov 2026): a greeting, today's rota with its call rounds beside the items that
 * need attention, and one solid tile per other module. The header (logo, date and time, the signed-in person) is drawn
 * by the app layout. Every figure is counted from the database within the person's own permissions and branches.
 */
export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requirePortal("overview");
  const sp = await searchParams;
  const now = new Date();
  const savedOrder = await overviewOrder(ctx);
  const arranging = sp.arrange === "1" && Boolean(ctx.organisationId);
  const portals = new Map(portalsFor(ctx).map((p) => [p.id, p] as const));
  const has = (id: PortalId) => portals.has(id);
  const orgId = ctx.organisationId;
  const [org, m, hr, branches, users, rotaFigures, rota] = await Promise.all([
    orgId ? db.organisation.findUnique({ where: { id: orgId }, select: { name: true } }) : null,
    has("policy") ? dashboardMetrics(ctx) : null,
    has("hr") ? hrHeadline(ctx) : null,
    has("admin") && orgId ? db.branch.count({ where: { organisationId: orgId } }) : null,
    has("admin") && orgId ? db.membership.count({ where: { organisationId: orgId, deactivatedAt: null } }) : null,
    has("rota") ? rotaHeadline(ctx) : null,
    has("rota") ? rotaSnapshot(ctx, now) : null,
  ]);
  const can = (p: Parameters<typeof hasOrgPermission>[1]) => hasOrgPermission(ctx, p);

  const policy = portals.get("policy");
  const rotaPortal = portals.get("rota");
  const hrPortal = portals.get("hr");
  const reporting = portals.get("reporting");
  const admin = portals.get("admin");

  // Needs your attention: only real, non-zero items, each with the one action that deals with it. `rank` puts today's
  // care-delivery problems first, then overdue work, then reviews.
  const attention: Attention[] = [];
  const rotaColour = rotaPortal?.colour ?? "#6b46c9";
  if (rotaPortal && rotaFigures?.unassignedToday) attention.push({ key: "unassigned", rank: 0, count: rotaFigures.unassignedToday, text: plural(rotaFigures.unassignedToday, "Visit needs a carer today", "Visits need a carer today"), action: "Find cover", href: "/rota/visits?view=unassigned", colour: rotaColour, icon: <CalendarDots size={16} /> });
  if (rotaPortal && rota?.missedToday) attention.push({ key: "missed", rank: 0, count: rota.missedToday, text: plural(rota.missedToday, "Missed visit today", "Missed visits today"), action: "Review", href: "/rota/monitor", colour: rotaColour, icon: <WarningCircle size={16} /> });
  if (rotaPortal && rotaFigures?.openAlerts) attention.push({ key: "alerts", rank: 1, count: rotaFigures.openAlerts, text: plural(rotaFigures.openAlerts, "Rota alert to review", "Rota alerts to review"), action: "Review", href: "/rota/exceptions", colour: rotaColour, icon: <CalendarDots size={16} /> });
  if (hrPortal && hr?.overdue) attention.push({ key: "hr", rank: 2, count: hr.overdue, text: plural(hr.overdue, "HR check overdue", "HR checks overdue"), action: "Review", href: hrPortal.home, external: true, colour: hrPortal.colour, icon: <UsersThree size={16} /> });
  const policyParts: string[] = [];
  let policyTotal = 0;
  if (policy && m) {
    const add = (key: string, rank: number, count: number, text: [string, string], part: [string, string], action: string, href: string, icon: React.ReactNode) => {
      if (!count) return;
      attention.push({ key, rank, count, text: plural(count, ...text), action, href, colour: policy.colour, icon });
      policyParts.push(`${count} ${plural(count, ...part)}`);
      policyTotal += count;
    };
    if (can("staff.view")) add("signoffs", 3, m.overdueAcks, ["Staff sign-off overdue", "Staff sign-offs overdue"], ["sign-off", "sign-offs"], "Chase", "/staff", <FileText size={16} />);
    add("reviews", 3, m.overdueReviews, ["Policy review overdue", "Policy reviews overdue"], ["review overdue", "reviews overdue"], "Open", "/policies?quick=overdue", <FileText size={16} />);
    add("actions", 3, m.overdueActions, ["Action past due date", "Actions past due date"], ["action past due", "actions past due"], "Open", "/actions", <ClipboardText size={16} />);
    add("approval", 4, m.draftsAwaitingApproval, ["Policy awaiting approval", "Policies awaiting approval"], ["awaiting approval", "awaiting approval"], "Review", "/queue", <FileText size={16} />);
    add("changes", 5, m.newChanges + m.awaitingAssessment, ["Regulatory change to review", "Regulatory changes to review"], ["change to review", "changes to review"], "Review", "/changes", <ClipboardText size={16} />);
  }
  attention.sort((a, b) => a.rank - b.rank);
  const SHOWN = 5;

  const tiles: Tile[] = [];
  if (policy && m) {
    tiles.push({
      key: "policy", portal: policy, name: policy.name, icon: <FileText size={21} />,
      ghost: <FileText aria-hidden="true" className="ovx-ghost -right-5 -top-5 opacity-10" size={150} />,
      figure: policyTotal, label: "to action", detail: policyParts.length ? policyParts.join(", ") : "Nothing overdue",
    });
  }
  if (hrPortal) {
    const detail = [hr ? `${hr.employees} ${plural(hr.employees, "employee", "employees")}` : null, rota ? `${rota.staffOnRota} on rota today` : null].filter(Boolean).join(" · ");
    tiles.push({
      key: "hr", portal: hrPortal, name: hrPortal.name, icon: <UsersThree size={21} />, external: true,
      ghost: <UsersThree aria-hidden="true" className="ovx-ghost -right-6 -top-6 opacity-10" size={160} />,
      figure: hr?.overdue ?? 0, label: "checks overdue", detail: detail || "Opens your HR Hub",
    });
  }
  if (reporting) {
    const exportsReady = `${Object.keys(REPORTS).length} report exports ready`;
    const week = rota ? rota.completedSeries.days.reduce((n, d) => n + d.value, 0) : null;
    tiles.push({
      key: "reporting", portal: reporting, name: reporting.name, icon: <ChartBar size={21} />,
      ghost: rota ? <WeekBars days={rota.completedSeries.days} /> : <ChartBar aria-hidden="true" className="ovx-ghost -right-5 -top-5 opacity-10" size={150} />,
      figure: week ?? Object.keys(REPORTS).length, label: week !== null ? "visits, 7 days" : "report exports", detail: week !== null ? exportsReady : "Reports and CSV exports",
    });
  }
  if (admin) {
    tiles.push({
      key: "admin", portal: admin, name: "Administration", icon: <GearSix size={21} />,
      ghost: <GearSix aria-hidden="true" className="ovx-ghost -right-8 -top-8 opacity-10" size={165} />,
      figure: branches ?? 0, label: plural(branches ?? 0, "branch", "branches"), detail: users !== null ? `${users} ${plural(users, "user", "users")} · activity log` : "Settings and activity log",
    });
  }
  const ordered = ctx.organisationId ? arrange(tiles.map((t) => t.key), savedOrder).flatMap((k) => tiles.filter((t) => t.key === k)) : tiles;

  const minute = londonMinute(now);
  const firstName = ctx.userName.trim().split(/\s+/)[0] ?? "";
  const today = fmtLondonDate(londonDate(now), { weekday: "long", day: "numeric", month: "long" }).replace(",", "");
  const showRota = Boolean(rotaPortal && rota);

  return (
    <div className="ov-root">
      <div className="space-y-3.5 px-4 pb-6 pt-4 md:px-4">
        <Flash searchParams={sp} />
        <AutoRefresh seconds={60} />
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <div className="min-w-0 flex-1">
            <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.01em] text-ink" data-testid="overview-greeting">{greeting(minute)}{firstName ? `, ${firstName}` : ""}</h2>
            <p className="mt-0.5 text-[14px] text-[#475467]">Here is {org?.name ?? "your organisation"} today, {today}.</p>
          </div>
          {!arranging && ctx.organisationId && ordered.length > 1 ? (
            <a href="/overview?arrange=1" className="rounded-[6px] px-1.5 py-0.5 text-[13px] text-[#475467] hover:bg-black/5 hover:text-ink" data-testid="arrange-modules">Rearrange</a>
          ) : null}
        </div>

        <div className={`grid grid-cols-1 gap-4 [&>*]:min-w-0 ${showRota ? "min-[1100px]:grid-cols-[minmax(0,60fr)_minmax(0,40fr)]" : ""}`}>
          {rotaPortal && rota ? (
            <RotaTile portal={rotaPortal} done={rota.completedToday} total={rota.visitsToday} carers={rota.staffOnRota} missed={rota.missedToday} rounds={rota.rounds} />
          ) : null}
          <section aria-labelledby="attention-title" className="ovx-attention flex flex-col rounded-[18px] border border-[#eaecf0] bg-white px-5 pb-2 pt-4" data-testid="needs-attention">
            <div className="flex items-center justify-between gap-3 border-b border-[#eaecf0] pb-2.5">
              <h2 id="attention-title" className="text-[15px] font-semibold text-ink">Needs your attention</h2>
              {attention.length ? (
                <Link href="/notifications" className="flex items-center gap-1 text-[13px] font-semibold text-[#1565c0]">View all {attention.length} <ArrowRight size={14} weight="bold" aria-hidden="true" /></Link>
              ) : null}
            </div>
            {attention.length ? (
              <ul>
                {attention.slice(0, SHOWN).map((a, i) => {
                  const cls = i === 0 ? "ovx-act ovx-act-primary" : "ovx-act";
                  const style = i === 0 ? ({ "--tile": a.colour } as React.CSSProperties) : undefined;
                  const label = <>{a.action}<span className="sr-only">: {a.count} {a.text.toLowerCase()}</span></>;
                  return (
                    <li key={a.key} className="flex min-h-[48px] items-center gap-3 border-b border-[#f0f1f4] py-2 last:border-b-0" data-testid={`attention-${a.key}`}>
                      <span aria-hidden="true" className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] text-white" style={{ background: a.colour }}>{a.icon}</span>
                      <span className="w-[26px] shrink-0 text-[15px] font-bold tabular-nums text-ink">{a.count}</span>
                      <span className="min-w-0 flex-1 text-[14px] text-ink">{a.text}</span>
                      {a.external ? <a href={a.href} className={cls} style={style}>{label}</a> : <Link href={a.href} className={cls} style={style}>{label}</Link>}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="py-4 text-[13px] text-[#475467]">Nothing needs your attention right now.</p>
            )}
          </section>
        </div>

        {ordered.length ? (
          <ModuleGrid
            // A new saved or standard order from the server starts the arrange state afresh.
            key={ordered.map((t) => t.key).join()}
            arranging={arranging}
            saveAction={saveOverviewOrderAction}
            columns={ordered.length}
            items={ordered.map((t) => ({ key: t.key, name: t.portal.name, node: <ModuleTile tile={t} /> }))}
          />
        ) : null}
      </div>
    </div>
  );
}
