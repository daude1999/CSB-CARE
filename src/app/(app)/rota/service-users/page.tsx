import { requireRotaPage } from "@/server/auth/portals";
import { serviceUserActionPerms, serviceUserDirectory } from "@/server/care/service-users";
import { rotaLookups } from "@/server/rota/queries";
import { Flash, PageHeader } from "@/components/ui";
import { RotaTabs } from "@/components/rota-nav";
import { DIRECTORY_STATUSES, ServiceUserDirectory } from "@/components/service-user-directory";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * All Service Users: the one service-user workspace (owner's approved design, 7 Nov 2026). Add New and Update
 * Existing dropdowns, the search and filter toolbar, and the directory with View / Update on every row. The old
 * Service User Management address redirects here.
 */
export default async function ServiceUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("serviceUser.view");
  const org = ctx.organisationId ? await db.organisation.findUnique({ where: { id: ctx.organisationId }, select: { isDemo: true } }) : null;
  const status = sp.status === "ALL" || sp.status === "ARCHIVED" ? sp.status : DIRECTORY_STATUSES.find((s) => s === sp.status) ?? "CURRENT";
  const lk = await rotaLookups(ctx);
  // Only a branch or area the member may see is passed on; anything else is ignored rather than trusted.
  const branchId = sp.branch && lk.branches.some((b) => b.id === sp.branch) ? sp.branch : undefined;
  const areaId = sp.area && lk.areas.some((a) => a.id === sp.area) ? sp.area : undefined;
  const dir = await serviceUserDirectory(ctx, { q: sp.q, status, areaId, branchId, page: Number(sp.page) || 1 });
  return (
    <>
      <PageHeader tabs={<RotaTabs ctx={ctx} ws="people" active="directory" />} title="All Service Users" subtitle={`Manage service users, add new referrals and update existing records.${org?.isDemo ? " All names in the demo are fictional." : ""}`} back={null} />
      <Flash searchParams={sp} />
      <ServiceUserDirectory dir={dir} sp={{ q: sp.q, status: sp.status, area: areaId, branch: branchId }} areas={lk.areas} branches={lk.branches} basePath="/rota/service-users" perms={serviceUserActionPerms(ctx)} demo={!!org?.isDemo} />
    </>
  );
}
