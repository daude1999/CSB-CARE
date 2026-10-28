"use client";
import { useState } from "react";
import Link from "@/hr/nav";
import {
  Users,
  UserPlus,
  AlertTriangle,
  FileText,
  Upload,
  Plus,
  ListTodo,
  CalendarDays,
  ChevronRight,
  ArrowUpRight,
} from "lucide-react";
import { Avatar, Badge, ComplianceMeter, Empty } from "./ui";
import { checkStatus, canEdit, dateDays, type Doc } from "@/hr/lib/domain";
import {
  currentPeople,
  currentChecks,
  checksFor,
  statusCounts,
  documentState,
  displayDate,
  type HubData,
} from "@/hr/lib/presentation";
import { documentTitle } from "@/hr/lib/document-groups";
import { employeeRoute } from "@/hr/lib/routes";

export function HRHome({
  data,
  scope,
  onAdd,
  onUpload,
  onDocument,
}: {
  data: HubData;
  scope: string;
  onAdd: () => void;
  onUpload: () => void;
  onDocument: (d: Doc) => void;
}) {
  const [view, setView] = useState("All");
  const people = currentPeople(data);
  const ids = new Set(people.map((e) => e.id));
  const checks = currentChecks(data);
  const overdue = checks.filter(
    (c) => checkStatus(c, data.today) === "Overdue",
  );
  const pending = data.documents.filter(
    (d) =>
      ids.has(d.employee) &&
      !data.documents.some((next) => next.previous === d.id) &&
      ["Awaiting verification", "Quarantined"].includes(documentState(d, data)),
  );
  const tasks = (data.tasks || []).filter(
    (t) =>
      t.assignedTo === data.user.id &&
      t.status !== "Complete" &&
      ids.has(t.employee),
  );
  const latePeople = people
    .filter((e) => overdue.some((c) => c.employee === e.id))
    .sort((a, b) => {
      const due = (id: string) =>
        overdue
          .filter((c) => c.employee === id)
          .map((c) => c.due || "")
          .sort()[0];
      return due(a.id).localeCompare(due(b.id));
    })
    .slice(0, 2);
  const week = checks
    .filter(
      (c) =>
        c.required &&
        c.due &&
        dateDays(c.due, data.today) >= 0 &&
        dateDays(c.due, data.today) <= 7 &&
        checkStatus(c, data.today) !== "Up to date",
    )
    .sort((a, b) => a.due!.localeCompare(b.due!));
  const weekPerson = people.find((e) => e.id === week[0]?.employee);
  const lateTasks = tasks
    .filter((t) => t.due < data.today)
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 1);
  const weekTasks = tasks
    .filter(
      (t) =>
        dateDays(t.due, data.today) >= 0 && dateDays(t.due, data.today) <= 7,
    )
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 1);
  const reviewDocs = pending
    .sort((a, b) => b.uploaded.localeCompare(a.uploaded))
    .slice(0, 2);
  const visibleCounts = {
    People: latePeople.length + (weekPerson ? 1 : 0),
    Documents: reviewDocs.length,
    Tasks: lateTasks.length + weekTasks.length,
  };
  const allCount = Object.values(visibleCounts).reduce((a, b) => a + b, 0);
  const branchName = (id: string) =>
    data.branches.find((b) => b.id === id)?.name || "Not recorded";
  const personLink = (id: string) => employeeRoute(id, scope);
  const show = (kind: string) => view === "All" || view === kind;
  const agenda = checks
    .filter((c) => c.required && c.due && c.due >= data.today)
    .sort((a, b) => a.due!.localeCompare(b.due!))
    .slice(0, 5);
  const updated = [...people]
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .slice(0, 4);
  const group = (name: string, icon: React.ReactNode) => (
    <div className="h-wgrp">
      {icon}
      {name}
    </div>
  );
  const taskRow = (t: (typeof tasks)[number]) => {
    const e = people.find((p) => p.id === t.employee)!;
    return (
      <div className="h-wi" key={t.id}>
        <span className="h-wi__ic">
          <ListTodo size={18} />
        </span>
        <div>
          <div className="h-wi__t">{t.type}</div>
          <div className="h-wi__s">Task for {e.name} · assigned to you</div>
        </div>
        <div className="h-wi__r">
          <time className={t.due < data.today ? "late" : ""}>
            Due {displayDate(t.due)}
          </time>
          <Link className="h-go" href={`/alerts?branch=${scope}&view=tasks`}>
            Open task <ChevronRight size={14} />
          </Link>
        </div>
      </div>
    );
  };
  return (
    <>
      <header className="h-ph">
        <div>
          <h1 data-testid="dashboard-title">
            Good afternoon, {data.user.name.split(" ")[0]}
          </h1>
          <p>Here’s what needs your attention today.</p>
        </div>
        <div className="act">
          <button
            className="cs-btn cs-btn--secondary"
            disabled={!canEdit(data.user)}
            onClick={onUpload}
          >
            <Upload size={15} />
            Upload document
          </button>
          <button
            className="cs-btn cs-btn--primary"
            disabled={!canEdit(data.user)}
            onClick={onAdd}
          >
            <Plus size={16} />
            Add employee
          </button>
        </div>
      </header>
      <div className="h-quick">
        {[
          {
            n: people.length,
            label: "employees",
            icon: Users,
            href: `/people?branch=${scope}`,
            tone: "",
          },
          {
            n: people.filter((e) => e.status === "Onboarding").length,
            label: "new starters",
            icon: UserPlus,
            href: `/people?branch=${scope}&view=New+starters`,
            tone: "",
          },
          {
            n: overdue.length,
            label: "overdue actions",
            icon: AlertTriangle,
            href: `/compliance?branch=${scope}&status=Overdue`,
            tone: "bad",
          },
          {
            n: pending.length,
            label: "documents awaiting review",
            icon: FileText,
            href: `/documents?branch=${scope}`,
            tone: "warn",
          },
        ].map((q) => (
          <Link className="h-q" href={q.href} key={q.label}>
            <span className={`h-q__ic ${q.tone}`}>
              <q.icon size={18} />
            </span>
            <div>
              <b>{q.n}</b>
              <span>{q.label}</span>
            </div>
          </Link>
        ))}
      </div>
      <div className="h-grid">
        <section className="h-sheet h-work-sheet">
          <div className="h-sec h-work-head">
            <div className="h-sh">
              <h2>My HR work</h2>
              <span className="muted">{allCount} items shown</span>
              <Link
                className="cs-btn cs-btn--link"
                href={`/alerts?branch=${scope}&view=tasks`}
              >
                Open My tasks <ArrowUpRight size={14} />
              </Link>
            </div>
            <div
              className="h-tabs h-work-tabs"
              role="tablist"
              aria-label="HR work filters"
            >
              {["All", "People", "Documents", "Tasks"].map((v) => (
                <button
                  role="tab"
                  aria-selected={view === v}
                  key={v}
                  onClick={() => setView(v)}
                >
                  {v}
                  <span className="cs-count">
                    {v === "All"
                      ? allCount
                      : visibleCounts[v as keyof typeof visibleCounts]}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="h-work">
            {((show("People") && latePeople.length > 0) ||
              (show("Tasks") && lateTasks.length > 0)) &&
              group("Overdue", <AlertTriangle size={13} />)}
            {show("People") &&
              latePeople.map((e) => {
                const items = overdue.filter((c) => c.employee === e.id);
                return (
                  <div className="h-wi" key={e.id}>
                    <Avatar name={e.name} />
                    <div>
                      <Link href={personLink(e.id)} className="h-wi__t">
                        {e.name}
                      </Link>
                      <div className="h-wi__s">
                        {e.job} · {branchName(e.branch)}
                      </div>
                      <div className="h-wi__issues">
                        {items.slice(0, 2).map((c) => (
                          <Badge variant="danger" key={c.id}>
                            {c.name} overdue
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="h-wi__r">
                      <time className="late">
                        {Math.abs(dateDays(items[0].due!, data.today))} days
                        late
                      </time>
                      <Link className="h-go" href={personLink(e.id)}>
                        Review employee <ChevronRight size={14} />
                      </Link>
                    </div>
                  </div>
                );
              })}
            {show("Tasks") && lateTasks.map(taskRow)}
            {show("Documents") &&
              reviewDocs.length > 0 &&
              group("Documents to review", <FileText size={13} />)}
            {show("Documents") &&
              reviewDocs.map((d) => {
                const e = people.find((p) => p.id === d.employee)!;
                return (
                  <div className="h-wi" key={d.id}>
                    <span className="h-wi__ic doc">
                      <FileText size={18} />
                    </span>
                    <div>
                      <div className="h-wi__t">
                        {documentTitle(d, data.checks)}
                      </div>
                      <div className="h-wi__s">
                        {e.name} · {e.job} · uploaded {displayDate(d.uploaded)}
                      </div>
                      <div className="h-wi__issues">
                        <Badge>{documentState(d, data)}</Badge>
                      </div>
                    </div>
                    <div className="h-wi__r">
                      {d.state === "Quarantined" ? (
                        <Link className="h-go" href={personLink(e.id)}>
                          Open employee <ChevronRight size={14} />
                        </Link>
                      ) : (
                        <button className="h-go" onClick={() => onDocument(d)}>
                          Review document <ChevronRight size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            {((show("People") && weekPerson) ||
              (show("Tasks") && weekTasks.length > 0)) &&
              group("This week", <CalendarDays size={13} />)}
            {show("People") && weekPerson && (
              <div className="h-wi">
                <Avatar name={weekPerson.name} />
                <div>
                  <Link className="h-wi__t" href={personLink(weekPerson.id)}>
                    {weekPerson.name}
                  </Link>
                  <div className="h-wi__s">
                    {weekPerson.job} · {branchName(weekPerson.branch)}
                  </div>
                  <div className="h-wi__issues">
                    <Badge
                      variant={
                        checkStatus(week[0], data.today) === "Due soon"
                          ? "warning"
                          : "danger"
                      }
                    >
                      {week[0].name} · {checkStatus(week[0], data.today)}
                    </Badge>
                  </div>
                </div>
                <Link className="h-go" href={personLink(weekPerson.id)}>
                  Review employee <ChevronRight size={14} />
                </Link>
              </div>
            )}
            {show("Tasks") && weekTasks.map(taskRow)}
            {(view === "All"
              ? allCount === 0
              : visibleCounts[view as keyof typeof visibleCounts] === 0) && (
              <Empty
                title="No work in this view"
                detail="Your permitted records have no matching items."
              />
            )}
          </div>
        </section>
        <aside className="h-rail">
          <section className="h-sec">
            <div className="h-sh">
              <h2>Upcoming</h2>
              <Link
                className="cs-btn cs-btn--link"
                href={`/compliance?branch=${scope}&status=Due+soon`}
              >
                View all
              </Link>
            </div>
            <div className="h-ag">
              {[...new Set(agenda.map((c) => c.due!))].map((day) => (
                <div key={day}>
                  <div className="h-ag__d">
                    {day === data.today ? "Today · " : ""}
                    {displayDate(day)}
                  </div>
                  {agenda
                    .filter((c) => c.due === day)
                    .map((c) => {
                      const e = people.find((p) => p.id === c.employee)!;
                      return (
                        <Link
                          href={personLink(e.id)}
                          className="h-ag__i"
                          key={c.id}
                        >
                          <i className="h-ag__bar" />
                          <div>
                            <b>{c.name}</b>
                            <small>
                              {e.name} · {branchName(e.branch)}
                            </small>
                          </div>
                          <Avatar name={e.name} />
                        </Link>
                      );
                    })}
                </div>
              ))}
              {!agenda.length && (
                <p className="muted">No upcoming review dates.</p>
              )}
            </div>
          </section>
          <section className="h-sec">
            <div className="h-sh">
              <h2>Recently updated people</h2>
            </div>
            <div className="h-pl">
              {updated.map((e) => (
                <div className="h-pi" key={e.id}>
                  <Avatar name={e.name} />
                  <div>
                    <b>{e.name}</b>
                    <small>
                      {e.job} · {branchName(e.branch)}
                    </small>
                  </div>
                  <Link className="h-go" href={personLink(e.id)}>
                    Open profile <ChevronRight size={14} />
                  </Link>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
      <section className="h-sheet h-snapshot">
        <div className="h-sec">
          <div className="h-sh">
            <h2>Organisation snapshot</h2>
            <span className="muted">
              {scope === "all" ? "Your permitted branches" : branchName(scope)}
            </span>
            <Link
              className="cs-btn cs-btn--link"
              href={`/branches?branch=${scope}`}
            >
              Branches <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
        <div
          className="h-org"
          style={{
            gridTemplateColumns: `repeat(${data.branches.length + 1}, minmax(0,1fr))`,
          }}
        >
          <div>
            <h3>Workforce</h3>
            <span className="muted">{people.length} current employees</span>
            <div className="row">
              Active <b>{people.filter((e) => e.status === "Active").length}</b>
            </div>
            <div className="row">
              New starters{" "}
              <b>{people.filter((e) => e.status === "Onboarding").length}</b>
            </div>
            <div className="row">
              Archived{" "}
              <b>
                {data.employees.filter((e) => e.status === "Archived").length}
              </b>
            </div>
          </div>
          {data.branches.map((b) => {
            const groupPeople = people.filter((e) => e.branch === b.id);
            const groupChecks = groupPeople.flatMap((e) =>
              checksFor(data, e.id),
            );
            const counts = statusCounts(groupChecks, data.today);
            const total = groupChecks.filter((c) => c.required).length;
            return (
              <div key={b.id}>
                <Link href={`/people?branch=${b.id}`}>
                  <h3>{b.name}</h3>
                </Link>
                <span className="muted">{groupPeople.length} employees</span>
                <ComplianceMeter
                  verified={counts["Up to date"]}
                  due={counts["Due soon"]}
                  overdue={counts.Overdue}
                  missing={
                    counts["Missing evidence"] +
                    counts["Awaiting verification"] +
                    counts["Incomplete information"]
                  }
                />
                <div className="row">
                  Checks up to date{" "}
                  <b>
                    {total
                      ? Math.round((counts["Up to date"] / total) * 100)
                      : 0}
                    %
                  </b>
                </div>
                <div className="row">
                  Overdue <b>{counts.Overdue}</b>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
