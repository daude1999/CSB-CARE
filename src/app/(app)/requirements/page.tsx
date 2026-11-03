import { db } from "@/lib/db";
import { CompliancePageHeader } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { requireCtx } from "@/server/auth/current";
import { requirementRegister } from "@/server/compliance/requirements";
import { RequirementsTable } from "@/components/requirements-table";

export const dynamic = "force-dynamic";

export default async function RequirementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const [reqs, services] = await Promise.all([requirementRegister(ctx), db.serviceType.findMany({ select: { code: true, name: true } })]);
  const serviceName = new Map(services.map((s) => [s.code, s.name]));
  return (
    <>
      <CompliancePageHeader
        tabs={<ComplianceTabs ctx={ctx} ws="regulatory" active="requirements" />}
        title="Regulatory Monitoring"
        subtitle="What the law and guidance ask, mapped to your policies, evidence and actions. Entries marked not yet verified have not been checked word-for-word against the official source by a qualified reviewer."
      />
      {reqs.length ? (
        <RequirementsTable
          initialQuery={sp.q ?? ""}
          rows={reqs.map((r) => ({
            id: r.id,
            ref: r.ref,
            title: r.title,
            exactReference: r.exactReference,
            source: r.source,
            legalStatus: r.legalStatus,
            applicability: r.serviceTypes.length ? r.serviceTypes.map((c) => serviceName.get(c) ?? c).join(", ") : "All services",
            verification: r.verification,
            policies: r.policies,
            evidence: r.evidence,
            openActions: r.openActions,
            simulated: r.simulated,
          }))}
        />
      ) : (
        <section className="pc-panel"><p className="pc-empty">No requirements are in the register yet.</p></section>
      )}
    </>
  );
}
