import { redirect } from "next/navigation";
import { requirePortal } from "@/server/auth/portals";

export const dynamic = "force-dynamic";

/** Service users are part of Rostering & Care Management. The old address keeps working for people allowed in. */
export default async function ServiceUsersMoved() {
  await requirePortal("rota");
  redirect("/rota/service-users");
}
