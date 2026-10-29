import { notFound } from "next/navigation";
import Link from "@/components/link";
import { db } from "@/lib/db";
import { requirePortal } from "@/server/auth/portals";
import { hasOrgPermission } from "@/server/auth/rbac";
import { linkLoginAction, reconcileWorkforceAction, unlinkLoginAction } from "@/app/rota-actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function WorkforceAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("admin");
  if (!hasOrgPermission(ctx, "workforce.link")) notFound();
  const org = ctx.organisationId!;
  const [staff, members, lastRun] = await Promise.all([
    db.staffMember.findMany({ where: { organisationId: org }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, jobTitle: true, workEmail: true, employmentStatus: true, hrMissing: true, userId: true, linkedAt: true, projectedAt: true } }),
    db.membership.findMany({ where: { organisationId: org }, include: { user: { select: { id: true, name: true, email: true, deactivatedAt: true } } }, orderBy: { user: { name: "asc" } } }),
    db.auditLog.findFirst({ where: { organisationId: org, action: "workforce.projected" }, orderBy: { createdAt: "desc" } }),
  ]);
  const linked = staff.filter((s) => s.userId);
  const memberById = new Map(members.map((m) => [m.userId, m]));
  const linkedUsers = new Set(linked.map((s) => s.userId));
  const freeMembers = members.filter((m) => !linkedUsers.has(m.userId) && !m.user.deactivatedAt);
  const freeStaff = staff.filter((s) => !s.userId && s.employmentStatus !== "ARCHIVED" && !s.hrMissing);
  const missing = staff.filter((s) => s.hrMissing);
  // Same e-mail is shown as a hint only. Linking is always an explicit choice.
  const hint = new Map(freeStaff.map((s) => [s.id, freeMembers.find((m) => s.workEmail && m.user.email.toLowerCase() === s.workEmail.toLowerCase())?.user.name]));
  const back = "/admin/workforce";

  return (
    <>
      <PageHeader title="Workforce Sync & Logins" back="/settings" subtitle="HR & Workforce is the source of truth for staff. Every HR change updates the rota's staff list in the same save; re-check below repairs anything out of step. Staff are not sign-ins: a carer gets the carer app only when an administrator links their sign-in here." />
      <Flash searchParams={sp} />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-3">
          <Card title="Linked sign-ins">
            {linked.length ? (
              <table className="table">
                <thead><tr><th>Staff member</th><th>Sign-in</th><th>Linked</th><th /></tr></thead>
                <tbody>
                  {linked.map((s) => {
                    const m = memberById.get(s.userId!);
                    return (
                      <tr key={s.id}>
                        <td><Link href={`/rota/staff/${s.id}`}>{s.displayName}</Link><div className="text-[12.5px] text-slate-500">{s.jobTitle}</div></td>
                        <td>{m ? <>{m.user.name}<div className="text-[12.5px] text-slate-500">{m.user.email} · {m.roles.map((r) => r.toLowerCase().replace(/_/g, " ")).join(", ")}</div></> : "Not a member any more"}</td>
                        <td>{s.linkedAt ? fmtDate(s.linkedAt, true) : "—"}</td>
                        <td>
                          <form action={unlinkLoginAction} className="flex gap-2">
                            <input type="hidden" name="back" value={back} />
                            <input type="hidden" name="staffId" value={s.id} />
                            <input name="reason" required minLength={3} className="input w-40 py-1 text-[13.5px]" placeholder="Reason" aria-label={`Reason for unlinking ${s.displayName}`} />
                            <button className="btn-secondary py-1">Unlink</button>
                          </form>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <Empty>No sign-ins are linked to staff yet.</Empty>}
          </Card>
          <Card title="Staff without a sign-in">
            {freeStaff.length ? (
              <ul className="grid gap-x-6 gap-y-1 text-[14px] md:grid-cols-2">
                {freeStaff.map((s) => <li key={s.id}>{s.displayName} <span className="text-slate-500">· {s.jobTitle}</span>{hint.get(s.id) ? <span className="text-[12.5px] text-[#1d4f91]"> · same e-mail as {hint.get(s.id)}</span> : null}</li>)}
              </ul>
            ) : <Empty>Every active member of staff has a sign-in.</Empty>}
          </Card>
        </div>
        <div className="space-y-3">
          <Card title="Link a sign-in">
            <form action={linkLoginAction} className="space-y-2.5">
              <input type="hidden" name="back" value={back} />
              <label className="block"><span className="label">Member of staff (from HR)</span><select name="staffId" required className="input"><option value="">Choose…</option>{freeStaff.map((s) => <option key={s.id} value={s.id}>{s.displayName} · {s.jobTitle}</option>)}</select></label>
              <label className="block"><span className="label">Sign-in (organisation member)</span><select name="userId" required className="input"><option value="">Choose…</option>{freeMembers.map((m) => <option key={m.userId} value={m.userId}>{m.user.name} · {m.user.email}</option>)}</select></label>
              <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" name="grantCarerRole" defaultChecked className="h-4 w-4" /> Give the Carer role (their own visits only)</label>
              <label className="flex items-start gap-2 text-[14px]"><input type="checkbox" name="confirm" required className="mt-0.5 h-4 w-4" /> I have checked this sign-in belongs to this person</label>
              <button className="btn-primary">Link</button>
              <p className="text-[12.5px] text-slate-500">Matching e-mail addresses are never linked automatically. Every link and unlink is recorded.</p>
            </form>
          </Card>
          <Card title="HR sync">
            <p className="text-[14px]">{staff.length} staff records from HR{missing.length ? <>, <span className="text-[#a3242c]">{missing.length} no longer in HR</span></> : ""}.</p>
            <p className="text-[13px] text-slate-600">Last update from HR: {lastRun ? fmtDate(lastRun.createdAt, true) : "never"}.</p>
            {missing.length ? <p className="mt-1 text-[13px]">{missing.map((s) => s.displayName).join(", ")} <Badge tone="rose">cannot be booked</Badge></p> : null}
            <form action={reconcileWorkforceAction} className="mt-3"><input type="hidden" name="back" value={back} /><button className="btn-secondary">Re-check against HR now</button></form>
          </Card>
        </div>
      </div>
    </>
  );
}
