import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { ACTIVITY_PAGE, securityAudit } from "@/server/platform/activity";
import { Filter, PxHeader, PxPagination, PxPanel, Toolbar } from "@/components/platform/ui";
import { AuditTable } from "@/components/platform/audit-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security Audit" };

const FILTERS: [string, string][] = [["", "All security events"], ["platform.customer", "Clients created, suspended, closed"], ["platform.member", "Invitations and resets by Evantix"], ["admin.member", "Changes by client administrators"], ["platform.roles", "Platform role changes"], ["platform.module", "Module changes"], ["platform.subscription", "Subscription changes"], ["platform.settings", "Platform settings"], ["platform.support", "Support access"], ["platform.account", "Account deactivation"], ["platform.session", "Sessions ended"], ["auth.password", "Passwords changed"]];

/** The security audit: read-only, filterable, and never showing passwords, links or secrets. */
export default async function SecurityAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const page = Number(sp.page ?? "1") || 1;
  const [{ entries, total }, orgs] = await Promise.all([
    securityAudit(ctx, { org: sp.org, action: sp.action, logins: sp.logins === "1", page }),
    db.organisation.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const params = { action: sp.action, org: sp.org, logins: sp.logins };
  return (
    <>
      <PxHeader title="Security Audit" description="Every account, permission, password, session, module, subscription, setting and support-access change: who, when, before and after, and why. The log cannot be edited or deleted, and never records passwords, links or secrets." />
      <PxPanel flush>
        <Toolbar label="Filter security events" clearHref="/platform-admin/security" active={Boolean(sp.action || sp.org || sp.logins)}>
          <Filter label="Event" grow><select name="action" defaultValue={sp.action ?? ""} className="input">{FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Filter>
          <Filter label="Organisation" grow><select name="org" defaultValue={sp.org ?? ""} className="input"><option value="">All organisations</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></Filter>
          <label className="flex h-9 items-center gap-2 text-[13.5px]"><input type="checkbox" name="logins" value="1" defaultChecked={sp.logins === "1"} />Include sign-ins</label>
        </Toolbar>
        <div className="px-4"><AuditTable entries={entries} /></div>
        <PxPagination page={page} pageSize={ACTIVITY_PAGE} total={total} base="/platform-admin/security" params={params} noun="event" />
      </PxPanel>
    </>
  );
}
