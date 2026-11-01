import { notFound, redirect } from "next/navigation";
import { requireCtx } from "@/server/auth/current";
import { workspaceHome } from "@/components/compliance-nav";

/** Audits & Improvements opens on the first of its tabs this person may use (audits, actions, risks, evidence). */
export default async function AuditsAndImprovements() {
  const ctx = await requireCtx();
  const home = ctx.organisationId ? workspaceHome(ctx, "improvements") : null;
  if (!home) notFound();
  redirect(home);
}
