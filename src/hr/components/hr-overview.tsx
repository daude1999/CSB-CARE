"use client";
/**
 * HR overview (`/hr/dashboard`), built to the owner's approved HR concept of 2 Nov 2026: what needs attention today.
 * Four figures, "Action required" (each row opens the existing screen already filtered) and "Coming up" (new starters
 * and booked interviews). No employee directory here: that is People's job.
 *
 * Checks, people and HR tasks come from the HR Hub data already on the page (branch scope applied on the server).
 * Interviews and leave requests come from /api/hr/overview, permission-checked on the server. If that part cannot
 * load, the page says so instead of showing a zero.
 */
import { useEffect, useState } from "react";
import { ArrowRight, CalendarBlank, CalendarCheck, ClockCountdown, FileText, GraduationCap, ListChecks, UsersThree, WarningCircle, CalendarDots } from "@phosphor-icons/react";
import { HrAvatar, HrEmpty, HrHeading, HrStat, HX_PRIMARY, HX_QUIET } from "@/components/hr-ui";
import Link from "@/components/link";
import { actionsDue, overviewFigures, STARTING_SOON_DAYS } from "@/hr/lib/overview";
import { dateDays } from "@/hr/lib/domain";
import type { HubData } from "@/hr/lib/presentation";
import type { HrOverviewExtras } from "@/server/workforce/hr-overview";

type Extras = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; data: HrOverviewExtras };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Mon 14 Apr" for a date (YYYY-MM-DD) or an instant, in London. */
function dayLabel(value: string) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/London" }).format(d).replace(",", "");
}
function timeLabel(iso: string) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(new Date(iso));
}
function londonDay(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date(iso));
}

export function HrOverview({ data, scope, setScope }: { data: HubData; scope: string; setScope: (s: string) => void }) {
  const [extras, setExtras] = useState<Extras>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    fetch(`/api/hr/overview?branch=${encodeURIComponent(scope)}`, { cache: "no-store" })
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!live) return;
        if (r.ok) setExtras({ state: "ready", data: body as HrOverviewExtras });
        else setExtras({ state: "error", message: (body as { error?: string }).error ?? "Could not load interviews and leave requests" });
      })
      .catch(() => live && setExtras({ state: "error", message: "Could not reach the server for interviews and leave requests" }));
    return () => {
      live = false;
    };
  }, [scope, attempt]);

  const f = overviewFigures({ employees: data.employees, checks: data.checks, tasks: data.tasks, today: data.today, userId: data.user.id });
  const x = extras.state === "ready" ? extras.data : null;
  const q = (path: string, extra = "") => `/hr${path}?branch=${encodeURIComponent(scope)}${extra}`;
  const branchName = (id: string) => data.branches.find((b) => b.id === id)?.name ?? "";

  type Row = { key: string; icon: React.ReactNode; title: string; detail: string; n: number; href: string; bad?: boolean };
  const rows: Row[] = [
    {
      key: "training",
      icon: <GraduationCap size={21} />,
      n: f.training.overdue + f.training.dueSoon,
      title: `${plural(f.training.overdue + f.training.dueSoon, "training record")} expiring or overdue`,
      detail: [f.training.overdue ? `${f.training.overdue} overdue` : "", f.training.dueSoon ? `${f.training.dueSoon} expire within the next 30 days` : ""].filter(Boolean).join(", ") + ".",
      href: q("/compliance", "&category=Training&status=Expiring+or+overdue"),
    },
    {
      key: "documents",
      icon: <FileText size={21} />,
      n: f.awaitingReview.n,
      title: `${plural(f.awaitingReview.n, "document")} awaiting review`,
      detail: "Evidence has been uploaded and needs someone to check and verify it.",
      href: q("/compliance", "&status=Awaiting+verification"),
    },
    ...(x
      ? [
          {
            key: "leave",
            icon: <CalendarDots size={21} />,
            n: x.leaveRequests,
            title: `${plural(x.leaveRequests, "leave request")} to ${x.canDecide ? "approve" : "be decided"}`,
            detail: "Holiday and other leave waiting for a decision. Approved leave is passed to the rota.",
            href: "/workforce/absences?status=REQUESTED",
          },
        ]
      : []),
    {
      key: "missing",
      icon: <WarningCircle size={21} />,
      bad: true,
      n: f.missing.n,
      title: `${plural(f.missing.n, "required check")} missing evidence`,
      detail: "Nothing is on file yet for a check the person's role needs.",
      href: q("/compliance", "&status=Missing+evidence"),
    },
    {
      key: "overdue",
      icon: <ClockCountdown size={21} />,
      bad: true,
      n: f.overdue.n,
      title: `${plural(f.overdue.n, "check")} overdue`,
      detail: "Past the review date, including training records.",
      href: q("/compliance", "&status=Overdue"),
    },
    {
      key: "incomplete",
      icon: <ListChecks size={21} />,
      n: f.incomplete.n,
      title: `${plural(f.incomplete.n, "check")} without a next review date`,
      detail: "Checked and verified, but the date of the next review was not recorded.",
      href: q("/compliance", "&status=Incomplete+information"),
    },
    {
      key: "tasks",
      icon: <ListChecks size={21} />,
      n: f.myOverdueTasks,
      title: `${plural(f.myOverdueTasks, "of your HR tasks", "of your HR tasks")} overdue`,
      detail: "Onboarding and other HR tasks assigned to you that are past their due date.",
      href: q("/alerts", "&view=tasks"),
    },
  ].filter((r) => r.n > 0);

  type Event = { key: string; at: string; kind: "starter" | "interview"; name: string; meta: string; href: string; when: string; sub: string };
  const events: Event[] = [
    ...f.starters.map((e) => {
      const days = dateDays(e.start, data.today);
      return {
        key: `s-${e.id}`,
        at: `${e.start}T00:00`,
        kind: "starter" as const,
        name: e.name,
        meta: [e.job, branchName(e.branch)].filter(Boolean).join(" • "),
        href: `/hr/people/${encodeURIComponent(e.id)}?branch=${encodeURIComponent(scope)}`,
        when: dayLabel(e.start),
        sub: days === 0 ? "Starts today" : days === 1 ? "Starts tomorrow" : `Starts in ${days} days`,
      };
    }),
    ...(x?.interviews ?? []).map((i) => ({
      key: `i-${i.id}`,
      at: `${londonDay(i.startsAt)}T${timeLabel(i.startsAt)}`,
      kind: "interview" as const,
      name: i.name,
      meta: [i.role, i.branch].filter(Boolean).join(" • "),
      href: `/hr/recruitment/${encodeURIComponent(i.candidateId)}`,
      when: dayLabel(i.startsAt),
      sub: `${timeLabel(i.startsAt)} – ${timeLabel(i.endsAt)}${i.status === "AWAITING_CONFIRMATION" ? " · not confirmed" : ""}`,
    })),
  ]
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 6);

  const pending = extras.state === "loading" ? "…" : extras.state === "error" ? "—" : null;

  return (
    <div className="hr-ui hx-page" data-testid="hr-dashboard">
      <HrHeading
        title="HR overview"
        subtitle="Your priorities today"
        actions={
          <>
            <Link href={q("/alerts", "&view=tasks")} className={HX_QUIET}>My tasks</Link>
            <Link href={q("/alerts")} className={HX_QUIET}>Alerts</Link>
            <label className="hx-field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <span>Branch</span>
              <select aria-label="Branch scope" className="hx-select" style={{ width: "auto", minWidth: 170 }} value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="all">{data.allBranches ? "All branches" : "All my branches"}</option>
                {data.branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </label>
          </>
        }
      />

      <ul className="hx-stats" aria-label="Summary">
        <HrStat testId="fig-employees" icon={<UsersThree size={22} />} value={f.employees} label="Employees" href={q("/people")} note="Everyone not archived" />
        <HrStat testId="fig-actions" icon={<ListChecks size={22} />} value={pending ?? actionsDue(f, x?.leaveRequests ?? 0)} label="Actions due" href="#hr-actions" note="Items listed under Action required" />
        <HrStat testId="fig-starting" icon={<CalendarBlank size={22} />} value={f.starters.length} label="Starting soon" href="#hr-coming-up" note={`Start date in the next ${STARTING_SOON_DAYS} days`} />
        <HrStat testId="fig-interviews" icon={<CalendarCheck size={22} />} value={pending ?? x!.interviewsToday} label="Interviews today" href="/hr/recruitment" note="Booked or held today" />
      </ul>

      <div className="hx-split">
        <section className="hx-card" aria-labelledby="hr-actions" data-testid="hr-action-required">
          <div className="hx-card-head">
            <h2 className="hx-card-title" id="hr-actions" tabIndex={-1}>Action required</h2>
          </div>
          <div className="hx-card-body">
            {extras.state === "error" ? (
              <p className="hx-alert" role="alert">
                Leave requests could not be loaded: {extras.message}.{" "}
                <button type="button" className="hx-link" onClick={() => { setExtras({ state: "loading" }); setAttempt((n) => n + 1); }}>Try again</button>
              </p>
            ) : null}
            {rows.length ? (
              <ul className="hx-rows">
                {rows.map((r) => (
                  <li key={r.key} className="hx-row" data-testid={`action-${r.key}`}>
                    <span className={`hx-row-icon ${r.bad ? "is-bad" : ""}`} aria-hidden="true">{r.icon}</span>
                    <span className="hx-row-text">
                      <span className="hx-row-title">{r.title}</span>
                      <span className="hx-row-detail">{r.detail}</span>
                    </span>
                    <span className="hx-row-go">
                      <Link href={r.href} className={`${HX_PRIMARY} hx-btn--sm`} aria-label={`Review: ${r.title}`}>Review</Link>
                      <ArrowRight size={18} className="hx-row-arrow" aria-hidden="true" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : extras.state === "loading" ? (
              <div className="grid gap-3 py-4" aria-busy="true" aria-label="Loading">
                <div className="hx-skeleton" /><div className="hx-skeleton" style={{ width: "70%" }} />
              </div>
            ) : (
              <HrEmpty title="Nothing needs your attention">Checks, documents{x ? ", leave requests" : ""} and your HR tasks are all up to date for this branch scope.</HrEmpty>
            )}
          </div>
        </section>

        <section className="hx-card" aria-labelledby="hr-coming-up" data-testid="hr-coming-up">
          <div className="hx-card-head">
            <h2 className="hx-card-title" id="hr-coming-up" tabIndex={-1}>Coming up</h2>
            <Link href="/hr/recruitment" className="hx-link">Recruitment</Link>
          </div>
          <div className="hx-card-body">
            {events.length ? (
              <ul className="hx-rows">
                {events.map((e) => (
                  <li key={e.key} className="hx-event" data-testid={`event-${e.kind}`}>
                    <span className={`hx-event-kind ${e.kind === "interview" ? "is-interview" : ""}`}>{e.kind === "interview" ? "Interview" : "New starter"}</span>
                    <HrAvatar name={e.name} size="lg" />
                    <span className="min-w-0">
                      <Link href={e.href} className="hx-event-name">{e.name}</Link>
                      <span className="hx-event-meta">{e.meta}</span>
                    </span>
                    <span className="hx-event-when">
                      {e.when}
                      <small>{e.sub}</small>
                    </span>
                  </li>
                ))}
              </ul>
            ) : extras.state === "loading" ? (
              <div className="grid gap-3 py-4" aria-busy="true" aria-label="Loading"><div className="hx-skeleton" /><div className="hx-skeleton" style={{ width: "60%" }} /></div>
            ) : (
              <HrEmpty title="Nothing coming up">No new starters in the next {STARTING_SOON_DAYS} days{x ? " and no interviews booked in the next 14 days" : ""}.</HrEmpty>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
