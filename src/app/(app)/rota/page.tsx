import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Alarm, Cake, CalendarBlank, CalendarDots, CaretLeft, CaretRight, Check, Clock, EnvelopeSimple, FirstAidKit, IdentificationCard, Lightning, Note, Stack, TreePalm, User, Users, UsersThree, Warning, X } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { ModuleHeader } from "@/components/module-header-band";
import { addDays, fmtLondonDate, fromDbDate, isIsoDate, londonDate, londonTime, mondayOf } from "@/lib/london";
import { requirePortal, rotaHome } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { BIRTHDAY_WINDOW_DAYS, rotaDashboard, type TeamDayStatus } from "@/server/rota/dashboard";
import type { Birthday } from "@/server/workforce/birthdays";
import { Flash } from "@/components/ui";
import { NotBuiltNotice } from "@/components/rota-ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { AutoSubmitForm } from "@/components/auto-submit";
import { DashTable } from "@/components/dash-table";
import { ordinalDate } from "@/components/rota-dashboard";
import { LiveLondonTime } from "@/components/live-london-time";

export const dynamic = "force-dynamic";

/** Percentages of the day's scheduled (not cancelled) visits, to one decimal place. */
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "0.0%");
const ddmmyyyy = (iso: string) => fmtLondonDate(iso, { day: "2-digit", month: "2-digit", year: "numeric" });
const ddmm = (d: Date) => `${d.toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "2-digit" })} ${londonTime(d)}`;

/**
 * The four call tiles (approved redesign, 10 Nov 2026): a white card with a 7% tint and a 28% border of the tile's
 * status colour, a solid status-colour icon chip, the figure and percentage in the status colour, supporting text in
 * grey, and a 5px bar along the bottom filled to the tile's share of the day's visits.
 */
const CARD = {
  green: { card: "bg-tile-completed/[.07] border-tile-completed/[.28]", chip: "bg-tile-completed", text: "text-tile-completed", bar: "bg-tile-completed", track: "bg-tile-completed/[.14]" },
  orange: { card: "bg-tile-late/[.07] border-tile-late/[.28]", chip: "bg-tile-late", text: "text-tile-late", bar: "bg-tile-late", track: "bg-tile-late/[.14]" },
  red: { card: "bg-tile-missed/[.07] border-tile-missed/[.28]", chip: "bg-tile-missed", text: "text-tile-missed", bar: "bg-tile-missed", track: "bg-tile-missed/[.14]" },
  blue: { card: "bg-tile-unassigned/[.07] border-tile-unassigned/[.28]", chip: "bg-tile-unassigned", text: "text-tile-unassigned", bar: "bg-tile-unassigned", track: "bg-tile-unassigned/[.14]" },
} as const;

function CallCard({ tone, icon, label, value, share, fraction, note, href, testId, title }: { tone: keyof typeof CARD; icon: ReactNode; label: string; value: number | string; share: string | null; fraction: number; note: string; href: string | null; testId: string; title?: string }) {
  const t = CARD[tone];
  const width = `${Math.max(0, Math.min(100, fraction * 100)).toFixed(1)}%`;
  const body = (
    <>
      <span className="flex items-center gap-4 px-4 pb-3.5 pt-3">
        <span aria-hidden className={`flex h-[50px] w-[50px] shrink-0 items-center justify-center rounded-[10px] text-white ${t.chip}`}>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lead font-semibold text-ink">{label}</span>
          <span className={`mt-0.5 flex items-center ${t.text}`}>
            <span data-value className="text-figure font-bold leading-none tabular-nums">{value}</span>
            {share ? <span className="ml-auto border-l border-rule pl-4 text-lead font-semibold tabular-nums">{share}</span> : null}
          </span>
          <span className="mt-1.5 block truncate text-meta text-status-ink">{note}</span>
        </span>
      </span>
      <span aria-hidden data-tile-bar className={`absolute inset-x-0 bottom-0 h-[5px] ${t.track}`}><span className={`block h-full ${t.bar}`} style={{ width }} /></span>
    </>
  );
  const cls = `relative flex min-w-0 flex-col overflow-hidden rounded-[10px] border bg-white no-underline shadow-[0_1px_2px_rgba(16,24,40,0.05)] ${t.card}`;
  return href ? <Link href={href} title={title} data-testid={testId} className={`${cls} hover:shadow-[0_2px_6px_rgba(16,24,40,0.12)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-module`}>{body}</Link> : <div data-testid={testId} className={cls}>{body}</div>;
}

function Panel({ id, icon, title, count, aside, children, className = "" }: { id: string; icon: ReactNode; title: string; count?: number; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`flex min-w-0 flex-col rounded-[10px] border border-[#e4e7ec] bg-white shadow-[0_1px_2px_rgba(16,24,40,0.05)] ${className}`}>
      <div className="flex flex-wrap items-center gap-2 px-3.5 pb-2 pt-2.5">
        <span aria-hidden className="text-module">{icon}</span>
        <h2 id={id} className="text-lead font-bold text-[#101828]">{title}</h2>
        {count !== undefined ? <span className="rounded-full bg-[#f2f4f7] px-2 py-0.5 text-meta font-semibold tabular-nums text-[#344054]">{count.toLocaleString("en-GB")}</span> : null}
        {aside ? <span className="ml-auto flex items-center gap-2">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

const ICON_LINK = "inline-flex h-[22px] w-[22px] items-center justify-center rounded-[4px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-module";
function RowActions({ items }: { items: { href: string; label: string; icon: ReactNode; tone: "green" | "blue" | "violet" }[] }) {
  const tone = { green: "bg-[#e7f6ec] text-[#15803d]", blue: "bg-[#e6f1fb] text-[#0a72b5]", violet: "bg-[#efeafc] text-module" };
  return (
    <span className="flex gap-1">
      {items.map((i) => <Link key={i.href} href={i.href} title={i.label} aria-label={i.label} className={`${ICON_LINK} ${tone[i.tone]}`}>{i.icon}</Link>)}
    </span>
  );
}

const STATUS_PILL: Record<TeamDayStatus, string> = {
  "On rota": "bg-[#e7f6ec] text-[#14713a]",
  "Off rota": "bg-[#f2f4f7] text-[#475467]",
  "On leave": "bg-[#e6f1fb] text-[#0a5d94]",
  "Off sick": "bg-[#fdecec] text-[#a3242c]",
  "Not ready": "bg-[#fdf3e2] text-[#8a5a00]",
};

function Issue({ href, icon, value, label, tone, testId }: { href: string; icon: ReactNode; value: number; label: string; tone: string; testId: string }) {
  return (
    <li className="min-w-0 flex-1">
      <Link href={href} data-testid={testId} className="flex items-center justify-center gap-4 rounded-[8px] px-3 py-1.5 no-underline hover:bg-[#fafafc] focus-visible:outline focus-visible:outline-2 focus-visible:outline-module">
        <span aria-hidden style={{ color: tone }}>{icon}</span>
        <span className="min-w-0">
          <span data-value className="block text-title font-bold leading-tight tabular-nums text-[#101828]">{value}</span>
          <span className="block truncate text-lead font-semibold" style={{ color: tone }}>{label}</span>
        </span>
      </Link>
    </li>
  );
}

function BirthdayTable({ who, rows, unavailable }: { who: string; rows: Birthday[] | null; unavailable: string }) {
  if (rows === null) return <p className="px-3.5 pb-4 text-body text-[#475467]">{unavailable}</p>;
  if (!rows.length) return <p className="px-3.5 pb-4 text-body text-[#475467]">No birthdays in the next {BIRTHDAY_WINDOW_DAYS} days.</p>;
  return (
    <div className="max-h-[118px] overflow-auto px-3.5 pb-2">
      <table className="w-full whitespace-nowrap text-body">
        <caption className="sr-only">{who} birthdays in the next {BIRTHDAY_WINDOW_DAYS} days</caption>
        <thead><tr className="border-b border-[#eaecf0] text-left text-meta"><th scope="col" className="py-1.5 pl-1 pr-3 font-semibold">{who}</th><th scope="col" className="py-1.5 pr-3 font-semibold">DOB</th><th scope="col" className="py-1.5 pr-3 font-semibold">Turns</th><th scope="col" className="py-1.5 font-semibold">Birthday</th></tr></thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id} className="border-b border-[#f2f4f7] last:border-0">
              <td className="max-w-[160px] truncate py-1.5 pl-1 pr-3"><span className="inline-flex items-center gap-2"><User size={15} weight="fill" aria-hidden className="text-[#475467]" />{b.href ? <Link href={b.href} className="text-[#101828] no-underline hover:underline">{b.name}</Link> : b.name}</span></td>
              <td className="py-1.5 pr-3 tabular-nums">{ddmmyyyy(b.dateOfBirth)}</td>
              <td className="py-1.5 pr-3 tabular-nums">{b.turns}</td>
              <td className="whitespace-nowrap py-1.5">{fmtLondonDate(b.next, { weekday: "short", day: "2-digit", month: "short" }).replace(",", "")} <span className="text-[#475467]">({b.inDays === 0 ? "today" : `in ${b.inDays} day${b.inDays === 1 ? "" : "s"}`})</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuickAction({ href, icon, label, badge, tone = "#5b2bb5" }: { href: string; icon: ReactNode; label: string; badge?: number; tone?: string }) {
  return (
    <Link href={href} data-count={badge} className="flex h-[46px] min-w-0 items-center gap-2.5 rounded-[8px] border border-[#e4e7ec] bg-white px-3.5 text-body font-semibold text-[#101828] no-underline shadow-[0_1px_2px_rgba(16,24,40,0.05)] hover:border-[#c9bdf0] hover:bg-module/[.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-module">
      <span aria-hidden style={{ color: tone }}>{icon}</span>
      <span className="line-clamp-2 min-w-0 flex-1 leading-[1.2]">{label}</span>
      {badge ? <span className="flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-meta font-bold tabular-nums text-white" style={{ background: tone }}>{badge}</span> : null}
    </Link>
  );
}

/**
 * Rota Dashboard, laid out to the owner's approved reference (31 Oct 2026, modernised OnePlan style): one date drives
 * the page; the day's call outcomes; service users, team members and reminders; the conflict and holiday counters;
 * upcoming birthdays and quick actions. Every figure is counted from live records and opens the list behind it. No money.
 */
export default async function RotaDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, "rota.view")) redirect(rotaHome(ctx));
  const date = sp.date && isIsoDate(sp.date) ? sp.date : londonDate();
  const d = await rotaDashboard(ctx, { date, branchId: sp.branch || undefined });
  const c = d.calls;
  const branch = d.branchId ?? undefined;
  const branchName = branch ? d.branches.find((b) => b.id === branch)?.name : d.branches.length === 1 ? d.branches[0]!.name : "All branches";
  const keep = (extra: Record<string, string | undefined>) => new URLSearchParams(Object.entries({ date, branch, ...extra }).filter((e): e is [string, string] => !!e[1])).toString();
  const day = (extra: Record<string, string | undefined> = {}) => `/rota/visits?${keep(extra)}`;
  const icon = { size: 30, weight: "bold" as const };
  const unlinked = d.team.filter((t) => !t.userId).length;
  const canBuild = hasOrgPermission(ctx, "rota.build");
  const statuses: TeamDayStatus[] = ["On rota", "Off rota", "On leave", "Off sick", "Not ready"];

  return (
    <div className="rota-home space-y-3">
      <ModuleHeader title="Rota Dashboard" description={<>Visit performance, people and reminders for the day · {branchName}</>}>
        <nav aria-label="Change day" className="flex items-center gap-2.5">
          <Link href={`/rota?${keep({ date: addDays(date, -1) })}`} aria-label="Previous day" className="mh-round"><CaretLeft size={20} weight="bold" aria-hidden /></Link>
          <p className="flex items-center gap-2.5 text-heading font-bold text-white sm:text-display"><CalendarBlank size={24} aria-hidden /><span>{ordinalDate(date)}</span></p>
          <Link href={`/rota?${keep({ date: addDays(date, 1) })}`} aria-label="Next day" className="mh-round"><CaretRight size={20} weight="bold" aria-hidden /></Link>
        </nav>
        <p className="text-lead font-semibold leading-6 tabular-nums text-white sm:border-l sm:border-white/38 sm:pl-3" title="Current UK time"><LiveLondonTime initial={Date.now()} testId="rota-live-time" /></p>
        <AutoSubmitForm label="Date and branch" className="flex flex-wrap items-center gap-2">
          {d.branches.length > 1 ? (
            <label><span className="sr-only">Branch</span>
              <select name="branch" defaultValue={branch ?? ""} className="mh-field"><option value="">All my branches</option>{d.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </label>
          ) : null}
          <label className="mh-field flex items-center gap-2"><CalendarBlank size={17} aria-hidden /><span className="sr-only">Date</span><input type="date" name="date" defaultValue={date} className="bg-transparent text-body" /></label>
          <Link href={`/rota?${keep({ date: undefined })}`} aria-current={date === d.today ? "date" : undefined} className="mh-btn mh-btn-primary">Today</Link>
        </AutoSubmitForm>
      </ModuleHeader>
      <Flash searchParams={sp} />
      {d.notBuilt ? <NotBuiltNotice date={date} canBuild={canBuild} /> : null}
      {date === d.today ? <AutoRefresh seconds={60} /> : null}

      <section aria-label="Calls on this day" className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <CallCard tone="green" testId="card-completed" fraction={c.total ? c.complete / c.total : 0} icon={<Check {...icon} />} label="Completed Calls" value={c.complete} share={pct(c.complete, c.total)} note={`${c.complete} of ${c.total} scheduled visits completed`} href={day({ status: "COMPLETED" })} />
        <CallCard tone="orange" testId="card-late" fraction={c.total ? c.late / c.total : 0} icon={<Clock {...icon} />} label="Late Calls" value={c.late} share={pct(c.late, c.total)} note={`${c.late} calls ${c.lateAfterMin}+ minutes late`} href={day({ view: "late" })} />
        <CallCard tone="red" testId="card-missed" fraction={c.total ? c.missed / c.total : 0} icon={<X {...icon} />} label="Missed Calls" value={c.missed} share={pct(c.missed, c.total)} note={`${c.missed} scheduled visits not clocked into`} href={`/rota/missed?period=day&date=${date}`} />
        {c.missedMeds === null ? (
          <CallCard tone="blue" testId="card-unassigned" fraction={c.total ? c.unassigned / c.total : 0} icon={<UsersThree {...icon} />} label="Unassigned Calls" value={c.unassigned} share={pct(c.unassigned, c.total)} note={`${c.unassigned} visits short of a carer`} title="Shown in place of missed medication while medication records are switched off in Rota Settings" href={day({ view: "unassigned" })} />
        ) : (
          <CallCard tone="blue" testId="card-missed-meds" fraction={c.total ? c.missedMeds / c.total : 0} icon={<FirstAidKit {...icon} />} label="Calls with Missed Meds" value={c.missedMeds} share={pct(c.missedMeds, c.total)} note={`${c.missedMeds} visits with a missed medication alert`} href="/rota/exceptions?kind=MISSED_MEDICATION&state=all" />
        )}
      </section>

      <section aria-label="People and reminders" className="grid grid-cols-1 gap-3.5 xl:grid-cols-3">
        <Panel id="su-h" icon={<Users size={24} weight="fill" />} title="All Service Users" count={d.canPeople ? d.serviceUsers.length : undefined}>
          {d.canPeople ? (
            <DashTable
              label="service users"
              columns={[{ key: "a", label: "Actions" }, { key: "first", label: "Forename", sortable: true }, { key: "last", label: "Surname", sortable: true }, { key: "dob", label: "DOB", sortable: true }, { key: "next", label: "Next Visit", sortable: true }]}
              initialSort={{ key: "first", dir: "asc" }}
              filterLabel="Filter by area"
              filters={[...new Set(d.serviceUsers.map((s) => s.area?.name ?? "No area"))].sort().map((a) => ({ value: a, label: a }))}
              menu={[{ label: "All service users", href: "/rota/service-users" }, { label: "Add a service user", href: "/rota/service-users/new" }]}
              empty="No service users in your branches yet."
              rows={d.serviceUsers.map((s) => {
                const next = d.nextVisit.get(s.id) ?? null;
                return {
                  key: s.id,
                  text: `${s.name} ${s.postcode ?? ""} ${s.area?.name ?? ""}`,
                  filter: s.area?.name ?? "No area",
                  sort: { first: (s.preferredName || s.firstName).toLowerCase(), last: s.lastName.toLowerCase(), dob: s.dateOfBirth ? fromDbDate(s.dateOfBirth) : "", area: s.area?.name ?? "", next: next ? next.toISOString() : "9" },
                  cells: [
                    <RowActions key="a" items={[{ href: day({ su: s.id }), label: `${s.name}: Daily Rota`, icon: <CalendarDots size={15} weight="fill" />, tone: "green" }, { href: `/rota/templates?su=${s.id}`, label: `${s.name}: visit templates`, icon: <IdentificationCard size={15} weight="fill" />, tone: "blue" }, { href: `/rota/service-users/${s.id}`, label: `${s.name}: record`, icon: <User size={14} weight="fill" />, tone: "violet" }]} />,
                    s.preferredName || s.firstName,
                    s.lastName,
                    s.dateOfBirth ? ddmmyyyy(fromDbDate(s.dateOfBirth)) : "—",
                    next ? <span key="n" className="tabular-nums">{ddmm(next)}</span> : <span key="n" className="text-[#667085]">None booked</span>,
                  ],
                };
              })}
            />
          ) : <p className="px-3.5 pb-4 text-body text-[#475467]">Your role does not include service-user records.</p>}
        </Panel>

        <Panel id="team-h" icon={<UsersThree size={24} weight="fill" />} title="All Team Members" count={d.canStaff ? d.team.length : undefined} aside={d.canStaff && unlinked ? <Link href="/rota/staff" title="Team members with no app sign-in linked yet" className="inline-flex items-center gap-1 rounded-[6px] border border-[#f5d9a8] bg-[#fdf6e8] px-2 py-0.5 text-caption font-semibold text-[#8a5a00] no-underline"><EnvelopeSimple size={14} aria-hidden />{unlinked} without a sign-in</Link> : null}>
          {d.canStaff ? (
            <DashTable
              label="team members"
              columns={[{ key: "a", label: "Actions" }, { key: "first", label: "Forename", sortable: true }, { key: "last", label: "Surname", sortable: true }, { key: "role", label: "Role", sortable: true }, { key: "status", label: "Status", sortable: true }]}
              initialSort={{ key: "first", dir: "asc" }}
              filterLabel="Filter by status"
              filters={statuses.map((s) => ({ value: s, label: s }))}
              menu={[{ label: "Staff & eligibility", href: "/rota/staff" }, { label: "Staff readiness", href: "/rota/readiness" }, { label: "Sickness & holiday cover", href: `/rota/cover?from=${date}&days=1` }]}
              empty="No team members in your branches yet."
              rows={d.team.map((t) => {
                const st = d.teamStatus.get(t.id)!;
                const name = t.preferredName ? `${t.preferredName} ${t.displayName.split(" ").slice(1).join(" ")}` : t.displayName;
                const [first, ...rest] = name.split(" ");
                return {
                  key: t.id,
                  text: `${t.displayName} ${t.jobTitle} ${st.status}`,
                  filter: st.status,
                  sort: { first: (first ?? "").toLowerCase(), last: rest.join(" ").toLowerCase(), role: t.jobTitle, status: st.status },
                  cells: [
                    <RowActions key="a" items={[{ href: `/rota/advanced?${new URLSearchParams({ date, view: "staff-week", carer: t.id })}`, label: `${t.displayName}: rota`, icon: <CalendarDots size={15} weight="fill" />, tone: "green" }, { href: day({ carer: t.id }), label: `${t.displayName}: Daily Rota`, icon: <IdentificationCard size={15} weight="fill" />, tone: "blue" }, { href: `/rota/staff/${t.id}`, label: `${t.displayName}: eligibility and details`, icon: <User size={14} weight="fill" />, tone: "violet" }]} />,
                    first ?? "",
                    rest.join(" "),
                    <span key="r" className="block max-w-[88px] truncate" title={t.jobTitle}>{t.jobTitle}</span>,
                    <span key="s" className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-caption font-semibold ${STATUS_PILL[st.status]}`}><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />{st.status}</span>,
                  ],
                };
              })}
            />
          ) : <p className="px-3.5 pb-4 text-body text-[#475467]">Your role does not include the staff directory.</p>}
        </Panel>

        <Panel id="rem-h" icon={<Alarm size={24} weight="bold" />} title="All Active Reminders" aside={<><span className="hidden whitespace-nowrap text-caption text-[#475467] 2xl:inline" title="Due in the next 14 days, or overdue">14 days + overdue</span><Link href="/rota/reminders" className="rounded-[7px] bg-[#15803d] px-3 py-1.5 text-meta font-semibold text-white no-underline hover:bg-[#116a32]">View All</Link></>}>
          <DashTable
            label="reminders"
            columns={[{ key: "text", label: "Reminder", sortable: true }, { key: "due", label: "Due", sortable: true }, { key: "account", label: "Account", sortable: true }, { key: "type", label: "Type", sortable: true }, { key: "over", label: "Overdue", sortable: true }]}
            initialSort={{ key: "due", dir: "asc" }}
            filterLabel="Filter by type"
            filters={[{ value: "Service user", label: "Service users" }, { value: "Team member", label: "Team members" }]}
            empty="Nothing due in the next 14 days."
            rows={d.reminders.map((r, n) => ({
              key: `${n}`,
              text: `${r.text} ${r.account} ${r.type}`,
              filter: r.type,
              sort: { text: r.text, due: r.due, account: r.account, type: r.type, over: String(r.overdueDays).padStart(6, "0") },
              cells: [
                <Link key="r" href={r.href} className="block max-w-[150px] truncate text-[#101828] no-underline hover:underline" title={r.text}>{r.text}</Link>,
                <span key="d" className="tabular-nums">{ddmmyyyy(r.due)}</span>,
                r.account,
                r.type === "Service user" ? "Client" : "Staff",
                r.overdueDays ? <span key="o" className="rounded-full bg-[#fdecec] px-2 py-0.5 text-caption font-semibold tabular-nums text-[#a3242c]">{r.overdueDays} day(s)</span> : <span key="o" className="text-[#667085]">—</span>,
              ],
            }))}
          />
        </Panel>
      </section>

      <section aria-label="Rota issues" className="rounded-[10px] border border-[#e4e7ec] bg-white px-2 py-1 shadow-[0_1px_2px_rgba(16,24,40,0.05)]">
        <ul className="grid grid-cols-2 gap-1 md:flex md:divide-x md:divide-[#eaecf0]">
          <Issue testId="issue-rota" href={day({ view: "review" })} icon={<Warning size={34} />} value={d.counters.rotaConflicts} label="Rota Conflicts" tone="#c42b2f" />
          <Issue testId="issue-template" href="/rota/templates/planner" icon={<Stack size={34} />} value={d.counters.templateConflicts} label="Template Conflicts" tone="#15803d" />
          <Issue testId="issue-holidays" href="/workforce/absences" icon={<TreePalm size={34} />} value={d.counters.holidaysDue} label="Holidays Due" tone="#15803d" />
          <Issue testId="issue-notes" href={`/rota/notes?from=${date}&to=${date}`} icon={<Note size={34} />} value={d.counters.notes} label="Visit Notes" tone="#c42b2f" />
        </ul>
      </section>

      <section aria-label="Birthdays and quick actions" className="grid grid-cols-1 gap-3.5 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.88fr)]">
        <Panel id="sub-h" icon={<Cake size={24} weight="fill" />} title="Service User Upcoming Birthdays" aside={<span className="rounded-full bg-[#f2f4f7] px-2 py-0.5 text-caption font-medium text-[#344054]">Next {BIRTHDAY_WINDOW_DAYS} days</span>}>
          <BirthdayTable who="Service User" rows={d.birthdays.serviceUsers} unavailable="Your role does not include service-user records." />
        </Panel>
        <Panel id="tmb-h" icon={<Cake size={24} weight="fill" />} title="Team Member Upcoming Birthdays" aside={<span className="rounded-full bg-[#f2f4f7] px-2 py-0.5 text-caption font-medium text-[#344054]">Next {BIRTHDAY_WINDOW_DAYS} days</span>}>
          <BirthdayTable who="Team Member" rows={d.birthdays.team} unavailable="Dates of birth are kept in HR & Workforce, so only people with HR access see team birthdays." />
        </Panel>
        <Panel id="qa-h" icon={<Lightning size={24} weight="fill" />} title="Quick Actions" className="lg:col-span-2 xl:col-span-1">
          <div className="grid grid-cols-1 gap-2.5 px-3.5 pb-3.5 sm:grid-cols-2">
            {canBuild ? <QuickAction href={`/rota/build?week=${mondayOf(date)}`} icon={<CalendarBlank size={22} />} label="Build Rota" /> : null}
            <QuickAction href={`/rota/planner?week=${mondayOf(date)}`} icon={<CalendarDots size={22} />} label="Weekly Planner" />
            <QuickAction href={`/rota/unassigned?from=${date}&days=1`} icon={<UsersThree size={22} weight="fill" />} label="Unassigned Visits" badge={c.unassigned} />
            {d.exceptions ? <QuickAction href="/rota/exceptions" icon={<Warning size={22} />} label="Exceptions" badge={d.exceptions.open} tone="#c42b2f" /> : null}
          </div>
        </Panel>
      </section>
    </div>
  );
}
