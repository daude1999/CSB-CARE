import { notFound } from "next/navigation";
import Link from "@/components/link";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { getServiceUser } from "@/server/care/service-users";
import { db } from "@/lib/db";
import { PageHeader, Card } from "@/components/ui";
export const dynamic="force-dynamic";
export default async function CoordinatorReviewQueue({searchParams}:{searchParams:Promise<{id?:string}>}) {
  const ctx=await requirePortal("rota");
  if(!ctx.organisationId || !hasOrgPermission(ctx,"serviceUser.sensitive")) notFound();
  const id=(await searchParams).id;
  if(!id) notFound();
  const su=await getServiceUser(ctx,id);
  const items=await db.careIntakeReviewItem.findMany({
    where:{organisationId:ctx.organisationId,serviceUserId:su.id},
    orderBy:{createdAt:"asc"},
  });
  return <>
    <PageHeader title="Care Coordinator — Confidential Review Queue" back={`/rota/service-users/${id}`} subtitle="Outstanding clinical, medication and risk questions from imported documents. No treatment or medication changes are authorised here." />
    {items.length===0?<Card>No imported follow-up items recorded.</Card>:null}
    {items.map(item=><Card key={item.id} title={item.category==="CLINICAL"?"Clinical review":item.category==="RISK"?"Risk assessment review":"Follow-up"}>
      <p className="text-sm whitespace-pre-wrap">{item.description}</p>
      <p className="mt-2 text-xs text-slate-600">Status: {item.status}. Requires competent human verification. This view cannot approve clinical actions.</p>
    </Card>)}
    <p className="text-sm"><Link className="underline" href={`/rota/service-users/${id}`}>Return to service user</Link></p>
  </>;
}
