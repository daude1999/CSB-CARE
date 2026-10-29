import { notFound } from "next/navigation";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rotaLookups } from "@/server/rota/queries";
import { createServiceUserAction } from "@/app/rota-actions";
import { Card, Flash, PageHeader } from "@/components/ui";
import { ServiceUserForm } from "@/components/service-user-form";

export const dynamic = "force-dynamic";

export default async function NewServiceUserPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, "serviceUser.edit")) notFound();
  const lk = await rotaLookups(ctx);
  return (
    <>
      <PageHeader title="Add service user" back="/rota/service-users" subtitle="New people start at Assessment. Visits can be planned once their care is Active." />
      <Flash searchParams={sp} />
      <Card><ServiceUserForm action={createServiceUserAction} areas={lk.areas} back="/rota/service-users/new" sensitive={hasOrgPermission(ctx, "serviceUser.sensitive")} submit="Add service user" /></Card>
    </>
  );
}
