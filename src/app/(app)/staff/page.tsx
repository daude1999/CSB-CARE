import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { ACK_NOT_TRAINING, BUCKET_LABEL, parseSignoffFilters, signoffCounts, signoffLookups, signoffRows, type SignoffRow } from "@/server/policies/assignment";
import { ComplianceTabs } from "@/components/compliance-nav";
import { personKey, signoffHref } from "@/components/signoff-ui";
import { SignoffRegister, type RegisterRow } from "@/components/signoff-register";
import { PcFigure, PcFoot, PcSearch, PcTableWrap } from "@/components/compliance-ui";
import { PcSelect } from "@/components/pc-select";
import { Flash, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

const PAGE = 300;

/** Groups rows for the "by person" and "by policy" views; the figures are counted from the same rows as the list. */
function group(rows: SignoffRow[], key: (r: SignoffRow) => string) {
  const m = new Map<string, SignoffRow[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m.entries()];
}
const tally = (rows: SignoffRow[]) => {
  const assigned = rows.filter((r) => r.b.bucket !== "withdrawn").length;
  const done = rows.filter((r) => r.b.bucket === "acknowledged").length;
  const required = rows.filter((r) => r.b.bucket !== "withdrawn" && r.b.bucket !== "exempted").length;
  return { assigned, done, required, outstanding: rows.filter((r) => r.b.outstanding).length, overdue: rows.filter((r) => r.b.overdue).length, cannotSign: rows.some((r) => r.b.cannotSign), completion: required ? Math.round((done / required) * 100) : null };
};

/** One status word per row, in the badge colours every Policy & Compliance screen uses. */
function statusOf(r: SignoffRow): { label: string; tone: RegisterRow["tone"] } {
  if (r.b.overdue) return { label: "Overdue", tone: "red" };
  if (r.b.cannotSign) return { label: "Cannot sign: no login", tone: "red" };
  switch (r.b.bucket) {
    case "acknowledged": return { label: "Acknowledged", tone: "green" };
    case "opened": return { label: "Opened", tone: "blue" };
    case "assessment_pending": return { label: "Assessment required", tone: "amber" };
    case "assessment_failed": return { label: "Assessment failed", tone: "red" };
    case "exempted": return { label: "Exempted", tone: "purple" };
    case "withdrawn": return { label: "Withdrawn", tone: "grey" };
    default: return { label: BUCKET_LABEL[r.b.bucket], tone: "grey" };
  }
}

/**
 * Staff Sign-off (owner's brief of 3 Nov 2026, screenshot 04): who has been asked to read which policy version, who has
 * acknowledged it, what is overdue and who cannot sign because they have no login. Figures, lists, drill-downs and the
 * CSV come from one set of rows. Managers can remind, extend or exempt in bulk; nobody is ever marked as having read.
 */
export default async function StaffSignoffPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "staff.view")) notFound();
  const f = parseSignoffFilters(sp);
  const view = sp.view === "policies" || sp.view === "rows" || sp.view === "people" ? sp.view : "overview";
  const tab = view === "rows" && f.status === "overdue" ? "overdue" : view === "rows" ? "overview" : view;
  const [all, lookups] = await Promise.all([signoffRows(ctx, { ...f, status: undefined }), signoffLookups(ctx)]);
  const rows = f.status ? all.filter((r) => (f.status === "overdue" ? r.b.overdue : f.status === "cannot_sign" ? r.b.cannotSign : r.b.bucket === f.status)) : all;
  const c = signoffCounts(all);
  const base = "/staff";
  const fv = { ...f, view };
  const csv = signoffHref("/api/staff-signoff", f);
  const canManage = hasOrgPermission(ctx, "signoff.manage");
  const completed = c.acknowledged + c.exempted;
  const back = signoffHref(base, fv);

  // Overdue first, then the rest still to read, then what is done; soonest due first within each.
  const rank = (r: SignoffRow) => (r.b.overdue ? 0 : r.b.outstanding ? 1 : 2);
  const ordered = rows.filter((r) => r.b.bucket !== "superseded").sort((a, b) => rank(a) - rank(b) || (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity));
  const register: RegisterRow[] = ordered.slice(0, PAGE).map((r) => {
    const st = statusOf(r);
    return {
      id: r.id,
      person: r.person,
      personHref: `/staff/person/${personKey(r)}`,
      role: r.staffMember?.jobTitle ?? "Office member",
      branch: r.staffMember?.branch?.name ?? "All branches",
      policy: `${r.publication.policy.ref} ${r.publication.policy.title}`,
      policyHref: `/staff/policy/${r.publication.policyId}`,
      version: r.publication.version.label,
      assigned: fmtDate(r.createdAt),
      due: fmtDate(r.dueAt),
      overdue: r.b.overdue,
      status: st.label,
      tone: st.tone,
      acknowledged: r.acknowledgedAt ? fmtDate(r.acknowledgedAt) : "—",
      outstanding: r.b.outstanding,
    };
  });

  return (
    <>
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="signoff" active={tab} />}
        title="Staff Sign-off"
        subtitle={`Who has been asked to read each policy version and whether they have acknowledged it. ${ACK_NOT_TRAINING.split(".")[0]}.`}
        actions={<><a href={csv} className="pc-btn-secondary">Export CSV</a><Link href="/rota/readiness" className="pc-btn-secondary">Staff readiness</Link></>}
      />
      <Flash searchParams={sp} />
      <section aria-label="Sign-off figures" className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="signoff-figures">
        <PcFigure label="Total assignments" value={c.total} note="Current policy versions" href={signoffHref(base, { ...f, view: "rows" }, { status: undefined })} />
        <PcFigure label="Completed" value={completed} valueTone="green" note={`Acknowledged or exempted${c.total ? ` · ${Math.round((completed / c.total) * 100)}%` : ""}`} href={signoffHref(base, { ...f, view: "rows" }, { status: "acknowledged" })} />
        <PcFigure label="Outstanding" value={c.outstanding} note="Not opened or not yet acknowledged" href={signoffHref(base, { ...f, view: "rows" }, { status: "not_opened" })} />
        <PcFigure label="Overdue" value={c.overdue} valueTone={c.overdue ? "red" : "default"} note={c.cannotSign ? `${c.cannotSign} cannot sign: no linked login` : "Past the due date"} href={signoffHref(base, { ...f, view: "rows" }, { status: "overdue" })} />
      </section>

      <section aria-label={tab === "people" ? "Sign-off by employee" : tab === "policies" ? "Sign-off by policy" : "Sign-off register"} className="pc-panel">
        <form method="get" action={base} className="pc-toolbar" role="search" aria-label="Filter sign-off">
          {view !== "overview" ? <input type="hidden" name="view" value={view} /> : null}
          <PcSearch defaultValue={f.q} placeholder="Search person or policy" />
          <PcSelect name="branch" label="Branch" defaultValue={f.branch ?? ""} options={[{ value: "", label: "All" }, ...lookups.branches.map((b) => ({ value: b.id, label: b.name }))]} />
          <PcSelect name="role" label="Role" defaultValue={f.role ?? ""} options={[{ value: "", label: "Any" }, ...lookups.roles.map((r) => ({ value: r, label: r }))]} />
          <PcSelect name="status" label="Status" defaultValue={f.status ?? ""} options={[{ value: "", label: "Any" }, ...(["not_opened", "opened", "acknowledged", "assessment_pending", "assessment_failed", "exempted", "withdrawn"] as const).map((b) => ({ value: b, label: BUCKET_LABEL[b] })), { value: "overdue", label: "Overdue" }, { value: "cannot_sign", label: "Cannot sign" }]} />
          <button className="pc-btn-secondary sr-only focus:not-sr-only" type="submit">Apply</button>
          {f.q || f.branch || f.role || f.status ? <Link href={view === "overview" ? base : `${base}?view=${view}`} className="pc-link ml-1">Clear filters</Link> : null}
        </form>

        {!all.length ? (
          <p className="pc-empty">No policy has been assigned yet. Publish a policy, or add an assignment rule on the Assignment Rules tab.</p>
        ) : !rows.length ? (
          <p className="pc-empty">Nothing matches these filters.</p>
        ) : view === "people" ? (
          <PcTableWrap>
            <table className="pc-table">
              <thead><tr><th>Employee</th><th>Branch</th><th className="text-right">Assigned</th><th className="text-right">Acknowledged</th><th className="text-right">Outstanding</th><th className="text-right">Overdue</th><th className="w-[200px]">Completion</th></tr></thead>
              <tbody>
                {group(rows, personKey).map(([k, rs]) => {
                  const t = tally(rs);
                  const r0 = rs[0]!;
                  return (
                    <tr key={k}>
                      <td><Link href={`/staff/person/${k}`} className="pc-strong">{r0.person}</Link><span className="pc-sub">{r0.staffMember?.jobTitle ?? "Office member"}{t.cannotSign ? " · cannot sign: no login" : ""}</span></td>
                      <td>{r0.staffMember?.branch?.name ?? "All branches"}</td>
                      <td className="text-right">{t.assigned}</td>
                      <td className="text-right">{t.done}</td>
                      <td className="text-right">{t.outstanding}</td>
                      <td className={`text-right ${t.overdue ? "font-semibold text-[#b42318]" : ""}`}>{t.overdue}</td>
                      <td><Completion value={t.completion} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PcTableWrap>
        ) : view === "policies" ? (
          <PcTableWrap>
            <table className="pc-table">
              <thead><tr><th>Policy</th><th>Version</th><th className="text-right">Assigned</th><th className="text-right">Acknowledged</th><th className="text-right">Overdue</th><th className="w-[200px]">Completion</th></tr></thead>
              <tbody>
                {group(rows, (r) => r.publication.policyId).map(([id, rs]) => {
                  const t = tally(rs);
                  const p = rs[0]!.publication;
                  return (
                    <tr key={id}>
                      <td><Link href={`/staff/policy/${id}`} className="pc-strong">{p.policy.ref} {p.policy.title}</Link></td>
                      <td>{p.version.label}</td>
                      <td className="text-right">{t.assigned}</td>
                      <td className="text-right">{t.done}</td>
                      <td className={`text-right ${t.overdue ? "font-semibold text-[#b42318]" : ""}`}>{t.overdue}</td>
                      <td><Completion value={t.completion} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PcTableWrap>
        ) : (
          <SignoffRegister rows={register} canManage={canManage} back={back} />
        )}
        <PcFoot shown={view === "people" ? group(rows, personKey).length : view === "policies" ? group(rows, (r) => r.publication.policyId).length : register.length} total={view === "people" ? group(rows, personKey).length : view === "policies" ? group(rows, (r) => r.publication.policyId).length : rows.length}>
          {rows.length > PAGE && view !== "people" && view !== "policies" ? <span className="pc-note">Narrow the filters or export the CSV to see every row.</span> : null}
        </PcFoot>
      </section>
    </>
  );
}

/** Completion as a bar and a percentage: acknowledged out of everyone still required to read. */
function Completion({ value }: { value: number | null }) {
  if (value === null) return <span className="text-[#667085]">—</span>;
  return (
    <span className="flex items-center gap-2.5">
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-[#f2f4f7]" role="img" aria-label={`${value}% acknowledged`}>
        <span className={`block h-full rounded-full ${value >= 90 ? "bg-[#12b76a]" : value >= 60 ? "bg-[#7a5af8]" : "bg-[#f79009]"}`} style={{ width: `${value}%` }} />
      </span>
      <span className="w-10 text-right text-meta font-semibold text-[#344054]">{value}%</span>
    </span>
  );
}
