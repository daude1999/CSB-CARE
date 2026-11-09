import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { listSupportGrants, SUPPORT_SCOPES } from "@/server/platform/support";
import { Flash, fmtDate } from "@/components/ui";
import { Back, Confirm, EmptyRow, Pill, PxHeader, PxPanel, pxDanger, ReasonField, Table } from "@/components/platform/ui";
import { revokeSupportAction } from "@/app/platform-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Support & Access" };

export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const grants = await listSupportGrants(ctx);
  return (
    <>
      <PxHeader title="Support & Access" description="Controlled support access to clients. Ask a client for access from its profile (Security tab). Access is time-limited, purpose-bound and limited to configuration and the activity log. There is no impersonation and no access to service user records." />
      <Flash searchParams={sp} />
      <PxPanel title="How it works" className="mb-4">
        <ol className="list-decimal space-y-1 pl-5 text-[13.5px]">
          <li>Open the client, Security tab, and describe why support needs access and to what: {Object.values(SUPPORT_SCOPES).join("; ")}.</li>
          <li>The client&apos;s administrators see the request in their bell and Settings, and approve or decline it.</li>
          <li>Access lasts for the hours asked and then stops by itself. Either side can revoke it earlier. Every use is in the audit.</li>
          <li>Emergency access is for when the client cannot be reached: at most 4 hours, your password, and the client is told at once.</li>
        </ol>
      </PxPanel>
      <PxPanel title="All support access">
        <Table head={["Client", "Requested", "Purpose", "Scope", "Authorised", "State", ""]} empty={grants.length ? null : <EmptyRow>No support access has been requested yet.</EmptyRow>}>
          {grants.map((g) => (
            <tr key={g.id}>
              <td><Link href={`/platform-admin/clients/${g.organisation.id}?tab=security`}>{g.organisation.name}</Link></td>
              <td className="whitespace-nowrap">{fmtDate(g.createdAt, true)}<span className="block text-[12px] text-[#5b6478]">{g.requestedBy}</span></td>
              <td className="max-w-[260px]">{g.purpose}</td>
              <td className="text-[12.5px]">{g.scopes.map((s) => s.toLowerCase().replace("_", " ")).join(", ")}</td>
              <td className="text-[12.5px]">{g.authorisation === "EMERGENCY" ? "Emergency" : g.decidedBy ? `Client: ${g.decidedBy}` : "Waiting"}</td>
              <td><Pill value={g.state} />{g.expiresAt && g.state === "ACTIVE" ? <span className="block text-[12px] text-[#5b6478]">until {fmtDate(g.expiresAt, true)}</span> : null}{g.revokedBy ? <span className="block text-[12px] text-[#5b6478]">by {g.revokedBy}</span> : null}</td>
              <td>{g.state === "ACTIVE" || g.state === "REQUESTED" ? <Confirm label="Revoke"><form action={revokeSupportAction} className="space-y-2"><Back value="/platform-admin/support" /><input type="hidden" name="grantId" value={g.id} /><ReasonField /><button className={pxDanger}>Revoke</button></form></Confirm> : null}</td>
            </tr>
          ))}
        </Table>
      </PxPanel>
    </>
  );
}
