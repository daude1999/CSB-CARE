import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { Badge, Card, Empty, PageHeader, SimulatedBadge, StatusBadge, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function RequirementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  await requireCtx();
  const reqs = await db.regulatoryRequirement.findMany({
    where: sp.q ? { OR: [{ title: { contains: sp.q, mode: "insensitive" } }, { ref: { contains: sp.q, mode: "insensitive" } }, { exactReference: { contains: sp.q, mode: "insensitive" } }] } : {},
    orderBy: { ref: "asc" },
    include: { source: { select: { name: true } }, _count: { select: { policyLinks: true, auditQuestions: true } } },
  });
  return (
    <>
      <PageHeader eyebrow="Compliance · what the law and guidance ask" title="Requirements Register" subtitle="Regulatory requirements mapped to policies, audit questions and training. Entries marked unverified have not yet been checked word-for-word against the official source by a qualified reviewer." />
      <form className="mb-4 flex gap-2" role="search">
        <input className="input w-72" name="q" defaultValue={sp.q} placeholder="Search requirements" aria-label="Search requirements" />
        <button className="btn-secondary" type="submit">Search</button>
      </form>
      <Card>
        {reqs.length ? (
          <table className="table">
            <thead><tr><th>Ref</th><th>Requirement</th><th>Reference</th><th>Source</th><th>Legal status</th><th>Verification</th><th>Last verified</th><th>Mapped</th></tr></thead>
            <tbody>
              {reqs.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs">{r.ref}</td>
                  <td><Link href={`/requirements/${r.id}`}>{r.title}</Link> <SimulatedBadge show={r.isSimulated} /></td>
                  <td className="text-xs">{r.exactReference}</td>
                  <td className="text-xs">{r.source.name}</td>
                  <td className="text-xs">{r.legalStatus.replace(/_/g, " ").toLowerCase()}</td>
                  <td><StatusBadge status={r.verificationStatus === "VERIFIED" ? "VERIFIED_REQ" : r.verificationStatus} /></td>
                  <td className="text-xs">{fmtDate(r.lastVerifiedAt)}</td>
                  <td className="text-xs"><Badge>{r._count.policyLinks} policies</Badge> <Badge>{r._count.auditQuestions} audit Qs</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>No requirements.</Empty>
        )}
      </Card>
    </>
  );
}
