import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { ACTIVITY_PAGE, securityAudit } from "@/server/platform/activity";
import { Pagination } from "@/components/ui";
import { PxHeader, PxPanel, pxPrimary, pxSecondary } from "@/components/platform/ui";
import { AuditTable } from "@/components/platform/audit-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security Audit" };

const FILTERS: [string, string][] = [["", "All security events"], ["platform.customer", "Clients created, suspended, closed"], ["platform.member", "Invitations and resets by Evantix"], ["admin.member", "Changes by client administrators"], ["platform.roles", "Platform role changes"], ["platform.module", "Module changes"], ["platform.subscription", "Subscription changes"], ["platform.settings", "Platform settings"], ["platform.support", "Support access"], ["platform.account", "Account deactivation"], ["platform.session", "Sessions ended"], ["auth.password", "Passwords changed"]];

export default async function SecurityAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const page = Number(sp.page ?? "1") || 1;
  const [{ entries, total }, orgs] = await Promise.all([
    securityAudit(ctx, { org: sp.org, action: sp.action, logins: sp.logins === "1", page }),
    db.organisation.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PxHeader title="Security Audit" description="Every account, permission, password, session, module, subscription, setting and support-access change, with who did it, when, before and after, and why. The log cannot be edited or deleted. Passwords, links and secrets are never recorded." />
      <form method="get" className="mb-4 grid grid-cols-1 gap-2 rounded-[8px] border border-[#e4e7ef] bg-white p-3 sm:grid-cols-2 lg:grid-cols-[repeat(2,minmax(0,1fr))_auto_auto]">
        <label><span className="label">Event</span><select name="action" defaultValue={sp.action ?? ""} className="input">{FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label><span className="label">Organisation</span><select name="org" defaultValue={sp.org ?? ""} className="input"><option value="">All</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
        <label className="flex items-end gap-2 pb-2 text-[13.5px]"><input type="checkbox" name="logins" value="1" defaultChecked={sp.logins === "1"} />Include sign-ins</label>
        <div className="flex items-end gap-2"><button className={pxPrimary}>Filter</button><Link href="/platform-admin/security" className={pxSecondary}>Clear</Link></div>
      </form>
      <PxPanel>
        <AuditTable entries={entries} />
        <Pagination page={page} pageSize={ACTIVITY_PAGE} total={total} base="/platform-admin/security" params={{ action: sp.action, org: sp.org, logins: sp.logins }} />
      </PxPanel>
    </>
  );
}
