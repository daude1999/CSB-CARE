import type { ServiceUserStatus } from "@prisma/client";
import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { serviceUserDirectory } from "@/server/care/service-users";
import { EXACT_REFERENCE_HINT, SearchProblem } from "@/components/search-notice";
import { mayBeExternalReference } from "@/lib/service-user-search";
import { rotaLookups, suName } from "@/server/rota/queries";
import { Badge, Card, Empty, Flash, PageHeader, StatusBadge } from "@/components/ui";
import { AreaDot } from "@/components/rota-ui";
import { RotaTabs } from "@/components/rota-nav";

export const dynamic = "force-dynamic";

const STATUSES: ServiceUserStatus[] = ["ENQUIRY", "ASSESSMENT", "ACTIVE", "PAUSED", "ENDED"];

export default async function ServiceUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("serviceUser.view");
  const status = sp.status === "ALL" ? "ALL" : STATUSES.find((s) => s === sp.status) ?? "CURRENT";
  const [dir, lk] = await Promise.all([serviceUserDirectory(ctx, { q: sp.q, status, areaId: sp.area || undefined }), rotaLookups(ctx)]);
  const rows = dir.rows;
  const showAll = `/rota/service-users?${new URLSearchParams({ q: dir.q, status: "ALL" })}`;
  return (
    <>
      <PageHeader tabs={<RotaTabs ctx={ctx} ws="people" active="directory" />} title="Service Users" back="/rota" subtitle="The people you support, with their care package, carer preferences and repeating visits. All names in the demo are fictional." actions={hasOrgPermission(ctx, "serviceUser.edit") ? <div className="flex flex-wrap gap-2">{hasOrgPermission(ctx, "rota.edit") && hasOrgPermission(ctx, "serviceUser.documents") ? <Link href="/rota/service-users/import" className="btn-secondary">Set up from support plan</Link> : null}<Link href="/rota/service-users/new" className="btn-primary">Add service user</Link></div> : null} />
      <Flash searchParams={sp} />
      <section aria-label="Filters" className="panel mb-3">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label><span className="label">Search</span><input name="q" defaultValue={sp.q ?? ""} placeholder="Name, CSB or council reference, postcode" className="input w-64" /></label>
          <label><span className="label">Status</span><select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">Current (not ended)</option><option value="ALL">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select></label>
          <label><span className="label">Area</span><select name="area" defaultValue={sp.area ?? ""} className="input"><option value="">All areas</option>{lk.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
          <button className="btn-primary">Apply</button>
          <Link href="/rota/service-users" className="btn-secondary">Clear</Link>
        </form>
      </section>
      {dir.referenceProblem ? <SearchProblem>{dir.referenceProblem}</SearchProblem> : null}
      {dir.hiddenByFilters ? (
        <p role="status" data-testid="hidden-by-filters" className="mb-3 rounded-[3px] border-l-4 border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          {dir.hiddenByFilters === 1 ? "1 more person matches" : `${dir.hiddenByFilters} more people match`} “{dir.q}” but {dir.hiddenByFilters === 1 ? "is" : "are"} hidden by the status or area filter. <Link href={showAll}>Show all matches</Link>
        </p>
      ) : null}
      <Card>
        {rows.length ? (
          <table className="table">
            <thead><tr><th>Name</th><th>Status</th><th>Area</th><th>Postcode</th><th>Risk</th><th>Commissioned</th><th>Repeating visits</th><th>Carer preference</th></tr></thead>
            <tbody>
              {rows.map((s) => {
                const mins = s.packages.reduce((n, p) => n + (p.commissionedMinutesPerWeek ?? 0), 0);
                return (
                  <tr key={s.id}>
                    <td><Link href={`/rota/service-users/${s.id}`}>{suName(s)}</Link><div className="text-[12.5px] text-slate-500">{s.csbReference ?? s.reference}{s.csbReference && s.reference !== s.csbReference ? ` · legacy ${s.reference}` : ""}{s.matchedReference ? ` · matched ${s.matchedReference}` : ""}</div></td>
                    <td><StatusBadge status={s.status} /></td>
                    <td><AreaDot area={s.area} /></td>
                    <td>{s.postcode ?? "—"}</td>
                    <td>{s.riskLevel ? <Badge tone={s.riskLevel === "HIGH" ? "rose" : s.riskLevel === "MEDIUM" ? "amber" : "slate"}>{s.riskLevel.toLowerCase()}</Badge> : <span className="text-slate-500">Not assessed</span>}</td>
                    <td className="tabular-nums">{mins ? `${(mins / 60).toFixed(1)} h/week` : "—"}</td>
                    <td className="tabular-nums">{s._count.templates}</td>
                    <td>{s.carerGenderPreference === "ANY" ? "None" : `${s.carerGenderPreference.toLowerCase()} carers`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <Empty>{dir.q ? `No service users you are allowed to see match “${dir.q}” with these filters.${mayBeExternalReference(dir.q) && !dir.referenceProblem ? ` ${EXACT_REFERENCE_HINT}` : ""}` : "No service users match these filters."}</Empty>}
      </Card>
    </>
  );
}
