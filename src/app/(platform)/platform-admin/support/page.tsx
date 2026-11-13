import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { listSupportGrants, SUPPORT_SCOPES } from "@/server/platform/support";
import { fmtDate } from "@/components/ui";
import { Back, Confirm, EmptyState, Pill, PxFlash, PxHeader, PxPanel, pxDanger, ReasonField, Table, Tabs } from "@/components/platform/ui";
import { revokeSupportAction } from "@/app/platform-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Support Access" };

const VIEWS = [["open", "Active and waiting"], ["all", "All"]] as const;

/** Time-limited, purpose-bound support access to clients. No impersonation and no service-user records. */
export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const grants = await listSupportGrants(ctx);
  const view = sp.view === "all" ? "all" : "open";
  const open = grants.filter((g) => g.state === "ACTIVE" || g.state === "REQUESTED");
  const rows = view === "all" ? grants : open;
  return (
    <>
      <PxHeader title="Support Access" description="Ask a client for access from its workspace (Security tab). Access is time-limited, purpose-bound and covers configuration and the activity log only. There is no impersonation and no access to service-user records." />
      <PxFlash searchParams={sp} />
      <Tabs label="Support access views" items={VIEWS.map(([v, l]) => ({ href: `/platform-admin/support${v === "open" ? "" : "?view=all"}`, label: l, active: v === view, count: v === "open" ? open.length : grants.length }))} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <PxPanel flush>
          {rows.length ? (
            <div className="px-4">
              <Table label="Support access" minWidth={900} head={["Client", "Requested", "Purpose", "Scope", "Authorised", "State", ""]}>
                {rows.map((g) => (
                  <tr key={g.id}>
                    <td><Link href={`/platform-admin/clients/${g.organisation.id}?tab=security`}>{g.organisation.name}</Link></td>
                    <td className="whitespace-nowrap tabular-nums">{fmtDate(g.createdAt, true)}<span className="block text-caption text-px-subtle">{g.requestedBy}</span></td>
                    <td className="max-w-[240px]">{g.purpose}</td>
                    <td className="text-meta">{g.scopes.map((s) => s.toLowerCase().replace("_", " ")).join(", ")}</td>
                    <td className="text-meta">{g.authorisation === "EMERGENCY" ? "Emergency" : g.decidedBy ? `Client: ${g.decidedBy}` : "Waiting"}</td>
                    <td><Pill value={g.state} />{g.expiresAt && g.state === "ACTIVE" ? <span className="block text-caption text-px-subtle">until {fmtDate(g.expiresAt, true)}</span> : null}{g.revokedBy ? <span className="block text-caption text-px-subtle">by {g.revokedBy}</span> : null}</td>
                    <td className="text-right">{g.state === "ACTIVE" || g.state === "REQUESTED" ? <Confirm label="Revoke" tone="danger" small><form action={revokeSupportAction} className="space-y-2 text-left"><Back value={`/platform-admin/support${view === "all" ? "?view=all" : ""}`} /><input type="hidden" name="grantId" value={g.id} /><ReasonField /><button className={pxDanger}>Revoke access</button></form></Confirm> : null}</td>
                  </tr>
                ))}
              </Table>
            </div>
          ) : (
            <EmptyState title={view === "open" ? "No active or waiting support access" : "No support access requested yet"} action={view === "open" && grants.length ? <Link href="/platform-admin/support?view=all">See all requests</Link> : <Link href="/platform-admin/clients">Open a client</Link>}>Request access from a client&apos;s Security tab when you need to help them.</EmptyState>
          )}
        </PxPanel>
        <PxPanel title="How it works">
          <ol className="list-decimal space-y-2 pl-5 text-meta text-px-body">
            <li>On the client&apos;s Security tab, say why support needs access and to what: {Object.values(SUPPORT_SCOPES).join("; ")}.</li>
            <li>The client&apos;s administrators approve or decline it from their bell or Settings.</li>
            <li>Access ends by itself after the hours asked. Either side can revoke it sooner, and every use is audited.</li>
            <li>Emergency access is for when the client cannot be reached: 4 hours at most, needs your password, and the client is told at once.</li>
          </ol>
        </PxPanel>
      </div>
    </>
  );
}
