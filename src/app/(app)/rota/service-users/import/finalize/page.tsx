import {notFound} from "next/navigation";
import {requirePortal} from "@/server/auth/portals";
import {hasOrgPermission} from "@/server/auth/rbac";
import {PageHeader,Card} from "@/components/ui";
import {CoordinatorRotaBuildForm} from "@/components/care-coordinator-build";
export const dynamic="force-dynamic";
export default async function CoordinatorFinalizePage({searchParams}:{searchParams:Promise<{id?:string}>}){
  const ctx=await requirePortal("rota");
  if(!hasOrgPermission(ctx,"care.plan.approve")||!hasOrgPermission(ctx,"rota.edit")) notFound();
  const id=(await searchParams).id;
  if(!id) return <PageHeader title="Select a service user" back="/rota/service-users" />;
  return <><PageHeader title="Care Coordinator — Authorised Rota Build" back={`/rota/service-users/${id}`} subtitle="Requires independently approved care plan and assessed risks. Never publishes or assigns carers automatically."/><Card><CoordinatorRotaBuildForm id={id}/></Card></>;
}
