import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { getAiProvider } from "@/server/ai";
import { updateOrgSettingsAction } from "../../actions";
import { Card, Field, Flash, fmtDate, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "org.manage")) notFound();
  const org = await db.organisation.findUniqueOrThrow({ where: { id: ctx.organisationId! }, include: { branches: { include: { services: { include: { serviceType: true } } } } } });
  const logs = await db.auditLog.findMany({ where: { organisationId: org.id }, orderBy: { createdAt: "desc" }, take: 40 });
  const actors = new Map((await db.user.findMany({ where: { id: { in: logs.map((l) => l.actorId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const settings = (org.settings ?? {}) as { requiredApprovals?: number };
  const ai = getAiProvider();
  return (
    <>
      <PageHeader eyebrow="Administration · your organisation" title="Organisation Settings" subtitle={org.name} />
      <Flash searchParams={sp} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6">
          <Card title="Approval rules">
            <form action={updateOrgSettingsAction} className="space-y-2">
              <input type="hidden" name="back" value="/settings" />
              <label className="label" htmlFor="ra">Approvals required before publishing</label>
              <select id="ra" name="requiredApprovals" className="input" defaultValue={String(settings.requiredApprovals ?? 1)}>
                {[1, 2, 3].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <p className="text-xs text-slate-500">Authors can never approve their own drafts, whatever this setting.</p>
              <button className="btn-primary" type="submit">Save</button>
            </form>
          </Card>
          <Card title="Services">
            <ul className="space-y-2 text-sm">
              {org.branches.map((b) => <li key={b.id}><strong>{b.name}</strong><div className="text-xs text-slate-500">{b.services.map((s) => s.serviceType.name).join(", ") || "No services recorded"}{b.cqcLocationId ? ` · CQC location ${b.cqcLocationId}` : ""}</div></li>)}
            </ul>
          </Card>
          <Card title="Platform configuration">
            <div className="grid grid-cols-1 gap-2">
              <Field label="AI provider">{ai ? `${ai.name}${ai.isSimulated ? " (simulated)" : ""}` : "Not configured"}</Field>
            </div>
          </Card>
        </div>
        <Card className="lg:col-span-2" title="Audit trail (latest 40)">
          <table className="table">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap text-xs">{fmtDate(l.createdAt, true)}</td>
                  <td className="text-xs">{l.actorId ? actors.get(l.actorId) ?? "user" : "system"}</td>
                  <td className="font-mono text-xs">{l.action}</td>
                  <td className="text-xs">{l.entityType}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
