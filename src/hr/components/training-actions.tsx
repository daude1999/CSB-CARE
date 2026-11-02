"use client";
/**
 * Assign Training and Send Reminder, from the Checks & Training page (owner's approved Training design, 1 Nov 2026),
 * and the "Assigned training" list on an employee's Training tab. The server re-checks permissions, works out who is
 * reminded and writes every change to the HR history; these panels only collect the choice and show the outcome.
 */
import { useMemo, useState } from "react";
import { BellRing, CheckCircle2, GraduationCap, Info, Search } from "lucide-react";
import { Drawer, Field } from "./ui";
import { canEdit, type TrainingAssignment } from "@/hr/lib/domain";
import { courseOptions, outstandingTraining, reminderText, type ReminderItem } from "@/hr/lib/training";
import { currentPeople, displayDate, type HubData } from "@/hr/lib/presentation";
import type { Mutate } from "./hub-shared";

type Outcome = { sent?: string[]; assigned?: string[]; skipped?: { name: string; reason: string }[] };

function addDays(day: string, n: number) {
  return new Date(Date.parse(day + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
}

/** "Sent to 3 people. Not sent: Sam Lee (no CSB sign-in linked)." */
export function outcomeMessage(verb: string, done: string[], skipped: { name: string; reason: string }[]) {
  const first = done.length ? `${verb} ${done.length} ${done.length === 1 ? "person" : "people"}.` : `Nobody was ${verb.toLowerCase().replace(/ to$/, "")}.`;
  return skipped.length ? `${first} Not included: ${skipped.map((s) => `${s.name} (${s.reason})`).join(", ")}.` : first;
}

function branchNameOf(data: HubData) {
  return (id: string) => data.branches.find((b) => b.id === id)?.name ?? "";
}

/* ------------------------------------------------------------ Assign training */

export function AssignTrainingForm({ data, close, mutate, done }: { data: HubData; close: () => void; mutate: Mutate; done: (message: string) => void }) {
  const people = currentPeople(data);
  const branchName = branchNameOf(data);
  const courses = useMemo(() => courseOptions(data), [data]);
  const followers = data.users.filter((x) => x.active && canEdit(x));
  const roles = [...new Set(people.map((e) => e.job))].sort();
  const [course, setCourse] = useState("");
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const shown = people
    .filter((e) => (!role || e.job === role) && (!search || `${e.name} ${e.job}`.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => a.name.localeCompare(b.name));
  const openFor = (id: string) => (data.trainingAssignments ?? []).find((a) => a.employee === id && a.status === "Open" && course.trim() && a.course.toLowerCase() === course.trim().toLowerCase());
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allShown = shown.length > 0 && shown.every((e) => picked.has(e.id));
  return (
    <Drawer title="Assign training" description="Choose a course, the people who need it and a date to complete it by." onClose={close} wide>
      <div className="info-banner">
        <Info size={20} />
        <span>
          This adds the course to each person&apos;s training list and creates an HR task to follow it up. Nothing is sent to staff, and rota
          readiness does not change: it still comes from verified training records.
        </span>
      </div>
      <form
        data-testid="assign-training-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          if (!picked.size) return setError("Choose at least one person.");
          const f = new FormData(e.currentTarget);
          setBusy(true);
          try {
            const r = (await mutate({
              action: "assign-training",
              assignment: { employees: [...picked], course: f.get("course"), due: f.get("due"), assignedTo: f.get("assignedTo"), note: f.get("note") },
            })) as Outcome;
            done(outcomeMessage(`${String(f.get("course")).trim()} assigned to`, r.assigned ?? [], r.skipped ?? []));
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Course">
          <input name="course" list="assign-course-options" required minLength={2} maxLength={120} value={course} onChange={(e) => setCourse(e.target.value)} placeholder="Choose or type a course" autoComplete="off" />
          <datalist id="assign-course-options">
            {courses.map((c) => <option key={c} value={c} />)}
          </datalist>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Complete by">
            <input type="date" name="due" required min={data.today} defaultValue={addDays(data.today, 30)} />
          </Field>
          <Field label="HR follow-up by">
            <select name="assignedTo" defaultValue={followers.some((x) => x.id === data.user.id) ? data.user.id : ""}>
              <option value="">Nobody yet</option>
              {followers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </Field>
        </div>
        <fieldset className="hrv-pick">
          <legend>
            Who needs it <span className="muted">({picked.size} chosen)</span>
          </legend>
          <div className="hrv-pick__tools">
            <label className="hrv-pick__search">
              <Search size={15} aria-hidden="true" />
              <span className="sr-only">Search people</span>
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search people…" />
            </label>
            <label>
              <span className="sr-only">Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">All roles</option>
                {roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <button
              type="button"
              className="cs-btn cs-btn--ghost cs-btn--sm"
              onClick={() =>
                setPicked((p) => {
                  const n = new Set(p);
                  for (const e of shown) {
                    if (allShown) n.delete(e.id);
                    else n.add(e.id);
                  }
                  return n;
                })
              }
            >
              {allShown ? "Clear shown" : `Choose all ${shown.length} shown`}
            </button>
          </div>
          <ul className="hrv-pick__list">
            {shown.map((e) => {
              const open = openFor(e.id);
              return (
                <li key={e.id}>
                  <label>
                    <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
                    <span className="min-w-0 flex-1">
                      <b>{e.name}</b>
                      <small>
                        {e.job} · {branchName(e.branch)}
                      </small>
                    </span>
                    {open ? <span className="hrv-pick__tag">Already assigned, due {displayDate(open.due)}</span> : null}
                  </label>
                </li>
              );
            })}
            {!shown.length ? <li className="hrv-pick__empty">No people match.</li> : null}
          </ul>
        </fieldset>
        <Field label="Note for the HR task (optional)">
          <textarea name="note" rows={2} maxLength={500} placeholder="For example: booked on the 14 November session" />
        </Field>
        {error && <div role="alert" className="error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={close}>Cancel</button>
          <button className="primary" disabled={busy}>
            {busy ? "Assigning…" : picked.size ? `Assign to ${picked.size} ${picked.size === 1 ? "person" : "people"}` : "Assign"}
          </button>
        </div>
      </form>
    </Drawer>
  );
}

/* ------------------------------------------------------------ Send reminder */

const ITEM_LABEL: Record<ReminderItem["status"], string> = {
  Overdue: "Overdue",
  "Due soon": "Due soon",
  "Missing evidence": "No certificate",
  Assigned: "Assigned",
  "Awaiting verification": "To verify",
  "Incomplete information": "Incomplete",
  "Up to date": "Up to date",
  "Not applicable": "Not needed",
};

export function SendReminderForm({ data, close, mutate, done }: { data: HubData; close: () => void; mutate: Mutate; done: (message: string) => void }) {
  const branchName = branchNameOf(data);
  const signIns = new Set(data.signIns ?? []);
  const rows = currentPeople(data)
    .map((e) => {
      const items = outstandingTraining(data, e.id, data.today);
      const today = (data.trainingReminders ?? []).find((r) => r.employee === e.id && r.day === data.today);
      return { e, items, linked: signIns.has(e.id), today };
    })
    .filter((r) => r.items.length)
    .sort((a, b) => Number(b.items.some((i) => i.status === "Overdue")) - Number(a.items.some((i) => i.status === "Overdue")) || a.e.name.localeCompare(b.e.name));
  const sendable = rows.filter((r) => r.linked && !r.today);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(sendable.map((r) => r.e.id)));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const preview = rows.find((r) => picked.has(r.e.id)) ?? sendable[0];
  const noLink = rows.filter((r) => !r.linked).length;
  return (
    <Drawer title="Send training reminder" description="Check who will get a reminder, then send." onClose={close} wide>
      <div className="info-banner">
        <BellRing size={20} />
        <span>
          Reminders go to each person&apos;s CSB notifications (the bell) only. Nothing is sent by email or text. People without a CSB sign-in
          can&apos;t be reminded here, so tell them yourself. One reminder per person per day.
        </span>
      </div>
      <form
        data-testid="send-reminder-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          if (!picked.size) return setError("Choose at least one person.");
          setBusy(true);
          try {
            const r = (await mutate({ action: "training-reminder", employees: [...picked] })) as Outcome;
            done(outcomeMessage("Reminder sent to", r.sent ?? [], r.skipped ?? []));
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset className="hrv-pick">
          <legend>
            People with training to do <span className="muted">({picked.size} chosen)</span>
          </legend>
          {noLink ? (
            <p className="hrv-pick__hint">
              {noLink} {noLink === 1 ? "person has" : "people have"} no CSB sign-in linked. An administrator can link one from the staff record.
            </p>
          ) : null}
          <ul className="hrv-pick__list hrv-pick__list--tall">
            {rows.map((r) => {
              const disabled = !r.linked || !!r.today;
              return (
                <li key={r.e.id}>
                  <label className={disabled ? "is-disabled" : ""}>
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={picked.has(r.e.id)}
                      onChange={() =>
                        setPicked((p) => {
                          const n = new Set(p);
                          if (n.has(r.e.id)) n.delete(r.e.id);
                          else n.add(r.e.id);
                          return n;
                        })
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <b>{r.e.name}</b>
                      <small>
                        {r.e.job} · {branchName(r.e.branch)}
                      </small>
                      <span className="hrv-pick__items">
                        {r.items.map((i) => (
                          <span key={i.course} className={`hrv-pick__item ${i.status === "Overdue" || i.status === "Missing evidence" ? "is-red" : "is-amber"}`}>
                            {i.course}: {ITEM_LABEL[i.status]}
                            {i.due && i.status !== "Missing evidence" ? ` · ${displayDate(i.due)}` : ""}
                          </span>
                        ))}
                      </span>
                    </span>
                    <span className={`hrv-pick__tag ${r.linked && !r.today ? "is-ok" : ""}`}>
                      {r.today ? `Reminded today by ${r.today.by}` : r.linked ? "Gets it on CSB" : "No CSB sign-in: tell them yourself"}
                    </span>
                  </label>
                </li>
              );
            })}
            {!rows.length ? <li className="hrv-pick__empty">Nobody has training to do. Everyone in this branch view is up to date.</li> : null}
          </ul>
        </fieldset>
        {preview ? (
          <div className="hrv-preview" aria-label="What they will see">
            <span className="hrv-preview__label">What {preview.e.name} will see</span>
            <b>{reminderText(preview.items).title}</b>
            <p>{reminderText(preview.items).body}</p>
          </div>
        ) : null}
        {error && <div role="alert" className="error">{error}</div>}
        <div className="form-actions">
          <button type="button" className="secondary-button" onClick={close}>Cancel</button>
          <button className="primary" disabled={busy || !picked.size}>
            {busy ? "Sending…" : picked.size ? `Send ${picked.size} ${picked.size === 1 ? "reminder" : "reminders"}` : "Send"}
          </button>
        </div>
      </form>
    </Drawer>
  );
}

/* --------------------------------------------- Assigned training on a record */

export function AssignedTraining({ data, employee, mutate, notify }: { data: HubData; employee: string; mutate: Mutate; notify: (m: string) => void }) {
  const list = (data.trainingAssignments ?? []).filter((a) => a.employee === employee).sort((a, b) => Number(b.status === "Open") - Number(a.status === "Open") || b.assignedAt.localeCompare(a.assignedAt));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const editable = canEdit(data.user);
  if (!list.length) return null;
  async function closeIt(a: TrainingAssignment, outcome: "Completed" | "Cancelled") {
    setBusy(a.id);
    setError("");
    try {
      await mutate({ action: "close-training", id: a.id, version: a.version, outcome });
      notify(outcome === "Completed" ? `${a.course} marked complete. Record the certificate below so it counts towards readiness.` : `${a.course} assignment cancelled.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="h-sheet" data-testid="assigned-training">
      <div className="h-sec h-table-head">
        <div className="h-sh">
          <h2>Assigned training</h2>
          <span className="muted">Courses HR has asked this person to complete</span>
        </div>
      </div>
      <div className="table-scroll">
        <table className="h-dir h-requirements">
          <thead>
            <tr>
              <th>Course</th>
              <th>Status</th>
              <th>Complete by</th>
              <th>Assigned</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => {
              const late = a.status === "Open" && a.due < data.today;
              return (
                <tr key={a.id}>
                  <td>
                    <b className="h-cell-title">
                      <GraduationCap size={14} aria-hidden="true" className="mr-1 inline" />
                      {a.course}
                    </b>
                    {a.note ? <small className="h-cell-meta">{a.note}</small> : null}
                  </td>
                  <td>
                    <span className={`hrv-chip ${late ? "is-red" : a.status === "Open" ? "is-amber" : a.status === "Completed" ? "is-green" : ""}`}>
                      {late ? "Overdue" : a.status === "Open" ? "Open" : a.status}
                    </span>
                  </td>
                  <td className={late ? "h-late" : ""}>{displayDate(a.due)}</td>
                  <td>
                    {displayDate(a.assignedAt)} · {a.assignedBy}
                    {a.closedAt ? <small className="h-cell-meta">{a.status} {displayDate(a.closedAt)} · {a.closedBy}</small> : null}
                  </td>
                  <td>
                    {editable && a.status === "Open" ? (
                      <span className="flex flex-wrap gap-1.5">
                        <button className="cs-btn cs-btn--secondary cs-btn--sm" disabled={busy === a.id} onClick={() => closeIt(a, "Completed")}>
                          <CheckCircle2 size={14} aria-hidden="true" />
                          Mark complete
                        </button>
                        <button className="cs-btn cs-btn--ghost cs-btn--sm" disabled={busy === a.id} onClick={() => closeIt(a, "Cancelled")}>
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && <div role="alert" className="error">{error}</div>}
      <div className="h-note">
        <Info size={14} />
        Marking a course complete closes the HR task. It does not verify training: record the certificate in the table below. Verifying it
        completes the assignment automatically.
      </div>
    </section>
  );
}
