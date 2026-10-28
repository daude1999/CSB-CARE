import "server-only";
import { redirect } from "next/navigation";
import { PORTALS, type Portal, type PortalId } from "@/lib/portals";
import { requireCtx } from "./current";
import { hasOrgPermission, hasPlatformPermission, type Ctx } from "./rbac";

/** Who may open each portal. This is the only place the rule lives; menus and pages both ask it. */
export function canUsePortal(ctx: Ctx, id: PortalId): boolean {
  const platformAdmin = hasPlatformPermission(ctx, "sources.manage");
  switch (id) {
    case "overview":
    case "policy":
      return true;
    case "service-users":
    case "rota":
      return hasOrgPermission(ctx, "operations.view");
    case "hr":
      return Boolean(ctx.organisationId && ctx.hrUserId);
    case "reporting":
      return hasOrgPermission(ctx, "report.view") || platformAdmin;
    case "admin":
      return hasOrgPermission(ctx, "org.manage") || platformAdmin;
  }
}

export function portalsFor(ctx: Ctx): Portal[] {
  return PORTALS.filter((p) => canUsePortal(ctx, p.id));
}

/** Page guard: people outside a portal get the "no access" page, whatever address they typed. */
export async function requirePortal(id: PortalId): Promise<Ctx> {
  const ctx = await requireCtx();
  if (!canUsePortal(ctx, id)) redirect(`/no-access?portal=${id}`);
  return ctx;
}
