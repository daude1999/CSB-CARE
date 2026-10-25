import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { Badge, Card, Empty, fmtDate, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  const ctx = await requireCtx();
  if (!hasOrgPermission(ctx, "staff.view")) notFound();
  const orgId = ctx.organisationId!;
  const now = new Date();
  const [members, acks, training] = await Promise.all([
    db.membership.findMany({ where: { organisationId: orgId }, include: { user: { select: { id: true, name: true, email: true } }, branch: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    db.acknowledgement.findMany({ where: { organisationId: orgId }, select: { userId: true, acknowledgedAt: true, dueAt: true } }),
    db.trainingRecord.findMany({ where: { organisationId: orgId }, include: { training: { select: { title: true } } }, orderBy: { completedAt: "desc" } }),
  ]);
  return (
    <>
      <PageHeader title="Staff & Training" subtitle="Policy acknowledgement and training status for each member of staff, calculated from recorded acknowledgements and training records." />
      <Card>
        {members.length ? (
          <table className="table">
            <thead><tr><th>Name</th><th>Roles</th><th>Branch</th><th>Acknowledgements</th><th>Training</th></tr></thead>
            <tbody>
              {members.map((m) => {
                const mine = acks.filter((a) => a.userId === m.userId);
                const outstanding = mine.filter((a) => !a.acknowledgedAt);
                const overdue = outstanding.filter((a) => a.dueAt && a.dueAt < now);
                const tr = training.filter((t) => t.userId === m.userId);
                return (
                  <tr key={m.id}>
                    <td>{m.user.name}<div className="text-xs text-slate-400">{m.user.email}{m.jobTitle ? ` · ${m.jobTitle}` : ""}</div></td>
                    <td className="text-xs">{m.roles.map((r) => r.replace(/_/g, " ").toLowerCase()).join(", ")}</td>
                    <td className="text-xs">{m.branch?.name ?? "—"}</td>
                    <td className="text-xs">{mine.length - outstanding.length} of {mine.length} done {overdue.length ? <Badge tone="rose">{overdue.length} overdue</Badge> : null}</td>
                    <td className="text-xs">
                      {tr.length ? tr.map((t) => <div key={t.id}>{t.training.title}: {fmtDate(t.completedAt)}{t.expiresAt ? (t.expiresAt < now ? <Badge tone="rose">expired {fmtDate(t.expiresAt)}</Badge> : ` (expires ${fmtDate(t.expiresAt)})`) : ""}</div>) : "No records"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <Empty>No staff.</Empty>
        )}
      </Card>
    </>
  );
}
