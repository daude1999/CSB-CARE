import Link from "@/components/link";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { fmtLondonDate } from "@/lib/london";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { orNotFound } from "@/server/auth/page-guard";
import { memberNames, rotaLookups, suName } from "@/server/rota/queries";
import { rotaSettings } from "@/server/rota/settings";
import { previewTemplateChanges } from "@/server/rota/templates";
import { applyTemplateChangesAction, duplicateTemplateAction, templateBulkAction, updateTemplateAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader } from "@/components/ui";
import { TemplateForm } from "@/components/template-form";

export const dynamic = "force-dynamic";

export default async function TemplatePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireRotaPage();
  const canEdit = hasOrgPermission(ctx, "rota.edit");
  const lk = await rotaLookups(ctx);
  const t = await orNotFound(
    db.visitTemplate.findFirst({ where: { id, organisationId: lk.scope.organisationId, ...(lk.scope.areaIds ? { areaId: { in: lk.scope.areaIds } } : {}) }, include: { tasks: true, serviceUser: { select: { id: true, firstName: true, lastName: true, preferredName: true } }, callType: { select: { name: true } } } }).then((x) => {
      if (!x) throw new NotFoundError("Template");
      return x;
    }),
  );
  const settings = await rotaSettings(db, lk.scope.organisationId);
  const preview = canEdit ? await previewTemplateChanges(ctx, t.id) : null;
  const history = await db.auditLog.findMany({ where: { organisationId: lk.scope.organisationId, entityType: "VisitTemplate", entityId: t.id }, orderBy: { createdAt: "desc" }, take: 20 });
  const names = await memberNames(ctx, history.map((h) => h.actorId));
  const back = `/rota/templates/${t.id}`;
  const toApply = preview?.impacts.filter((i) => i.apply) ?? [];
  const kept = preview?.impacts.filter((i) => !i.apply && i.change !== "no change") ?? [];

  return (
    <>
      <PageHeader
        title={`${suName(t.serviceUser)} · ${t.callType.name}`}
        back="/rota/templates"
        subtitle="Saving changes the pattern for weeks not yet built. Visits already built change only when you apply the change below, and visits changed by hand or already started are always left as they are."
        actions={canEdit ? (
          <>
            <form action={duplicateTemplateAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="templateId" value={t.id} /><button className="btn-secondary">Duplicate</button></form>
            <form action={templateBulkAction}><input type="hidden" name="back" value={back} /><input type="hidden" name="templateIds" value={t.id} /><button className="btn-secondary" name="kind" value={t.enabled ? "disable" : "enable"}>{t.enabled ? "Switch off" : "Switch on"}</button></form>
          </>
        ) : null}
      />
      <Flash searchParams={sp} />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card title={<span className="flex items-center gap-2">Template {t.enabled ? <Badge tone="green">Switched on</Badge> : <Badge>Switched off</Badge>} <span className="text-[13px] font-normal text-slate-500">version {t.version}</span></span>}>
          {canEdit ? (
            <TemplateForm action={updateTemplateAction} lk={lk} t={t} taskIds={t.tasks.map((x) => x.careTaskId)} back={back} cycleLength={settings.cycleLength} submit="Save template" />
          ) : (
            <p className="text-[14px] text-slate-600">You can view this template. Changing it needs rota editing rights.</p>
          )}
        </Card>
        <div className="space-y-3">
          {preview ? (
            <Card title="Built visits">
              {toApply.length ? (
                <>
                  <p className="mb-2 text-[14px]">{toApply.length} future visit{toApply.length === 1 ? "" : "s"} still follow{toApply.length === 1 ? "s" : ""} the old pattern.</p>
                  <ul className="mb-3 max-h-60 space-y-1 overflow-y-auto text-[13.5px]">
                    {toApply.map((i) => <li key={i.visitId}><Link href={`/rota/visits/${i.visitId}`}>{fmtLondonDate(i.date)}</Link> · {i.change}</li>)}
                  </ul>
                  <form action={applyTemplateChangesAction}>
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="templateId" value={t.id} />
                    <input type="hidden" name="version" value={t.version} />
                    <button className="btn-primary">Apply to {toApply.length} built visit{toApply.length === 1 ? "" : "s"}</button>
                  </form>
                  <p className="mt-2 text-[12.5px] text-slate-500">Every carer is re-checked at the new time. Visits a carer cannot do are listed as refused and left unchanged.</p>
                </>
              ) : (
                <Empty>All future built visits match this template.</Empty>
              )}
              {kept.length ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[14px] font-medium text-navy-900">{kept.length} left as they are</summary>
                  <ul className="mt-2 space-y-1 text-[13px]">{kept.map((i) => <li key={i.visitId}>{fmtLondonDate(i.date)}: {i.reason}</li>)}</ul>
                </details>
              ) : null}
            </Card>
          ) : null}
          <Card title="History">
            {history.length ? (
              <ol className="space-y-2 text-[13.5px]">
                {history.map((h) => <li key={h.id} className="border-l-2 border-slate-200 pl-3"><div className="font-medium">{h.action.replace("template.", "").replace(/_/g, " ")}</div><div className="text-slate-500">{names.get(h.actorId ?? "") ?? "System"} · {fmtDate(h.createdAt, true)}</div></li>)}
              </ol>
            ) : <Empty>No changes recorded yet.</Empty>}
          </Card>
        </div>
      </div>
    </>
  );
}
