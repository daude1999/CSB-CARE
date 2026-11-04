import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, type Ctx } from "@/server/auth/rbac";
import { AppError } from "@/lib/errors";
import {
  complianceReport,
  HEADLINE_REPORTS,
  isReportKind,
  parseReportFilters,
  REPORT_CATEGORY,
  REPORT_STATUS_OPTIONS,
  REPORT_TITLES,
  reportFormats,
  type ComplianceReportKind,
} from "@/server/compliance/reports";
import { RISK_CATEGORIES } from "@/server/compliance/risks";
import { db } from "@/lib/db";
import { PcTableWrap } from "@/components/compliance-ui";
import { DownloadSimple, Info } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

/** Which reports a person may open: each needs the permission of the workspace its records come from. */
function allowed(ctx: Ctx, kind: ComplianceReportKind) {
  if (kind === "signoff" || kind === "signoff-groups") return hasOrgPermission(ctx, "staff.view");
  if (kind === "audits" || kind === "findings") return hasOrgPermission(ctx, "audit.conduct");
  if (kind === "risks") return hasOrgPermission(ctx, "risk.view");
  if (kind === "evidence") return hasOrgPermission(ctx, "evidence.read");
  return true;
}

const MORE: ComplianceReportKind[] = ["publications", "signoff-groups", "findings", "actions", "evidence"];
const FORMAT_LABEL = { csv: "CSV", xlsx: "Excel", pdf: "PDF" } as const;
const PREVIEW = 200;

/**
 * Compliance Reports (owner's brief of 3 Nov 2026, screenshot 06): six headline reports chosen like radio buttons, one
 * filter bar (period, branch, status, category) and a preview of exactly the rows an export will contain. Exports carry
 * the same filters, offer only the formats that are built, and are logged. Internal management reports, never CQC ratings.
 */
export default async function ComplianceReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "report.view")) notFound();
  const kind: ComplianceReportKind = sp.kind && isReportKind(sp.kind) && allowed(ctx, sp.kind) ? sp.kind : "policies";
  let error: string | null = null;
  let f = parseReportFilters({});
  try {
    f = parseReportFilters(sp);
  } catch (e) {
    error = e instanceof AppError ? e.message : "Check the dates";
  }
  const statusOptions = REPORT_STATUS_OPTIONS[kind] ?? [];
  const categoryKind = REPORT_CATEGORY[kind];
  const [report, branches, policyCategories] = await Promise.all([
    complianceReport(ctx, kind, f).catch((e) => {
      if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
      throw e;
    }),
    db.branch.findMany({ where: { organisationId: ctx.organisationId!, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    categoryKind === "policy" ? db.policyCategory.findMany({ where: { policies: { some: { organisationId: ctx.organisationId! } } }, orderBy: { name: "asc" } }) : Promise.resolve([]),
  ]);
  const categories: [string, string][] = categoryKind === "policy" ? policyCategories.map((c) => [c.code, c.name]) : categoryKind === "risk" ? Object.entries(RISK_CATEGORIES) : [];
  const status = statusOptions.some(([k]) => k === f.status) ? f.status : undefined;
  const category = categories.some(([k]) => k === f.category) ? f.category : undefined;
  const qs = (over: Record<string, string | undefined>) =>
    new URLSearchParams(Object.entries({ kind, from: f.from, to: f.to, branch: f.branch, status, category, ...over }).filter(([, v]) => v) as [string, string][]).toString();
  const canExport = hasOrgPermission(ctx, "report.export");
  const cards = HEADLINE_REPORTS.filter((r) => allowed(ctx, r.kind));
  const more = MORE.filter((k) => allowed(ctx, k));

  return (
    <>
      <CompliancePageHeader title="Compliance Reports" subtitle="Choose a report, set the filters and preview it. Exports contain exactly the rows shown, for your branches only." />

      <nav aria-label="Reports" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6" data-testid="report-cards">
        {cards.map((r) => {
          const on = r.kind === kind;
          return (
            <Link
              key={r.kind}
              href={`/compliance/reports?${qs({ kind: r.kind, status: undefined, category: undefined })}`}
              aria-current={on ? "page" : undefined}
              className={`pc-plain flex gap-3 rounded-[12px] border bg-white p-4 no-underline shadow-[0_1px_2px_rgba(16,24,40,0.05)] transition-colors hover:border-[#b9a6ea] ${on ? "border-[#5b2bb5] ring-1 ring-[#5b2bb5]" : "border-[#eaecf0]"}`}
            >
              <span aria-hidden="true" className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-[#5b2bb5]" : "border-[#d0d5dd]"}`}>
                {on ? <span className="h-2 w-2 rounded-full bg-[#5b2bb5]" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-[#101828]">{r.title}</span>
                <span className="mt-1 block text-[12.5px] leading-[18px] text-[#475467]">{r.blurb}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      <section aria-label="Report filters" className="pc-panel mt-4">
        <form method="get" action="/compliance/reports" className="flex flex-wrap items-end gap-3 px-5 py-4">
          <input type="hidden" name="kind" value={kind} />
          <label className="flex flex-col text-[13px] font-medium text-[#344054]">From<input type="date" name="from" defaultValue={f.from} className="input mt-1 h-[38px] w-[160px] py-0" /></label>
          <label className="flex flex-col text-[13px] font-medium text-[#344054]">To<input type="date" name="to" defaultValue={f.to} className="input mt-1 h-[38px] w-[160px] py-0" /></label>
          <label className="flex flex-col text-[13px] font-medium text-[#344054]">
            Branch
            <select name="branch" defaultValue={f.branch ?? ""} className="input mt-1 h-[38px] w-[160px] py-0">
              <option value="">{ctx.branchIds ? "All my branches" : "All branches"}</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          {statusOptions.length ? (
            <label className="flex flex-col text-[13px] font-medium text-[#344054]">
              Status
              <select name="status" defaultValue={status ?? ""} className="input mt-1 h-[38px] w-[160px] py-0">
                <option value="">Any</option>
                {statusOptions.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
          ) : null}
          {categories.length ? (
            <label className="flex flex-col text-[13px] font-medium text-[#344054]">
              Category
              <select name="category" defaultValue={category ?? ""} className="input mt-1 h-[38px] w-[200px] py-0">
                <option value="">All</option>
                {categories.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
              </select>
            </label>
          ) : null}
          <button className="pc-btn" type="submit">Run report</button>
          {canExport ? (
            <span className="ml-auto flex flex-wrap gap-2" data-testid="report-exports">
              {reportFormats(kind).map((fmt) => (
                <a key={fmt} href={`/api/compliance-reports/${kind}?${qs({ kind: undefined, format: fmt })}`} data-no-progress="" className="pc-btn-secondary">
                  <DownloadSimple size={16} aria-hidden="true" />{FORMAT_LABEL[fmt]}
                </a>
              ))}
            </span>
          ) : null}
        </form>
        {error ? <p role="alert" className="px-5 pb-3 text-[13.5px] text-[#b42318]">{error}. Showing the last 12 months instead.</p> : null}
        <p className="flex items-start gap-1.5 border-t border-[#f2f4f7] px-5 py-2.5 text-[12.5px] text-[#667085]">
          <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>
            {report.periodBasis ? `The period applies to each record's ${report.periodBasis}.` : "This report shows the current position; the period does not apply."}{" "}
            Internal management report. Not a CQC rating.
          </span>
        </p>
      </section>

      <section aria-labelledby="report-title" className="pc-panel mt-4">
        <div className="pc-panel-head flex-wrap">
          <h2 id="report-title" className="pc-panel-title">{report.title}</h2>
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-[13px]" data-testid="report-summary">
            {(report.summary ?? []).map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-1.5">
                <dt className="text-[#475467]">{label}</dt>
                <dd className="font-semibold tabular-nums text-[#101828]">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        {report.rows.length ? (
          <PcTableWrap>
            <table className="pc-table" data-testid="report-table">
              <thead><tr>{report.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {report.rows.slice(0, PREVIEW).map((r, i) => (
                  <tr key={i}>{r.map((v, j) => <td key={j} className={String(v ?? "").length < 24 ? "whitespace-nowrap" : ""}>{String(v ?? "")}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </PcTableWrap>
        ) : <p className="pc-empty">No records for this report with these filters.</p>}
        <div className="pc-foot">
          <span>Showing {Math.min(report.rows.length, PREVIEW)} of {report.rows.length} rows{report.rows.length > PREVIEW ? ". Export for the full report." : ""}</span>
          <ul className="list-none space-y-0.5 text-[12.5px]">{report.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </div>
      </section>

      {more.length ? (
        <section aria-labelledby="more-reports" className="pc-panel mt-4 px-5 py-4">
          <h2 id="more-reports" className="text-[14px] font-semibold text-[#101828]">More reports</h2>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
            {more.map((k) => (
              <li key={k}><Link href={`/compliance/reports?${qs({ kind: k, status: undefined, category: undefined })}`} aria-current={k === kind ? "page" : undefined} className="pc-link">{REPORT_TITLES[k]}</Link></li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
