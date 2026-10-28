"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  FileText,
  Upload,
  Plus,
  Mail,
  Phone,
  Pencil,
} from "lucide-react";
import { Avatar, Badge, Drawer, Empty } from "./ui";
import {
  Ring,
  TaskList,
  RecentActivity,
  SectionHeading,
} from "./workspace-widgets";
import {
  checksFor,
  displayDate,
  health,
  statusCounts,
  type HubData,
} from "@/hr/lib/presentation";
import {
  checkStatus,
  employeeAddress,
  canEdit,
  type Employee,
  type Doc,
  type Check,
} from "@/hr/lib/domain";
export function EmployeePanel({
  data,
  employee: e,
  close,
  openRecord,
  onDocument,
  onReview,
  onNote,
  onEdit,
  onUpload,
}: {
  data: HubData;
  employee: Employee;
  close: () => void;
  openRecord: () => void;
  onDocument: (d: Doc) => void;
  onReview: (c: Check) => void;
  onNote: () => void;
  onEdit: () => void;
  onUpload: () => void;
}) {
  const [tab, setTab] = useState("Overview");
  const checks = checksFor(data, e.id);
  const required = checks.filter((c) => c.required);
  const counts = statusCounts(checks, data.today);
  const ready = required.filter(
    (c) => checkStatus(c, data.today) === "Up to date",
  ).length;
  const documents = data.documents.filter((d) => d.employee === e.id);
  const notes = data.notes.filter((n) => n.employee === e.id);
  const editable = canEdit(data.user);
  const details = [
    ["Home address", employeeAddress(e)],
    ["Staff ID", e.staffId],
    ["Branch", data.branches.find((b) => b.id === e.branch)?.name],
    ["Job role", e.job],
    ["Employment type", e.employmentType || "Not recorded"],
    ["Start date", displayDate(e.start)],
    ["Date of birth", displayDate(e.dateOfBirth || null)],
    ["Line manager", e.lineManager || "Not recorded"],
    ["Last updated", displayDate(e.updated)],
  ];
  return (
    <Drawer
      title="Employee details"
      onClose={close}
      className="employee-drawer"
    >
      <div className="employee-panel-heading">
        <Avatar name={e.name} large />
        <div>
          <h1>{e.name}</h1>
          <p>
            {e.job} · {e.staffId}
          </p>
          <div className="button-group">
            <Badge>{e.status}</Badge>
            <Badge>{health(checks, data.today)}</Badge>
          </div>
        </div>
        <button
          className="icon-btn"
          disabled={!editable}
          aria-label="Edit employee"
          onClick={onEdit}
        >
          <Pencil size={17} />
        </button>
      </div>
      <div className="employee-contact">
        <span>
          <Mail size={14} />
          {e.email || "Email not recorded"}
        </span>
        <span>
          <Phone size={14} />
          {e.phone || "Phone not recorded"}
        </span>
      </div>
      <div className="tabs panel-tabs">
        {["Overview", "Documents", "Compliance", "Employment", "Notes"].map(
          (t) => (
            <button
              key={t}
              aria-label={t}
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
            >
              {t}
              {t === "Documents" && (
                <span className="count">{documents.length}</span>
              )}
            </button>
          ),
        )}
      </div>
      <div className="employee-tab-body">
        {tab === "Overview" && (
          <>
            <section className="employee-compliance">
              <Ring
                value={
                  required.length
                    ? Math.round((ready / required.length) * 100)
                    : 0
                }
                label="up to date"
                size={112}
              />
              <div>
                <h2>Compliance summary</h2>
                <p>
                  {ready} of {required.length} required checks up to date
                </p>
                <div className="compliance-mini">
                  <span>
                    <strong>{counts.Overdue}</strong>Overdue
                  </span>
                  <span>
                    <strong>{counts["Due soon"]}</strong>Due soon
                  </span>
                  <span>
                    <strong>{counts["Missing evidence"]}</strong>Missing
                  </span>
                </div>
              </div>
            </section>
            <SectionHeading title="Key information" />
            <dl className="employee-key-grid">
              {details.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <SectionHeading title="Upcoming tasks" />
            <TaskList
              data={data}
              employee={e.id}
              limit={3}
              onReview={(c) => (editable ? onReview(c) : openRecord())}
            />
            <SectionHeading title="Recent activity" />
            <RecentActivity data={data} employee={e.id} limit={3} />
          </>
        )}
        {tab === "Documents" && (
          <>
            <SectionHeading
              title="Employee documents"
              action={
                <button
                  className="secondary-button"
                  disabled={!editable}
                  onClick={onUpload}
                >
                  <Upload size={15} />
                  Upload
                </button>
              }
            />
            {documents.map((d) => (
              <button
                className="employee-document"
                key={d.id}
                onClick={() => onDocument(d)}
              >
                <span className="event-mark">
                  <FileText size={19} />
                </span>
                <div>
                  <strong>{d.filename}</strong>
                  <small>
                    {d.category} · Version {d.version} ·{" "}
                    {displayDate(d.uploaded)}
                  </small>
                </div>
                <Badge>{d.state}</Badge>
                <ArrowUpRight size={16} />
              </button>
            ))}
            {!documents.length && (
              <Empty
                title="No documents yet"
                detail="Upload evidence to start the employee file."
              />
            )}
          </>
        )}
        {tab === "Compliance" && (
          <>
            <SectionHeading
              title="Review requirements"
              caption="DBS dates are organisational review dates, not official expiry dates."
            />
            {checks.map((c) => (
              <button
                className="employee-check"
                key={c.id}
                onClick={() => (editable ? onReview(c) : openRecord())}
              >
                <div>
                  <strong>{c.name}</strong>
                  <small>
                    {c.required
                      ? `Review date: ${displayDate(c.due)}`
                      : "Not required for this role"}
                  </small>
                </div>
                <Badge>{checkStatus(c, data.today)}</Badge>
                <ArrowUpRight size={15} />
              </button>
            ))}
          </>
        )}
        {tab === "Employment" && (
          <>
            <SectionHeading
              title="Employment details"
              action={
                <button
                  className="text-btn"
                  disabled={!editable}
                  onClick={onEdit}
                >
                  Edit record
                </button>
              }
            />
            <dl className="employee-key-grid">
              {details.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <Badge>{e.status}</Badge>
          </>
        )}
        {tab === "Notes" && (
          <>
            <SectionHeading
              title="HR notes"
              action={
                <button
                  className="secondary-button"
                  disabled={!editable}
                  onClick={onNote}
                >
                  <Plus size={15} />
                  Add note
                </button>
              }
            />
            {notes.map((n) => (
              <article className="employee-note" key={n.id}>
                <p>{n.text}</p>
                <small>
                  {n.author} · {displayDate(n.at)}
                </small>
              </article>
            ))}
            {!notes.length && (
              <Empty
                title="No HR notes"
                detail="Record useful context for authorised HR colleagues."
              />
            )}
          </>
        )}
      </div>
      <div className="employee-panel-footer">
        <button className="secondary-button" onClick={close}>
          Close
        </button>
        <button className="primary" onClick={openRecord}>
          Open full employee record <ArrowUpRight size={16} />
        </button>
      </div>
    </Drawer>
  );
}
