import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";
import { listPolicies } from "@/server/policies/library";
import { adoptTemplateAction } from "../../actions";
import { DOC_TYPES } from "../../../../prisma/seed-data/library/types";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader, Pagination, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function PoliciesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const tab = sp.tab === "templates" ? "MASTER" : ctx.organisationId ? "CUSTOMER" : "MASTER";
  const page = Number(sp.page ?? 1);
  const docType = DOC_TYPES.some(([code]) => code === sp.type) ? sp.type : undefined;
  const { items, total, pageSize } = await listPolicies(ctx, { q: sp.q, category: sp.category, kind: tab, docType, page, overdueOnly: sp.overdue === "1" });
  const typeCounts = new Map(
    (await db.policy.groupBy({ by: ["docType"], where: tab === "MASTER" ? { kind: "MASTER", organisationId: null, status: "ACTIVE" } : { organisationId: ctx.organisationId, status: "ACTIVE" }, _count: true })).map((g) => [g.docType, g._count]),
  );
  const typeName = new Map<string, string>(DOC_TYPES);
  const typeHref = (code?: string) => {
    const params = new URLSearchParams();
    if (tab === "MASTER") params.set("tab", "templates");
    if (code) params.set("type", code);
    if (sp.category) params.set("category", sp.category);
    if (sp.q) params.set("q", sp.q);
    const qs = params.toString();
    return `/policies${qs ? `?${qs}` : ""}`;
  };
  const categories = await db.policyCategory.findMany({ orderBy: { name: "asc" } });
  const adopted = ctx.organisationId ? new Set((await db.policy.findMany({ where: { organisationId: ctx.organisationId, templateId: { not: null } }, select: { templateId: true } })).map((p) => p.templateId)) : new Set();
  const canAuthor = hasOrgPermission(ctx, "policy.author") || hasPlatformPermission(ctx, "master.author");
  return (
    <>
      <PageHeader
        title="Policies & Procedures"
        subtitle="Your organisation's policy library and the CSB starter templates. Starter templates are original content that has not been professionally reviewed; adapt and approve them before use."
        actions={canAuthor ? <Link className="btn-primary" href="/policies/new">New policy</Link> : null}
      />
      <Flash searchParams={sp} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        {ctx.organisationId ? <Link className={tab === "CUSTOMER" ? "btn-primary" : "btn-secondary"} href="/policies">Our policies</Link> : null}
        <Link className={tab === "MASTER" ? "btn-primary" : "btn-secondary"} href="/policies?tab=templates">CSB templates</Link>
        <form className="ml-auto flex flex-wrap gap-2" role="search">
          {tab === "MASTER" ? <input type="hidden" name="tab" value="templates" /> : null}
          {docType ? <input type="hidden" name="type" value={docType} /> : null}
          <input className="input w-56" name="q" defaultValue={sp.q} placeholder="Search title or reference" aria-label="Search policies" />
          <select className="input w-48" name="category" defaultValue={sp.category ?? ""} aria-label="Category">
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" name="overdue" value="1" defaultChecked={sp.overdue === "1"} /> Overdue review</label>
          <button className="btn-secondary" type="submit">Filter</button>
        </form>
      </div>
      <nav className="mb-4 flex flex-wrap gap-1 text-xs" aria-label="Document type">
        <Link className={!docType ? "btn-primary py-1" : "btn-secondary py-1"} href={typeHref()}>All types ({[...typeCounts.values()].reduce((a, b) => a + b, 0)})</Link>
        {DOC_TYPES.filter(([code]) => typeCounts.get(code)).map(([code, name]) => (
          <Link key={code} className={docType === code ? "btn-primary py-1" : "btn-secondary py-1"} href={typeHref(code)}>{name} ({typeCounts.get(code)})</Link>
        ))}
      </nav>
      <Card>
        {items.length ? (
          <table className="table">
            <thead>
              <tr><th>Reference</th><th>Title</th><th>Category</th><th>Current version</th><th>Next review</th><th>Open work</th><th>Download</th>{tab === "MASTER" && ctx.organisationId ? <th /> : null}</tr>
            </thead>
            <tbody>
              {items.map((p) => {
                const overdue = p.nextReviewDate && p.nextReviewDate < new Date();
                return (
                  <tr key={p.id}>
                    <td className="font-mono text-xs">{p.ref}</td>
                    <td><Link href={`/policies/${p.id}`} className="font-medium">{p.title}</Link>{p.docType !== "POLICY" ? <span className="ml-2"><Badge tone="teal">{typeName.get(p.docType) ?? p.docType}</Badge></span> : null}</td>
                    <td>{p.category.name}</td>
                    <td>{p.currentPublishedVersion ? <span className="flex items-center gap-2">{p.currentPublishedVersion.label} {p.currentPublishedVersion.origin === "SEED" ? <Badge title="Seeded content without an approval record">seeded, unapproved</Badge> : <StatusBadge status="PUBLISHED" />}</span> : <Badge tone="amber">no published version</Badge>}</td>
                    <td className={overdue ? "font-medium text-rose-600" : ""}>{fmtDate(p.nextReviewDate)}{overdue ? " (overdue)" : ""}</td>
                    <td>{p.revisions.length ? <Badge tone="amber">{p.revisions.length} open revision(s)</Badge> : "—"}</td>
                    <td className="whitespace-nowrap text-xs">
                      {p.currentPublishedVersion ? (
                        <>
                          <a href={`/api/policies/${p.id}/download?format=docx`} download>Word</a>
                          <span className="mx-1 text-slate-300">|</span>
                          <a href={`/api/policies/${p.id}/download?format=pdf`} download>PDF</a>
                        </>
                      ) : "—"}
                    </td>
                    {tab === "MASTER" && ctx.organisationId ? (
                      <td>
                        {adopted.has(p.id) ? <Badge tone="teal">in use</Badge> : hasOrgPermission(ctx, "policy.author") ? (
                          <form action={adoptTemplateAction}>
                            <input type="hidden" name="templateId" value={p.id} />
                            <input type="hidden" name="back" value="/policies?tab=templates" />
                            <button className="btn-secondary py-1" type="submit">Adopt</button>
                          </form>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty>{sp.q || sp.category || sp.overdue || docType ? "No policies match these filters." : tab === "CUSTOMER" ? "Your library is empty. Adopt a CSB template or create a policy to get started." : "No templates found."}</Empty>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} base="/policies" params={{ q: sp.q, category: sp.category, tab: sp.tab, overdue: sp.overdue, type: docType }} />
      </Card>
    </>
  );
}
