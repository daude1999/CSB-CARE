import { db } from "@/lib/db";
import { CompliancePageHeader, ModuleStat, ModuleStatRow } from "@/components/module-header";
import { ComplianceTabs } from "@/components/compliance-nav";
import { requireCtx } from "@/server/auth/current";
import { Empty, fmtDate } from "@/components/ui";
import { RequirementsTable } from "@/components/requirements-table";

export const dynamic = "force-dynamic";

export default async function RequirementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const reqs = await db.regulatoryRequirement.findMany({
    orderBy: { ref: "asc" },
    include: { source: { select: { name: true } }, _count: { select: { policyLinks: true, auditQuestions: true, trainingLinks: true } } },
  });
  const verified = reqs.filter((r) => r.verificationStatus === "VERIFIED").length;
  const unmapped = reqs.filter((r) => !r._count.policyLinks).length;
  return (
    <>
      <CompliancePageHeader tabs={<ComplianceTabs ctx={ctx} ws="regulatory" active="requirements" />} eyebrow="Compliance · what the law and guidance ask" title="Regulatory Monitoring" subtitle="Regulatory requirements mapped to policies, audit questions and training. Entries marked unverified have not yet been checked word-for-word against the official source by a qualified reviewer." />
      <ModuleStatRow>
        <ModuleStat label="Requirements" value={reqs.length} hint="In the register" tone="violet" />
        <ModuleStat label="Verified" value={verified} hint="Checked against the source" tone="green" />
        <ModuleStat label="Unverified" value={reqs.length - verified} hint="Awaiting a qualified check" tone="amber" />
        <ModuleStat label="No Policy Linked" value={unmapped} hint="Not yet covered by a policy" tone="rose" />
      </ModuleStatRow>
      {reqs.length ? (
        <RequirementsTable
          initialQuery={sp.q ?? ""}
          rows={reqs.map((r) => ({
            id: r.id,
            ref: r.ref,
            title: r.title,
            exactReference: r.exactReference,
            source: r.source.name,
            legalStatus: r.legalStatus,
            verification: r.verificationStatus,
            lastVerified: r.lastVerifiedAt ? fmtDate(r.lastVerifiedAt) : null,
            policies: r._count.policyLinks,
            auditQuestions: r._count.auditQuestions,
            training: r._count.trainingLinks,
            simulated: r.isSimulated,
          }))}
        />
      ) : (
        <Empty>No requirements.</Empty>
      )}
    </>
  );
}
