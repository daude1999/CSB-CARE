import Link from "@/components/link";
import type { AcknowledgementEvent } from "@prisma/client";
import { BUCKET_LABEL, type AckBucket, type SignoffFilters, type signoffCounts } from "@/server/policies/assignment";
import { Badge, fmtDate, type Tone } from "@/components/ui";
import { createRuleAction } from "@/app/signoff-actions";

const TONE: Record<AckBucket, Tone> = { not_opened: "slate", opened: "amber", acknowledged: "green", assessment_pending: "amber", assessment_failed: "rose", exempted: "violet", withdrawn: "slate", superseded: "slate" };

export function AckBadge({ bucket, overdue, cannotSign }: { bucket: AckBucket; overdue?: boolean; cannotSign?: boolean }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={TONE[bucket]}>{BUCKET_LABEL[bucket]}</Badge>
      {overdue ? <Badge tone="rose">Overdue</Badge> : null}
      {cannotSign ? <Badge tone="rose" title="This person has no sign-in linked, so they cannot acknowledge. Link one in Administration > Workforce Sync & Logins.">Cannot sign: no login</Badge> : null}
    </span>
  );
}

/** The drill-down key for a person: their staff record, or their sign-in when they have no staff record. */
export const personKey = (r: { staffMemberId: string | null; userId: string | null }) => (r.staffMemberId ? `s-${r.staffMemberId}` : `u-${r.userId}`);

/** Builds a Staff Sign-off link that keeps the current filters. */
export function signoffHref(base: string, f: SignoffFilters & { view?: string }, over: Record<string, string | undefined> = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...over })) if (v) q.set(k, String(v));
  const s = q.toString();
  return `${base}${s ? `?${s}` : ""}`;
}

/**
 * The counts as one line of links. Every figure opens the list it counts, and the same rows feed the CSV, so the
 * dashboard, the individual records and the export reconcile.
 */
export function SignoffSummary({ c, base, f }: { c: ReturnType<typeof signoffCounts>; base: string; f: SignoffFilters & { view?: string } }) {
  const items: [string, number, string | undefined][] = [
    ["Assigned", c.total, undefined],
    ["Not opened", c.not_opened, "not_opened"],
    ["Opened", c.opened, "opened"],
    ["Acknowledged", c.acknowledged, "acknowledged"],
    ["Assessment required", c.assessment_pending, "assessment_pending"],
    ["Assessment failed", c.assessment_failed, "assessment_failed"],
    ["Overdue", c.overdue, "overdue"],
    ["Cannot sign", c.cannotSign, "cannot_sign"],
    ["Exempted", c.exempted, "exempted"],
  ];
  return (
    <section aria-label="Sign-off figures" className="panel mb-3">
      <p className="mb-2 text-[13.5px] text-slate-700">{c.completion === null ? "Nothing assigned in this view." : <>Completion <strong className="tabular-nums">{c.completion}%</strong>: acknowledged out of everyone still required to read (exempted people are not counted).</>}</p>
      <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[14px]">
        {items.map(([label, n, status]) => (
          <li key={label}>
            <Link href={signoffHref(base, { ...f, view: "rows" }, { status })} aria-current={f.status === status && f.view === "rows" ? "page" : undefined} className={`no-underline ${f.status === status ? "font-semibold" : ""} ${status === "overdue" && n ? "text-[#a3242c]" : ""}`}>
              {label} <span className="tabular-nums">{n}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const EVENT_LABEL: Record<string, string> = { ASSIGNED: "Assigned", OPENED: "Opened", ACKNOWLEDGED: "Acknowledged", REMINDED: "Reminder sent", ESCALATED: "Escalated", EXEMPTED: "Exempted", WITHDRAWN: "Withdrawn", CORRECTED: "Corrected", ASSESSMENT_PASSED: "Assessment passed", ASSESSMENT_FAILED: "Assessment failed" };

export function AckTimeline({ events, names }: { events: AcknowledgementEvent[]; names: Map<string, string> }) {
  if (!events.length) return <p className="text-[13px] text-slate-500">No events recorded.</p>;
  return (
    <ol className="space-y-1 border-l border-slate-300 pl-3 text-[13px]">
      {events.map((e) => (
        <li key={e.id}>
          <span className="tabular-nums text-slate-600">{fmtDate(e.at, true)}</span> · <span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</span>
          {e.actorId ? <span className="text-slate-600"> by {names.get(e.actorId) ?? "a member"}</span> : <span className="text-slate-600"> by the system</span>}
          {e.note ? <span className="text-slate-700">: {e.note}</span> : null}
        </li>
      ))}
    </ol>
  );
}

/** The filter bar shared by the sign-off pages. */
export function SignoffFilterForm({ f, view, branches, roles, policies, base }: { f: SignoffFilters; view?: string; branches: { id: string; name: string }[]; roles: string[]; policies?: { id: string; ref: string; title: string }[]; base: string }) {
  return (
    <section aria-label="Filters" className="panel mb-3">
      <form method="get" action={base} className="flex flex-wrap items-end gap-2">
        {view ? <input type="hidden" name="view" value={view} /> : null}
        <label><span className="label">Search</span><input name="q" defaultValue={f.q ?? ""} placeholder="Person or policy" className="input w-48" /></label>
        <label><span className="label">Branch</span><select name="branch" defaultValue={f.branch ?? ""} className="input"><option value="">All my branches</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
        <label><span className="label">Role</span><select name="role" defaultValue={f.role ?? ""} className="input"><option value="">Any role</option>{roles.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
        {policies ? <label><span className="label">Policy</span><select name="policy" defaultValue={f.policy ?? ""} className="input max-w-[260px]"><option value="">Any policy</option>{policies.map((p) => <option key={p.id} value={p.id}>{p.ref} {p.title}</option>)}</select></label> : null}
        <label><span className="label">Status</span><select name="status" defaultValue={f.status ?? ""} className="input"><option value="">Any</option>{(["not_opened", "opened", "acknowledged", "assessment_pending", "assessment_failed", "exempted", "withdrawn"] as const).map((b) => <option key={b} value={b}>{BUCKET_LABEL[b]}</option>)}<option value="overdue">Overdue</option><option value="cannot_sign">Cannot sign</option></select></label>
        <label><span className="label">Due by</span><input type="date" name="dueBefore" defaultValue={f.dueBefore ?? ""} className="input" /></label>
        <button className="btn-primary">Apply</button>
        <Link href={view ? `${base}?view=${view}` : base} className="btn-secondary">Clear</Link>
      </form>
    </section>
  );
}

export const SCOPE_LABEL: Record<string, string> = { ORG: "Everyone in the organisation", BRANCH: "Branch", ROLE: "Platform role", JOB_TITLE: "Job title", STAFF: "Named person" };
const ROLES = ["ORG_ADMIN", "COMPLIANCE_LEAD", "CARE_MANAGER", "CARE_COORDINATOR", "FINANCE_OFFICER", "POLICY_AUTHOR", "POLICY_REVIEWER", "POLICY_APPROVER", "STAFF", "CARER"] as const;

/**
 * The "who must read it" form. On a policy's sign-off page the policy is fixed; on the Assignment Rules tab the manager
 * chooses it. Either way the rule goes through createRule, which checks the policy, branch and people on the server.
 */
export function RuleForm({ back, policyId, policies, branches, roles, staff }: { back: string; policyId?: string; policies?: { id: string; ref: string; title: string }[]; branches: { id: string; name: string }[]; roles: string[]; staff: { id: string; displayName: string; jobTitle: string | null }[] }) {
  return (
    <form action={createRuleAction} className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-200 pt-3">
      <input type="hidden" name="back" value={back} />
      {policyId ? <input type="hidden" name="policyId" value={policyId} /> : (
        <label className="col-span-2"><span className="label">Policy (published policies only)</span><select name="policyId" required defaultValue="" className="input"><option value="" disabled>Choose a policy…</option>{(policies ?? []).map((p) => <option key={p.id} value={p.id}>{p.ref} {p.title}</option>)}</select></label>
      )}
      <label className="col-span-2"><span className="label">Assign to</span><select name="scope" className="input"><option value="ORG">Everyone in the organisation</option><option value="BRANCH">One branch</option><option value="JOB_TITLE">A job title</option><option value="ROLE">A platform role</option><option value="STAFF">Named people</option></select></label>
      <label><span className="label">Branch</span><select name="branchId" className="input"><option value="">—</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label><span className="label">Job title</span><select name="jobTitle" className="input"><option value="">—</option>{roles.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
      <label><span className="label">Platform role</span><select name="orgRole" className="input"><option value="">—</option>{ROLES.map((r) => <option key={r} value={r}>{r.replace(/_/g, " ").toLowerCase()}</option>)}</select></label>
      <label><span className="label">Due after (days)</span><input type="number" name="dueDays" min={1} max={180} defaultValue={14} className="input" /></label>
      <label className="col-span-2"><span className="label">Named people</span><select name="staffMemberIds" multiple size={4} className="input">{staff.map((s) => <option key={s.id} value={s.id}>{s.displayName} · {s.jobTitle}</option>)}</select></label>
      <label><span className="label">Priority</span><select name="priority" defaultValue="2" className="input"><option value="1">High risk</option><option value="2">Standard</option><option value="3">Routine</option></select></label>
      <div className="space-y-1 pt-5">
        <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="mandatory" defaultChecked className="h-4 w-4" /> Mandatory</label>
        <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="requiresAssessment" className="h-4 w-4" /> Needs an assessment</label>
      </div>
      <div className="col-span-2"><button className="btn-primary">Add assignment</button> <span className="text-[13px] text-slate-500">The current version is assigned at once.</span></div>
    </form>
  );
}
