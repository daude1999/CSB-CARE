import { redirect } from "next/navigation";
import { requireRotaPage } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { rotaLookups, suName } from "@/server/rota/queries";
import { createRiskAction } from "@/app/rota-actions";
import { Card, Flash, PageHeader } from "@/components/ui";
import { RiskFields } from "@/components/risk-fields";

export const dynamic = "force-dynamic";

export default async function NewRiskPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage("serviceUser.view");
  if (!hasOrgPermission(ctx, "care.plan.edit")) redirect("/rota/risks");
  const lk = await rotaLookups(ctx);
  return (
    <>
      <PageHeader title="New risk assessment" back={`/rota/risks${sp.su ? `?su=${sp.su}` : ""}`} subtitle="Record the hazard, the controls carers follow and the level that remains with those controls in place." />
      <Flash searchParams={sp} />
      <Card>
        <form action={createRiskAction} className="space-y-3">
          <input type="hidden" name="back" value={`/rota/risks/new${sp.su ? `?su=${sp.su}` : ""}`} />
          <label className="block max-w-md"><span className="label">Person</span>
            <select name="serviceUserId" defaultValue={sp.su ?? ""} required className="input"><option value="" disabled>Choose…</option>{lk.serviceUsers.map((s) => <option key={s.id} value={s.id}>{suName(s)}</option>)}</select>
          </label>
          <RiskFields />
          <button className="btn-primary">Save assessment</button>
        </form>
      </Card>
    </>
  );
}
