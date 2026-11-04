import { notFound } from "next/navigation";
import Link from "@/components/link";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { getServiceUser } from "@/server/care/service-users";
import { db } from "@/lib/db";
import { fromDbDate } from "@/lib/london";
import { Flash,PageHeader,Card } from "@/components/ui";
import { RISK_TYPE_LABEL } from "@/server/care/risks";
import { approveCoordinatorRiskAction } from "@/app/care-coordinator-risk-actions";

export const dynamic="force-dynamic";
export default async function CoordinatorRiskReviewPage({searchParams}:{searchParams:Promise<{id?:string;ok?:string;error?:string}>}){
  const ctx=await requirePortal("rota");
  if(!ctx.organisationId || !hasOrgPermission(ctx,"care.plan.approve")) notFound();
  const sp=await searchParams, id=sp.id;
  if(!id) notFound();
  const su=await getServiceUser(ctx,id);
  const risks=await db.riskAssessment.findMany({where:{organisationId:ctx.organisationId,serviceUserId:su.id,status:"DRAFT"},orderBy:{assessedAt:"asc"}});
  return <>
    <PageHeader title="Care Coordinator — Risk Draft Review" back={`/rota/service-users/${id}?tab=risks`} subtitle="An independent manager must review each proposed hazard, control, risk level and review date before activation." />
    <Flash searchParams={sp} />
    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">These are proposed assessments, NOT care instructions. Verify the original documents and obtain clinical or moving-and-handling advice where required. Never approve a control you cannot substantiate.</div>
    {risks.length===0?<Card>No draft risk assessments awaiting approval.</Card>:null}
    {risks.map(r=><Card key={r.id} title={r.title}>
      <form action={approveCoordinatorRiskAction} className="space-y-3">
        <input name="riskId" type="hidden" value={r.id}/>
        <input name="version" type="hidden" value={r.version}/>
        <input name="back" type="hidden" value={`/rota/service-users/import/risks?id=${id}`}/>
        <label className="block"><span className="label">Category</span><select name="type" className="input" defaultValue={r.type}>{Object.entries(RISK_TYPE_LABEL).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
        <label className="block"><span className="label">Title</span><input name="title" className="input w-full" required defaultValue={r.title}/></label>
        <label className="block"><span className="label">Hazards and possible harm</span><textarea name="hazards" rows={4} className="input w-full" required defaultValue={r.hazards}/></label>
        <label className="block"><span className="label">Verified control measures</span><textarea name="controls" rows={4} className="input w-full" required defaultValue={r.controls}/></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Manager-assessed risk level</span><select name="level" className="input" defaultValue={r.level}><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option></select></label>
          <label className="block"><span className="label">Review by</span><input type="date" name="reviewDue" className="input" required defaultValue={fromDbDate(r.reviewDue)} /></label>
        </div>
        <label className="block"><span className="label">Outstanding actions</span><textarea name="requiredActions" rows={2} className="input w-full" defaultValue={r.requiredActions||""}/></label>
        <label className="block"><span className="label">Responsible person (required if actions outstanding)</span><input name="responsiblePerson" className="input w-full" defaultValue={r.responsiblePerson||""}/></label>
        {r.assessedById===ctx.userId ? <p className="text-amber-800 text-sm">You authored this draft. A different authorised manager must approve it.</p> :
          <button className="btn-primary">Approve this reviewed risk assessment</button>}
      </form>
    </Card>)}
    <p className="text-sm"><Link href={`/rota/service-users/${id}?tab=risks`} className="underline">Return to the service user's risk register</Link></p>
  </>;
}
