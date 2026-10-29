import Hub from "@/hr/components/hub";
import { portalsFor, requirePortal } from "@/server/auth/portals";

export const dynamic = "force-dynamic";

export default async function HrPortal() {
  const ctx = await requirePortal("hr");
  const portals = portalsFor(ctx).map(({ id, name, code, summary, home, planned, colour }) => ({ id, name, code, summary, home, planned, colour }));
  return <Hub portals={portals} />;
}
