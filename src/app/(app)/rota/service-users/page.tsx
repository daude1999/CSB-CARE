import { requireRotaPage } from "@/server/auth/portals";
import { serviceUserActionPerms, serviceUserDirectory } from "@/server/care/service-users";
import { rotaLookups } from "@/server/rota/queries";
import { Flash, PageHeader } from "@/components/ui";
import { RotaTabs } from "@/components/rota-nav";
import { DIRECTORY_STATUSES, ServiceUserDirectory } from "@/components/service-user-directory";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * All Service Users: the directory, with Add New Service User and Update Existing Service User above the search and
 * View / Update on every row. The same component is shown on the Service User Management workspace.
 */
export default async function ServiceUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("serviceUser.view");
  const org = ctx.organisationId ? await db.organisation.findUnique({ where: { id: ctx.organisationId }, select: { isDemo: true } }) : null;
  const status = sp.status === "ALL" ? "ALL" : DIRECTORY_STATUSES.find((s) => s === sp.status) ?? "CURRENT";
  const [dir, lk] = await Promise.all([serviceUserDirectory(ctx, { q: sp.q, status, areaId: sp.area || undefined, page: Number(sp.page) || 1 }), rotaLookups(ctx)]);
  return (
    <>
      <PageHeader tabs={<RotaTabs ctx={ctx} ws="people" active="directory" />} title="Service Users" back="/rota" />
      <Flash searchParams={sp} />
      <ServiceUserDirectory dir={dir} sp={sp} areas={lk.areas} basePath="/rota/service-users" perms={serviceUserActionPerms(ctx)} demo={!!org?.isDemo} />
    </>
  );
}
