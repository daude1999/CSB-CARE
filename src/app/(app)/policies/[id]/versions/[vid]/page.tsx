import Link from "@/components/link";
import { CompliancePageHeader } from "@/components/module-header";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { orNotFound } from "@/server/auth/page-guard";
import { getPolicy } from "@/server/policies/library";
import { Badge, Card, fmtDate, SimulatedBadge, StatusBadge } from "@/components/ui";

export default async function VersionPage({ params }: { params: Promise<{ id: string; vid: string }> }) {
  const { id, vid } = await params;
  const ctx = await requireCtx();
  const p = await orNotFound(getPolicy(ctx, id));
  const v = await db.policyVersion.findUnique({ where: { id: vid }, include: { sections: { orderBy: { position: "asc" } }, approvals: true, publication: true } });
  if (!v || v.policyId !== p.id) notFound();
  const users = await db.user.findMany({ where: { id: { in: v.approvals.map((a) => a.deciderId) } } });
  return (
    <>
      <CompliancePageHeader back={`/policies/${p.id}`} title={`${p.ref} ${p.title}: ${v.label}`} subtitle={v.changeSummary ?? undefined} actions={<Link className="btn-secondary" href={`/policies/${p.id}`}>Back to policy</Link>} />
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="mb-4 flex flex-wrap gap-2"><StatusBadge status={v.status} /><Badge>{v.origin.replace(/_/g, " ").toLowerCase()}</Badge><SimulatedBadge show={v.isSimulated} /></div>
          {v.sections.map((s) => (
            <section key={s.key} className="mb-4">
              <h3>{s.heading}</h3>
              <p className="prose-policy">{s.body}</p>
            </section>
          ))}
        </Card>
        <Card title="Record">
          <dl className="space-y-2 text-sm">
            <div><dt className="label">Reason</dt><dd>{v.reasonForChange ?? "—"}</dd></div>
            <div><dt className="label">Created</dt><dd>{fmtDate(v.createdAt, true)}</dd></div>
            <div><dt className="label">Approved</dt><dd>{fmtDate(v.approvedAt, true)}</dd></div>
            <div><dt className="label">Published</dt><dd>{fmtDate(v.publishedAt, true)}</dd></div>
            <div><dt className="label">Effective</dt><dd>{fmtDate(v.effectiveDate)}</dd></div>
            <div><dt className="label">Superseded</dt><dd>{fmtDate(v.supersededAt, true)}</dd></div>
            <div><dt className="label">Content hash</dt><dd className="break-all font-mono text-xs">{v.contentHash}</dd></div>
            <div>
              <dt className="label">Decisions</dt>
              <dd>
                {v.approvals.length ? v.approvals.map((a) => <div key={a.id} className="text-xs">{a.decision} by {users.find((u) => u.id === a.deciderId)?.name} ({a.role.toLowerCase()}), {fmtDate(a.createdAt, true)}: “{a.comment}”</div>) : v.origin === "SEED" ? "No approval record (seeded content)" : "None"}
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </>
  );
}
