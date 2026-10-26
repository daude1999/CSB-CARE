import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { Empty, PageHeader, Stat, StatRow, fmtDate } from "@/components/ui";
import { RequirementsTable } from "@/components/requirements-table";

export const dynamic = "force-dynamic";

export default async function RequirementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireCtx();
  const reqs = await db.regulatoryRequirement.findMany({
    orderBy: { ref: "asc" },
    include: { source: { select: { name: true } }, _count: { select: { policyLinks: true, auditQuestions: true } } },
  });
  const verified = reqs.filter((r) => r.verificationStatus === "VERIFIED").length;
  const unmapped = reqs.filter((r) => !r._count.policyLinks).length;
  return (
    <>
      <PageHeader eyebrow="Compliance · what the law and guidance ask" title="Requirements Register" subtitle="Regulatory requirements mapped to policies, audit questions and training. Entries marked unverified have not yet been checked word-for-word against the official source by a qualified reviewer." />
      <StatRow>
        <Stat label="Requirements" value={reqs.length} hint="In the register" tone="violet" />
        <Stat label="Verified" value={verified} hint="Checked against the source" tone="green" />
        <Stat label="Unverified" value={reqs.length - verified} hint="Awaiting a qualified check" tone="amber" />
        <Stat label="No Policy Linked" value={unmapped} hint="Not yet covered by a policy" tone="rose" />
      </StatRow>
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
            simulated: r.isSimulated,
          }))}
        />
      ) : (
        <Empty>No requirements.</Empty>
      )}
    </>
  );
}
