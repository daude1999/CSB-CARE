import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { getAiProvider } from "@/server/ai";
import { updateBusinessDetailsAction, updateOrgSettingsAction } from "../../actions";
import { Card, Field, Flash, fmtDate } from "@/components/ui";
import { TitleBar } from "@/components/title-bar";
import { BusinessForm } from "@/components/business-form";
import { businessDetails } from "@/server/business";
import { missingDetails } from "@/lib/business";
import { Buildings, CheckCircle, Warning } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("admin");
  if (!hasOrgPermission(ctx, "org.manage")) notFound();
  const org = await db.organisation.findUniqueOrThrow({ where: { id: ctx.organisationId! }, include: { branches: { include: { services: { include: { serviceType: true } } } } } });
  const logs = await db.auditLog.findMany({ where: { organisationId: org.id }, orderBy: { createdAt: "desc" }, take: 40 });
  const actors = new Map((await db.user.findMany({ where: { id: { in: logs.map((l) => l.actorId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const settings = (org.settings ?? {}) as { requiredApprovals?: number };
  const ai = getAiProvider();
  const details = (await businessDetails(org.id))!;
  const missing = missingDetails(details);
  return (
    <>
      <TitleBar title="System Settings" back="/" />
      <div className="bg-[#f1f2f5] px-0 pb-6 pt-3">
      <Flash searchParams={sp} />
      <section id="business" aria-labelledby="business-heading" className="mb-4 scroll-mt-24 rounded-[3px] bg-white px-5 pb-5 pt-4">
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-200 pb-3">
          <Buildings size={26} weight="fill" aria-hidden="true" className="text-navy-900" />
          <div className="min-w-0 flex-1">
            <h2 id="business-heading" className="text-[19px] font-normal tracking-normal text-slate-800">Business details</h2>
            <p className="text-[13px] text-slate-600">Recorded once, used everywhere. These details fill the highlighted tags in every policy, form and Word or PDF download.</p>
          </div>
          {missing.length ? (
            <span className="flex items-center gap-1.5 rounded-full bg-[#fde1e3] px-3 py-1 text-[13px] text-[#a3242c]"><Warning size={15} weight="fill" aria-hidden="true" />{missing.length} required {missing.length === 1 ? "detail" : "details"} missing</span>
          ) : (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[13px] text-emerald-800"><CheckCircle size={15} weight="fill" aria-hidden="true" />Policies fully personalised</span>
          )}
        </div>
        <BusinessForm initial={details} action={updateBusinessDetailsAction} />
      </section>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3">
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
      </div>
    </>
  );
}
