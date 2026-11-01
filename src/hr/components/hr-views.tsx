"use client";
/**
 * The HR & Workforce screens redesigned to the owner's approved orange HR designs (1 Nov 2026): the HR Dashboard,
 * the Training & Readiness matrix and the Documents split view. Every figure is counted from the HR Hub's own records
 * for the branch scope chosen in the header; nothing is invented. Actions appear only when the HR user may take them
 * (`canEdit`) and open the HR Hub's existing forms.
 */
import { useMemo, useState, type ReactNode } from "react";
import Link from "@/hr/nav";
import { useSearchParams } from "@/hr/nav";
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  GraduationCap,
  Search,
  Upload,
  UserPlus,
  Users,
  Briefcase,
  ListTodo,
  CalendarClock,
  ShieldCheck,
} from "lucide-react";
import { Avatar } from "./ui";
import {
  checkCategory,
  checkStatus,
  canEdit,
  dateDays,
  priorities,
  type Check,
  type Doc,
  type Employee,
  type ReviewStatus,
} from "@/hr/lib/domain";
import { currentPeople, displayDate, documentState, type HubData } from "@/hr/lib/presentation";
import { documentTitle } from "@/hr/lib/document-groups";
import { employeeRoute } from "@/hr/lib/routes";

/* ------------------------------------------------------------------ helpers */

const TRAINING = /training|certificate|first aid|manual handling|medication|moving|infection|fire|food|mca|dols/i;
export const isTraining = (c: Pick<Check, "name" | "category">) =>
  checkCategory(c) === "Training" || TRAINING.test(`${c.name} ${c.category ?? ""}`);

/** The least healthy status among some checks (Overdue first), or null when none is required. */
export function worst(checks: Check[], today: string): ReviewStatus | null {
  const required = checks.filter((c) => c.required);
  if (!required.length) return null;
  return required.map((c) => checkStatus(c, today)).sort((a, b) => priorities[a] - priorities[b])[0]!;
}

/** The earliest review date among an employee's required checks. */
export function nextDue(checks: Check[]): string | null {
  return (
    checks
      .filter((c) => c.required && c.due)
      .map((c) => c.due!)
      .sort()[0] ?? null
  );
}

const CHIP: Record<ReviewStatus, { label: string; cls: string }> = {
  "Up to date": { label: "Up to date", cls: "bg-[#dff3e7] text-[#17663a]" },
  "Due soon": { label: "Due soon", cls: "bg-[#fdf0d8] text-[#7a4f00]" },
  "Awaiting verification": { label: "To verify", cls: "bg-[#fdf0d8] text-[#7a4f00]" },
  "Incomplete information": { label: "Incomplete", cls: "bg-[#fdf0d8] text-[#7a4f00]" },
  Overdue: { label: "Overdue", cls: "bg-[#fde1e3] text-[#9b1c24]" },
  "Missing evidence": { label: "Missing", cls: "bg-[#fde1e3] text-[#9b1c24]" },
  "Not applicable": { label: "Not needed", cls: "bg-slate-100 text-slate-600" },
};

/** A small status chip. Green only for up to date, amber for attention, red for overdue or missing. */
export function StatusChip({ status, title }: { status: ReviewStatus | null; title?: string }) {
  if (!status) return <span className="text-[13px] text-slate-400" title="Not required for this person">—</span>;
  const c = CHIP[status];
  return (
    <span title={title ?? status} className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[12.5px] font-medium leading-5 ${c.cls}`}>
      {c.label}
    </span>
  );
}

function Panel({ title, icon, actions, children, className = "", id }: { title: string; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section aria-labelledby={id} className={`min-w-0 rounded-[8px] border border-[#e5e8ed] bg-white ${className}`}>
      <div className="flex flex-wrap items-center gap-3 border-b border-[#eef0f3] px-4 py-3">
        {icon ? <span className="text-[#c2410c]" aria-hidden="true">{icon}</span> : null}
        <h2 id={id} className="mr-auto text-[17px] font-semibold text-[#0c1728]">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Figure({ icon, label, value, href, note }: { icon: ReactNode; label: string; value: number; href: string; note: string }) {
  return (
    <Link href={href} title={note} className="group flex min-w-0 items-center gap-3.5 rounded-[8px] border border-[#e5e8ed] bg-white px-4 py-3 no-underline hover:border-[#f9b98a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#c2410c]">
      <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] bg-[#fff1e6] text-[#c2410c]">{icon}</span>
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-[#344054]">{label}</span>
        <span className="block text-[26px] font-semibold leading-8 tabular-nums text-[#0c1728]">{value}</span>
        <span className="block truncate text-[12px] text-[#667085]">{note}</span>
      </span>
    </Link>
  );
}

function Pager({ page, pages, setPage, total, size, noun }: { page: number; pages: number; setPage: (n: number) => void; total: number; size: number; noun: string }) {
  if (!total) return null;
  const from = (page - 1) * size + 1;
  const to = Math.min(page * size, total);
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 2);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#eef0f3] px-4 py-2.5 text-[13.5px] text-[#475467]">
      <span>
        Showing {from}–{to} of {total} {noun}
      </span>
      {pages > 1 ? (
        <nav aria-label={`${noun} pages`} className="flex items-center gap-1">
          <button type="button" className="hrv-pg" disabled={page === 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
            <ChevronLeft size={15} />
          </button>
          {nums.map((n, i) => (
            <span key={n} className="flex items-center gap-1">
              {i > 0 && n - nums[i - 1]! > 1 ? <span aria-hidden="true">…</span> : null}
              <button type="button" className="hrv-pg" aria-current={n === page ? "page" : undefined} onClick={() => setPage(n)}>
                {n}
              </button>
            </span>
          ))}
          <button type="button" className="hrv-pg" disabled={page === pages} onClick={() => setPage(page + 1)} aria-label="Next page">
            <ChevronRight size={15} />
          </button>
        </nav>
      ) : null}
    </div>
  );
}

function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <label className="hrv-search">
      <span className="sr-only">{label}</span>
      <Search size={16} aria-hidden="true" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="hrv-input" />
    </label>
  );
}

function usePeopleIndex(data: HubData) {
  return useMemo(() => {
    const byEmployee = new Map<string, Check[]>();
    for (const c of data.checks) {
      const list = byEmployee.get(c.employee);
      if (list) list.push(c);
      else byEmployee.set(c.employee, [c]);
    }
    return byEmployee;
  }, [data.checks]);
}

const branchNameOf = (data: HubData) => (id: string) => data.branches.find((b) => b.id === id)?.name ?? "Not recorded";

/* ------------------------------------------------------------- HR Dashboard */

export function HRHome({
  data,
  scope,
  onAdd,
  onUpload,
}: {
  data: HubData;
  scope: string;
  onAdd: () => void;
  onUpload: () => void;
  onDocument?: (d: Doc) => void;
}) {
  const people = currentPeople(data);
  const ids = new Set(people.map((e) => e.id));
  const checksOf = usePeopleIndex(data);
  const branchName = branchNameOf(data);
  const editable = canEdit(data.user);
  const q = (path: string, extra = "") => `${path}?branch=${scope}${extra}`;
  const checks = data.checks.filter((c) => ids.has(c.employee) && c.required);
  const count = (s: ReviewStatus) => checks.filter((c) => checkStatus(c, data.today) === s).length;
  const openTasks = (data.tasks ?? []).filter((t) => t.status !== "Complete" && ids.has(t.employee));
  const myLate = openTasks.filter((t) => t.assignedTo === data.user.id && t.due < data.today).length;

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [page, setPage] = useState(1);
  const rows = people
    .map((e) => {
      const own = checksOf.get(e.id) ?? [];
      return {
        e,
        dbs: worst(own.filter((c) => checkCategory(c) === "DBS"), data.today),
        rtw: worst(own.filter((c) => checkCategory(c) === "Right to work"), data.today),
        training: worst(own.filter(isTraining), data.today),
        overall: worst(own, data.today),
        next: nextDue(own),
      };
    })
    .filter((r) => {
      const text = `${r.e.name} ${r.e.job} ${branchName(r.e.branch)} ${r.e.staffId}`.toLowerCase();
      if (search && !text.includes(search.toLowerCase())) return false;
      if (filter === "attention") return r.overall !== null && r.overall !== "Up to date";
      if (filter === "clear") return r.overall === "Up to date";
      if (filter === "starters") return r.e.status === "Onboarding";
      return true;
    })
    .sort((a, b) => a.e.name.localeCompare(b.e.name));
  const size = 10;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);

  const attention: { label: string; detail: string; n: number; href: string; tone: "red" | "amber" }[] = [
    { label: "Overdue checks", detail: "Past their review date", n: count("Overdue"), href: q("/compliance", "&status=Overdue"), tone: "red" },
    { label: "Missing evidence", detail: "Required, with nothing on file", n: count("Missing evidence"), href: q("/compliance", "&status=Missing+evidence"), tone: "red" },
    { label: "Awaiting verification", detail: "Evidence uploaded, not yet checked", n: count("Awaiting verification"), href: q("/compliance", "&status=Awaiting+verification"), tone: "amber" },
    { label: "Incomplete information", detail: "Checked, but no next review date", n: count("Incomplete information"), href: q("/compliance"), tone: "amber" },
    { label: "My overdue tasks", detail: "HR tasks assigned to you, past due", n: myLate, href: q("/alerts", "&view=tasks"), tone: "red" },
  ];
  const upcoming = checks
    .filter((c) => c.due && c.due >= data.today && checkStatus(c, data.today) !== "Not applicable")
    .sort((a, b) => a.due!.localeCompare(b.due!))
    .slice(0, 6);

  const quick: { label: string; icon: ReactNode; onClick?: () => void; href?: string; external?: boolean; show: boolean }[] = [
    { label: "Add employee", icon: <UserPlus size={20} />, onClick: onAdd, show: editable },
    { label: "Upload document", icon: <Upload size={20} />, onClick: onUpload, show: editable },
    { label: "Record absence", icon: <CalendarDays size={20} />, href: "/workforce/absences", external: true, show: true },
    { label: "Training & readiness", icon: <GraduationCap size={20} />, href: q("/training"), show: true },
    { label: "Recruitment", icon: <Briefcase size={20} />, href: "/hr/recruitment", external: true, show: true },
  ];

  return (
    <div className="hrv grid gap-3" data-testid="hr-dashboard">
      <h2 className="sr-only" data-testid="dashboard-title">
        HR Dashboard
      </h2>
      <section aria-label="Key figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Figure icon={<Users size={22} />} label="Active employees" value={people.filter((e) => e.status === "Active").length} href={q("/people", "&view=Active")} note="Current, not archived or new starters" />
        <Figure icon={<UserPlus size={22} />} label="New starters" value={people.filter((e) => e.status === "Onboarding").length} href={q("/people", "&view=New+starters")} note="Onboarding, not yet active" />
        <Figure icon={<CalendarClock size={22} />} label="Checks due in 30 days" value={count("Due soon")} href={q("/compliance", "&status=Due+soon")} note="Review date within the next 30 days" />
        <Figure icon={<ListTodo size={22} />} label="Open HR tasks" value={openTasks.length} href={q("/alerts", "&view=tasks")} note="Not yet complete, all assignees" />
      </section>

      <div className="grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel
          id="hr-directory"
          title="Employee directory"
          icon={<Users size={20} />}
          actions={
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by name, role or branch…" label="Search employees" />
              <label>
                <span className="sr-only">Show</span>
                <select className="hrv-input" value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
                  <option value="all">Everyone</option>
                  <option value="attention">Needs attention</option>
                  <option value="clear">Checks up to date</option>
                  <option value="starters">New starters</option>
                </select>
              </label>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="hrv-table" data-testid="hr-directory">
              <caption className="sr-only">Employees and the state of their key checks</caption>
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Role</th>
                  <th scope="col">Branch</th>
                  <th scope="col">Status</th>
                  <th scope="col">DBS</th>
                  <th scope="col">Right to work</th>
                  <th scope="col">Training</th>
                  <th scope="col">Next review</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice((current - 1) * size, current * size).map((r) => (
                  <tr key={r.e.id}>
                    <td>
                      <Link href={employeeRoute(r.e.id, scope)} className="hrv-name">
                        {r.e.name}
                      </Link>
                    </td>
                    <td className="text-[#344054]">{r.e.job}</td>
                    <td className="text-[#344054]">{branchName(r.e.branch)}</td>
                    <td>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[12.5px] font-medium ${r.e.status === "Active" ? "bg-[#dff3e7] text-[#17663a]" : "bg-slate-100 text-slate-700"}`}>{r.e.status === "Onboarding" ? "New starter" : r.e.status}</span>
                    </td>
                    <td><StatusChip status={r.dbs} /></td>
                    <td><StatusChip status={r.rtw} /></td>
                    <td><StatusChip status={r.training} /></td>
                    <td className={`whitespace-nowrap tabular-nums ${r.next && r.next < data.today ? "font-semibold text-[#b42318]" : "text-[#344054]"}`}>{r.next ? displayDate(r.next) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length ? <p className="px-4 py-8 text-center text-[14px] text-[#667085]">No employees match this search.</p> : null}
          </div>
          <Pager page={current} pages={pages} setPage={setPage} total={rows.length} size={size} noun="employees" />
        </Panel>

        <div className="grid gap-3">
          <Panel id="hr-attention" title="Needs attention" icon={<AlertTriangle size={20} />}>
            <ul className="divide-y divide-[#eef0f3]" data-testid="hr-needs-attention">
              {attention.map((a) => (
                <li key={a.label}>
                  <Link href={a.href} className="flex items-center gap-3 px-4 py-2.5 no-underline hover:bg-[#fffaf5] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#c2410c]">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold text-[#0c1728]">{a.label}</span>
                      <span className="block text-[12.5px] text-[#667085]">{a.detail}</span>
                    </span>
                    <span className={`min-w-8 rounded-full px-2 text-center text-[13px] font-semibold tabular-nums ${a.n === 0 ? "bg-slate-100 text-slate-500" : a.tone === "red" ? "bg-[#fde1e3] text-[#9b1c24]" : "bg-[#fdf0d8] text-[#7a4f00]"}`}>{a.n}</span>
                    <ChevronRight size={16} aria-hidden="true" className="text-[#98a2b3]" />
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel id="hr-upcoming" title="Upcoming checks & reviews" icon={<CalendarDays size={20} />} actions={<Link href={q("/compliance", "&status=Due+soon")} className="text-[13.5px] font-semibold text-[#c2410c] no-underline hover:underline">View all</Link>}>
            {upcoming.length ? (
              <div className="overflow-x-auto">
              <table className="hrv-table hrv-table--compact">
                <caption className="sr-only">The next review dates</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Employee</th>
                    <th scope="col">Item</th>
                  </tr>
                </thead>
                <tbody>
                  {upcoming.map((c) => {
                    const e = people.find((p) => p.id === c.employee)!;
                    return (
                      <tr key={c.id}>
                        <td className="whitespace-nowrap tabular-nums">{displayDate(c.due)}</td>
                        <td>
                          <Link href={employeeRoute(e.id, scope)} className="hrv-name">{e.name}</Link>
                          <span className="block text-[12px] text-[#667085]">{branchName(e.branch)}</span>
                        </td>
                        <td>{c.name}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            ) : (
              <p className="px-4 py-6 text-[14px] text-[#667085]">No review dates coming up.</p>
            )}
          </Panel>
        </div>
      </div>

      <Panel id="hr-quick" title="Quick actions" icon={<ClipboardList size={20} />}>
        <ul className="grid grid-cols-2 gap-2.5 p-3 sm:grid-cols-3 xl:grid-cols-5">
          {quick
            .filter((x) => x.show)
            .map((x) => (
              <li key={x.label}>
                {x.onClick ? (
                  <button type="button" onClick={x.onClick} className="hrv-quick">
                    <span className="text-[#c2410c]" aria-hidden="true">{x.icon}</span>
                    {x.label}
                  </button>
                ) : x.external ? (
                  <a href={x.href} className="hrv-quick">
                    <span className="text-[#c2410c]" aria-hidden="true">{x.icon}</span>
                    {x.label}
                  </a>
                ) : (
                  <Link href={x.href!} className="hrv-quick">
                    <span className="text-[#c2410c]" aria-hidden="true">{x.icon}</span>
                    {x.label}
                  </Link>
                )}
              </li>
            ))}
        </ul>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------- Training & readiness */

export function TrainingMatrix({ data, scope }: { data: HubData; scope: string }) {
  const people = currentPeople(data);
  const checksOf = usePeopleIndex(data);
  const branchName = branchNameOf(data);
  // Columns: DBS and Right to work, then the training requirements most people have (up to three).
  const trainingNames = useMemo(() => {
    const freq = new Map<string, number>();
    const ids = new Set(people.map((e) => e.id));
    for (const c of data.checks) if (ids.has(c.employee) && c.required && isTraining(c)) freq.set(c.name, (freq.get(c.name) ?? 0) + 1);
    return [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([n]) => n);
  }, [data.checks, people]);
  const roles = [...new Set(people.map((e) => e.job))].sort();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);

  const rows = people
    .map((e) => {
      const own = (checksOf.get(e.id) ?? []).filter((c) => c.required);
      const training = own.filter(isTraining);
      const done = training.filter((c) => checkStatus(c, data.today) === "Up to date").length;
      return {
        e,
        own,
        dbs: worst(own.filter((c) => checkCategory(c) === "DBS"), data.today),
        rtw: worst(own.filter((c) => checkCategory(c) === "Right to work"), data.today),
        cells: trainingNames.map((n) => worst(own.filter((c) => c.name === n), data.today)),
        done,
        total: training.length,
        next: nextDue(own),
        overall: worst(own, data.today),
      };
    })
    .filter((r) => {
      if (search && !`${r.e.name} ${r.e.job} ${branchName(r.e.branch)}`.toLowerCase().includes(search.toLowerCase())) return false;
      if (role && r.e.job !== role) return false;
      if (status && r.overall !== status) return false;
      return true;
    })
    .sort((a, b) => a.e.name.localeCompare(b.e.name));
  const size = 12;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);

  const ids = new Set(people.map((e) => e.id));
  const required = data.checks.filter((c) => ids.has(c.employee) && c.required);
  const thisWeek = required
    .filter((c) => c.due && dateDays(c.due, data.today) >= 0 && dateDays(c.due, data.today) <= 7 && checkStatus(c, data.today) !== "Up to date")
    .sort((a, b) => a.due!.localeCompare(b.due!));
  const overdue = required.filter((c) => checkStatus(c, data.today) === "Overdue").length;

  return (
    <div className="hrv grid grid-cols-1 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_340px]" data-testid="training-matrix">
      <Panel
        id="tm-title"
        title="Employee training & checks"
        icon={<GraduationCap size={20} />}
        actions={
          <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto">
            <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search employee…" label="Search employees" />
            <label>
              <span className="sr-only">Role</span>
              <select className="hrv-input" value={role} onChange={(e) => { setRole(e.target.value); setPage(1); }}>
                <option value="">All roles</option>
                {roles.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label>
              <span className="sr-only">Overall status</span>
              <select className="hrv-input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                <option value="">All statuses</option>
                {(["Overdue", "Missing evidence", "Awaiting verification", "Incomplete information", "Due soon", "Up to date"] as ReviewStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="hrv-table hrv-table--matrix">
            <caption className="sr-only">Each employee&apos;s required checks and training. The overall column shows the least healthy status.</caption>
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col">Training up to date</th>
                <th scope="col">Next due</th>
                <th scope="col">DBS</th>
                <th scope="col">Right to work</th>
                {trainingNames.map((n) => <th scope="col" key={n}>{n.replace(/ training$/i, "")}</th>)}
                <th scope="col">Overall</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice((current - 1) * size, current * size).map((r) => (
                <tr key={r.e.id}>
                  <td>
                    <Link href={employeeRoute(r.e.id, scope)} className="hrv-name">{r.e.name}</Link>
                    <span className="block text-[12px] text-[#667085]">{r.e.job} · {branchName(r.e.branch)}</span>
                  </td>
                  <td className="whitespace-nowrap tabular-nums">{r.total ? `${r.done} / ${r.total}` : "—"}</td>
                  <td className={`whitespace-nowrap tabular-nums ${r.next && r.next < data.today ? "font-semibold text-[#b42318]" : "text-[#344054]"}`}>{r.next ? displayDate(r.next) : "—"}</td>
                  <td><StatusChip status={r.dbs} /></td>
                  <td><StatusChip status={r.rtw} /></td>
                  {r.cells.map((s, i) => <td key={trainingNames[i]}><StatusChip status={s} /></td>)}
                  <td><StatusChip status={r.overall} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? <p className="px-4 py-8 text-center text-[14px] text-[#667085]">No employees match these filters.</p> : null}
        </div>
        <Pager page={current} pages={pages} setPage={setPage} total={rows.length} size={size} noun="employees" />
      </Panel>

      <div className="grid gap-3">
        <Panel id="tm-week" title="Due this week" icon={<CalendarDays size={20} />}>
          <p className="px-4 pt-2.5 text-[13px] text-[#667085]">Checks and training with a review date in the next 7 days.</p>
          {thisWeek.length ? (
            <ul className="divide-y divide-[#eef0f3]">
              {thisWeek.slice(0, 8).map((c) => {
                const e = people.find((p) => p.id === c.employee)!;
                return (
                  <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="min-w-0 flex-1">
                      <Link href={employeeRoute(e.id, scope)} className="hrv-name">{e.name}</Link>
                      <span className="block truncate text-[12.5px] text-[#475467]">{c.name}</span>
                    </span>
                    <span className="whitespace-nowrap rounded-full bg-[#fdf0d8] px-2 py-0.5 text-[12.5px] font-medium tabular-nums text-[#7a4f00]">{displayDate(c.due)}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-4 py-4 text-[14px] text-[#667085]">Nothing due in the next 7 days.</p>
          )}
          <div className="grid gap-2 border-t border-[#eef0f3] p-3">
            <Link href={`/compliance?branch=${scope}&status=Overdue`} className="hrv-btn hrv-btn--secondary">
              <AlertTriangle size={16} aria-hidden="true" />
              {overdue} overdue {overdue === 1 ? "check" : "checks"}
            </Link>
            <Link href={`/compliance?branch=${scope}`} className="hrv-btn hrv-btn--primary">
              <ShieldCheck size={16} aria-hidden="true" />
              Open the checks register
            </Link>
          </div>
        </Panel>
        <p className="px-1 text-[12.5px] leading-5 text-[#667085]">
          Training is recorded and verified on each employee&apos;s record (Checks tab). Staff readiness for the rota is worked out from these
          records and is not changed by this page.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------ Documents & checks */

export function DocumentsSplit({
  data,
  scope,
  onOpen,
  onReview,
  onUpload,
  categoryView,
}: {
  data: HubData;
  scope: string;
  onOpen: (d: Doc) => void;
  onReview: (c: Check) => void;
  onUpload: (e: Employee) => void;
  categoryView: ReactNode;
}) {
  const params = useSearchParams();
  const byCategory = params.get("mode") === "category" || params.has("category") || params.has("view") || params.has("status");
  const people = currentPeople(data);
  const checksOf = usePeopleIndex(data);
  const branchName = branchNameOf(data);
  const editable = canEdit(data.user);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [chosen, setChosen] = useState<string | null>(params.get("person"));
  const [tab, setTab] = useState<"checklist" | "files">("checklist");

  const rows = people
    .map((e) => {
      const req = (checksOf.get(e.id) ?? []).filter((c) => c.required);
      const onFile = req.filter((c) => c.evidence).length;
      return { e, req, onFile, pct: req.length ? Math.round((onFile / req.length) * 100) : 100 };
    })
    .filter((r) => !search || `${r.e.name} ${r.e.job} ${branchName(r.e.branch)}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.e.name.localeCompare(b.e.name));
  const size = 12;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);
  const selected = rows.find((r) => r.e.id === chosen) ?? rows[0];

  const ids = new Set(people.map((e) => e.id));
  const required = data.checks.filter((c) => ids.has(c.employee) && c.required);
  const missing = required.filter((c) => !c.evidence).length;
  const toVerify = required.filter((c) => checkStatus(c, data.today) === "Awaiting verification").length;
  const expiring = data.documents.filter((d) => ids.has(d.employee) && d.expiryDate && dateDays(d.expiryDate, data.today) >= 0 && dateDays(d.expiryDate, data.today) <= 30 && !data.documents.some((n) => n.previous === d.id)).length;

  const modeLink = (category: boolean) => `/documents?branch=${scope}${category ? "&mode=category" : ""}`;
  const toggle = (
    <div role="group" aria-label="Documents view" className="flex rounded-[8px] border border-[#d0d5dd] bg-white p-0.5">
      <Link href={modeLink(false)} aria-current={!byCategory ? "page" : undefined} className={`hrv-seg ${!byCategory ? "is-on" : ""}`}>By employee</Link>
      <Link href={modeLink(true)} aria-current={byCategory ? "page" : undefined} className={`hrv-seg ${byCategory ? "is-on" : ""}`}>By category</Link>
    </div>
  );

  const summary = (
    <section aria-label="Document summary" className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-[8px] border border-[#e5e8ed] bg-white px-4 py-2.5 text-[14px] text-[#344054]">
      <span><strong className="text-[18px] tabular-nums text-[#0c1728]">{people.length}</strong> employees</span>
      <span aria-hidden="true" className="h-5 w-px bg-[#e5e8ed]" />
      <Link href={`/documents?branch=${scope}&mode=category`} className="no-underline hover:underline"><strong className="text-[18px] tabular-nums text-[#b42318]">{missing}</strong> required documents missing</Link>
      <span aria-hidden="true" className="h-5 w-px bg-[#e5e8ed]" />
      <Link href={`/compliance?branch=${scope}&status=Awaiting+verification`} className="no-underline hover:underline"><strong className="text-[18px] tabular-nums text-[#8a5a00]">{toVerify}</strong> awaiting verification</Link>
      <span aria-hidden="true" className="h-5 w-px bg-[#e5e8ed]" />
      <span><strong className="text-[18px] tabular-nums text-[#0c1728]">{expiring}</strong> files expiring in 30 days</span>
      <span className="ml-auto">{toggle}</span>
    </section>
  );

  if (byCategory)
    return (
      <div className="hrv grid gap-3">
        {summary}
        <div>{categoryView}</div>
      </div>
    );

  const docs = selected ? data.documents.filter((d) => d.employee === selected.e.id).sort((a, b) => b.uploaded.localeCompare(a.uploaded)) : [];
  return (
    <div className="hrv grid gap-3" data-testid="documents-split">
      {summary}
      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[400px_minmax(0,1fr)]">
        <Panel id="docs-people" title="Employees" icon={<Users size={20} />}>
          <div className="px-3 pt-3">
            <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search by name, role or branch…" label="Search employees" />
          </div>
          <ul className="mt-2" aria-label="Employees">
            {rows.slice((current - 1) * size, current * size).map((r) => {
              const on = selected?.e.id === r.e.id;
              return (
                <li key={r.e.id}>
                  <button type="button" aria-pressed={on} onClick={() => { setChosen(r.e.id); setTab("checklist"); }} className={`hrv-person ${on ? "is-on" : ""}`}>
                    <span className="min-w-0 flex-1 text-left">
                      <span className="block truncate text-[14px] font-semibold text-[#0c1728]">{r.e.name}</span>
                      <span className="block truncate text-[12.5px] text-[#667085]">{r.e.job}</span>
                    </span>
                    <span className="flex w-[118px] items-center gap-2" title={`${r.onFile} of ${r.req.length} required documents on file`}>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#eef0f3]">
                        <span className={`block h-full rounded-full ${r.pct === 100 ? "bg-[#1c7a43]" : r.pct >= 75 ? "bg-[#d08700]" : "bg-[#c4323a]"}`} style={{ width: `${r.pct}%` }} />
                      </span>
                      <span className="w-9 text-right text-[12.5px] tabular-nums text-[#344054]">{r.pct}%</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!rows.length ? <p className="px-4 py-6 text-center text-[14px] text-[#667085]">No employees match this search.</p> : null}
          <Pager page={current} pages={pages} setPage={setPage} total={rows.length} size={size} noun="employees" />
        </Panel>

        {selected ? (
          <section aria-labelledby="docs-person" className="min-w-0 rounded-[8px] border border-[#e5e8ed] bg-white">
            <div className="flex flex-wrap items-center gap-3 border-b border-[#eef0f3] px-4 py-3">
              <Avatar name={selected.e.name} />
              <div className="mr-auto min-w-0">
                <h2 id="docs-person" className="text-[18px] font-semibold text-[#0c1728]">{selected.e.name}</h2>
                <p className="text-[13px] text-[#667085]">{selected.e.job} · {branchName(selected.e.branch)}</p>
              </div>
              <div className="min-w-[220px]">
                <p className="text-[12.5px] font-medium text-[#344054]">Required documents on file</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-[#eef0f3]"><span className="block h-full rounded-full bg-[#1c7a43]" style={{ width: `${selected.pct}%` }} /></span>
                  <span className="text-[13px] tabular-nums text-[#344054]">{selected.onFile} of {selected.req.length}</span>
                </div>
              </div>
            </div>
            <div role="tablist" aria-label="Employee documents" className="flex gap-1 border-b border-[#eef0f3] px-3">
              {(["checklist", "files"] as const).map((t) => (
                <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`hrv-tab ${tab === t ? "is-on" : ""}`}>
                  {t === "checklist" ? "Required documents & checks" : `Files & history (${docs.length})`}
                </button>
              ))}
            </div>
            {tab === "checklist" ? (
              <div className="overflow-x-auto" role="tabpanel">
                <table className="hrv-table">
                  <caption className="sr-only">Required documents and checks for {selected.e.name}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Document / check</th>
                      <th scope="col">On file</th>
                      <th scope="col">Verified</th>
                      <th scope="col">Review or expiry</th>
                      <th scope="col">Status</th>
                      <th scope="col"><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.req.map((c) => {
                      const doc = c.evidence ? data.documents.find((d) => d.id === c.evidence) : undefined;
                      const s = checkStatus(c, data.today);
                      return (
                        <tr key={c.id}>
                          <td className="font-medium text-[#0c1728]">{c.name}</td>
                          <td>{doc ? <span className="text-[#17663a]">Yes{doc.mime.includes("pdf") ? " (PDF)" : ""}</span> : <span className="font-medium text-[#b42318]">No</span>}</td>
                          <td>{c.verified ? <span className="text-[#17663a]">Verified</span> : <span className="text-[#667085]">Not verified</span>}</td>
                          <td className={`whitespace-nowrap tabular-nums ${s === "Overdue" ? "font-semibold text-[#b42318]" : ""}`}>{c.due ? displayDate(c.due) : doc?.expiryDate ? displayDate(doc.expiryDate) : "—"}</td>
                          <td><StatusChip status={s} /></td>
                          <td className="whitespace-nowrap text-right">
                            {doc && doc.state !== "Quarantined" ? <button type="button" className="hrv-link" onClick={() => onOpen(doc)}>View file</button> : null}
                            {editable ? <button type="button" className="hrv-link ml-3" onClick={() => onReview(c)}>Review</button> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!selected.req.length ? <p className="px-4 py-6 text-[14px] text-[#667085]">No documents are required for this role.</p> : null}
              </div>
            ) : (
              <div role="tabpanel">
                {docs.length ? (
                  <ul className="divide-y divide-[#eef0f3]">
                    {docs.map((d) => {
                      const state = documentState(d, data);
                      return (
                        <li key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                          <FileText size={18} aria-hidden="true" className="text-[#667085]" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium text-[#0c1728]">{documentTitle(d, data.checks)}</span>
                            <span className="block truncate text-[12.5px] text-[#667085]">{d.filename} · v{d.version} · uploaded {displayDate(d.uploaded)}</span>
                          </span>
                          <span className="text-[12.5px] text-[#475467]">{state}</span>
                          {d.state !== "Quarantined" ? <button type="button" className="hrv-link" onClick={() => onOpen(d)}>Open</button> : <span className="text-[12.5px] text-[#8a5a00]">Waiting for virus check</span>}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="px-4 py-6 text-[14px] text-[#667085]">No files uploaded for this employee yet.</p>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 border-t border-[#eef0f3] p-3">
              {editable ? (
                <button type="button" className="hrv-btn hrv-btn--primary" onClick={() => onUpload(selected.e)}>
                  <Upload size={16} aria-hidden="true" />Upload file
                </button>
              ) : null}
              <Link href={employeeRoute(selected.e.id, scope)} className="hrv-btn hrv-btn--secondary">Open full record</Link>
              <span className="ml-auto text-[12.5px] text-[#667085]">Files are checked for viruses before anyone can open them. Verifying is done from Review.</span>
            </div>
          </section>
        ) : (
          <p className="rounded-[8px] border border-[#e5e8ed] bg-white px-4 py-8 text-center text-[14px] text-[#667085]">No employees in this branch.</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------ Employee key checks */

/** The four readiness boxes under an employee's name: DBS, Right to work, Training and all checks together. */
export function KeyChecks({ checks, today }: { checks: Check[]; today: string }) {
  const boxes: [string, ReactNode, ReviewStatus | null][] = [
    ["DBS", <ShieldCheck key="i" size={18} />, worst(checks.filter((c) => checkCategory(c) === "DBS"), today)],
    ["Right to work", <FileText key="i" size={18} />, worst(checks.filter((c) => checkCategory(c) === "Right to work"), today)],
    ["Training", <GraduationCap key="i" size={18} />, worst(checks.filter(isTraining), today)],
    ["All checks", <ClipboardList key="i" size={18} />, worst(checks, today)],
  ];
  return (
    <ul className="hrv-keychecks" aria-label="Key checks" data-testid="key-checks">
      {boxes.map(([label, icon, status]) => (
        <li key={label}>
          <span className="text-[#c2410c]" aria-hidden="true">{icon}</span>
          <span className="font-semibold text-[#0c1728]">{label}</span>
          <StatusChip status={status} title={status ? `${label}: ${status}` : `${label}: not required`} />
        </li>
      ))}
    </ul>
  );
}
