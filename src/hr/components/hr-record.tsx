"use client";
import { Fragment, useState, type ReactNode } from "react";
import { AssignedTraining } from "./training-actions";
import {
  MessageCircle,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";
import { Avatar, Badge } from "./ui";
import { HRTasks } from "./hr-tasks";
import { EmployeeChecks, EmployeeDocuments } from "./employee-sections";
import { HarbourRecordHeader, HarbourRecordOverview } from "./hr-record-harbour";
import {
  checkStatus,
  canEdit,
  dateDays,
  type Employee,
  type Doc,
  type Check,
} from "@/hr/lib/domain";
import {
  displayDate,
  checksFor,
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
  notify,
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
  notify?: (message: string) => void;
}) {
  const [tab, setTab] = useState("Overview");
  const checks = checksFor(data, e.id);
  const required = checks.filter((c) => c.required);
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
      <HarbourRecordHeader
        data={data}
        employee={e}
        tab={tab}
        setTab={setTab}
        editable={editable}
        docs={docs}
        overdue={overdue}
        required={required}
        backHref={returnTo?.startsWith("/people?") ? returnTo : `/people?branch=${scope}`}
        onEdit={onEdit}
        onUpload={onUpload}
        onNote={onNote}
      />
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
            <HarbourRecordOverview
              data={data}
              employee={e}
              checks={checks}
              docs={docs}
              events={events}
              editable={editable}
              setTab={setTab}
              onEdit={onEdit}
              onUpload={onUpload}
              onDocument={onDocument}
              onReview={onReview}
            />
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
        {tab === "Training" && (
          <>
            <AssignedTraining data={data} employee={e.id} mutate={mutate} notify={notify ?? (() => {})} />
            <EmployeeChecks {...sectionProps} training />
          </>
        )}
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
