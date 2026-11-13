import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Alarm, ArrowRight, Cake, CalendarBlank, CalendarDots, CaretLeft, CaretRight, Check, Clock, CurrencyGbp, EnvelopeSimple, FirstAidKit, IdentificationCard, Note, Plus, ShieldCheck, SquaresFour, Stack, TreePalm, User, Users, UsersThree, Warning, WarningOctagon, X } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { PageHeader, Panel, StatTiles } from "@/components/harbour/ui";
import { HowThisWorks } from "@/components/harbour/how-this-works";
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

function BirthdayTable({ who, rows, unavailable }: { who: string; rows: Birthday[] | null; unavailable: string }) {
  if (rows === null) return <p className="px-3.5 pb-4 text-[13.5px] text-[#475467]">{unavailable}</p>;
  if (!rows.length) return <p className="px-3.5 pb-4 text-[13.5px] text-[#475467]">No birthdays in the next {BIRTHDAY_WINDOW_DAYS} days.</p>;
  return (
    <div className="max-h-[118px] overflow-auto px-3.5 pb-2">
      <table className="w-full whitespace-nowrap text-[13.5px]">
        <caption className="sr-only">{who} birthdays in the next {BIRTHDAY_WINDOW_DAYS} days</caption>
        <thead><tr className="border-b border-[#eaecf0] text-left text-[12.5px]"><th scope="col" className="py-1.5 pl-1 pr-3 font-semibold">{who}</th><th scope="col" className="py-1.5 pr-3 font-semibold">DOB</th><th scope="col" className="py-1.5 pr-3 font-semibold">Turns</th><th scope="col" className="py-1.5 font-semibold">Birthday</th></tr></thead>
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

type Tone = "bad" | "warn" | "n" | "ok";
type Todo = { key: string; tone: Tone; icon: ReactNode; title: string; sub: string; action: string; href: string; testId?: string; count?: number };
const RANK: Record<Tone, number> = { bad: 0, warn: 1, n: 2, ok: 3 };

/** One row of "What needs doing": what it is, one line of detail, and the button to the screen that deals with it. */
function TodoRow({ t }: { t: Todo }) {
  return (
    <div className={`hb-todo hb-t-${t.tone}`} data-testid={`todo-${t.key}`}>
      <span className="hb-todo-ic" aria-hidden="true">{t.icon}</span>
      <span className="min-w-0"><b>{t.title}</b><small>{t.sub}</small></span>
      <Link href={t.href} data-testid={t.testId} data-count={t.count} className={t.tone === "bad" ? "hb-btn hb-btn-p" : "hb-btn"} aria-label={`${t.action}: ${t.title}`}>{t.action}</Link>
    </div>
  );
}

function GoLink({ href, icon, title, sub, badge }: { href: string; icon: ReactNode; title: string; sub: string; badge?: number }) {
  return (
    <Link href={href} className="hb-gol" data-count={badge}>
      <span className="hb-gol-ic" aria-hidden="true">{icon}</span>
      <span className="min-w-0"><b>{title}{badge ? <span className="hb-gol-n" aria-label={`${badge} open`}>{badge}</span> : null}</b><small>{sub}</small></span>
      <CaretRight size={16} aria-hidden="true" className="text-[var(--hb-ink-4)]" />
    </Link>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

/**
 * Rota Home (Harbour module home, owner's decision of 13 Nov 2026; docs/design/harbour/screens/rota-home-1440.png):
 * the header with the day's controls, a tip, the four call counts, a red "What needs doing" list (most urgent first)
 * and a navy "Go to" panel; the people, reminders and birthday tables follow underneath, unchanged. One date drives
 * the page. Every figure is counted from live records and opens the list behind it. No money.
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
  const unlinked = d.team.filter((t) => !t.userId).length;
  const canBuild = hasOrgPermission(ctx, "rota.build");
  const canAdd = hasOrgPermission(ctx, "rota.edit");
  const canFinance = hasOrgPermission(ctx, "finance.view");
  const statuses: TeamDayStatus[] = ["On rota", "Off rota", "On leave", "Off sick", "Not ready"];
  const isToday = date === d.today;
  const when = isToday ? "today" : `on ${fmtLondonDate(date, { weekday: "short", day: "numeric", month: "short" })}`;
  const ti = { size: 18 } as const;
  const share = (n: number) => `${pct(n, c.total)} of the day's ${c.total} scheduled visits`;

  const todos: Todo[] = [
    c.unassigned
      ? { key: "unassigned", tone: "bad", icon: <UsersThree {...ti} />, title: `${plural(c.unassigned, "visit")} ${c.unassigned === 1 ? "needs" : "need"} a carer ${when}`, sub: "Each open place is filled through the eligibility check", action: "Find cover", href: `/rota/unassigned?from=${date}&days=1`, testId: "todo-unassigned-link", count: c.unassigned }
      : { key: "unassigned", tone: "ok", icon: <Check {...ti} />, title: `Every visit has a carer ${when}`, sub: "No open carer places", action: "Unassigned Visits", href: `/rota/unassigned?from=${date}&days=1`, testId: "todo-unassigned-link", count: 0 },
    ...(d.exceptions
      ? [d.exceptions.open
          ? { key: "exceptions", tone: "bad" as const, icon: <Warning {...ti} />, title: `${plural(d.exceptions.open, "open exception")}`, sub: "Visits that did not go to plan", action: "Review", href: "/rota/exceptions", testId: "todo-exceptions-link", count: d.exceptions.open }
          : { key: "exceptions", tone: "ok" as const, icon: <Check {...ti} />, title: "No open exceptions", sub: "Visits that did not go to plan appear here", action: "Exceptions", href: "/rota/exceptions", testId: "todo-exceptions-link", count: 0 }]
      : []),
    d.counters.rotaConflicts
      ? { key: "rota", tone: "warn", icon: <Warning {...ti} />, title: `${plural(d.counters.rotaConflicts, "rota conflict")} ${when}`, sub: "Visits to check on the Daily Rota", action: "Check", href: day({ view: "review" }), testId: "issue-rota", count: d.counters.rotaConflicts }
      : { key: "rota", tone: "ok", icon: <Check {...ti} />, title: `No rota conflicts ${when}`, sub: "Nobody is booked in two places", action: "Check again", href: day({ view: "review" }), testId: "issue-rota", count: 0 },
    d.counters.templateConflicts
      ? { key: "template", tone: "warn", icon: <Stack {...ti} />, title: plural(d.counters.templateConflicts, "template conflict"), sub: "Repeating visits with an open slot, or a carer who has left", action: "Review", href: "/rota/templates/planner", testId: "issue-template", count: d.counters.templateConflicts }
      : { key: "template", tone: "ok", icon: <Check {...ti} />, title: "No template conflicts", sub: "Every repeating visit has its carers", action: "Templates", href: "/rota/templates/planner", testId: "issue-template", count: 0 },
    d.reminders.length
      ? { key: "reminders", tone: d.reminders.some((r) => r.overdueDays) ? "bad" : "warn", icon: <Alarm {...ti} />, title: `${plural(d.reminders.length, "reminder")} due`, sub: `${d.reminders.filter((r) => r.overdueDays).length} overdue · due in the next 14 days`, action: "See reminders", href: "/rota/reminders", count: d.reminders.length }
      : { key: "reminders", tone: "ok", icon: <Check {...ti} />, title: "No reminders due", sub: "Nothing due in the next 14 days", action: "Reminders", href: "/rota/reminders", count: 0 },
    { key: "holidays", tone: "n", icon: <TreePalm {...ti} />, title: `${plural(d.counters.holidaysDue, "holiday")} coming up`, sub: "Approved time off starting in the next 14 days", action: "Holidays", href: "/workforce/absences", testId: "issue-holidays", count: d.counters.holidaysDue },
    { key: "notes", tone: "n", icon: <Note {...ti} />, title: `${plural(d.counters.notes, "visit note")} ${when}`, sub: "What carers wrote at each visit", action: "Read notes", href: `/rota/notes?from=${date}&to=${date}`, testId: "issue-notes", count: d.counters.notes },
  ];
  todos.sort((x, y) => RANK[x.tone] - RANK[y.tone]);
  const needing = todos.filter((t) => t.tone === "bad" || t.tone === "warn").length;

  return (
    <div className="rota-home hb-ws" data-hb-module="rota">
      <PageHeader
        module="rota"
        moduleName="Care & Rostering"
        icon={<CalendarBlank size={21} />}
        title="Rota Home"
        description={<>How {isToday ? "today" : "the day"} is going, and the quickest way to everything you need for the rota · {branchName}</>}
        actions={
          <>
            {canAdd ? <Link href={`/rota/visits/new?date=${date}`} className="hb-btn hb-btn-p"><Plus size={15} weight="bold" aria-hidden="true" />Add a visit</Link> : null}
            <Link href={day()} className="hb-btn">Open Daily Rota</Link>
          </>
        }
      >
        <div className="hb-dayctl" data-testid="title-bar">
          <nav aria-label="Change day" className="flex items-center gap-1.5">
            <Link href={`/rota?${keep({ date: addDays(date, -1) })}`} aria-label="Previous day" title="Previous day" className="hb-sq"><CaretLeft size={15} weight="bold" aria-hidden /></Link>
            <span className="hb-dayctl-d px-1">{ordinalDate(date)}</span>
            <Link href={`/rota?${keep({ date: addDays(date, 1) })}`} aria-label="Next day" title="Next day" className="hb-sq"><CaretRight size={15} weight="bold" aria-hidden /></Link>
          </nav>
          <span className="text-[13px] font-semibold tabular-nums text-[var(--hb-ink-2)]" title="Current UK time"><LiveLondonTime initial={Date.now()} testId="rota-live-time" /></span>
          <AutoSubmitForm label="Date and branch" className="flex flex-wrap items-center gap-2">
            {d.branches.length > 1 ? (
              <label><span className="sr-only">Branch</span>
                <select name="branch" defaultValue={branch ?? ""} className="hb-field"><option value="">All my branches</option>{d.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
              </label>
            ) : null}
            <label className="hb-field flex items-center gap-2"><CalendarBlank size={15} aria-hidden /><span className="sr-only">Date</span><input type="date" name="date" defaultValue={date} className="bg-transparent text-[13px]" /></label>
            <Link href={`/rota?${keep({ date: undefined })}`} aria-current={isToday ? "date" : undefined} className="hb-btn">Today</Link>
          </AutoSubmitForm>
        </div>
      </PageHeader>

      <div className="hb-ws-b">
        <Flash searchParams={sp} />
        {d.notBuilt ? <NotBuiltNotice date={date} canBuild={canBuild} /> : null}
        {isToday ? <AutoRefresh seconds={60} /> : null}
        <HowThisWorks userId={ctx.userId} page="rota-home">Start your shift here. Anything in red needs doing before the next call round.</HowThisWorks>

        <section aria-label="Calls on this day">
          <StatTiles
            label="Calls on this day"
            tiles={[
              { key: "completed", testId: "card-completed", label: "Completed calls", value: c.complete, icon: <Check size={18} weight="bold" />, colour: "var(--hb-ok-fill)", numberColour: "var(--hb-ok)", href: day({ status: "COMPLETED" }), note: `${c.complete} of ${c.total} scheduled visits completed (${pct(c.complete, c.total)})` },
              { key: "late", testId: "card-late", label: "Running late", value: c.late, icon: <Clock size={18} weight="bold" />, colour: "var(--hb-warn-fill)", numberColour: "var(--hb-warn)", href: day({ view: "late" }), note: `${c.late} calls ${c.lateAfterMin}+ minutes late (${share(c.late)})` },
              { key: "missed", testId: "card-missed", label: "Missed calls", value: c.missed, icon: <X size={18} weight="bold" />, colour: c.missed ? "var(--hb-bad-fill)" : "#8a8f97", numberColour: c.missed ? "var(--hb-bad)" : undefined, href: `/rota/missed?period=day&date=${date}`, note: `${c.missed} scheduled visits not clocked into (${share(c.missed)})` },
              c.missedMeds === null
                ? { key: "unassigned", testId: "card-unassigned", label: "Need a carer", value: c.unassigned, icon: <Warning size={18} weight="bold" />, colour: "var(--hb-bad-fill)", numberColour: c.unassigned ? "var(--hb-bad)" : undefined, href: day({ view: "unassigned" }), note: `${c.unassigned} visits short of a carer (${share(c.unassigned)})` }
                : { key: "missed-meds", testId: "card-missed-meds", label: "Calls with missed meds", value: c.missedMeds, icon: <FirstAidKit size={18} weight="bold" />, colour: "var(--hb-bad-fill)", numberColour: c.missedMeds ? "var(--hb-bad)" : undefined, href: "/rota/exceptions?kind=MISSED_MEDICATION&state=all", note: `${c.missedMeds} visits with a missed medication alert (${share(c.missedMeds)})` },
            ]}
          />
        </section>

        <div className="hb-hgrid">
          <Panel id="todo" colour="red" icon={<Warning size={15} weight="bold" />} title="What needs doing" count={needing} action={<span className="text-[12px] font-medium opacity-90">Most urgent first</span>} fullHref="/rota/attention" flush testId="what-needs-doing">
            {todos.map((t) => <TodoRow key={t.key} t={t} />)}
          </Panel>
          <Panel id="goto" colour="navy" icon={<ArrowRight size={15} weight="bold" />} title="Go to" flush className="self-start" testId="go-to">
            <nav aria-label="Go to" className="hb-golinks" data-hb-module="rota">
              <GoLink href={day()} icon={<CalendarDots size={20} />} title="Daily Rota" sub={isToday ? "Today's visits, live" : "This day's visits"} />
              <GoLink href="/rota/attention" icon={<WarningOctagon size={20} />} title="Visits Needing Attention" sub="Everything that could stop a visit" />
              <GoLink href={`/rota/planner?week=${mondayOf(date)}`} icon={<SquaresFour size={20} />} title="Weekly Planner" sub="Plan the week by dragging visits" />
              {canBuild ? <GoLink href={`/rota/build?week=${mondayOf(date)}`} icon={<CalendarBlank size={20} />} title="Build Rota" sub="Turn templates into next week's rota" /> : null}
              {d.canPeople ? <GoLink href="/rota/service-users" icon={<User size={20} />} title="Service users" sub={`${plural(d.serviceUsers.length, "person", "people")} we support`} /> : null}
              {d.canStaff ? <GoLink href="/rota/staff" icon={<ShieldCheck size={20} />} title="Staff & Eligibility" sub={unlinked ? `Who can work and where · ${unlinked} without a sign-in` : "Who can work and where"} /> : null}
              {canFinance ? <GoLink href="/rota/finance" icon={<CurrencyGbp size={20} />} title="Finance" sub="This week's timesheets and invoices" /> : null}
            </nav>
          </Panel>
        </div>

        <section aria-label="People and reminders" className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <Panel id="su-h" colour="rose" icon={<Users size={15} weight="bold" />} title="All Service Users" count={d.canPeople ? d.serviceUsers.length : undefined} fullHref="/rota/service-users" flush>
            <div className="pt-2.5">
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
          ) : <p className="px-3.5 pb-4 text-[13.5px] text-[#475467]">Your role does not include service-user records.</p>}
            </div>
          </Panel>
          <Panel id="team-h" colour="purple" icon={<UsersThree size={15} weight="bold" />} title="All Team Members" count={d.canStaff ? d.team.length : undefined} fullHref="/rota/staff" flush action={d.canStaff && unlinked ? <Link href="/rota/staff" title="Team members with no app sign-in linked yet" className="hb-pn-act"><EnvelopeSimple size={13} aria-hidden />{unlinked} without a sign-in</Link> : null}>
            <div className="pt-2.5">
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
                    <span key="s" className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[12px] font-semibold ${STATUS_PILL[st.status]}`}><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />{st.status}</span>,
                  ],
                };
              })}
            />
          ) : <p className="px-3.5 pb-4 text-[13.5px] text-[#475467]">Your role does not include the staff directory.</p>}
            </div>
          </Panel>
          <Panel id="rem-h" colour="amber" icon={<Alarm size={15} weight="bold" />} title="All Active Reminders" count={d.reminders.length} flush action={<Link href="/rota/reminders" className="hb-pn-act">View All</Link>}>
            <div className="pt-2.5">
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
                r.overdueDays ? <span key="o" className="rounded-full bg-[#fdecec] px-2 py-0.5 text-[12px] font-semibold tabular-nums text-[#a3242c]">{r.overdueDays} day(s)</span> : <span key="o" className="text-[#667085]">—</span>,
              ],
            }))}
          />
            </div>
          </Panel>
        </section>

        <section aria-label="Birthdays" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Panel id="sub-h" colour="cyan" icon={<Cake size={15} weight="bold" />} title="Service User Upcoming Birthdays" action={<span className="text-[12px] font-medium opacity-90">Next {BIRTHDAY_WINDOW_DAYS} days</span>} flush>
            <div className="pt-2.5"><BirthdayTable who="Service User" rows={d.birthdays.serviceUsers} unavailable="Your role does not include service-user records." /></div>
          </Panel>
          <Panel id="tmb-h" colour="purple" icon={<Cake size={15} weight="bold" />} title="Team Member Upcoming Birthdays" action={<span className="text-[12px] font-medium opacity-90">Next {BIRTHDAY_WINDOW_DAYS} days</span>} flush>
            <div className="pt-2.5"><BirthdayTable who="Team Member" rows={d.birthdays.team} unavailable="Dates of birth are kept in HR & Workforce, so only people with HR access see team birthdays." /></div>
          </Panel>
        </section>
      </div>
    </div>
  );
}
