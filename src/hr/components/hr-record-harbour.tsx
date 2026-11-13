"use client";
import { useState, type ReactNode } from "react";
import Link from "@/hr/nav";
import {
  ChevronLeft,
  Pencil,
  Upload,
  MessageCircle,
  Mail,
  Menu as MenuIcon,
  User,
  ShieldAlert,
  Phone,
  CalendarDays,
  FileText,
  Clock,
  Check as CheckIcon,
  BadgeCheck,
  GraduationCap,
  Briefcase,
  Home,
  Maximize2,
} from "lucide-react";
import { checkStatus, dateDays, employeeAddress, type Check, type Doc, type Employee } from "@/hr/lib/domain";
import { displayDate, documentState, type HubData } from "@/hr/lib/presentation";
import { documentTitle } from "@/hr/lib/document-groups";

/**
 * The employee record in the Harbour look (docs/design/harbour/screens/employee-record-1440.png): context bar, the
 * light blue record header, record tabs with a Menu, and the Overview's coloured panels and timeline. Presentation
 * only: every button calls the HR Hub's existing handlers, and every figure comes from the HR workspace already loaded.
 */

type Tone = "ok" | "warn" | "bad" | "progress" | "neutral";
const TONE: Record<string, Tone> = {
  "Up to date": "ok",
  "Due soon": "warn",
  Overdue: "bad",
  "Missing evidence": "bad",
  "Awaiting verification": "progress",
  "Incomplete information": "warn",
  "Not applicable": "neutral",
};
const Pill = ({ tone, children }: { tone: Tone; children: ReactNode }) => (
  <span className="hb-pill" data-tone={tone}>{children}</span>
);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((w) => w.charAt(0)).join("").slice(0, 2).toUpperCase();
const surnameFirst = (name: string) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return <>{name}</>;
  const last = parts.pop()!;
  return <><span className="uppercase">{last}</span>, {parts.join(" ")}</>;
};

export const RECORD_TABS = ["Overview", "Employment", "Compliance", "Documents", "Training", "Activity"] as const;

function service(today: string, start: string) {
  const days = dateDays(today, start);
  if (days < 0) return "Not yet started";
  const y = Math.floor(days / 365.25);
  const m = Math.floor((days % 365.25) / 30.44);
  return `${y ? `${y} yr ` : ""}${m} mo`;
}

/** Context bar, record header and record tabs. */
export function HarbourRecordHeader({ data, employee: e, tab, setTab, editable, docs, overdue, required, backHref, onEdit, onUpload, onNote }: {
  data: HubData;
  employee: Employee;
  tab: string;
  setTab: (t: string) => void;
  editable: boolean;
  docs: Doc[];
  overdue: Check[];
  required: Check[];
  backHref: string;
  onEdit: () => void;
  onUpload: () => void;
  onNote: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const branch = data.branches.find((b) => b.id === e.branch)?.name || "Not recorded";
  const states = required.map((c) => checkStatus(c, data.today));
  const dueSoon = states.filter((s) => s === "Due soon").length;
  const waiting = states.filter((s) => s === "Awaiting verification" || s === "Missing evidence").length;
  const alerts: { label: string; tone: string; icon: ReactNode; go: string }[] = [
    ...(overdue.length ? [{ label: `${overdue.length} ${overdue.length === 1 ? "check" : "checks"} overdue`, tone: "bad", icon: <ShieldAlert size={14} />, go: "Compliance" }] : []),
    ...(waiting ? [{ label: `${waiting} ${waiting === 1 ? "check" : "checks"} waiting for evidence or verification`, tone: "prog", icon: <BadgeCheck size={14} />, go: "Compliance" }] : []),
    ...(dueSoon ? [{ label: `${dueSoon} ${dueSoon === 1 ? "check" : "checks"} due within 30 days`, tone: "warn", icon: <GraduationCap size={14} />, go: "Compliance" }] : []),
    ...(required.length && !overdue.length && !waiting && !dueSoon ? [{ label: "All required checks up to date", tone: "ok", icon: <CheckIcon size={14} />, go: "Compliance" }] : []),
  ];
  return (
    <div className="hb-hr-rec">
      <div className="hb-ctx" data-testid="record-context-bar">
        <Link href={backHref} className="hb-ctx-b" aria-label="Back to all people" title="Back to all people"><ChevronLeft size={16} /></Link>
        <span className="hb-ctx-v" aria-hidden="true" />
        {editable ? <button type="button" className="hb-ctx-b" aria-label="Edit employee" title="Edit employee" onClick={onEdit}><Pencil size={15} /></button> : null}
        {editable ? <button type="button" className="hb-ctx-b" aria-label="Upload document" title="Upload document" onClick={onUpload}><Upload size={15} /></button> : null}
        {e.email ? <a className="hb-ctx-b" href={`mailto:${e.email}`} aria-label={`Email ${e.name}`} title={`Email ${e.name}`}><Mail size={15} /></a> : null}
        <p className="hb-ctx-t">Employee: <b>{e.name}</b></p>
        <span className="flex-1" />
        <div className="hb-ctx-a">
          <button type="button" className="hb-btn" disabled={!editable} onClick={onNote}><MessageCircle size={14} />Add note</button>
          <button type="button" className="hb-btn hb-btn-p" disabled={!editable} onClick={onUpload}><Upload size={14} />Upload document</button>
        </div>
      </div>
      <header className="hb-pid" data-testid="record-header">
        <span className="hb-pid-av" data-hr="" aria-hidden="true">{initials(e.name)}</span>
        <div className="min-w-0 flex-1 basis-[18rem]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="hb-pid-n">{surnameFirst(e.name)} (Staff ID: {e.staffId})</h1>
            <Pill tone={e.status === "Active" ? "ok" : e.status === "Suspended" ? "bad" : e.status === "Onboarding" ? "progress" : "neutral"}>{e.status === "Active" ? "Active employee" : e.status === "Onboarding" ? "New starter" : e.status}</Pill>
          </div>
          <div className="hb-pid-m">
            <div>Preferred name: <b>{e.preferredName || e.name.split(" ")[0]}</b></div>
            <div>{e.job}{e.department ? ` · ${e.department}` : ""} · Manager: <b>{e.lineManager || "Not recorded"}</b></div>
          </div>
        </div>
        <div className="hb-pid-r">
          <div className="hb-pid-ids">
            <span>Started: <b>{displayDate(e.start)} ({service(data.today, e.start)})</b></span>
            <span>Branch: <b>{branch}</b></span>
            <span>Hours: <b>{e.employmentType || "Not recorded"}</b></span>
          </div>
          {alerts.length ? (
            <ul className="hb-pid-al" aria-label="Alerts">
              {alerts.map((a) => <li key={a.label}><button type="button" className="hb-ai" data-tone={a.tone} aria-label={a.label} title={a.label} onClick={() => setTab(a.go)}>{a.icon}</button></li>)}
            </ul>
          ) : null}
        </div>
      </header>
      <div className="hb-rt-wrap">
        <div className="hb-rt">
          <div className="hb-rt-menu">
            <button type="button" className="hb-btn" aria-expanded={menu} aria-haspopup="true" title="More actions for this record" onClick={() => setMenu((m) => !m)} onKeyDown={(ev) => { if (ev.key === "Escape") setMenu(false); }}><MenuIcon size={16} />Menu</button>
            {menu ? (
              <ul className="hb-rt-pop" onClick={() => setMenu(false)}>
                {editable ? <li><button type="button" className="hb-rt-pi" onClick={onEdit}><Pencil size={15} />Edit employee</button></li> : null}
                {editable ? <li><button type="button" className="hb-rt-pi" onClick={onUpload}><Upload size={15} />Upload document</button></li> : null}
                {editable ? <li><button type="button" className="hb-rt-pi" onClick={onNote}><MessageCircle size={15} />Add note</button></li> : null}
                <li><Link href={backHref} className="hb-rt-pi"><ChevronLeft size={15} />All people</Link></li>
              </ul>
            ) : null}
          </div>
          <nav className="hb-rt-tabs" aria-label="Employee record sections">
            {RECORD_TABS.map((t) => (
              <button key={t} type="button" className="hb-rt-tab" aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>
                {t}
                {t === "Compliance" && overdue.length > 0 ? <span className="hb-rt-n" data-tone="bad">{overdue.length}</span> : null}
                {t === "Documents" ? <span className="hb-rt-n">{docs.length}</span> : null}
              </button>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}

function Bar({ title, colour, icon, count, action, onFull, children, className = "", footer, flush, testId }: { title: string; colour: string; icon: ReactNode; count?: number; action?: ReactNode; onFull?: () => void; children: ReactNode; className?: string; footer?: ReactNode; flush?: boolean; testId?: string }) {
  return (
    <section className={`hb-pn hb-c-${colour} ${className}`} aria-label={title} data-testid={testId}>
      <div className="hb-pn-h">
        <span aria-hidden="true" className="flex">{icon}</span>
        <h2>{title}</h2>
        {count !== undefined ? <span className="hb-pn-cnt">{count}</span> : null}
        <span className="hb-sp" />
        {action}
        {onFull ? <button type="button" className="hb-pn-x" aria-label={`Open ${title} full screen`} title="Open full screen" onClick={onFull}><Maximize2 size={12} /></button> : null}
      </div>
      <div className="hb-pn-b" data-flush={flush ? "" : undefined}>{children}</div>
      {footer ? <div className="hb-pn-f">{footer}</div> : null}
    </section>
  );
}

/** The Overview: quick links, details, checks, contact, timeline, the checks chart, documents and upcoming dates. */
export function HarbourRecordOverview({ data, employee: e, checks, docs, events, editable, setTab, onEdit, onUpload, onDocument, onReview }: {
  data: HubData;
  employee: Employee;
  checks: Check[];
  docs: Doc[];
  events: { id: string; actor: string; action: string; at: string }[];
  editable: boolean;
  setTab: (t: string) => void;
  onEdit: () => void;
  onUpload: () => void;
  onDocument: (d: Doc) => void;
  onReview: (c: Check) => void;
}) {
  const [personal, setPersonal] = useState<Record<string, boolean>>({});
  const today = data.today;
  const branch = data.branches.find((b) => b.id === e.branch)?.name || "Not recorded";
  const required = checks.filter((c) => c.required);
  const needing = required.filter((c) => checkStatus(c, today) !== "Up to date");
  const upcoming = required.filter((c) => c.due).sort((a, b) => a.due!.localeCompare(b.due!)).slice(0, 5);
  const sortedDocs = [...docs].sort((a, b) => b.uploaded.localeCompare(a.uploaded));
  const sens = data.user.sensitive;
  const show = (k: string, label: string, value: ReactNode) =>
    !sens ? <span>Restricted</span>
    : personal[k] ? <span>{value || "Not recorded"} <button type="button" className="hb-show" aria-label={`Hide ${label}`} onClick={() => setPersonal((p) => ({ ...p, [k]: false }))}>Hide</button></span>
    : <span>Restricted <button type="button" className="hb-show" aria-label={`Show ${label}`} onClick={() => setPersonal((p) => ({ ...p, [k]: true }))}>Show</button></span>;
  const kv = (rows: [string, ReactNode][]) => (
    <dl className="hb-kv">{rows.map(([k, v]) => <div key={k}><dt>{k}:</dt> <dd>{v || "Not recorded"}</dd></div>)}</dl>
  );
  // The chart: a year either side of today; each check's bar runs from its issue (or check) date to its review date.
  const from = Date.parse(`${today}T00:00:00Z`) - 365 * 86400000;
  const to = Date.parse(`${today}T00:00:00Z`) + 365 * 86400000;
  const pos = (d: string) => Math.min(100, Math.max(0, ((Date.parse(`${d.slice(0, 10)}T00:00:00Z`) - from) / (to - from)) * 100));
  const months = Array.from({ length: 9 }, (_, i) => { const d = new Date(from); d.setUTCMonth(d.getUTCMonth() + i * 3, 1); return d; });
  const groups = new Map<string, typeof events>();
  for (const ev of events.slice(0, 12)) {
    const k = new Date(ev.at).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "Europe/London" }).toUpperCase();
    groups.set(k, [...(groups.get(k) ?? []), ev]);
  }
  const quick: [string, string, string, ReactNode, number | undefined, boolean][] = [
    ["Overview", "Overview", "#b4532a", <Home key="i" size={12} />, undefined, false],
    ["Employment", "Employment", "#1f3a68", <Briefcase key="i" size={12} />, undefined, false],
    ["Compliance", "Compliance", "#8c5200", <ShieldAlert key="i" size={12} />, needing.length || undefined, needing.some((c) => checkStatus(c, today) === "Overdue")],
    ["Training", "Training", "#0f766e", <GraduationCap key="i" size={12} />, undefined, false],
    ["Documents", "Documents", "#0e7490", <FileText key="i" size={12} />, docs.length, false],
    ["Activity", "Activity", "#5b3cc4", <Clock key="i" size={12} />, undefined, false],
  ];
  return (
    <div className="hb-cl">
      <div className="hb-cl-l">
        <nav aria-label="Quick links" className="hb-qm" data-testid="quick-links">
          <ul>
            {quick.map(([label, t, colour, icon, n, urgent]) => (
              <li key={label}><button type="button" className="hb-qm-a" onClick={() => setTab(t)}><span className="hb-qm-i" style={{ background: colour }} aria-hidden="true">{icon}</span><span className="min-w-0 flex-1 truncate text-left">{label}</span>{n ? <span className="hb-qm-n" data-urgent={urgent ? "" : undefined}>{n}</span> : null}</button></li>
            ))}
          </ul>
        </nav>
        <Bar title="Employee details" colour="blue" icon={<User size={15} />} className="hb-cl-first" onFull={() => setTab("Employment")} footer={editable ? <button type="button" className="hb-btn hb-btn-p" onClick={onEdit}>Edit</button> : undefined}>
          {kv([
            ["Full name", e.name],
            ["Job role", e.job],
            ["Department", e.department],
            ["Manager", e.lineManager],
            ["Branch", branch],
            ["Employment", e.employmentType],
            ["Started", `${displayDate(e.start)} · ${service(today, e.start)}`],
            ["Staff ID", <span key="id" className="font-mono">{e.staffId}</span>],
            ["Status", e.status],
          ])}
        </Bar>
        <Bar title="Checks needing action" colour="red" icon={<ShieldAlert size={15} />} count={needing.length} flush onFull={() => setTab("Compliance")} action={<button type="button" className="hb-pn-act" onClick={() => setTab("Compliance")}>Compliance</button>}
          footer={<span className="mr-auto text-[12.5px] text-[var(--hb-ink-3)]">{required.length - needing.length ? `The other ${required.length - needing.length} ${required.length - needing.length === 1 ? "check is" : "checks are"} in date.` : "No checks are in date yet."}</span>}>
          {needing.length ? (
            <table className="hb-tbl">
              <caption className="sr-only">Checks needing action</caption>
              <thead><tr><th scope="col">Check</th><th scope="col">Status</th><th scope="col">Due</th></tr></thead>
              <tbody>
                {needing.map((c) => { const s = checkStatus(c, today); return (
                  <tr key={c.id}>
                    <td><button type="button" className="text-left font-semibold text-[var(--hb-link)] hover:underline" onClick={() => onReview(c)}>{c.name}</button></td>
                    <td><Pill tone={TONE[s] ?? "neutral"}>{s}</Pill></td>
                    <td className="whitespace-nowrap">{c.due ? displayDate(c.due) : "—"}</td>
                  </tr>
                ); })}
              </tbody>
            </table>
          ) : <p className="px-3.5 py-4 text-[13.5px] text-[var(--hb-ink-3)]">Every required check is up to date.</p>}
        </Bar>
        <Bar title="Contact" colour="rose" icon={<Phone size={15} />} action={editable ? <button type="button" className="hb-pn-act" onClick={onEdit}>Edit</button> : undefined}>
          {kv([
            ["Work email", e.email],
            ["Phone", e.phone],
            ["Home address", show("address", "home address", employeeAddress(e))],
            ["Date of birth", show("dob", "date of birth", e.dateOfBirth ? displayDate(e.dateOfBirth) : "")],
            ["Emergency contact", show("emergency", "emergency contact", [e.emergencyName, e.emergencyRelationship, e.emergencyPhone].filter(Boolean).join(", "))],
            ["Identification", show("id", "identification", e.identificationType ? `${e.identificationType}${e.identificationLastFour ? ` •••• ${e.identificationLastFour}` : ""}` : "")],
          ])}
        </Bar>
      </div>
      <section className="hb-tl" aria-labelledby="hr-tl-h" data-testid="record-timeline">
        <div className="hb-tl-h">
          <h2 id="hr-tl-h">Timeline</h2>
          <span className="flex-1" />
          <button type="button" className="text-[13px] font-semibold text-[var(--hb-link)] hover:underline" onClick={() => setTab("Activity")}>All activity</button>
        </div>
        {events.length ? [...groups.entries()].map(([label, list]) => (
          <div key={label}>
            <p className="hb-tl-m">{label}</p>
            <ol>
              {list.map((ev) => (
                <li key={ev.id} className="hb-tle">
                  <span className="hb-tle-ic" aria-hidden="true"><MessageCircle size={18} /></span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="hb-tle-t" data-plain="">{ev.action}</span>
                      <span className="hb-tle-w">{displayDate(ev.at)}</span>
                    </div>
                    <dl className="hb-tm">
                      <div><dt>Completed by:</dt><dd>{ev.actor}</dd></div>
                      <div><dt>Date and time:</dt><dd>{new Date(ev.at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}</dd></div>
                    </dl>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )) : <p className="px-4 py-8 text-center text-[13.5px] text-[var(--hb-ink-3)]">No recorded activity.</p>}
      </section>
      <Bar title="Checks and training" colour="navy" icon={<BadgeCheck size={15} />} count={required.length} className="hb-cl-full" flush onFull={() => setTab("Compliance")} testId="record-checks">
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-b border-[var(--hb-line-2)] px-3.5 py-2 text-[12px] text-[var(--hb-ink-2)]">
          <span className="inline-flex items-center gap-1.5"><i className="hb-gk" data-s="ok" aria-hidden="true" />In date</span>
          <span className="inline-flex items-center gap-1.5"><i className="hb-gk" data-s="warn" aria-hidden="true" />Due within 30 days</span>
          <span className="inline-flex items-center gap-1.5"><i className="hb-gk" data-s="progress" aria-hidden="true" />Waiting for evidence or verification</span>
          <span className="inline-flex items-center gap-1.5"><i className="hb-gk" data-s="bad" aria-hidden="true" />Overdue</span>
        </div>
        {required.length ? (
          <div className="overflow-x-auto">
            <div className="hb-gantt">
              <div className="hb-gantt-row hb-gantt-axis" aria-hidden="true">
                <span />
                <div className="hb-gantt-track">
                  {months.map((m) => <span key={m.toISOString()} style={{ left: `${pos(m.toISOString())}%` }}>{m.toLocaleDateString("en-GB", { month: "short", year: m.getUTCMonth() === 0 ? "2-digit" : undefined, timeZone: "UTC" })}</span>)}
                  <b style={{ left: `${pos(today)}%` }}>Today</b>
                </div>
                <span />
              </div>
              {required.map((c) => {
                const s = checkStatus(c, today);
                const start = c.issueDate || c.checkedAt || e.start;
                const end = c.due || (s === "Up to date" ? new Date(to).toISOString() : today);
                const l = pos(start);
                const w = Math.max(1, pos(end) - l);
                return (
                  <div key={c.id} className="hb-gantt-row" data-testid="record-check">
                    <div className="min-w-0"><button type="button" className="text-left text-[13px] font-semibold text-[var(--hb-ink)] hover:underline" onClick={() => onReview(c)}>{c.name}</button><small className="block text-[11.5px] text-[var(--hb-ink-3)]">{c.category || (c.recurring ? "Renewed" : "One-off")}</small></div>
                    <div className="hb-gantt-track">
                      <i className="hb-gantt-bar" data-s={TONE[s] ?? "neutral"} style={{ left: `${l}%`, width: `${w}%` }} />
                      <i className="hb-gantt-now" style={{ left: `${pos(today)}%` }} aria-hidden="true" />
                    </div>
                    <div><Pill tone={TONE[s] ?? "neutral"}>{s}</Pill><small className="mt-0.5 block text-[11.5px] text-[var(--hb-ink-3)]">{c.due ? `Review ${displayDate(c.due)}` : "No review date"}</small></div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : <p className="px-3.5 py-4 text-[13.5px] text-[var(--hb-ink-3)]">No checks are required for this role.</p>}
      </Bar>
      <Bar title="Documents" colour="cyan" icon={<FileText size={15} />} count={docs.length} className="hb-cl-half" flush onFull={() => setTab("Documents")} action={editable ? <button type="button" className="hb-pn-act" onClick={onUpload}>Upload</button> : undefined}>
        {sortedDocs.length ? (
          <table className="hb-tbl">
            <caption className="sr-only">Documents</caption>
            <thead><tr><th scope="col">Document</th><th scope="col">Uploaded</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {sortedDocs.slice(0, 6).map((d) => (
                <tr key={d.id}>
                  <td><button type="button" className="text-left font-semibold text-[var(--hb-link)] hover:underline disabled:text-[var(--hb-ink-3)] disabled:no-underline" disabled={d.state === "Quarantined"} onClick={() => onDocument(d)} aria-label={d.filename}>{documentTitle(d, checks)}</button><small className="block text-[11.5px] text-[var(--hb-ink-3)]">{d.category}</small></td>
                  <td className="whitespace-nowrap">{displayDate(d.uploaded)}</td>
                  <td>{(() => { const st = documentState(d, data); return <Pill tone={TONE[st] ?? (/verif|sign|up to date/i.test(st) ? "ok" : /waiting|await/i.test(st) ? "progress" : /missing|quarant|overdue|expired/i.test(st) ? "bad" : "neutral")}>{st}</Pill>; })()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="px-3.5 py-4 text-[13.5px] text-[var(--hb-ink-3)]">No accessible documents.</p>}
      </Bar>
      <Bar title="Upcoming dates" colour="purple" icon={<CalendarDays size={15} />} count={upcoming.length} className="hb-cl-half" flush>
        {upcoming.length ? (
          <ul className="hb-up">
            {upcoming.map((c) => {
              const d = new Date(`${c.due}T00:00:00Z`);
              const n = dateDays(c.due!, today);
              return (
                <li key={c.id}>
                  <span className="hb-up-d"><small>{d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}</small><b>{d.getUTCDate()}</b></span>
                  <span className="min-w-0 flex-1"><b className="block text-[13.5px] font-semibold">{c.name}</b><small className="text-[12.5px] text-[var(--hb-ink-3)]">{checkStatus(c, today)}</small></span>
                  <Pill tone={n < 0 ? "bad" : n <= 30 ? "warn" : "neutral"}>{n < 0 ? `${-n} days overdue` : n === 0 ? "today" : n <= 60 ? `in ${n} days` : `in ${Math.round(n / 30.44)} months`}</Pill>
                </li>
              );
            })}
          </ul>
        ) : <p className="px-3.5 py-4 text-[13.5px] text-[var(--hb-ink-3)]">No review dates recorded.</p>}
      </Bar>
    </div>
  );
}
