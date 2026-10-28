"use client";
import { Fragment, useState, type ReactNode } from "react";
import Link from "@/hr/nav";
import {
  Mail,
  Upload,
  MessageCircle,
  MoreHorizontal,
  Hash,
  CalendarDays,
  Users,
  Lock,
  FileText,
  ChevronRight,
  AlertTriangle,
  ChevronLeft,
} from "lucide-react";
import { Avatar, Badge, ComplianceMeter } from "./ui";
import { HRTasks } from "./hr-tasks";
import { EmployeeChecks, EmployeeDocuments } from "./employee-sections";
import { documentTitle } from "@/hr/lib/document-groups";
import {
  checkStatus,
  employeeAddress,
  canEdit,
  dateDays,
  type Employee,
  type Doc,
  type Check,
} from "@/hr/lib/domain";
import {
  displayDate,
  checksFor,
  statusCounts,
  documentState,
  type HubData,
} from "@/hr/lib/presentation";

export function HRRecord({
  data,
  employee: e,
  scope,
  onEdit,
  onUpload,
  onDocument,
  onReview,
  onNote,
  mutate,
}: {
  data: HubData;
  employee: Employee;
  scope: string;
  onEdit: () => void;
  onUpload: () => void;
  onDocument: (d: Doc) => void;
  onReview: (c: Check) => void;
  onNote: () => void;
  mutate: (body: unknown) => Promise<Record<string, unknown>>;
}) {
  const [tab, setTab] = useState("Overview");
  const checks = checksFor(data, e.id);
  const required = checks.filter((c) => c.required);
  const counts = statusCounts(required, data.today);
  const docs = data.documents.filter((d) => d.employee === e.id);
  const events = [...data.events.filter((a) => a.employee === e.id)].sort(
    (a, b) => b.at.localeCompare(a.at),
  );
  const editable = canEdit(data.user);
  const overdue = required.filter(
    (c) => checkStatus(c, data.today) === "Overdue",
  );
  const branch =
    data.branches.find((b) => b.id === e.branch)?.name || "Not recorded";
  const notes = data.notes
    .filter((n) => n.employee === e.id)
    .sort((a, b) => b.at.localeCompare(a.at));
  const returnTo =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("returnTo")
      : null;
  const days = dateDays(data.today, e.start);
  const service =
    days < 0
      ? "Not yet started"
      : `${Math.floor(days / 365.25)} years ${Math.floor((days % 365.25) / 30.44)} months`;
  const facts: [string, ReactNode][] = [
    ["Job role", e.job],
    ["Branch", branch],
    [
      "Manager",
      e.lineManager ? (
        <span className="h-mgr">
          <Avatar name={e.lineManager} />
          {e.lineManager}
        </span>
      ) : (
        "Not recorded"
      ),
    ],
    ["Department", e.department || "Not recorded"],
    ["Employment type", e.employmentType || "Not recorded"],
    [
      "Employment status",
      <Badge variant="neutral" key="status">
        {e.status}
      </Badge>,
    ],
    ["Start date", displayDate(e.start)],
    ["Length of service", service],
    [
      "Staff ID",
      <span className="mono" key="id">
        {e.staffId}
      </span>,
    ],
  ];
  function fields(rows: [string, ReactNode][], extra = "") {
    return (
      <dl className={`h-fields record-field-grid ${extra}`}>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || "Not recorded"}</dd>
          </div>
        ))}
      </dl>
    );
  }
  function meter() {
    return (
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
    );
  }
  function timeline(limit?: number) {
    const items = limit ? events.slice(0, limit) : events;
    return (
      <ol className="cs-tl record-timeline h-timeline">
        {items.map((a, index) => (
          <Fragment key={a.id}>
            {!limit &&
              (index === 0 ||
                a.at.slice(0, 10) !== items[index - 1].at.slice(0, 10)) && (
                <li className="h-timeline-date">
                  <b>{displayDate(a.at)}</b>
                </li>
              )}
            <li key={a.id}>
              <span className="cs-tl__ic">
                <MessageCircle size={14} />
              </span>
              <div>
                <p>
                  <b>{a.actor}</b> · {a.action}
                </p>
                <time>{displayDate(a.at)}</time>
              </div>
            </li>
          </Fragment>
        ))}
        {!items.length && (
          <li>
            <p className="muted">No recorded activity.</p>
          </li>
        )}
      </ol>
    );
  }
  const sectionProps = { data, employee: e.id, onDocument, onReview, onUpload };
  return (
    <div className="h-record">
      <header className="h-prof employee-record-header">
        <div className="h-prof__in">
          <div className="h-id">
            <Avatar name={e.name} large />
            <div>
              <h1>{e.name}</h1>
              <p className="role">
                {e.job} · {branch}
              </p>
              <div className="h-facts">
                <Badge variant="neutral">
                  {e.status === "Active"
                    ? "Active employee"
                    : e.status === "Onboarding"
                      ? "New starter"
                      : e.status}
                </Badge>
                <span className="mono">
                  <Hash size={14} />
                  {e.staffId}
                </span>
                <span>
                  <CalendarDays size={14} />
                  Started {displayDate(e.start)}
                </span>
                <span>
                  <Users size={14} />
                  Reports to{" "}
                  {e.lineManager ? (
                    <>
                      <Avatar name={e.lineManager} />
                      {e.lineManager}
                    </>
                  ) : (
                    "Not recorded"
                  )}
                </span>
                <span>
                  <Mail size={14} />
                  {e.email || "Email not recorded"}
                </span>
              </div>
            </div>
            <div className="act">
              {e.email ? (
                <a
                  className="cs-btn cs-btn--secondary cs-btn--icon"
                  href={`mailto:${e.email}`}
                  aria-label={`Email ${e.name}`}
                >
                  <Mail size={16} />
                </a>
              ) : (
                <button
                  className="cs-btn cs-btn--secondary cs-btn--icon"
                  disabled
                  aria-label="Email not recorded"
                >
                  <Mail size={16} />
                </button>
              )}
              <button
                className="cs-btn cs-btn--secondary"
                disabled={!editable}
                onClick={onNote}
              >
                <MessageCircle size={15} />
                Add note
              </button>
              <button
                className="cs-btn cs-btn--primary"
                disabled={!editable}
                onClick={onUpload}
              >
                <Upload size={15} />
                Upload document
              </button>
              <details className="h-more">
                <summary
                  className="cs-btn cs-btn--secondary cs-btn--icon"
                  aria-label="Employee actions"
                >
                  <MoreHorizontal size={16} />
                </summary>
                <div className="h-menu">
                  {editable && <button onClick={onEdit}>Edit employee</button>}
                  <Link
                    href={
                      returnTo?.startsWith("/people?")
                        ? returnTo
                        : `/people?branch=${scope}`
                    }
                  >
                    <ChevronLeft size={14} />
                    All people
                  </Link>
                </div>
              </details>
            </div>
          </div>
          <nav
            className="h-ptabs employee-record-tabs"
            aria-label="Employee record sections"
          >
            {[
              "Overview",
              "Employment",
              "Compliance",
              "Documents",
              "Training",
              "Activity",
            ].map((t) => (
              <button
                key={t}
                className={tab === t ? "active" : ""}
                aria-current={tab === t ? "page" : undefined}
                onClick={() => setTab(t)}
              >
                {t}
                {t === "Compliance" && overdue.length > 0 && (
                  <span className="cs-count cs-count--bad">
                    {overdue.length}
                  </span>
                )}
                {t === "Documents" && (
                  <span className="cs-count">{docs.length}</span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <div className="h-wrap h-record-body">
        {tab === "Overview" && (
          <>
            {overdue.length > 0 && (
              <div className="h-alert">
                <AlertTriangle size={16} />
                <span>
                  <b>{overdue.length} compliance actions are overdue</b> —{" "}
                  {overdue.map((c) => c.name).join(" and ")}.
                </span>
                <button className="h-go" onClick={() => setTab("Compliance")}>
                  Review compliance <ChevronRight size={14} />
                </button>
              </div>
            )}
            <div className="h-grid record-overview-grid">
              <div className="h-sheet">
                <section className="h-sec">
                  <div className="h-sh">
                    <h2>Work profile</h2>
                    <button
                      className="cs-btn cs-btn--link"
                      onClick={() => setTab("Employment")}
                    >
                      Employment details ↗
                    </button>
                  </div>
                  {fields(facts)}
                </section>
                <section className="h-sec">
                  <div className="h-sh">
                    <h2>Contact</h2>
                    <button
                      className="cs-btn cs-btn--link"
                      disabled={!editable}
                      onClick={onEdit}
                    >
                      Edit
                    </button>
                  </div>
                  {fields([
                    ["Work email", e.email],
                    ["Phone", e.phone || "Not recorded"],
                    ["Preferred name", e.preferredName || "Not recorded"],
                  ])}
                  <details className="h-personal">
                    <summary className="h-lock">
                      <Lock size={16} />
                      <span>
                        <b>Personal details</b> · home address, date of birth,
                        emergency contact.{" "}
                        {data.user.sensitive
                          ? "Visible to HR with sensitive-data access."
                          : "Restricted to HR with sensitive-data access."}
                      </span>
                      <span className="h-go">
                        {data.user.sensitive ? "View" : "Restricted"}
                        <ChevronRight size={14} />
                      </span>
                    </summary>
                    {data.user.sensitive &&
                      fields(
                        [
                          ["Home address", employeeAddress(e)],
                          ["Date of birth", displayDate(e.dateOfBirth)],
                          ["Emergency contact", e.emergencyName],
                          ["Relationship", e.emergencyRelationship],
                          ["Emergency phone", e.emergencyPhone],
                          ["Identification type", e.identificationType],
                          [
                            "Identification reference",
                            e.identificationLastFour
                              ? `•••• ${e.identificationLastFour}`
                              : "Not recorded",
                          ],
                        ],
                        "h-private-fields",
                      )}
                  </details>
                </section>
                <section className="h-sec">
                  <div className="h-sh">
                    <h2>Documents</h2>
                    <span className="muted">{docs.length} files</span>
                    <button
                      className="cs-btn cs-btn--link"
                      onClick={() => setTab("Documents")}
                    >
                      View documents ↗
                    </button>
                  </div>
                  <div className="h-rows">
                    {[...docs]
                      .sort((a, b) => b.uploaded.localeCompare(a.uploaded))
                      .slice(0, 4)
                      .map((d) => (
                        <div className="h-row" key={d.id}>
                          <span className="h-fic">
                            <FileText size={15} />
                          </span>
                          <div className="nm">
                            <button
                              className="h-doc-title"
                              disabled={d.state === "Quarantined"}
                              onClick={() => onDocument(d)}
                              aria-label={d.filename}
                            >
                              <b>{documentTitle(d, checks)}</b>
                            </button>
                            <small>{d.category}</small>
                          </div>
                          <Badge>{documentState(d, data)}</Badge>
                          <time>{displayDate(d.uploaded)}</time>
                        </div>
                      ))}
                    {!docs.length && (
                      <p className="muted">No accessible documents.</p>
                    )}
                  </div>
                </section>
              </div>
              <aside className="h-rail">
                <section className="h-sec">
                  <div className="h-sh">
                    <h2>Compliance</h2>
                    <span className="muted">
                      {counts["Up to date"]} of {required.length} up to date
                    </span>
                  </div>
                  {meter()}
                  <div className="h-rail-checks">
                    {required.map((c) => (
                      <div className="h-row" key={c.id}>
                        <span className="nm">{c.name}</span>
                        <Badge>{checkStatus(c, data.today)}</Badge>
                      </div>
                    ))}
                  </div>
                  <button className="h-go" onClick={() => setTab("Compliance")}>
                    View compliance <ChevronRight size={14} />
                  </button>
                </section>
                <section className="h-sec">
                  <div className="h-sh">
                    <h2>Upcoming dates</h2>
                  </div>
                  <div className="h-ag">
                    {checks
                      .filter((c) => c.required && c.due)
                      .sort((a, b) => a.due!.localeCompare(b.due!))
                      .slice(0, 3)
                      .map((c) => (
                        <div className="h-ag__i" key={c.id}>
                          <i
                            className={`h-ag__bar ${c.due! < data.today ? "bad" : ""}`}
                          />
                          <div>
                            <b>{c.name}</b>
                            <small>
                              {c.due! < data.today ? "Overdue since " : ""}
                              {displayDate(c.due)}
                            </small>
                          </div>
                        </div>
                      ))}
                  </div>
                </section>
                <section className="h-sec">
                  <div className="h-sh">
                    <h2>Recent activity</h2>
                    <button
                      className="cs-btn cs-btn--link"
                      onClick={() => setTab("Activity")}
                    >
                      All
                    </button>
                  </div>
                  {timeline(3)}
                </section>
              </aside>
            </div>
          </>
        )}
        {tab === "Employment" && (
          <section className="h-sheet">
            <section className="h-sec">
              <div className="h-sh">
                <h2>Employment details</h2>
                <button
                  className="cs-btn cs-btn--link"
                  disabled={!editable}
                  onClick={onEdit}
                >
                  Edit employee
                </button>
              </div>
              {fields([
                ...facts,
                [
                  "Leaving date",
                  e.leavingDate ? displayDate(e.leavingDate) : "Not applicable",
                ],
              ])}
            </section>
            <section className="h-sec">
              <div className="h-sh">
                <h2>Employment history</h2>
              </div>
              <div className="record-timeline h-employment-history">
                {[...(e.employmentHistory || [])]
                  .sort((a, b) => b.at.localeCompare(a.at))
                  .map((h, i) => (
                    <article key={i}>
                      <b>
                        {displayDate(h.at)} · {h.actor}
                      </b>
                      <p>{h.changes.join(" · ")}</p>
                    </article>
                  ))}
                {!e.employmentHistory?.length && (
                  <p className="muted">No recorded employment changes.</p>
                )}
              </div>
            </section>
            <section className="h-sec">
              <div className="h-sh">
                <h2>Branch transfer history</h2>
              </div>
              {events
                .filter((a) => a.action.startsWith("Branch transferred"))
                .map((a) => (
                  <p key={a.id}>
                    {displayDate(a.at)} · {a.action}
                  </p>
                ))}
              {!events.some((a) =>
                a.action.startsWith("Branch transferred"),
              ) && <p className="muted">No recorded transfers.</p>}
            </section>
          </section>
        )}
        {tab === "Compliance" && <EmployeeChecks {...sectionProps} />}
        {tab === "Training" && <EmployeeChecks {...sectionProps} training />}
        {tab === "Documents" && <EmployeeDocuments {...sectionProps} />}
        {tab === "Activity" && (
          <div className="h-grid">
            <div className="h-sheet">
              <section className="h-sec">
                <div className="h-sh">
                  <h2>Employee activity</h2>
                  <span className="muted">Newest first</span>
                </div>
                {timeline()}
              </section>
              <section className="h-sec">
                <div className="h-sh">
                  <h2>HR notes</h2>
                  <button
                    className="cs-btn cs-btn--link"
                    disabled={!editable}
                    onClick={onNote}
                  >
                    Add note
                  </button>
                </div>
                {editable ? (
                  notes.map((n) => (
                    <article className="employee-note" key={n.id}>
                      <p>{n.text}</p>
                      <small>
                        {n.author} · {displayDate(n.at)}
                      </small>
                    </article>
                  ))
                ) : (
                  <p className="muted">HR notes require an editing role.</p>
                )}
                {editable && !notes.length && (
                  <p className="muted">No HR notes recorded.</p>
                )}
              </section>
            </div>
            <aside className="h-rail">
              <HRTasks
                data={data}
                employee={e.id}
                scope={scope}
                mutate={mutate}
              />
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
