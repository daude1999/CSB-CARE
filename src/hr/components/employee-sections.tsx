"use client";
import { Fragment, useState } from "react";
import { FileText, Lock, Search, ShieldCheck, Upload } from "lucide-react";
import { Avatar, Badge, ComplianceMeter, Empty } from "./ui";
import { checkStatus, canEdit, type Check, type Doc } from "@/hr/lib/domain";
import {
  displayDate,
  documentState,
  documentDue,
  statusCounts,
  type HubData,
} from "@/hr/lib/presentation";
import {
  documentTitle,
  documentGroup,
  documentGroups,
} from "@/hr/lib/document-groups";

type Props = {
  data: HubData;
  employee: string;
  onDocument: (d: Doc) => void;
  onReview: (c: Check) => void;
  onUpload: () => void;
};
export function EmployeeChecks({
  data,
  employee,
  onDocument,
  onReview,
  onUpload,
  training = false,
}: Props & { training?: boolean }) {
  const all = data.checks.filter((c) => c.employee === employee);
  const list = training
    ? all.filter((c) =>
        /training|qualification|safeguard|certificate|first aid|manual handling|driving/i.test(
          c.name + " " + c.category,
        ),
      )
    : all;
  const docs = data.documents.filter((d) => d.employee === employee);
  const counts = statusCounts(
    all.filter((c) => c.required),
    data.today,
  );
  const e = data.employees.find((e) => e.id === employee)!;
  return (
    <section className="h-sheet">
      <div className="h-sec h-table-head">
        <div className="h-sh">
          <h2>{training ? "Training" : "Compliance"}</h2>
          {!training && (
            <>
              <div className="h-small-meter">
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
              </div>
              <span className="muted">
                <b>
                  {counts["Up to date"]} of{" "}
                  {all.filter((c) => c.required).length}
                </b>{" "}
                requirements up to date · {counts.Overdue} overdue ·{" "}
                {counts["Missing evidence"]} missing evidence
              </span>
            </>
          )}
        </div>
      </div>
      <div className="table-scroll">
        <table className="h-dir h-requirements">
          <thead>
            <tr>
              <th>Requirement</th>
              <th>Status</th>
              <th>Last reviewed</th>
              <th>Next review</th>
              <th>Evidence</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const d = docs.find((d) => d.id === c.evidence);
              const editable =
                canEdit(data.user) &&
                (c.name !== "DBS review" || data.user.sensitive);
              return (
                <tr key={c.id}>
                  <td>
                    <b className="h-cell-title">{c.name}</b>
                    <small className="h-cell-meta">
                      {c.category || documentGroup("", c.name)}
                    </small>
                  </td>
                  <td>
                    <Badge>{checkStatus(c, data.today)}</Badge>
                  </td>
                  <td>{c.checkedAt ? displayDate(c.checkedAt) : "—"}</td>
                  <td
                    className={
                      checkStatus(c, data.today) === "Overdue" ? "h-late" : ""
                    }
                  >
                    {c.due ? displayDate(c.due) : "—"}
                  </td>
                  <td>
                    {d ? (
                      d.state === "Quarantined" ? (
                        <span className="muted">Quarantined</span>
                      ) : (
                        <button
                          className="h-q-file"
                          onClick={() => onDocument(d)}
                        >
                          <FileText size={14} />
                          {d.filename}
                        </button>
                      )
                    ) : (
                      <span className="muted">
                        {c.evidence ? "On file · restricted access" : "None"}
                      </span>
                    )}
                  </td>
                  <td>
                    {editable && c.required ? (
                      <button
                        className="cs-btn cs-btn--secondary cs-btn--sm"
                        onClick={() => (c.evidence ? onReview(c) : onUpload())}
                      >
                        {c.evidence ? "Record review" : "Upload evidence"}
                      </button>
                    ) : d && d.state !== "Quarantined" ? (
                      <button
                        className="cs-btn cs-btn--ghost cs-btn--sm"
                        onClick={() => onDocument(d)}
                      >
                        View
                      </button>
                    ) : (
                      <span className="muted">Read only</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.length && (
          <Empty
            title={
              training
                ? "No training requirements"
                : "No requirements configured"
            }
            detail="No matching requirements are recorded for this employee."
          />
        )}
      </div>
      <div className="h-note">
        <ShieldCheck size={14} />
        Requirements for {e.job}. Uploading a file or completing a task never
        verifies a requirement. DBS dates are organisational review dates.
      </div>
    </section>
  );
}
export function EmployeeDocuments({
  data,
  employee,
  onDocument,
  onUpload,
}: Props) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const checks = data.checks.filter((c) => c.employee === employee);
  const docs = data.documents.filter((d) => d.employee === employee);
  const visible = docs.filter(
    (d) =>
      (documentTitle(d, checks) + " " + d.filename)
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (!category ||
        documentGroup(d.category, documentTitle(d, checks)) === category) &&
      (!status || documentState(d, data) === status),
  );
  const missing = checks.filter(
    (c) =>
      c.required &&
      !c.evidence &&
      (!category || documentGroup(c.category || "", c.name) === category) &&
      (!status || status === "Missing evidence") &&
      c.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="h-sheet">
      <div className="h-sec h-table-head">
        <div className="h-sh">
          <h2>Documents</h2>
          <span className="muted">
            {docs.length} files ·{" "}
            {checks.filter((c) => c.required && !c.evidence).length}{" "}
            requirements missing evidence
          </span>
          <div className="h-doc-filters">
            <label className="cs-input">
              <Search size={14} />
              <input
                aria-label="Search employee documents"
                placeholder="Search documents…"
                value={search}
                onChange={(ev) => setSearch(ev.target.value)}
              />
            </label>
            <select
              aria-label="Employee document category"
              value={category}
              onChange={(ev) => setCategory(ev.target.value)}
            >
              <option value="">Category</option>
              {documentGroups.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
            <select
              aria-label="Employee document status"
              value={status}
              onChange={(ev) => setStatus(ev.target.value)}
            >
              <option value="">Status</option>
              {[
                "Up to date",
                "Due soon",
                "Overdue",
                "Awaiting verification",
                "Missing evidence",
                "Quarantined",
                "Previous version",
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <button
              className="cs-btn cs-btn--primary"
              disabled={!canEdit(data.user)}
              onClick={onUpload}
            >
              <Upload size={15} />
              Upload document
            </button>
          </div>
        </div>
      </div>
      <div className="table-scroll">
        <table className="h-dir h-documents">
          <thead>
            <tr>
              <th>Document</th>
              <th>Status</th>
              <th>Uploaded</th>
              <th>Review / expiry</th>
              <th>Verified by</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {documentGroups.map((g) => {
              const groupDocs = visible.filter(
                (d) =>
                  documentGroup(d.category, documentTitle(d, checks)) === g,
              );
              const groupMissing = missing.filter(
                (c) => documentGroup(c.category || "", c.name) === g,
              );
              return groupDocs.length || groupMissing.length ? (
                <Fragment key={g}>
                  <tr className="h-catrow">
                    <td colSpan={6}>{g}</td>
                  </tr>
                  {groupDocs.map((d) => {
                    const c = checks.find((c) => c.evidence === d.id);
                    return (
                      <tr key={d.id}>
                        <td>
                          <div className="h-emp">
                            <span className="h-fic">
                              {d.state === "Quarantined" ? (
                                <Lock size={15} />
                              ) : (
                                <FileText size={15} />
                              )}
                            </span>
                            <div>
                              <b>{documentTitle(d, checks)}</b>
                              <small>
                                {d.filename} · v{d.version}
                              </small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <Badge
                            variant={
                              d.state === "Quarantined" ? "neutral" : undefined
                            }
                          >
                            {documentState(d, data)}
                          </Badge>
                        </td>
                        <td>{displayDate(d.uploaded)}</td>
                        <td>
                          {documentDue(d, data)
                            ? displayDate(documentDue(d, data))
                            : "—"}
                        </td>
                        <td>
                          {c?.verified && c.reviewer ? (
                            <span className="h-mgr" title={c.reviewer}>
                              <Avatar name={c.reviewer} />
                              {c.reviewer}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {d.state === "Quarantined" ? (
                            <span className="muted">Preview after scan</span>
                          ) : (
                            <button
                              className="cs-btn cs-btn--secondary cs-btn--sm"
                              onClick={() => onDocument(d)}
                            >
                              {c && !c.verified ? "Review" : "Open"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {groupMissing.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className="h-emp">
                          <span className="h-fic">
                            <FileText size={15} />
                          </span>
                          <div>
                            <b>{c.name}</b>
                            <small>No file uploaded</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        <Badge>Missing evidence</Badge>
                      </td>
                      <td>—</td>
                      <td>{c.due ? displayDate(c.due) : "—"}</td>
                      <td>—</td>
                      <td>
                        <button
                          className="cs-btn cs-btn--primary cs-btn--sm"
                          disabled={!canEdit(data.user)}
                          onClick={onUpload}
                        >
                          <Upload size={14} />
                          Upload
                        </button>
                      </td>
                    </tr>
                  ))}
                </Fragment>
              ) : null;
            })}
          </tbody>
        </table>
        {!visible.length && !missing.length && (
          <Empty
            title="No matching documents"
            detail="Try another filter or upload evidence when authorised."
          />
        )}
      </div>
      <div className="h-note">
        <ShieldCheck size={14} />
        Uploads are quarantined until scanned and are never treated as verified
        evidence until a reviewer confirms them.
      </div>
    </section>
  );
}
