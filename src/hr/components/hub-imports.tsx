"use client";
import { useState } from "react";
import { ChevronRight, FolderOpen, Lock } from "lucide-react";
import Papa from "papaparse";
import { Badge, Field } from "./ui";
import { type ImportRow } from "@/hr/lib/domain";
import { PageHeading, type Data, type Mutate } from "./hub-shared";
export function Imports({
  data,
  mutate,
  notify,
}: {
  data: Data;
  mutate: Mutate;
  notify: (s: string) => void;
}) {
  const [tab, setTab] = useState("CSV employees");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fields, setFields] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [batchId, setBatchId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const batch =
    data.imports.find((i) => i.id === batchId) || data.imports.at(-1);
  const columns = [
    "staffId",
    "name",
    "branch",
    "job",
    "status",
    "start",
    "email",
  ];
  const admin = data.user.role === "Organisation Admin";
  return (
    <>
      <PageHeading
        title="Imports"
        subtitle="Prepare, validate and approve. Your source data stays untouched."
      />
      <section className="panel">
        <div className="tabs">
          {["CSV employees", "OneDrive preparation"].map((t) => (
            <button
              className={tab === t ? "active" : ""}
              key={t}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        {tab === "CSV employees" ? (
          <div className="padded">
            <div className="import-steps">
              <span className="active">1 Upload</span>
              <ChevronRight size={14} />
              <span className={rows.length ? "active" : ""}>2 Map columns</span>
              <ChevronRight size={14} />
              <span className={batch ? "active" : ""}>
                3 Validate & preview
              </span>
              <ChevronRight size={14} />
              <span className={batch?.state === "Imported" ? "active" : ""}>
                4 Approve & import
              </span>
            </div>
            <div className="info-banner">
              Employee imports never create login accounts or send invitations.
              Organisation Admin approval is required.
            </div>
            <Field label="Fictional employee CSV">
              <input
                type="file"
                accept=".csv"
                disabled={!admin || busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 500000) {
                    setError("CSV must be under 500 KB");
                    return;
                  }
                  const result = Papa.parse<Record<string, string>>(
                    await file.text(),
                    { header: true, skipEmptyLines: true },
                  );
                  if (result.errors.length) {
                    setError(result.errors[0].message);
                    return;
                  }
                  setRows(result.data);
                  setFields(result.meta.fields || []);
                  setMapping(
                    Object.fromEntries(
                      columns.map((c) => [
                        c,
                        result.meta.fields?.includes(c) ? c : "",
                      ]),
                    ),
                  );
                  setError("");
                }}
              />
            </Field>
            <p className="muted">
              Use branch IDs: {data.branches.map((b) => b.id).join(", ")}.
              Dates: YYYY-MM-DD. Maximum 500 rows.{" "}
              <a href="/sample-employees.csv" download>
                Download sample CSV
              </a>
            </p>
            {rows.length > 0 && (
              <>
                <h3>Map your columns</h3>
                <div className="mapping-grid">
                  {columns.map((c) => (
                    <Field label={c} key={c}>
                      <select
                        value={mapping[c] || ""}
                        onChange={(e) =>
                          setMapping({ ...mapping, [c]: e.target.value })
                        }
                      >
                        <option value="">
                          {c === "email" ? "Not included" : "Choose column"}
                        </option>
                        {fields.map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                    </Field>
                  ))}
                </div>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const mapped = rows.map(
                        (row) =>
                          Object.fromEntries(
                            columns.map((c) => [c, row[mapping[c]] || ""]),
                          ) as ImportRow,
                      );
                      const result = await mutate({
                        action: "stage-import",
                        rows: mapped,
                      });
                      setBatchId(String(result.id));
                      notify("CSV staged. No live employee records changed.");
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Validate & preview {rows.length} rows
                </button>
              </>
            )}
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            {batch && (
              <div className="import-preview">
                <div className="panel-heading">
                  <div>
                    <h2>
                      {batch.state === "Imported"
                        ? "Import complete"
                        : "Staged import preview"}
                    </h2>
                    <p>
                      {batch.rows.length} rows ·{" "}
                      {batch.rows.filter((r) => r.error).length} errors ·{" "}
                      {batch.state}
                    </p>
                  </div>
                  <Badge>{batch.state}</Badge>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Staff ID</th>
                        <th>Name</th>
                        <th>Branch</th>
                        <th>Validation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batch.rows.map((r, i) => (
                        <tr key={i}>
                          <td>{r.staffId}</td>
                          <td>{r.name}</td>
                          <td>{r.branch}</td>
                          <td>
                            {r.error ? (
                              <span className="overdue-date">{r.error}</span>
                            ) : (
                              <Badge>Ready</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {batch.state === "Staged" && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBusy(true);
                      try {
                        const result = await mutate({
                          action: "approve-import",
                          id: batch.id,
                        });
                        notify(
                          `${result.count} employee records imported. No invitations sent.`,
                        );
                      } catch (err) {
                        setError((err as Error).message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <label className="checkbox">
                      <input type="checkbox" required />I approve these
                      fictional employee records and their branch assignments.
                    </label>
                    <button
                      className="primary"
                      disabled={
                        busy || batch.rows.some((r) => r.error) || !admin
                      }
                    >
                      Approve import
                    </button>
                    {batch.rows.some((r) => r.error) && (
                      <p className="muted">
                        Correct the CSV and upload again to resolve errors. This
                        staged batch does not affect employee records.
                      </p>
                    )}
                  </form>
                )}
                {batch.state === "Imported" && (
                  <p className="success-text">
                    {batch.count} records imported. Repeating approval is safe
                    and will not create duplicates.
                  </p>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="padded">
            <div className="connection-card">
              <div className="file-icon">
                <FolderOpen size={28} />
              </div>
              <div>
                <h2>OneDrive import preparation</h2>
                <p>Not connected · No source files have been accessed</p>
              </div>
              <Badge>Awaiting configuration</Badge>
            </div>
            <p>
              Future imports will use approved Microsoft Graph read access to a
              selected source. Folder names suggest matches; HR must confirm
              identity, branch and category. No source file will be changed.
            </p>
            <h3>Fictional sample preview</h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Example source folder</th>
                    <th>Proposed match</th>
                    <th>Category</th>
                    <th>Review decision</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Liverpool / CSB-1001 / Training</td>
                    <td>Amelia Hart · Liverpool</td>
                    <td>Training</td>
                    <td>
                      <Badge>Needs approval</Badge>
                    </td>
                  </tr>
                  <tr>
                    <td>Unsorted / Amelia Hart</td>
                    <td>Two people share this name</td>
                    <td>Unknown</td>
                    <td>
                      <Badge>Manual review</Badge>
                    </td>
                  </tr>
                  <tr>
                    <td>Portsmouth / DBS scans</td>
                    <td>Not matched</td>
                    <td>DBS</td>
                    <td>
                      <Badge>Held for policy approval</Badge>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="info-banner">
              <Lock size={19} />
              <span>
                Connection and migration are deferred. Required: tenant grant
                review, retention approval, matching sign-off, malware scanning
                and explicit import approval.
              </span>
            </div>
            <h3>Planned source provenance</h3>
            <p className="muted">
              Drive and item IDs · original path · version/checksum when
              available · per-item outcomes · resumable idempotent import.
              Notifications and invitations remain off.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
