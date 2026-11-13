import { notFound } from "next/navigation";
import { CompliancePageHeader } from "@/components/module-header";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { ACK_NOT_TRAINING, ackTimeline, signoffCounts, signoffRows } from "@/server/policies/assignment";
import { memberNames } from "@/server/rota/queries";
import { AckBadge, AckTimeline, personKey } from "@/components/signoff-ui";
import { Card, Empty, fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

/** One person's reading record: every policy version assigned to them, its state and its full event history. */
export default async function PersonSignoffPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "staff.view")) notFound();
  // The rows are already limited to the caller's organisation and branches; a person outside them has none and 404s.
  const rows = (await signoffRows(ctx)).filter((r) => personKey(r) === key);
  if (!rows.length) notFound();
  const r0 = rows[0]!;
  const events = await ackTimeline(ctx, rows.map((r) => r.id));
  const names = await memberNames(ctx, events.map((e) => e.actorId));
  const c = signoffCounts(rows);
  const staff = r0.staffMemberId ? await db.staffMember.findFirst({ where: { id: r0.staffMemberId, organisationId: ctx.organisationId! }, select: { id: true } }) : null;

  return (
    <>
      <CompliancePageHeader title={r0.person} back="/staff" subtitle={`${r0.staffMember?.jobTitle ?? "Office member"}${r0.staffMember?.branch ? ` · ${r0.staffMember.branch.name}` : ""} · ${r0.user ? `signs in as ${r0.user.email}` : "no sign-in linked, so cannot acknowledge yet"}. ${c.acknowledged} of ${c.total - c.exempted} acknowledged, ${c.overdue} overdue. ${ACK_NOT_TRAINING}`} actions={staff && hasOrgPermission(ctx, "readiness.view") ? <Link href={`/rota/staff/${staff.id}`} className="btn-secondary">Readiness and training</Link> : null} />
      <Card>
        {rows.length ? (
          <ul className="rows">
            {rows.map((r) => (
              <li key={r.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><Link href={`/staff/policy/${r.publication.policyId}`} className="row-title">{r.publication.policy.ref} {r.publication.policy.title}</Link> <span className="text-[13px] text-slate-600">{r.publication.version.label} · {r.mandatory ? "mandatory" : "optional"} · due {fmtDate(r.dueAt)}</span></div>
                  <AckBadge bucket={r.b.bucket} overdue={r.b.overdue} cannotSign={r.b.cannotSign} />
                </div>
                {r.wording ? <p className="mt-1 text-[13px] text-slate-700">Agreed {fmtDate(r.acknowledgedAt, true)}: “{r.wording}”</p> : null}
                <div className="mt-1.5"><AckTimeline events={events.filter((e) => e.acknowledgementId === r.id)} names={names} /></div>
              </li>
            ))}
          </ul>
        ) : <Empty>Nothing assigned.</Empty>}
      </Card>
    </>
  );
}
