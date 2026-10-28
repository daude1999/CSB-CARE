"use client";
import { useState } from "react";
import Link from "@/hr/nav";
import { useRouter, useSearchParams } from "@/hr/nav";
import {
  Search,
  FolderOpen,
  ArrowUpRight,
  ChevronLeft,
  Upload,
  FileText,
} from "lucide-react";
import { Badge, Avatar, Empty } from "./ui";
import {
  type HubData,
  documentState,
  documentDue,
  displayDate,
  currentChecks,
} from "@/hr/lib/presentation";
import {
  documentGroups,
  documentGroup,
  documentTitle,
} from "@/hr/lib/document-groups";
import { checkStatus, canEdit, type Doc, type Check } from "@/hr/lib/domain";
import { employeeRoute } from "@/hr/lib/routes";
export function DocumentCentre({
  data,
  scope,
  employee,
  onOpen,
  onReview,
  onUpload,
}: {
  data: HubData;
  scope: string;
  employee?: string;
  onOpen: (d: Doc) => void;
  onReview: (c: Check) => void;
  onUpload: () => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [localGroup, setLocalGroup] = useState("");
  const [localView, setLocalView] = useState("All");
  const group = employee ? localGroup : params.get("category") || "";
  const destination = employee ? "all" : params.get("view") || "";
  const view = employee ? localView : params.get("status") || "All";
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("");
  const [type, setType] = useState("");
  function navigate(category: string, status = "All", all = false) {
    if (employee) {
      setLocalGroup(category);
      setLocalView(status);
      return;
    }
    const p = new URLSearchParams({ branch: scope });
    if (category) p.set("category", category);
    if (status !== "All") p.set("status", status);
    if (all) p.set("view", "all");
    router.push("/documents?" + p.toString());
  }
  const docs = data.documents.filter(
    (d) =>
      (!employee || d.employee === employee) &&
      (!branch ||
        data.employees.find((e) => e.id === d.employee)?.branch === branch) &&
      (!type || d.category === type) &&
      (
        documentTitle(d, data.checks) +
        " " +
        d.filename +
        " " +
        data.employees.find((e) => e.id === d.employee)?.name
      )
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const requirements = currentChecks(data).filter(
    (c) =>
      (!employee || c.employee === employee) &&
      c.required &&
      (!branch ||
        data.employees.find((e) => e.id === c.employee)?.branch === branch) &&
      (!type || c.category === type) &&
      (c.name + " " + data.employees.find((e) => e.id === c.employee)?.name)
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const needs = (s: string) =>
    !["Up to date", "Not applicable", "Previous version"].includes(s);
  const focused =
    !!group ||
    destination === "all" ||
    !!search ||
    !!branch ||
    !!type ||
    view !== "All";
  const relevant = docs.filter(
    (d) =>
      !group ||
      documentGroup(d.category, documentTitle(d, data.checks)) === group,
  );
  const shown = relevant.filter(
    (d) =>
      view === "All" ||
      (view === "Needs attention"
        ? needs(documentState(d, data))
        : documentState(d, data) === view),
  );
  const missing = requirements.filter(
    (c) =>
      (!group || documentGroup(c.category || "", c.name) === group) &&
      checkStatus(c, data.today) === "Missing evidence",
  );
  const [page, setPage] = useState(0);
  const key = [group, view, search, branch, type, employee].join("|");
  const [previous, setPrevious] = useState(key);
  if (key !== previous) {
    setPrevious(key);
    setPage(0);
  }
  const items = focused
    ? shown
    : [...docs]
        .sort((a, b) => b.uploaded.localeCompare(a.uploaded))
        .slice(0, 6);
  function table() {
    return (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Document</th>
              {!employee && <th>Employee</th>}
              <th>Branch</th>
              <th>Uploaded</th>
              <th>Review / expiry</th>
              <th>Verification state</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {items.slice(page * 20, page * 20 + 20).map((d) => {
              const e = data.employees.find((e) => e.id === d.employee)!;
              return (
                <tr key={d.id}>
                  <td>
                    <button
                      className="document-label"
                      onClick={() => onOpen(d)}
                    >
                      <FileText size={19} />
                      <span>
                        <strong>{documentTitle(d, data.checks)}</strong>
                        <small>
                          {d.filename} · v{d.version}
                        </small>
                      </span>
                    </button>
                  </td>
                  {!employee && (
                    <td>
                      <Link
                        className="person-cell"
                        href={employeeRoute(e.id, scope)}
                      >
                        <Avatar name={e.name} />
                        <span>
                          {e.name}
                          <small>{e.staffId}</small>
                        </span>
                      </Link>
                    </td>
                  )}
                  <td>{data.branches.find((b) => b.id === e.branch)?.name}</td>
                  <td>{displayDate(d.uploaded)}</td>
                  <td>{displayDate(documentDue(d, data))}</td>
                  <td>
                    <Badge>{documentState(d, data)}</Badge>
                  </td>
                  <td>
                    <button className="text-btn" onClick={() => onOpen(d)}>
                      Open <ArrowUpRight size={14} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!items.length && (
          <Empty
            title="No documents in this view"
            detail="Adjust the filters or upload evidence to an employee record."
          />
        )}
      </div>
    );
  }
  return (
    <div className="document-control">
      {!employee && (
        <div className="page-heading">
          <div>
            {focused && (
              <button
                className="text-btn"
                onClick={() => {
                  setSearch("");
                  setBranch("");
                  setType("");
                  navigate("");
                }}
              >
                <ChevronLeft size={15} />
                Document centre
              </button>
            )}
            <h1>
              {group || (destination === "all" ? "All documents" : "Documents")}
            </h1>
            <p>
              {focused
                ? `${relevant.length} accessible documents in this work area`
                : "Manage employee evidence, HR records and compliance files."}
            </p>
          </div>
          {canEdit(data.user) && (
            <button className="primary" onClick={onUpload}>
              <Upload size={17} />
              Upload document
            </button>
          )}
        </div>
      )}
      <div className="panel document-filters">
        <div className="table-toolbar">
          <div className="local-search">
            <Search size={17} />
            <input
              aria-label="Search documents"
              placeholder="Search document type, filename or employee"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            aria-label="Document branch"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
          >
            <option value="">All permitted branches</option>
            {data.branches.map((b) => (
              <option value={b.id} key={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Document category"
            value={type}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="">All document types</option>
            {data.settings.documentTypes.map((t) => (
              <option key={t.name}>{t.name}</option>
            ))}
          </select>
          <select
            aria-label="Document status"
            value={view}
            onChange={(e) => navigate(group, e.target.value, true)}
          >
            {[
              "All",
              "Needs attention",
              "Due soon",
              "Awaiting verification",
              "Missing evidence",
              "Overdue",
              "Up to date",
              "Quarantined",
            ].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          {!employee && (
            <button
              className="text-btn"
              onClick={() => navigate("", "All", true)}
            >
              View all documents <ArrowUpRight size={15} />
            </button>
          )}
        </div>
      </div>
      {!focused && (
        <>
          <section
            className="document-category-grid"
            aria-label="Document categories"
          >
            {documentGroups.map((g) => {
              const files = docs.filter(
                (d) =>
                  documentGroup(d.category, documentTitle(d, data.checks)) ===
                  g,
              );
              const attention = requirements.filter(
                (c) =>
                  documentGroup(c.category || "", c.name) === g &&
                  needs(checkStatus(c, data.today)),
              ).length;
              return (
                <button
                  key={g}
                  className="document-category-card"
                  onClick={() => navigate(g)}
                >
                  <FolderOpen size={22} />
                  <strong>{g}</strong>
                  <span>
                    {files.length} files{" "}
                    <span className={attention ? "attention-text" : ""}>
                      {attention
                        ? `${attention} requirements need attention`
                        : "No requirement actions"}
                    </span>
                  </span>
                  <ArrowUpRight size={15} />
                </button>
              );
            })}
          </section>
          <section className="panel work-queue">
            <div className="panel-heading">
              <h2>Needs attention</h2>
              <span className="muted">
                Requirements, including missing files
              </span>
            </div>
            {documentGroups.map((g) => {
              const checks = requirements.filter(
                (c) =>
                  documentGroup(c.category || "", c.name) === g &&
                  needs(checkStatus(c, data.today)),
              );
              return checks.length ? (
                <button
                  className="queue-summary"
                  key={g}
                  onClick={() => navigate(g, "Needs attention")}
                >
                  <span>
                    <strong>{g}</strong>
                    <small>
                      {
                        checks.filter(
                          (c) =>
                            checkStatus(c, data.today) === "Missing evidence",
                        ).length
                      }{" "}
                      missing evidence ·{" "}
                      {
                        checks.filter(
                          (c) =>
                            checkStatus(c, data.today) ===
                            "Awaiting verification",
                        ).length
                      }{" "}
                      awaiting verification ·{" "}
                      {
                        checks.filter(
                          (c) => checkStatus(c, data.today) === "Due soon",
                        ).length
                      }{" "}
                      due soon
                    </small>
                  </span>
                  <b>{checks.length}</b>
                  <span className="text-btn">
                    Review <ArrowUpRight size={14} />
                  </span>
                </button>
              ) : null;
            })}
            {!requirements.some((c) => needs(checkStatus(c, data.today))) && (
              <Empty
                title="No outstanding requirements"
                detail="All current requirements in this scope are up to date."
              />
            )}
          </section>
        </>
      )}
      {focused && (
        <div className="tabs">
          {[
            "All",
            "Needs attention",
            "Due soon",
            "Awaiting verification",
            "Missing evidence",
          ].map((v) => (
            <button
              key={v}
              className={view === v ? "active" : ""}
              onClick={() => navigate(group, v, true)}
            >
              {v === "Missing evidence" ? "Missing" : v}
            </button>
          ))}
        </div>
      )}
      {(view === "Missing evidence" || view === "Needs attention") &&
        missing.length > 0 && (
          <section className="panel">
            <div className="panel-heading">
              <h2>Missing evidence</h2>
              <small>These requirements have no file to display.</small>
            </div>
            {missing.map((c) => (
              <div className="requirement-row" key={c.id}>
                <div>
                  <strong>
                    {data.employees.find((e) => e.id === c.employee)?.name}
                  </strong>
                  <small>{c.name}</small>
                </div>
                <Badge>Missing evidence</Badge>
                <button className="text-btn" onClick={() => onReview(c)}>
                  Open requirement
                </button>
              </div>
            ))}
          </section>
        )}
      {view !== "Missing evidence" && (
        <section className="panel document-register">
          <div className="panel-heading">
            <h2>{focused ? "Documents in this view" : "Recently uploaded"}</h2>
            {!focused && (
              <button
                className="text-btn"
                onClick={() => navigate("", "All", true)}
              >
                View all →
              </button>
            )}
          </div>
          {table()}
          {focused && items.length > 20 && (
            <div className="pagination">
              <span>
                {items.length} documents · Page {page + 1} of{" "}
                {Math.ceil(items.length / 20)}
              </span>
              <button
                className="secondary-button"
                disabled={!page}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <button
                className="secondary-button"
                disabled={(page + 1) * 20 >= items.length}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </section>
      )}
      {employee && (
        <div className="employee-document-groups">
          {documentGroups.map((g) => (
            <button
              key={g}
              className={group === g ? "active" : ""}
              onClick={() => navigate(g)}
            >
              {g}
            </button>
          ))}
          <button onClick={() => navigate("")}>All categories</button>
        </div>
      )}
    </div>
  );
}
