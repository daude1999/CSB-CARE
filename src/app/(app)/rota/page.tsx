import { requirePortal } from "@/server/auth/portals";
import { PlannedPortal } from "@/components/portal-pages";

export const dynamic = "force-dynamic";

export default async function RotaPortal() {
  await requirePortal("rota");
  return (
    <PlannedPortal
      id="rota"
      description="Rota & Visits will plan care visits for each week, match carers to the people they support, and show when each visit started and finished. It will use the same staff records as HR & Workforce and the same service users as the Service Users portal."
      features={["Weekly rota by carer and by service user", "Warnings when a carer's checks or training are out of date", "Unassigned visits shown in red", "Visit log from the carer phone page (location simulated in the demo)"]}
      notIncluded="Real GPS, route planning and travel times, payroll export."
    />
  );
}
