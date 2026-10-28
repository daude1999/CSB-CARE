"use client";
import { useState } from "react";
import Link from "@/hr/nav";
import { Plus, ClipboardList } from "lucide-react";
import { Drawer, Field, Badge, Empty } from "./ui";
import { canEdit, type HRTask } from "@/hr/lib/domain";
import { displayDate, type HubData } from "@/hr/lib/presentation";
import { employeeRoute } from "@/hr/lib/routes";
export function HRTasks({
  data,
  employee,
  scope,
  mutate,
  initialFilter = "Open",
}: {
  data: HubData;
  employee?: string;
  scope: string;
  mutate: (body: unknown) => Promise<Record<string, unknown>>;
  initialFilter?: string;
}) {
  const [editing, setEditing] = useState<HRTask | null | undefined>();
  const [filter, setFilter] = useState(initialFilter);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [person, setPerson] = useState(employee || "");
  const tasks = (data.tasks || [])
    .filter(
      (t) =>
        (!employee || t.employee === employee) &&
        (filter === "All" ||
          (filter === "Open"
            ? t.status !== "Complete"
            : t.assignedTo === data.user.id)),
    )
    .sort((a, b) => a.due.localeCompare(b.due));
  const target = data.employees.find((e) => e.id === person);
  const people = data.employees.filter(
    (e) => (!employee || e.id === employee) && e.status !== "Archived",
  );
  return (
    <section className="panel hr-tasks">
      <div className="panel-heading">
        <div>
          <h2>
            <ClipboardList size={18} /> HR tasks
          </h2>
          <p className="muted">
            Assigned actions. Completing a task does not verify evidence.
          </p>
        </div>
        {canEdit(data.user) && (
          <button
            className="secondary-button"
            onClick={() => {
              setPerson(employee || "");
              setEditing(null);
              setError("");
            }}
          >
            <Plus size={16} />
            Create task
          </button>
        )}
      </div>
      <div className="tabs">
        {["Open", "Assigned to me", "All"].map((s) => (
          <button
            key={s}
            className={filter === s ? "active" : ""}
            onClick={() => setFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>
      {tasks.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Task / employee</th>
                <th>Assigned to</th>
                <th>Due</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.type}</strong>
                    <Link
                      className="task-employee-link"
                      href={employeeRoute(t.employee, scope)}
                    >
                      {data.employees.find((e) => e.id === t.employee)?.name} →
                    </Link>
                  </td>
                  <td>
                    {data.users.find((u) => u.id === t.assignedTo)?.name ||
                      "Unassigned"}
                  </td>
                  <td>
                    {displayDate(t.due)}
                    {t.due < data.today && t.status !== "Complete" && (
                      <Badge>Overdue</Badge>
                    )}
                  </td>
                  <td>{t.priority}</td>
                  <td>
                    <Badge>{t.status}</Badge>
                  </td>
                  <td>
                    {canEdit(data.user) && (
                      <button
                        className="text-btn"
                        onClick={() => {
                          setPerson(t.employee);
                          setEditing(t);
                          setError("");
                        }}
                      >
                        Update
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty
          title="No tasks in this view"
          detail="Create an assigned action linked to an employee, requirement or document."
        />
      )}
      {editing !== undefined && (
        <Drawer
          title={editing ? "Update HR task" : "Create HR task"}
          onClose={() => setEditing(undefined)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              const f = new FormData(e.currentTarget);
              try {
                await mutate({
                  action: "task",
                  id: editing?.id,
                  version: editing?.version,
                  task: {
                    employee: person,
                    type: f.get("type"),
                    assignedTo: f.get("assignedTo"),
                    due: f.get("due"),
                    priority: f.get("priority"),
                    status: f.get("status"),
                    requirement: f.get("requirement") || null,
                    document: f.get("document") || null,
                  },
                });
                setEditing(undefined);
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Task employee">
              <select
                value={person}
                required
                disabled={!!editing || !!employee}
                onChange={(e) => setPerson(e.target.value)}
              >
                <option value="">Select employee</option>
                {people.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} · {e.staffId}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Task type">
              <input
                name="type"
                aria-label="Task type"
                required
                minLength={2}
                maxLength={120}
                defaultValue={editing?.type}
                list="hr-task-types"
              />
              <datalist id="hr-task-types">
                {[
                  "Review DBS",
                  "Verify Right to Work",
                  "Upload contract",
                  "Complete missing reference",
                  "Review training certificate",
                  "Confirm personal details",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </datalist>
            </Field>
            <Field label="Assigned HR person">
              <select
                key={person}
                name="assignedTo"
                defaultValue={editing?.assignedTo || ""}
              >
                <option value="">Unassigned</option>
                {data.users
                  .filter(
                    (u) =>
                      u.active &&
                      canEdit(u) &&
                      target &&
                      u.branches.includes(target.branch),
                  )
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Task due date">
              <input
                type="date"
                name="due"
                required
                defaultValue={editing?.due || data.today}
              />
            </Field>
            <Field label="Priority">
              <select
                name="priority"
                defaultValue={editing?.priority || "Normal"}
              >
                {["Low", "Normal", "High"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Task status">
              <select
                name="status"
                defaultValue={editing?.status || "Not started"}
              >
                {[
                  "Not started",
                  "Waiting on employee",
                  "Waiting on HR",
                  "Complete",
                ].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Linked requirement">
              <select
                key={"r" + person}
                name="requirement"
                defaultValue={editing?.requirement || ""}
              >
                <option value="">No linked requirement</option>
                {data.checks
                  .filter((c) => c.employee === person)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Linked document">
              <select
                key={"d" + person}
                name="document"
                defaultValue={editing?.document || ""}
              >
                <option value="">No linked document</option>
                {data.documents
                  .filter((d) => d.employee === person)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.category} · {d.filename}
                    </option>
                  ))}
              </select>
            </Field>
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save task"}
            </button>
          </form>
        </Drawer>
      )}
    </section>
  );
}
