import Link from "@/components/link";
import { db } from "@/lib/db";
import { fmtLondonDate, hhmm, londonDate, londonMinute } from "@/lib/london";
import { coverAlert, greeting, policySummary, type CallRound } from "@/lib/overview-rounds";
import { requirePortal, portalsFor } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { dashboardMetrics } from "@/server/reports/metrics";
import { REPORTS } from "@/server/reports/tables";
import { hrHeadline } from "@/server/hr/summary";
import { rotaHeadline } from "@/server/rota/summary";
import { rotaSnapshot } from "@/server/overview/snapshot";
import { ModuleGrid } from "@/components/overview-ui";
import { WeekBars } from "@/components/overview-week-bars";
import { arrange, overviewOrder } from "@/server/overview/layout";
import { markNotificationsReadAction, saveOverviewOrderAction } from "@/app/actions";
import { Flash, fmtDate } from "@/components/ui";
import { Panel as HbPanel, PanelAction } from "@/components/harbour/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import type { Portal, PortalId } from "@/lib/portals";
import { Bell, CalendarDots, CaretRight, Check, ChartBar, ClipboardText, FileText, GearSix, UsersThree, WarningCircle } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/* ── Today's care delivery (navy) ─────────────────────────────────────── */

function CareDelivery({ done, total, pending, missed, carers, rounds }: { done: number; total: number; pending: number; missed: number; carers: number; rounds: CallRound[] }) {
  const alert = coverAlert(rounds);
  const needsCarer = rounds.reduce((n, r) => n + r.needsCarer, 0);
  const other = Math.max(0, total - done - pending - missed);
  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  const legend: [string, number, string][] = [["Completed", done, "#2e9a63"], ["In progress or other", other, "#7b5fda"], ["Needs a carer", needsCarer, "#d14336"], ["Still to come", pending, "#d6dde8"], ["Missed", missed, "#ffffff"]];
  return (
    <HbPanel
      id="care-delivery"
      title="Today's care delivery"
      icon={<CalendarDots size={15} weight="bold" />}
      colour="navy"
      testId="tile-rota"
      action={<><PanelAction href="/rota/monitor">The Monitor</PanelAction><Link href="/rota/visits" className="hb-ov-open">Open Daily Rota <CaretRight size={12} weight="bold" aria-hidden="true" /></Link></>}
      flush
    >
      <div className="hb-ov-cd">
        <div className="hb-ov-cd-l">
          <div className="min-w-[220px]">
            <p className="flex items-baseline gap-2.5" data-testid="rota-headline">
              <span className="text-[36px] font-semibold leading-none tracking-[-0.02em] tabular-nums">{done}</span>
              <span className="text-[14.5px] text-[var(--hb-ink-2)]">of {total} {plural(total, "visit", "visits")} done today</span>
            </p>
            <span className="hb-ov-meter" aria-hidden="true">
              <i style={{ width: pct(done), background: "#2e9a63" }} /><i style={{ width: pct(other), background: "#7b5fda" }} /><i style={{ width: pct(missed), background: "#d14336" }} />
            </span>
          </div>
          <ul className="hb-ov-legend">
            {legend.map(([label, n, c]) => <li key={label}><i style={{ background: c }} aria-hidden="true" />{label}<b className="tabular-nums">{n}</b></li>)}
            <li className="hb-ov-legend-x">{carers} {plural(carers, "carer", "carers")} working</li>
          </ul>
        </div>
        <div className="hb-ov-cd-r">
          {rounds.length ? (
            <table className="hb-ov-rt" aria-label="Today's call rounds">
              <thead>
                <tr><th scope="col">Call round</th><th scope="col">Times</th><th scope="col" className="hb-num">Visits</th><th scope="col" className="hb-num">Done</th><th scope="col">Needs a carer</th><th scope="col" className="hb-ov-rt-p">Progress</th><th scope="col">Status</th></tr>
              </thead>
              <tbody>
                {rounds.map((r) => {
                  const share = (n: number) => `${r.total ? (n / r.total) * 100 : 0}%`;
                  return (
                    <tr key={r.name} data-state={r.state} data-testid={`round-${r.label.toLowerCase()}`}>
                      <th scope="row">{r.label}</th>
                      <td className="tabular-nums">{hhmm(r.start)} to {hhmm(r.end)}</td>
                      <td className="hb-num tabular-nums">{r.total}</td>
                      <td className="hb-num tabular-nums">{r.done}</td>
                      <td>{r.needsCarer ? <span className="hb-ov-pill" data-tone="bad">{r.needsCarer} {plural(r.needsCarer, "visit", "visits")}</span> : <span className="text-[var(--hb-ink-3)]">None</span>}</td>
                      <td className="hb-ov-rt-p">
                        <span className="hb-ov-bar" aria-hidden="true"><i data-s="done" style={{ width: share(r.done) }} /><i data-s="bad" style={{ width: share(r.needsCarer) }} /></span>
                        <span className="sr-only">{r.done} of {r.total} done</span>
                      </td>
                      <td>{r.state === "now" ? <span className="hb-ov-pill" data-tone="now">Now</span> : r.state === "done" ? <span className="hb-ov-pill" data-tone="ok"><Check size={11} weight="bold" aria-hidden="true" />Done</span> : r.state === "open" ? <span className="hb-ov-pill" data-tone="open">Still open</span> : <span className="hb-ov-pill">To come</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : <p className="py-10 text-center text-[14px] text-[var(--hb-ink-3)]">No visits are booked for today.</p>}
        </div>
      </div>
      <div className="hb-ov-cover" data-testid="rota-cover">
        <span aria-hidden="true" className={`h-[9px] w-[9px] shrink-0 rounded-full ${alert ? "bg-[#d14336]" : "bg-[#2e9a63]"}`} />
        <p className="min-w-0 flex-1 text-[14px] font-semibold">{alert ?? "All visits covered"}</p>
        {alert ? <Link href="/rota/visits?view=unassigned" className="hb-btn hb-btn-p">Find cover</Link> : null}
      </div>
    </HbPanel>
  );
}

/* ── Module tiles ───────────────────────────────────────────────────────── */

interface Tile {
  key: "policy" | "hr" | "reporting" | "admin";
  portal: Portal;
  name: string;
  icon: React.ReactNode;
  figure: number;
  label: string;
  detail: string;
  /** The whole detail line, as a tooltip, when `detail` is shortened. */
  fullDetail?: string;
  /** HR pages are full page loads (the HR Hub has its own shell). */
  external?: boolean;
}

function ModuleTile({ tile }: { tile: Tile }) {
  const body = (
    <>
      <span aria-hidden="true" className="hb-tile-ic">{tile.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="ovx-title block text-[13px] font-semibold text-[var(--hb-ink-2)]">{tile.name}</span>
        <span className="flex items-baseline gap-2 whitespace-nowrap"><b className="tabular-nums">{tile.figure}</b><span className="text-[13.5px] text-[var(--hb-ink)]">{tile.label}</span></span>
        <span className="mt-0.5 line-clamp-1 block text-[12.5px] text-[var(--hb-ink-3)]" title={tile.fullDetail ?? tile.detail}>{tile.detail}</span>
      </span>
      <CaretRight size={14} weight="bold" aria-hidden="true" className="shrink-0 text-[var(--hb-ink-3)]" />
    </>
  );
  // The icon square takes the module's Harbour colour, the same as the chip in that module's page header.
  const props = { className: "hb-tile hb-ov-tile", "data-hb-module": tile.key, style: { "--t": "var(--hb-mod)" } as React.CSSProperties, "data-testid": `tile-${tile.key}` };
  return tile.external ? <a href={tile.portal.home} {...props}>{body}</a> : <Link href={tile.portal.home} {...props}>{body}</Link>;
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
  const [org, m, hr, branches, users, rotaFigures, rota, notes] = await Promise.all([
    orgId ? db.organisation.findUnique({ where: { id: orgId }, select: { name: true } }) : null,
    has("policy") ? dashboardMetrics(ctx) : null,
    has("hr") ? hrHeadline(ctx) : null,
    has("admin") && orgId ? db.branch.count({ where: { organisationId: orgId } }) : null,
    has("admin") && orgId ? db.membership.count({ where: { organisationId: orgId, deactivatedAt: null } }) : null,
    has("rota") ? rotaHeadline(ctx) : null,
    has("rota") ? rotaSnapshot(ctx, now) : null,
    // The newest notifications for the person signed in (the bell's own records).
    db.notification.findMany({ where: { userId: ctx.userId }, orderBy: { createdAt: "desc" }, take: 4, select: { id: true, title: true, body: true, readAt: true, createdAt: true, links: true } }),
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
  if (rotaPortal && rotaFigures?.unassignedToday) attention.push({ key: "unassigned", rank: 0, count: rotaFigures.unassignedToday, text: plural(rotaFigures.unassignedToday, "Visit needs a carer today", "Visits need a carer today"), action: "Find cover", href: "/rota/visits?view=unassigned", colour: rotaColour, icon: <CalendarDots size={18} /> });
  if (rotaPortal && rota?.missedToday) attention.push({ key: "missed", rank: 0, count: rota.missedToday, text: plural(rota.missedToday, "Missed visit today", "Missed visits today"), action: "Review", href: "/rota/monitor", colour: rotaColour, icon: <WarningCircle size={18} /> });
  if (rotaPortal && rotaFigures?.openAlerts) attention.push({ key: "alerts", rank: 1, count: rotaFigures.openAlerts, text: plural(rotaFigures.openAlerts, "Rota alert to review", "Rota alerts to review"), action: "Review", href: "/rota/exceptions", colour: rotaColour, icon: <CalendarDots size={18} /> });
  if (hrPortal && hr?.overdue) attention.push({ key: "hr", rank: 2, count: hr.overdue, text: plural(hr.overdue, "HR check overdue", "HR checks overdue"), action: "Review", href: hrPortal.home, external: true, colour: hrPortal.colour, icon: <UsersThree size={18} /> });
  const policyParts: { count: number; text: string }[] = [];
  let policyTotal = 0;
  if (policy && m) {
    const add = (key: string, rank: number, count: number, text: [string, string], part: [string, string], action: string, href: string, icon: React.ReactNode) => {
      if (!count) return;
      attention.push({ key, rank, count, text: plural(count, ...text), action, href, colour: policy.colour, icon });
      policyParts.push({ count, text: `${count} ${plural(count, ...part)}` });
      policyTotal += count;
    };
    if (can("staff.view")) add("signoffs", 3, m.overdueAcks, ["Staff sign-off overdue", "Staff sign-offs overdue"], ["sign-off", "sign-offs"], "Chase", "/staff", <FileText size={18} />);
    add("reviews", 3, m.overdueReviews, ["Policy review overdue", "Policy reviews overdue"], ["review overdue", "reviews overdue"], "Open", "/policies?quick=overdue", <FileText size={18} />);
    add("actions", 3, m.overdueActions, ["Action past due date", "Actions past due date"], ["action past due", "actions past due"], "Open", "/actions", <ClipboardText size={18} />);
    add("approval", 4, m.draftsAwaitingApproval, ["Policy awaiting approval", "Policies awaiting approval"], ["awaiting approval", "awaiting approval"], "Review", "/queue", <FileText size={18} />);
    add("changes", 5, m.newChanges + m.awaitingAssessment, ["Regulatory change to review", "Regulatory changes to review"], ["change to review", "changes to review"], "Review", "/changes", <ClipboardText size={18} />);
  }
  attention.sort((a, b) => a.rank - b.rank);

  const tiles: Tile[] = [];
  if (policy && m) {
    tiles.push({
      key: "policy", portal: policy, name: policy.name, icon: <FileText size={21} />,
      figure: policyTotal, label: "to action", detail: policyParts.length ? policySummary(policyParts) : "Nothing overdue",
      fullDetail: policyParts.length > 2 ? policyParts.map((p) => p.text).join(", ") : undefined,
    });
  }
  if (hrPortal) {
    const detail = [hr ? `${hr.employees} ${plural(hr.employees, "employee", "employees")}` : null, rota ? `${rota.staffOnRota} on rota today` : null].filter(Boolean).join(" · ");
    tiles.push({
      key: "hr", portal: hrPortal, name: hrPortal.name, icon: <UsersThree size={21} />, external: true,
      figure: hr?.overdue ?? 0, label: "checks overdue", detail: detail || "Opens your HR Hub",
    });
  }
  if (reporting) {
    const exportsReady = `${Object.keys(REPORTS).length} report exports ready`;
    const week = rota ? rota.completedSeries.days.reduce((n, d) => n + d.value, 0) : null;
    tiles.push({
      key: "reporting", portal: reporting, name: reporting.name, icon: <ChartBar size={21} />,
      figure: week ?? Object.keys(REPORTS).length, label: week !== null ? "visits, 7 days" : "report exports", detail: week !== null ? exportsReady : "Reports and CSV exports",
    });
  }
  if (admin) {
    tiles.push({
      key: "admin", portal: admin, name: "Administration", icon: <GearSix size={21} />,
      figure: branches ?? 0, label: plural(branches ?? 0, "branch", "branches"), detail: users !== null ? `${users} ${plural(users, "user", "users")} · activity log` : "Settings and activity log",
    });
  }
  const ordered = ctx.organisationId ? arrange(tiles.map((t) => t.key), savedOrder).flatMap((k) => tiles.filter((t) => t.key === k)) : tiles;

  const minute = londonMinute(now);
  const firstName = ctx.userName.trim().split(/\s+/)[0] ?? "";
  const todayLong = fmtLondonDate(londonDate(now), { weekday: "long", day: "numeric", month: "long" }).replace(",", "");
  const unread = notes.filter((n) => !n.readAt).length;
  const areaOf = (a: Attention) => (["unassigned", "missed", "alerts"].includes(a.key) ? rotaPortal?.name : a.key === "hr" ? hrPortal?.name : policy?.name) ?? "";
  const unassigned = rotaFigures?.unassignedToday ?? 0;
  const days = rota?.completedSeries.days ?? [];
  const goTo: { label: string; href: string; colour: string; icon: React.ReactNode; external?: boolean }[] = [
    ...(rotaPortal ? [{ label: "Daily Rota", href: "/rota/visits", colour: rotaPortal.colour, icon: <CalendarDots size={14} /> }, ...(can("serviceUser.view") ? [{ label: "Service users", href: "/rota/service-users", colour: rotaPortal.colour, icon: <UsersThree size={14} /> }] : [])] : []),
    ...(hrPortal ? [{ label: "HR Hub", href: hrPortal.home, colour: hrPortal.colour, icon: <UsersThree size={14} />, external: true }] : []),
    ...(policy ? [{ label: "Policies", href: "/policies", colour: policy.colour, icon: <FileText size={14} /> }] : []),
    ...(reporting ? [{ label: "Reports and CSV exports", href: reporting.home, colour: reporting.colour, icon: <ChartBar size={14} /> }] : []),
    ...(admin ? [{ label: "Settings and activity log", href: admin.home, colour: admin.colour, icon: <GearSix size={14} /> }] : []),
  ];

  return (
    <div className="ov-root hb-ov">
      {/* Full width beside the side panel at every screen size, with the page padding only (owner's decision of 14 Nov 2026, replacing the 1320px cap). */}
      <div className="px-4 pb-6 pt-5">
        <div className="w-full space-y-[16px]" data-testid="overview-content">
          <Flash searchParams={sp} />
          <AutoRefresh seconds={60} />
          <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-semibold text-[var(--hb-ink-3)]">{todayLong}{org?.name ? ` · ${org.name}` : ""}</p>
              <h2 className="text-[24px] font-semibold leading-tight tracking-[-0.01em] text-[var(--hb-ink)]" data-testid="overview-greeting">{greeting(minute)}{firstName ? `, ${firstName}` : ""}</h2>
              {rota ? (
                <p className="mt-0.5 text-[14.5px] text-[var(--hb-ink-2)]" data-testid="overview-summary">
                  {unassigned ? <b className="font-semibold text-[#b3261e]">{unassigned} {plural(unassigned, "visit has", "visits have")} no carer</b> : <span>Every visit today has a carer</span>}
                  {rota.missedToday ? <> and <b className="font-semibold text-[#8c5200]">{rota.missedToday} {plural(rota.missedToday, "was", "were")} missed</b></> : null}. {rota.completedToday} of {rota.visitsToday} done so far.
                </p>
              ) : <p className="mt-0.5 text-[14.5px] text-[var(--hb-ink-2)]">Here is {org?.name ?? "your organisation"} today.</p>}
            </div>
            {!arranging && ctx.organisationId && ordered.length > 1 ? (
              <a href="/overview?arrange=1" className="hb-btn" data-testid="arrange-modules">Rearrange</a>
            ) : null}
          </div>

          {rotaPortal && rota ? <CareDelivery done={rota.completedToday} total={rota.visitsToday} pending={rota.pendingToday} missed={rota.missedToday} carers={rota.staffOnRota} rounds={rota.rounds} /> : null}

          <div className="hb-ov-grid">
            <div className="flex min-w-0 flex-col gap-4">
            <HbPanel id="needs-action" title="Needs action" icon={<WarningCircle size={15} weight="bold" />} colour="red" count={attention.length} testId="needs-attention" flush
              action={attention.length ? <PanelAction href="/notifications">View all</PanelAction> : undefined}
              footer={<span className="mr-auto text-[12.5px] text-[var(--hb-ink-3)]">Showing what your role can act on, most urgent first.</span>}>
              {attention.length ? (
                <ul className="hb-ov-act">
                  {attention.map((a, i) => {
                    const label = <>{a.action}<span className="sr-only">: {a.count} {a.text.toLowerCase()}</span></>;
                    const cls = i === 0 ? "hb-btn hb-btn-p" : "hb-btn";
                    return (
                      <li key={a.key} data-testid={`attention-${a.key}`}>
                        <span aria-hidden="true" className="hb-ov-ai" style={{ background: a.colour }}>{a.icon}</span>
                        <span className="min-w-0 flex-1"><b className="block text-[14px] font-semibold"><span className="tabular-nums">{a.count}</span> {/^[A-Z][a-z]/.test(a.text) ? a.text.charAt(0).toLowerCase() + a.text.slice(1) : a.text}</b></span>
                        <span className="hb-ov-area hidden sm:inline-flex"><i style={{ background: a.colour }} aria-hidden="true" />{areaOf(a)}</span>
                        {a.external ? <a href={a.href} className={cls}>{label}</a> : <Link href={a.href} className={cls}>{label}</Link>}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="px-4 py-6 text-[14px] text-[var(--hb-ink-3)]">Nothing needs your attention right now.</p>
              )}
            </HbPanel>
            {rota ? (
              <HbPanel id="this-week" title="This week" icon={<ChartBar size={15} weight="bold" />} colour="green" testId="overview-week">
                <p className="-mt-1 mb-2 text-[12.5px] text-[var(--hb-ink-3)]">Visits completed each day, the last seven days</p>
                <WeekBars days={days} />
              </HbPanel>
            ) : null}
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <HbPanel id="notifications" title="Notifications" icon={<Bell size={15} weight="bold" />} colour="blue" count={unread} flush testId="overview-notifications"
                action={unread ? <form action={markNotificationsReadAction}><input type="hidden" name="back" value="/overview" /><button className="hb-pn-act" type="submit">Mark all read</button></form> : <PanelAction href="/notifications">All</PanelAction>}>
                {notes.length ? (
                  <ul className="hb-ov-notes">
                    {notes.map((n) => {
                      const link = ((n.links as { label: string; url: string }[] | null) ?? []).find((l) => l.url.startsWith("/"));
                      return (
                        <li key={n.id}>
                          <span className="min-w-0 flex-1">
                            <Link href={link?.url ?? "/notifications"} className="block text-[13.5px] font-semibold text-[var(--hb-ink)]">{!n.readAt ? <span className="hb-ov-dot" aria-label="Unread" /> : null}{n.title}</Link>
                            <span className="line-clamp-2 text-[12.5px] text-[var(--hb-ink-3)]">{n.body}</span>
                          </span>
                          <span className="shrink-0 text-[12px] text-[var(--hb-ink-3)]">{fmtDate(n.createdAt)}</span>
                        </li>
                      );
                    })}
                  </ul>
                ) : <p className="px-4 py-5 text-[13.5px] text-[var(--hb-ink-3)]">No notifications.</p>}
              </HbPanel>
              {goTo.length ? (
                <HbPanel id="go-to" title="Go to" colour="teal" flush testId="overview-go-to">
                  <nav aria-label="Go to">
                    <ul className="hb-golinks">
                      {goTo.map((g) => {
                        const inner = <><span className="hb-gol-i" style={{ background: g.colour }} aria-hidden="true">{g.icon}</span><span className="min-w-0 flex-1">{g.label}</span><CaretRight size={13} aria-hidden="true" /></>;
                        return <li key={g.label}>{g.external ? <a href={g.href} className="hb-gol">{inner}</a> : <Link href={g.href} className="hb-gol">{inner}</Link>}</li>;
                      })}
                    </ul>
                  </nav>
                </HbPanel>
              ) : null}
            </div>
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
    </div>
  );
}
