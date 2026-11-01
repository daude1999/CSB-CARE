import { db } from "@/lib/db";
import { CompliancePageHeader } from "@/components/module-header";
import { requireCtx } from "@/server/auth/current";
import { hasPlatformPermission } from "@/server/auth/rbac";
import { createPolicyAction } from "../../../actions";
import { Card, Flash } from "@/components/ui";

export default async function NewPolicy({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const [categories, services] = await Promise.all([db.policyCategory.findMany({ orderBy: { name: "asc" } }), db.serviceType.findMany()]);
  return (
    <>
      <CompliancePageHeader eyebrow="Library · new document" title="Create Policy" back="/policies" subtitle="The policy is created as a draft. It must be reviewed and approved by someone other than you before it can be published." />
      <Flash searchParams={sp} />
      <Card title="Policy details">
        <form action={createPolicyAction} className="grid gap-4 md:grid-cols-2">
          <input type="hidden" name="back" value="/policies/new" />
          <div><label className="label" htmlFor="ref">Reference</label><input className="input" id="ref" name="ref" required /></div>
          <div><label className="label" htmlFor="title">Title</label><input className="input" id="title" name="title" required /></div>
          <div className="md:col-span-2"><label className="label" htmlFor="description">Description</label><input className="input" id="description" name="description" required /></div>
          <div>
            <label className="label" htmlFor="category">Category</label>
            <select className="input" id="category" name="category">{categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
          </div>
          <fieldset>
            <legend className="label">Service types</legend>
            <div className="flex flex-wrap gap-3 text-sm">{services.map((s) => <label key={s.code} className="flex items-center gap-1"><input type="checkbox" name="serviceTypes" value={s.code} defaultChecked /> {s.name}</label>)}</div>
          </fieldset>
          <div className="md:col-span-2">
            <label className="label" htmlFor="content">Content</label>
            <textarea className="input" id="content" name="content" rows={14} required defaultValue={"## Purpose\n\n## Scope\n\n## Responsibilities\n\n## Procedure\n\n## Local contacts and reporting routes\n\n## Review arrangements\n"} />
            <p className="mt-1 text-xs text-slate-500">Start each section with “## Heading”. Sections whose heading mentions local or contacts are marked as customer-specific and are never changed automatically.</p>
          </div>
          {hasPlatformPermission(ctx, "master.author") ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="master" /> Create as a CSB master template</label> : null}
          <div className="md:col-span-2"><button className="btn-primary" type="submit">Create draft</button></div>
        </form>
      </Card>
    </>
  );
}
