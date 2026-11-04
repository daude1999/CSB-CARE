import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rotaLookups } from "@/server/rota/queries";
import { rotaSettings } from "@/server/rota/settings";
import { createTemplateAction } from "@/app/rota-actions";
import { Card, Flash, PageHeader } from "@/components/ui";
import { TemplateForm } from "@/components/template-form";

export const dynamic = "force-dynamic";

export default async function NewTemplatePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("rota");
  if (!hasOrgPermission(ctx, "rota.edit")) notFound();
  const lk = await rotaLookups(ctx);
  const settings = await rotaSettings(db, lk.scope.organisationId);
  // Opened from a service user's profile: choose them already, but only someone this member may see.
  const su = sp.su && lk.serviceUsers.some((s) => s.id === sp.su) ? sp.su : undefined;
  return (
    <>
      <PageHeader title="New rota template" back={su ? `/rota/service-users/${su}?tab=template` : "/rota/templates"} subtitle="A repeating visit for one person. The carers you choose are checked again every time the week is built." />
      <Flash searchParams={sp} />
      <Card><TemplateForm action={createTemplateAction} lk={lk} back={su ? `/rota/templates/new?su=${su}` : "/rota/templates/new"} cycleLength={settings.cycleLength} submit="Create template" serviceUserId={su} /></Card>
    </>
  );
}
