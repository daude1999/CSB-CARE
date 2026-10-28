"use client";
import { useState, type ReactNode } from "react";
import Link from "@/hr/nav";
import {
  Users,
  UserPlus,
  Clock,
  AlertCircle,
  Files,
  ChevronRight,
  Building2,
  ArrowUpRight,
  Upload,
  Bell,
  RefreshCw,
  ShieldCheck,
  FileText,
  Check,
} from "lucide-react";
import { Badge, Avatar, Empty, KpiStrip, ComplianceMeter, Segmented, Timeline } from "./ui";
import {
  checkStatus,
  priorities,
  canEdit,
  type Check as Review,
} from "@/hr/lib/domain";
import {
  branchStats,
  currentChecks,
  currentPeople,
  displayDate,
  statusCounts,
  type HubData,
} from "@/hr/lib/presentation";

export function StatCard({
  label,
  value,
  caption,
  icon,
  tone = "blue",
  onClick,
}: {
  label: string;
  value: number | string;
  caption: string;
  icon: ReactNode;
  tone?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="stat-top">
        <span>{label}</span>
        <span className={`stat-icon ${tone}`}>{icon}</span>
      </div>
      <strong className={`stat-value ${tone}`}>{value}</strong>
      <small>{caption}</small>
    </>
  );
  return onClick ? (
    <button className="stat-card" onClick={onClick}>
      {content}
    </button>
  ) : (
    <div className="stat-card">{content}</div>
  );
}
export function Ring({
  value,
  label,
  size = 92,
  tone = "blue",
}: {
  value: number;
  label: string;
  size?: number;
  tone?: string;
}) {
  return (
    <div
      className={`score-ring ${tone}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${value}% ${label}`}
    >
      <svg viewBox="0 0 100 100">
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke="#eaf0f4"
          strokeWidth="7"
        />
        <circle
          cx="50"
          cy="50"
          r="42"
          fill="none"
          stroke="currentColor"
          strokeWidth="7"
          strokeLinecap="round"
          pathLength="100"
          strokeDasharray={`${value} 100`}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div>
        <strong>{value}%</strong>
        <small>{label}</small>
      </div>
    </div>
  );
}
export function SectionHeading({
  title,
  caption,
  action,
}: {
  title: string;
  caption?: string;
  action?: ReactNode;
}) {
  return (
    <div className="widget-heading">
      <div>
        <h2>{title}</h2>
        {caption && <p>{caption}</p>}
      </div>
      {action}
    </div>
  );
}
export function RecentActivity({
  data,
  employee,
  limit = 5,
}: {
  data: HubData;
  employee?: string;
  limit?: number;
}) {
  const events = data.events
    .filter((e) => !employee || e.employee === employee)
    .slice(0, limit);
  return (
    <div className="fresh-activity">
      {events.map((event) => {
        const Icon = /document|evidence|Upload|Preview|Download/.test(
          event.action,
        )
          ? FileText
          : /review|verified/i.test(event.action)
            ? ShieldCheck
            : /note/i.test(event.action)
              ? FileText
              : Users;
        return (
          <div className="fresh-event" key={event.id}>
            <span className="event-mark">
              <Icon size={15} />
            </span>
            <div>
              <strong>{event.action}</strong>
              <p>
                {data.employees.find((e) => e.id === event.employee)?.name ||
                  event.actor}
              </p>
              <small>
                {displayDate(event.at)} · {event.actor}
              </small>
            </div>
          </div>
        );
      })}
      {!events.length && (
        <Empty
          title="No recent changes"
          detail="Authorised record activity will appear here."
        />
      )}
    </div>
  );
}
export function TaskList({
  data,
  employee,
  onReview,
  limit = 4,
}: {
  data: HubData;
  employee?: string;
  onReview: (c: Review) => void;
  limit?: number;
}) {
  const tasks = currentChecks(data)
    .filter(
      (c) =>
        (!employee || c.employee === employee) &&
        c.required &&
        checkStatus(c, data.today) !== "Up to date",
    )
    .sort((a, b) => {
      const aSoon = !!a.due && a.due >= data.today;
      const bSoon = !!b.due && b.due >= data.today;
      return (
        Number(bSoon) - Number(aSoon) ||
        (a.due || "9999").localeCompare(b.due || "9999")
      );
    })
    .slice(0, limit);
  return (
    <div className="task-list">
      {tasks.map((c) => {
        const e = data.employees.find((e) => e.id === c.employee)!;
        return (
          <button className="task-row" key={c.id} onClick={() => onReview(c)}>
            <div className="task-date">
              {c.due ? (
                <>
                  <strong>{new Date(c.due + "T12:00:00Z").getUTCDate()}</strong>
                  <span>
                    {new Date(c.due + "T12:00:00Z").toLocaleString("en-GB", {
                      month: "short",
                      timeZone: "UTC",
                    })}
                  </span>
                </>
              ) : (
                <Files size={20} />
              )}
            </div>
            <div className="task-copy">
              <strong>{c.name}</strong>
              <small>
                {e.name} · {data.branches.find((b) => b.id === e.branch)?.name}
              </small>
              <Badge>{checkStatus(c, data.today)}</Badge>
            </div>
            <ChevronRight size={15} />
          </button>
        );
      })}
      {!tasks.length && (
        <Empty
          title="Nothing outstanding"
          detail="All applicable review requirements are up to date."
        />
      )}
    </div>
  );
}
export function BranchPerformance({
  data,
  onBranch,
  scope = "all",
}: {
  data: HubData;
  onBranch: (id: string) => void;
  scope?: string;
}) {
  return (
    <div className="table-scroll">
      <table className="performance-table">
        <thead>
          <tr>
            <th>Branch</th>
            <th>Employees</th>
            <th>Checks up to date</th>
            <th>Overdue checks</th>
            <th>Missing evidence</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {data.branches
            .filter(
              (b) =>
                (scope === "all" || b.id === scope) &&
                data.employees.some((e) => e.branch === b.id),
            )
            .map((b) => {
              const s = branchStats(data, b.id);
              return (
                <tr key={b.id}>
                  <td>
                    <span className="branch-table-name">
                      <Building2 size={16} />
                      {b.name}
                    </span>
                  </td>
                  <td>{s.employees.length}</td>
                  <td>
                    <div className="inline-progress">
                      <span>{s.rate}%</span>
                      <div>
                        <i style={{ width: `${s.rate}%` }} />
                      </div>
                    </div>
                  </td>
                  <td>
                    <span
                      className={s.counts.Overdue ? "count-pill red" : "muted"}
                    >
                      {s.counts.Overdue}
                    </span>
                  </td>
                  <td>{s.missing} employees</td>
                  <td>
                    <button className="text-btn" onClick={() => onBranch(b.id)}>
                      View branch <ChevronRight size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}
export function Overview({
  data,
  scope,
  onAdd,
  onUpload,
  onReview,
  onEmployee,
  onBranch,
}: {
  data: HubData;
  scope: string;
  scopeName: string;
  onAdd: () => void;
  onUpload: () => void;
  onReview: (c: Review) => void;
  onEmployee: (id: string) => void;
  onBranch: (id: string) => void;
  actions: ReactNode;
}) {
  const employees = currentPeople(data);
  const checks = currentChecks(data).filter((c) => c.required);
  const counts = statusCounts(checks, data.today);
  const verified = counts["Up to date"] || 0;
  const overdue = checks.filter((c) => checkStatus(c, data.today) === "Overdue");
  const weekEnd = new Date(Date.parse(data.today + "T00:00:00Z") + 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  const dueThisWeek = checks.filter(
    (c) =>
      c.due &&
      c.due >= data.today &&
      c.due < weekEnd &&
      checkStatus(c, data.today) === "Due soon",
  );
  const overduePeople = new Set(overdue.map((c) => c.employee)).size;
  const requiredTotal = checks.length;
  const verifiedPercent = requiredTotal
    ? Math.round((verified / requiredTotal) * 100)
    : 0;
  const issueStates = [
    "Overdue",
    "Missing evidence",
    "Awaiting verification",
  ] as const;
  const peopleIssues = employees
    .map((employee) => {
      const issues = checks
        .filter(
          (c) =>
            c.employee === employee.id &&
            issueStates.includes(
              checkStatus(c, data.today) as (typeof issueStates)[number],
            ),
        )
        .sort(
          (a, b) =>
            priorities[checkStatus(a, data.today)] -
              priorities[checkStatus(b, data.today)] ||
            (a.due || "9999").localeCompare(b.due || "9999"),
        );
      return { employee, issues };
    })
    .filter((x) => x.issues.length)
    .sort(
      (a, b) =>
        priorities[checkStatus(a.issues[0], data.today)] -
          priorities[checkStatus(b.issues[0], data.today)] ||
        (a.issues[0].due || "9999").localeCompare(b.issues[0].due || "9999"),
    );
  const filterCounts = Object.fromEntries(
    issueStates.map((state) => [
      state,
      new Set(
        peopleIssues
          .filter((x) =>
            x.issues.some((c) => checkStatus(c, data.today) === state),
          )
          .map((x) => x.employee.id),
      ).size,
    ]),
  ) as Record<string, number>;
  const [issueFilter, setIssueFilter] = useState<string>(
    overdue.length ? "Overdue" : "Missing evidence",
  );
  const visibleIssues = peopleIssues
    .filter((x) =>
      x.issues.some((c) => checkStatus(c, data.today) === issueFilter),
    )
    .slice(0, 5);
  const dayDiff = (date: string) =>
    Math.floor(
      (Date.parse(date + "T00:00:00Z") -
        Date.parse(data.today + "T00:00:00Z")) /
        86400000,
    );
  const labelIssue = (c: Review) => {
    const status = checkStatus(c, data.today);
    if (status === "Overdue" && c.due)
      return c.name + " · " + Math.abs(dayDiff(c.due)) + "d overdue";
    if (status === "Missing evidence") return c.name + " missing";
    if (status === "Awaiting verification")
      return c.name + " awaiting verification";
    return c.name;
  };
  const dueChecks = checks
    .filter(
      (c) =>
        c.due &&
        c.due >= data.today &&
        dayDiff(c.due) <= 30 &&
        checkStatus(c, data.today) === "Due soon",
    )
    .sort((a, b) => (a.due || "").localeCompare(b.due || ""))
    .slice(0, 3);
  const weeks = Array.from({ length: 4 }, (_, i) => {
    const from = Date.parse(data.today + "T00:00:00Z") + i * 7 * 86400000;
    const to = from + 7 * 86400000;
    const inWeek = checks.filter(
      (c) =>
        c.due &&
        Date.parse(c.due + "T00:00:00Z") >= from &&
        Date.parse(c.due + "T00:00:00Z") < to,
    );
    return {
      label:
        i === 0
          ? "This week"
          : new Date(from).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              timeZone: "UTC",
            }),
      due: inWeek.filter((c) => checkStatus(c, data.today) === "Due soon")
        .length,
      over: i === 0 ? overdue.length : 0,
      from: new Date(from).toISOString().slice(0, 10),
      to: new Date(to).toISOString().slice(0, 10),
    };
  });
  const maxDue = Math.max(1, ...weeks.map((w) => w.due + w.over));
  const categoryName = (c: Review) => {
    const text = (c.category || c.name).toLowerCase();
    if (/dbs|safeguard/.test(text)) return "DBS & safeguarding";
    if (/right to work|identity|passport/.test(text))
      return "Right to work & ID";
    if (/reference/.test(text)) return "References";
    if (/supervision|appraisal/.test(text)) return "Supervisions";
    if (/training|qualification|first aid|manual handling|driving/.test(text))
      return "Training";
    return c.category || "Other requirements";
  };
  const categories = [...new Set(checks.map(categoryName))];
  const branchRows = data.branches
    .filter((b) => scope === "all" || b.id === scope)
    .map((branch) => {
      const subset = checks.filter((c) =>
        employees.some((e) => e.id === c.employee && e.branch === branch.id),
      );
      const state = statusCounts(subset, data.today);
      return {
        branch,
        counts: state,
        total: subset.length,
        percent: subset.length
          ? Math.round(((state["Up to date"] || 0) / subset.length) * 100)
          : 0,
      };
    });
  const sentence = overdue.length
    ? overdue.length +
      " checks are overdue across " +
      overduePeople +
      " people. " +
      dueThisWeek.length +
      " more fall due this week."
    : "Everything is up to date. " + dueThisWeek.length + " checks fall due this week.";
  const categoryRows = categories.map((label) => {
    const group = checks.filter((c) => categoryName(c) === label);
    const state = statusCounts(group, data.today);
    return {
      label,
      counts: state,
      total: group.length,
      percent: group.length
        ? Math.round(((state["Up to date"] || 0) / group.length) * 100)
        : 0,
    };
  });
  const recent = data.events.slice(0, 3).map((event) => ({
    title: event.action,
    detail:
      (data.employees.find((e) => e.id === event.employee)?.name ||
        event.actor) +
      " · " +
      event.actor,
    time: displayDate(event.at),
  }));
  const missing =
    (counts["Missing evidence"] || 0) +
    (counts["Awaiting verification"] || 0) +
    (counts["Incomplete information"] || 0);

  return (
    <div className="cs-dashboard">
      <header className="cs-head">
        <div>
          <h1 data-testid="dashboard-title">
            Good afternoon, {data.user.name.split(" ")[0]}
          </h1>
          <p>{sentence}</p>
        </div>
        <div className="actions">
          <button
            className="cs-btn cs-btn--secondary"
            onClick={onUpload}
            disabled={!canEdit(data.user)}
          >
            <Upload size={15} />
            Upload evidence
          </button>
          {canEdit(data.user) && (
            <button className="cs-btn cs-btn--primary" onClick={onAdd}>
              <UserPlus size={15} />
              Add employee
            </button>
          )}
        </div>
      </header>
      <KpiStrip
        items={[
          {
            label: "Current employees",
            value: employees.length,
            note:
              employees.filter((e) => e.status === "Active").length +
              " active · " +
              employees.filter((e) => e.status !== "Active").length +
              " new starter / other · archived excluded",
            href: "/people?branch=" + scope + "&view=All+people",
          },
          {
            label: "Checks verified",
            value: verifiedPercent + "%",
            note: verified + " of " + requiredTotal + " required checks",
            href: "/people?branch=" + scope + "&view=All+clear",
          },
          {
            label: "Overdue",
            value: overdue.length,
            note: "Checks past review date · " + overduePeople + " people",
            href: "/compliance?branch=" + scope + "&status=Overdue",
            hot: true,
          },
          {
            label: "Due in 30 days",
            value: counts["Due soon"] || 0,
            note:
              "Checks to plan · busiest week " +
              weeks.reduce((a, b) => (b.due > a.due ? b : a), weeks[0]).label,
            href: "/compliance?branch=" + scope + "&status=Due+soon",
          },
        ]}
      />
      <div className="cs-dgrid">
        <div className="cs-dgrid__left">
          <section className="cs-panel">
            <div className="cs-panel__head">
              <h2>Needs attention</h2>
              <span className="cs-count">
                {new Set(peopleIssues.map((x) => x.employee.id)).size} people
              </span>
              <div className="cs-panel__head-actions">
                <Segmented
                  label="Filter attention"
                  value={issueFilter}
                  onChange={setIssueFilter}
                  items={issueStates.map((label) => ({
                    label,
                    count: filterCounts[label],
                  }))}
                />
              </div>
            </div>
            <div className="cs-alist">
              {visibleIssues.map(({ employee, issues }) => {
                const ownerTask = (data.tasks || []).find(
                  (t) => t.employee === employee.id && t.status !== "Complete",
                );
                const owner = data.users.find(
                  (u) => u.id === ownerTask?.assignedTo,
                );
                const selected = issues[0];
                return (
                  <div className="cs-arow" key={employee.id}>
                    <button
                      className="cs-person"
                      onClick={() => onEmployee(employee.id)}
                    >
                      <Avatar name={employee.name} />
                      <span>
                        <b>{employee.preferredName || employee.name}</b>
                        <small>
                          {employee.job} ·{" "}
                          {
                            data.branches.find(
                              (b) => b.id === employee.branch,
                            )?.name
                          }
                        </small>
                      </span>
                    </button>
                    <div className="cs-arow__issues">
                      {issues.slice(0, 2).map((check) => {
                        const status = checkStatus(check, data.today);
                        return (
                          <Badge
                            key={check.id}
                            variant={
                              status === "Overdue" ||
                              status === "Missing evidence"
                                ? "danger"
                                : "warning"
                            }
                          >
                            {labelIssue(check)}
                          </Badge>
                        );
                      })}
                      {issues.length > 2 && (
                        <span className="cs-count">+{issues.length - 2}</span>
                      )}
                    </div>
                    <div
                      className="cs-arow__owner"
                      title={owner?.name || "No task owner assigned"}
                    >
                      {owner ? (
                        <Avatar name={owner.name} />
                      ) : (
                        <span className="cs-owner-empty">—</span>
                      )}
                    </div>
                    <div className="cs-arow__act">
                      <button
                        className="cs-btn cs-btn--secondary cs-btn--sm"
                        onClick={() => onReview(selected)}
                      >
                        Review
                      </button>
                      <button
                        className="cs-btn cs-btn--ghost cs-btn--icon cs-btn--sm"
                        aria-label={"Open " + employee.name + " record"}
                        onClick={() => onEmployee(employee.id)}
                      >
                        ···
                      </button>
                    </div>
                  </div>
                );
              })}
              {!visibleIssues.length && (
                <Empty
                  title={
                    issueFilter === "Overdue" ? "Nothing overdue" : "No open items"
                  }
                  detail="No people match this attention filter."
                />
              )}
            </div>
            <div className="cs-foot">
              <span>Sorted by days overdue</span>
              <Link
                href={"/compliance?branch=" + scope}
                className="cs-btn cs-btn--link"
              >
                Open in Compliance <ArrowUpRight size={14} />
              </Link>
            </div>
          </section>
          <section className="cs-panel">
            <div className="cs-panel__head">
              <h2>Coming up</h2>
              <span className="cs-panel__sub">
                {counts["Due soon"] || 0} checks in the next 30 days
              </span>
              <Link
                className="cs-btn cs-btn--link"
                href={"/compliance?branch=" + scope + "&status=Due+soon"}
              >
                Plan reviews <ArrowUpRight size={14} />
              </Link>
            </div>
            <div className="cs-panel__body cs-due">
              <div className="cs-due__chart">
                {weeks.map((week, index) => (
                  <a
                    key={week.from}
                    className="cs-due__col"
                    href={
                      "/compliance?branch=" +
                      scope +
                      "&status=Due+soon&dueFrom=" +
                      week.from +
                      "&dueTo=" +
                      week.to
                    }
                  >
                    <b>{week.due + week.over}</b>
                    <div
                      className="cs-due__bar"
                      style={{
                        height: Math.max(
                          8,
                          ((week.due + week.over) / maxDue) * 126,
                        ),
                      }}
                    >
                      <i
                        style={{
                          height: week.due + week.over
                            ? (week.over / (week.due + week.over)) * 100 + "%"
                            : "0",
                        }}
                      />
                    </div>
                    <span>{index === 0 ? "This week" : week.label}</span>
                  </a>
                ))}
              </div>
              <div className="cs-due__list">
                <h3>Next up</h3>
                {dueChecks.map((check) => {
                  const employee = employees.find(
                    (x) => x.id === check.employee,
                  );
                  return (
                    <div className="cs-upnext" key={check.id}>
                      <Avatar name={employee?.name || "Unknown"} />
                      <span className="t">
                        <b>{employee?.preferredName || employee?.name}</b> ·{" "}
                        {check.name}
                      </span>
                      <time>{displayDate(check.due)}</time>
                    </div>
                  );
                })}
                {!dueChecks.length && (
                  <p className="muted">No reviews fall due in the next 30 days.</p>
                )}
              </div>
            </div>
          </section>
        </div>
        <div className="cs-dgrid__right">
          <section className="cs-panel">
            <div className="cs-panel__head">
              <h2>Compliance health</h2>
              <Link
                className="cs-btn cs-btn--link"
                href={"/compliance?branch=" + scope}
              >
                Report <ArrowUpRight size={14} />
              </Link>
            </div>
            <div className="cs-panel__body cs-health">
              <div className="cs-health__top">
                <div>
                  <strong className="cs-health__percent">{verifiedPercent}%</strong>
                  <span> verified</span>
                </div>
                <ComplianceMeter
                  verified={verified}
                  due={counts["Due soon"] || 0}
                  overdue={counts.Overdue || 0}
                  missing={missing}
                  large
                  legend
                />
              </div>
              <div className="cs-hgroup">
                <h3>By requirement</h3>
                {categoryRows.map((row) => (
                  <div className="cs-hrow" key={row.label}>
                    <span>{row.label}</span>
                    <ComplianceMeter
                      verified={row.counts["Up to date"] || 0}
                      due={row.counts["Due soon"] || 0}
                      overdue={row.counts.Overdue || 0}
                      missing={
                        (row.counts["Missing evidence"] || 0) +
                        (row.counts["Awaiting verification"] || 0) +
                        (row.counts["Incomplete information"] || 0)
                      }
                    />
                    <b>{row.percent}%</b>
                  </div>
                ))}
              </div>
              <div className="cs-hgroup">
                <h3>By branch</h3>
                {branchRows.map((row) => (
                  <button
                    type="button"
                    className="cs-hrow cs-hrow--button"
                    key={row.branch.id}
                    onClick={() => onBranch(row.branch.id)}
                  >
                    <span>{row.branch.name}</span>
                    <ComplianceMeter
                      verified={row.counts["Up to date"] || 0}
                      due={row.counts["Due soon"] || 0}
                      overdue={row.counts.Overdue || 0}
                      missing={
                        (row.counts["Missing evidence"] || 0) +
                        (row.counts["Awaiting verification"] || 0) +
                        (row.counts["Incomplete information"] || 0)
                      }
                    />
                    <b>{row.percent}%</b>
                  </button>
                ))}
              </div>
            </div>
            <div className="cs-panel__head">
              <h2>Recent activity</h2>
              <Link
                className="cs-btn cs-btn--link"
                href={"/alerts?branch=" + scope}
              >
                All <ArrowUpRight size={14} />
              </Link>
            </div>
            <div className="cs-panel__body">
              <Timeline items={recent} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export function BranchWorkspace({
  data,
  scope,
  onBranch,
}: {
  data: HubData;
  scope: string;
  onBranch: (id: string) => void;
}) {
  const branches = data.branches.filter(
    (b) => scope === "all" || scope === b.id,
  );
  const employees = currentPeople(data);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="section-eyebrow">YOUR ORGANISATION</span>
          <h1>Branches</h1>
          <p>One CSB team. A clear view of every location.</p>
        </div>
        <span className="scope-chip">
          <Building2 size={16} />
          {branches.length} permitted branches
        </span>
      </div>
      <div className="compact-summary-row">
        <StatCard
          label="Current employees"
          value={employees.length}
          caption="Across your selected branches"
          icon={<Users size={18} />}
        />
        <StatCard
          label="Overdue reviews"
          value={
            currentChecks(data).filter(
              (c) => checkStatus(c, data.today) === "Overdue",
            ).length
          }
          caption="Individual checks requiring attention"
          icon={<AlertCircle size={18} />}
          tone="red"
        />
      </div>
      <div className="rich-branch-grid">
        {branches.map((b) => {
          const s = branchStats(data, b.id);
          const team = data.users.filter(
            (u) => u.active && u.branches.includes(b.id),
          );
          return (
            <section className="panel rich-branch" key={b.id}>
              <div className="branch-card-top">
                <span className="branch-emblem">
                  <Building2 size={24} />
                </span>
                <Badge>CSB branch</Badge>
              </div>
              <h2>{b.name}</h2>
              <p>Care Solution Bureau</p>
              <div className="branch-readiness">
                <Ring value={s.rate} label="up to date" size={104} />
                <div>
                  <strong>
                    {s.compliant} / {s.employees.length}
                  </strong>
                  <span>
                    employees with all
                    <br />
                    required checks up to date
                  </span>
                </div>
              </div>
              <div className="branch-number-grid">
                <div>
                  <span>Active headcount</span>
                  <strong>
                    {s.employees.filter((e) => e.status === "Active").length}
                  </strong>
                </div>
                <div>
                  <span>Overdue checks</span>
                  <strong className="red-text">{s.counts.Overdue}</strong>
                </div>
                <div>
                  <span>Missing evidence</span>
                  <strong className="amber-text">{s.missing}</strong>
                </div>
                <div>
                  <span>Due soon</span>
                  <strong>{s.counts["Due soon"]}</strong>
                </div>
              </div>
              <div className="branch-team">
                <span>Assigned HR team</span>
                <div>
                  {team.slice(0, 4).map((u) => (
                    <span key={u.id} title={`${u.name} · ${u.role}`}>
                      <Avatar name={u.name} />
                    </span>
                  ))}
                  <small>{team.length} accounts</small>
                </div>
              </div>
              <button
                className="secondary-button full"
                onClick={() => onBranch(b.id)}
              >
                View branch people <ArrowUpRight size={16} />
              </button>
            </section>
          );
        })}
      </div>
      <section className="panel branch-performance">
        <SectionHeading
          title="Compare branches"
          caption="Same definitions and shared review policy across locations"
        />
        <BranchPerformance data={data} onBranch={onBranch} scope={scope} />
      </section>
    </>
  );
}
export function AlertsWorkspace({
  data,
  onReview,
  onEmployee,
  mutate,
  notify,
}: {
  data: HubData;
  onReview: (c: Review) => void;
  onEmployee: (id: string) => void;
  mutate: (body: unknown) => Promise<Record<string, unknown>>;
  notify: (s: string) => void;
}) {
  const [group, setGroup] = useState("All priorities");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const checks = currentChecks(data);
  const groups = [
    {
      name: "Overdue reviews",
      status: "Overdue",
      icon: <AlertCircle size={18} />,
      tone: "red",
      items: checks.filter((c) => checkStatus(c, data.today) === "Overdue"),
    },
    {
      name: "Upcoming due items",
      status: "Due soon",
      icon: <Clock size={18} />,
      tone: "amber",
      items: checks.filter((c) => checkStatus(c, data.today) === "Due soon"),
    },
    {
      name: "Missing documents",
      status: "Missing evidence",
      icon: <Files size={18} />,
      tone: "red",
      items: checks.filter(
        (c) => checkStatus(c, data.today) === "Missing evidence",
      ),
    },
  ];
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="section-eyebrow">STAY ONE STEP AHEAD</span>
          <h1>Alerts & reminders</h1>
          <p>See what needs attention. Resolve it in the employee’s record.</p>
        </div>
        <button
          className="secondary-button"
          disabled={!canEdit(data.user) || running}
          onClick={async () => {
            setRunning(true);
            try {
              const r = await mutate({ action: "reminders" });
              notify(`Reminder job complete. ${r.count} new in-app reminders.`);
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setRunning(false);
            }
          }}
        >
          <RefreshCw size={16} />
          {running ? "Processing…" : "Run reminder job"}
        </button>
      </div>
      <div className="compact-summary-row">
        {groups.map((g) => (
          <StatCard
            key={g.name}
            label={g.name}
            value={g.items.length}
            caption="Individual review checks"
            icon={g.icon}
            tone={g.tone}
            onClick={() => setGroup(g.name)}
          />
        ))}
      </div>
      <div className="panel">
        <div className="tabs">
          {["All priorities", ...groups.map((g) => g.name)].map(
            (g) => (
              <button
                key={g}
                className={group === g ? "active" : ""}
                onClick={() => setGroup(g)}
              >
                {g}
              </button>
            ),
          )}
        </div>
        <div className="priority-groups">
          {groups
            .filter((g) => group === "All priorities" || group === g.name)
            .map((g) => (
              <section key={g.name}>
                <div className="priority-heading">
                  <span className={`stat-icon ${g.tone}`}>{g.icon}</span>
                  <h2>{g.name}</h2>
                  <span className="count">{g.items.length}</span>
                </div>
                {g.items.slice(0, 5).map((c) => {
                  const e = data.employees.find((e) => e.id === c.employee)!;
                  return (
                    <button
                      key={c.id}
                      className="priority-row"
                      onClick={() => onReview(c)}
                    >
                      <Avatar name={e.name} />
                      <div>
                        <strong>{c.name}</strong>
                        <small>
                          {e.name} ·{" "}
                          {data.branches.find((b) => b.id === e.branch)?.name}
                        </small>
                      </div>
                      <Badge>{g.status}</Badge>
                      <span>{displayDate(c.due)}</span>
                      <ChevronRight size={16} />
                    </button>
                  );
                })}
                {!g.items.length && (
                  <p className="widget-note">No items in this group.</p>
                )}
                {g.items.length > 5 && (
                  <Link
                    className="widget-bottom-link"
                    href={`/compliance?branch=${typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("branch") || "all" : "all"}&status=${encodeURIComponent(g.status)}`}
                  >
                    View all {g.items.length} items <ChevronRight size={14} />
                  </Link>
                )}
              </section>
            ))}

        </div>
      </div>
      <section className="panel delivered-reminders">
        <SectionHeading
          title="Delivered reminders"
          caption="Marking an alert as read does not resolve its underlying check"
          action={
            <span className="count">
              {data.notices.filter((n) => !n.read).length} unread
            </span>
          }
        />
        {data.notices.length ? (
          data.notices.map((n) => (
            <div className={`alert-row ${n.read ? "read" : ""}`} key={n.id}>
              <Bell size={18} />
              <div>
                <strong>{n.message}</strong>
                <small>
                  {displayDate(n.at)} · {n.read ? "Read" : "Unread"} · In-app
                </small>
              </div>
              <button
                className="text-btn"
                onClick={() => onEmployee(n.employee)}
              >
                Open record
              </button>
              {!n.read && (
                <button
                  className="icon-btn"
                  aria-label="Mark alert read"
                  onClick={() =>
                    mutate({ action: "read-alert", id: n.id }).catch((e) =>
                      setError(e.message),
                    )
                  }
                >
                  <Check size={17} />
                </button>
              )}
            </div>
          ))
        ) : (
          <p className="widget-note">
            No reminders have been delivered yet. Live priorities above are
            calculated from current records.
          </p>
        )}
      </section>
      <p className="service-note">
        <Clock size={15} /> In-app outbox available. Automatic scheduling and
        external email are not configured.
      </p>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}

