import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { ACTIVITY_PAGE, securityAudit } from "@/server/platform/activity";
import { PxHeader, PxPagination, PxPanel, pxSecondary } from "@/components/platform/ui";
import { AuditTable } from "@/components/platform/audit-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity History" };

/** What Evantix staff have done on the platform, newest first. */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const page = Number(sp.page ?? "1") || 1;
  const { entries, total } = await securityAudit(ctx, { action: "platform.", page });
  return (
    <>
      <PxHeader title="Activity History" description="Every action taken in this Admin Centre by Evantix staff. Changes made by clients' own administrators, and sign-ins, are in the Security Audit." actions={<Link href="/platform-admin/security" className={pxSecondary}>Security audit</Link>} />
      <PxPanel flush>
        <div className="px-4"><AuditTable entries={entries} /></div>
        <PxPagination page={page} pageSize={ACTIVITY_PAGE} total={total} base="/platform-admin/activity" noun="event" />
      </PxPanel>
    </>
  );
}
