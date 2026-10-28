import { requirePortal } from "@/server/auth/portals";
import { PlannedPortal } from "@/components/portal-pages";

export const dynamic = "force-dynamic";

export default async function ServiceUsersPortal() {
  await requirePortal("service-users");
  return (
    <PlannedPortal
      id="service-users"
      description="Service Users will hold the people your agency supports: their details, contacts and families, care plans and risk assessments. Their visits will come from Rota & Visits and their care notes from the carer phone page, so each record is kept once."
      features={["Service user list with search and filters", "Contacts, next of kin and commissioners", "Care plan summary and review dates", "Risk assessments linked to the relevant policies"]}
      notIncluded="Medication records, personal budgets, and family or commissioner logins."
    />
  );
}
