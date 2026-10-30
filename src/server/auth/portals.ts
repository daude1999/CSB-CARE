import "server-only";
import { redirect } from "next/navigation";
import { PORTALS, type Portal, type PortalId } from "@/lib/portals";
import { requireCtx } from "./current";
import { hasOrgPermission, hasPlatformPermission, type Ctx, type OrgPermission } from "./rbac";

/** Who may open each portal. This is the only place the rule lives; menus and pages both ask it. */
export function canUsePortal(ctx: Ctx, id: PortalId): boolean {
  const platformAdmin = hasPlatformPermission(ctx, "sources.manage");
  switch (id) {
    case "overview":
    case "policy":
      return true;
    case "rota":
      return hasOrgPermission(ctx, "rota.view") || hasOrgPermission(ctx, "serviceUser.view") || hasOrgPermission(ctx, "finance.view") || hasOrgPermission(ctx, "visit.own");
    case "hr":
      return Boolean(ctx.organisationId && ctx.hrUserId);
    case "reporting":
      return hasOrgPermission(ctx, "report.view") || hasOrgPermission(ctx, "analytics.view") || platformAdmin;
    case "admin":
      return hasOrgPermission(ctx, "org.manage") || platformAdmin;
  }
}

/** The portals this person may open, each with the home page they can actually use (CSB staff outside an organisation have no System Settings). */
export function portalsFor(ctx: Ctx): Portal[] {
  return PORTALS.filter((p) => canUsePortal(ctx, p.id)).map((p) => {
    if (p.id === "admin" && !hasOrgPermission(ctx, "org.manage")) return { ...p, home: "/modules" };
    if (p.id === "rota") return { ...p, home: rotaHome(ctx) };
    if (p.id === "reporting" && !hasOrgPermission(ctx, "analytics.view")) return { ...p, home: "/reports" };
    return p;
  });
}

/** Where Rostering & Care Management opens for this person: coordinators get Today, carers their own visits. */
export function rotaHome(ctx: Ctx) {
  if (hasOrgPermission(ctx, "rota.view")) return "/rota";
  if (hasOrgPermission(ctx, "serviceUser.view")) return "/rota/service-users";
  if (hasOrgPermission(ctx, "finance.view")) return "/rota/finance";
  return "/carer";
}

/** Page guard: people outside a portal get the "no access" page, whatever address they typed. */
export async function requirePortal(id: PortalId): Promise<Ctx> {
  const ctx = await requireCtx();
  if (!canUsePortal(ctx, id)) redirect(`/no-access?portal=${id}`);
  return ctx;
}

/**
 * Page guard for Rostering & Care Management pages: the portal, then the page's own permission. People who may use the
 * portal but not this page (a carer, a finance officer) are sent to their own Rostering home instead of an error.
 */
export async function requireRotaPage(perm: OrgPermission = "rota.view"): Promise<Ctx> {
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, perm)) redirect(rotaHome(ctx));
  return ctx;
}
