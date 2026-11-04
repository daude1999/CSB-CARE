import { notFound } from "next/navigation";
import Link from "@/components/link";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { getServiceUser } from "@/server/care/service-users";
import { db } from "@/lib/db";
import { fromDbDate } from "@/lib/london";
import { PageHeader, Card } from "@/components/ui";
import { RISK_TYPE_LABEL } from "@/server/care/risks";

export const dynamic="force-dynamic";
/** Read-only queue: draft risks must never silently become active clinical guidance. */
export default async function CoordinatorRiskDrafts({searchParams}:{searchParams:Promise<{id?:string}>}){
  const ctx=await requirePortal("rota");
  if(!ctx.organisationId || !hasOrgPermission(ctx,"care.plan.approve")) notFound();
  const id=(await searchParams).id;
  if(!id) notFound();
  const su=await getServiceUser(ctx,id);
  const risks=await db.riskAssessment.findMany({where:{organisationId:ctx.organisationId,serviceUserId:su.id,status:"DRAFT"},orderBy:{assessedAt:"asc"}});
  return <>
    <PageHeader title="Care Coordinator — Draft Risk Review" back={`/rota/service-users/${id}?tab=risks`} subtitle="Confidential read-only proposals awaiting competent independent review."/>
    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">These assessments are DRAFTS and must not be used as approved care instructions. Activation is disabled pending completion and testing of the manager review workflow.</div>
    {risks.length===0?<Card>No outstanding AI risk drafts.</Card>:null}
    {risks.map(r=><Card key={r.id} title={r.title}>
      <dl className="space-y-2 text-sm">
        <div><dt className="font-semibold">Category</dt><dd>{RISK_TYPE_LABEL[r.type]}</dd></div>
        <div><dt className="font-semibold">Hazards</dt><dd className="whitespace-pre-wrap">{r.hazards}</dd></div>
        <div><dt className="font-semibold">Proposed controls — not approved</dt><dd className="whitespace-pre-wrap">{r.controls}</dd></div>
        <div><dt className="font-semibold">Provisional level</dt><dd>{r.level}</dd></div>
        <div><dt className="font-semibold">Review due</dt><dd>{fromDbDate(r.reviewDue)}</dd></div>
        <div><dt className="font-semibold">Unresolved actions</dt><dd className="whitespace-pre-wrap">{r.requiredActions||"None recorded"}</dd></div>
        <div><dt className="font-semibold">Responsible person</dt><dd>{r.responsiblePerson||"Not recorded"}</dd></div>
      </dl>
    </Card>)}
    <Link href={`/rota/service-users/${id}?tab=risks`} className="underline text-sm">Back to service user</Link>
  </>;
}
