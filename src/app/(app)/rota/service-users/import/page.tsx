import { notFound } from "next/navigation";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { PageHeader, Card } from "@/components/ui";
import { CareCoordinatorIntakeForm } from "@/components/care-coordinator-intake";

export const dynamic = "force-dynamic";
export default async function CareCoordinatorImportPage() {
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx,"serviceUser.edit") || !hasOrgPermission(ctx,"care.plan.edit") || !hasOrgPermission(ctx,"rota.edit") || !hasOrgPermission(ctx,"serviceUser.documents")) notFound();
  return <>
    <PageHeader title="Care Coordinator — Service User Import" back="/rota/service-users" subtitle="Create a new Assessment-stage profile, source documents, care plan draft, care package and recurring visits from a reviewed manifest." />
    <Card><CareCoordinatorIntakeForm /></Card>
  </>;
}
