import { notFound } from "next/navigation";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rotaLookups } from "@/server/rota/queries";
import { getAiProvider } from "@/server/ai";
import { COUNCIL_CATEGORIES, OTHER_CATEGORIES } from "@/server/care/su-documents";
import { Flash, PageHeader } from "@/components/ui";
import { SuImportWizard } from "@/components/su-import-wizard";

export const dynamic = "force-dynamic";

/** Set up a service user from a council support plan: upload, check and correct, confirm. */
export default async function ImportServiceUserPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, "serviceUser.edit") || !hasOrgPermission(ctx, "rota.edit") || !hasOrgPermission(ctx, "serviceUser.documents")) notFound();
  const lk = await rotaLookups(ctx);
  const provider = getAiProvider();
  const canRead = !!provider?.extractSupportPlan;
  return (
    <>
      <PageHeader title="Set up from support plan" back="/rota/service-users" subtitle="Upload the council support plan, check what was read from it, correct anything wrong, then confirm. The person, their contacts, care package, repeating visits and documents are created together, ready for Build Rota." />
      <Flash searchParams={sp} />
      <SuImportWizard
        areas={lk.areas.map((a) => ({ id: a.id, name: a.name }))}
        callTypes={lk.callTypes.map((c) => ({ id: c.id, name: c.name }))}
        councilCategories={COUNCIL_CATEGORIES.map((c) => ({ key: c.key, label: c.label, sensitive: !!c.sensitive }))}
        otherCategories={OTHER_CATEGORIES.map((c) => ({ key: c.key, label: c.label, sensitive: !!c.sensitive }))}
        sensitive={hasOrgPermission(ctx, "serviceUser.sensitive")}
        reading={canRead ? { available: true, simulated: !!provider?.isSimulated } : { available: false, reason: provider ? "The configured AI provider cannot read documents, so type the details in from the plan." : "AI is switched off for this organisation, so type the details in from the plan." }}
      />
    </>
  );
}
