"use client";
import { useState } from "react";
import { Lock } from "lucide-react";
import { Avatar, Badge, Drawer, Field } from "./ui";
import { type User } from "@/hr/lib/domain";
import { PageHeading, type Data, type Mutate } from "./hub-shared";
export function SettingsPage({
  data,
  mutate,
  notify,
}: {
  data: Data;
  mutate: Mutate;
  notify: (s: string) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<User | null>(null);
  const admin = data.user.role === "Organisation Admin";
  return (
    <>
      <PageHeading
        title="Settings"
        subtitle="Explicit access. Clear policies. A controlled path to live data."
      />
      <div className="settings-grid">
        <section className="panel padded">
          <h2>Review & reminder policy</h2>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                await mutate({
                  action: "settings",
                  thresholds: String(f.get("thresholds"))
                    .split(",")
                    .map(Number),
                  dbsPolicy: f.get("dbsPolicy"),
                  retention: f.get("retention"),
                });
                notify("Organisation policies saved.");
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Reminder thresholds (days before review)">
              <input
                name="thresholds"
                defaultValue={data.settings.thresholds.join(", ")}
                disabled={!admin}
              />
            </Field>
            <Field label="Organisational DBS review policy">
              <textarea
                name="dbsPolicy"
                rows={4}
                defaultValue={data.settings.dbsPolicy}
                disabled={!admin}
              />
            </Field>
            <Field label="Retention policy">
              <textarea
                name="retention"
                rows={4}
                defaultValue={data.settings.retention}
                disabled={!admin}
              />
            </Field>
            <p className="muted">
              Pilot defaults are organisational settings, not legal
              requirements. Employee-facing email remains off.
            </p>
            <button className="primary" disabled={!admin || busy}>
              Save policies
            </button>
          </form>
        </section>
        <section className="panel padded">
          <h2>Before going live</h2>
          {[
            ["Sign-in", "Uses your CSB platform sign-in"],
            ["Virus checking", "Not set up yet, so uploaded files stay locked"],
            ["Emails", "Switched off. Nothing is sent outside the platform"],
            [
              "Automatic reminders",
              "Not scheduled yet. Use “Run reminder job” on Alerts",
            ],
            ["OneDrive import", "Not connected yet"],
          ].map(([name, state]) => (
            <div className="readiness-row" key={name}>
              <Lock size={16} />
              <div>
                <strong>{name}</strong>
                <small>{state}</small>
              </div>
            </div>
          ))}
          <div className="warning">
            This is a demo workspace. Do not enter real staff records until the
            go-live checks are complete.
          </div>
          <h3>Document categories</h3>
          <div className="category-chips">
            {data.settings.documentTypes
              .map((t) => t.name)
              .map((c) => (
                <span className="badge slate" key={c}>
                  {c}
                </span>
              ))}
          </div>
          <p className="muted">
            An administrator can manage categories and requirement applicability
            below.
          </p>
        </section>
      </div>
      <PolicyAdministration data={data} mutate={mutate} notify={notify} />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Authorised accounts</h2>
            <p>Application access is separate from employee records.</p>
          </div>
          <span className="muted">
            New accounts can’t be invited from here yet
          </span>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Role</th>
                <th>Assigned branches</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="person-cell">
                      <Avatar name={u.name} />
                      {u.name}
                    </span>
                  </td>
                  <td>{u.role}</td>
                  <td>
                    {u.branches
                      .map((b) => data.branches.find((x) => x.id === b)?.name)
                      .join(", ")}
                  </td>
                  <td>
                    <Badge>{u.active ? "Active" : "Deactivated"}</Badge>
                  </td>
                  <td>
                    <button
                      className="text-btn"
                      disabled={!admin || u.id === data.user.id}
                      onClick={() => setAccount(u)}
                    >
                      Manage access
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {error && <div className="error">{error}</div>}
      {account && (
        <Drawer
          title="Manage account access"
          description={account.name}
          onClose={() => setAccount(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              const f = new FormData(e.currentTarget);
              try {
                await mutate({
                  action: "account",
                  id: account.id,
                  role: f.get("role"),
                  branches: f.getAll("branch"),
                  sensitive: f.get("sensitive") === "on",
                  active: f.get("active") === "on",
                });
                notify("Account permissions updated.");
                setAccount(null);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Role">
              <select name="role" defaultValue={account.role}>
                {[
                  "Organisation Admin",
                  "Group HR",
                  "Branch HR",
                  "Branch Viewer",
                ].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
            <h3>Assigned branches</h3>
            {data.branches.map((b) => (
              <label className="checkbox" key={b.id}>
                <input
                  type="checkbox"
                  name="branch"
                  value={b.id}
                  defaultChecked={account.branches.includes(b.id)}
                />
                {b.name}
              </label>
            ))}
            <label className="checkbox">
              <input
                type="checkbox"
                name="sensitive"
                defaultChecked={account.sensitive}
              />
              Sensitive document capability
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                name="active"
                defaultChecked={account.active}
              />
              Account active
            </label>
            <label className="checkbox warning">
              <input type="checkbox" required />I confirm these access changes.
            </label>
            {error && <div className="error">{error}</div>}
            <button className="primary" disabled={busy}>
              Save access
            </button>
          </form>
        </Drawer>
      )}
    </>
  );
}
function PolicyAdministration({
  data,
  mutate,
  notify,
}: {
  data: Data;
  mutate: Mutate;
  notify: (s: string) => void;
}) {
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const admin = data.user.role === "Organisation Admin";
  const rule = data.settings.requirements.find((r) => r.id === selected);
  async function save(body: unknown, message: string) {
    setBusy(true);
    setError("");
    try {
      await mutate(body);
      notify(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="settings-grid">
        <section className="panel padded">
          <h2>Requirements by role & branch</h2>
          <Field label="Requirement">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Add a requirement</option>
              {data.settings.requirements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>
          <form
            key={selected}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              save(
                {
                  action: "requirement",
                  rule: {
                    id: selected,
                    name: f.get("name"),
                    category: f.get("category"),
                    job: f.get("job"),
                    branch: f.get("branch"),
                    recurring: f.get("recurring") === "on",
                    enabled: f.get("enabled") === "on",
                  },
                },
                "Requirement saved. Applicable employee checks recalculated.",
              );
            }}
          >
            <Field label="Requirement name">
              <input
                name="name"
                required
                defaultValue={rule?.name}
                disabled={!admin}
              />
            </Field>
            <Field label="Evidence category">
              <select
                name="category"
                defaultValue={rule?.category || "Training"}
                disabled={!admin}
              >
                {data.settings.documentTypes.map((t) => (
                  <option key={t.name}>{t.name}</option>
                ))}
              </select>
            </Field>
            <div className="form-grid">
              <Field label="Job role">
                <select
                  name="job"
                  defaultValue={rule?.job || ""}
                  disabled={!admin}
                >
                  <option value="">All job roles</option>
                  {[...new Set(data.employees.map((e) => e.job))].map((j) => (
                    <option key={j}>{j}</option>
                  ))}
                </select>
              </Field>
              <Field label="Applicable branch">
                <select
                  name="branch"
                  defaultValue={rule?.branch || ""}
                  disabled={!admin}
                >
                  <option value="">All branches</option>
                  {data.branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <label className="checkbox">
              <input
                name="recurring"
                type="checkbox"
                defaultChecked={rule?.recurring ?? true}
                disabled={!admin}
              />
              Recurring review date required
            </label>
            <label className="checkbox">
              <input
                name="enabled"
                type="checkbox"
                defaultChecked={rule?.enabled ?? true}
                disabled={!admin}
              />
              Requirement enabled
            </label>
            <label className="checkbox warning">
              <input type="checkbox" required disabled={!admin} />I approve
              applying this policy to matching employee records.
            </label>
            <button className="primary" disabled={!admin || busy}>
              Save requirement
            </button>
          </form>
        </section>
        <section className="panel padded">
          <h2>Document category access</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              save(
                {
                  action: "category",
                  name: f.get("name"),
                  sensitive: f.get("sensitive") === "on",
                },
                "Document category saved.",
              );
            }}
          >
            <Field label="Category name">
              <input
                name="name"
                list="category-names"
                required
                disabled={!admin}
              />
            </Field>
            <datalist id="category-names">
              {data.settings.documentTypes.map((t) => (
                <option key={t.name}>{t.name}</option>
              ))}
            </datalist>
            <label className="checkbox">
              <input
                type="checkbox"
                name="sensitive"
                defaultChecked
                disabled={!admin}
              />
              Requires sensitive-document capability
            </label>
            <p className="muted">
              Use an existing category name to update access. DBS, identity and
              right-to-work categories always remain sensitive.
            </p>
            <button className="secondary-button full" disabled={!admin || busy}>
              Save category
            </button>
          </form>
          <hr />
          <h2>Add a branch</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              save(
                { action: "branch", name: f.get("name") },
                "Branch added. Group HR and administrators have been assigned.",
              );
            }}
          >
            <Field label="New branch name">
              <input name="name" required disabled={!admin} />
            </Field>
            <p className="muted">
              Group HR and organisation administrators receive access. Assign
              branch users separately.
            </p>
            <button className="secondary-button full" disabled={!admin || busy}>
              Create branch
            </button>
          </form>
        </section>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
