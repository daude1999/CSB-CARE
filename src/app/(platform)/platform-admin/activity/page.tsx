import { requireCtx } from "@/server/auth/current";
import { ACTIVITY_PAGE, securityAudit } from "@/server/platform/activity";
import { Pagination } from "@/components/ui";
import { PxHeader, PxPanel } from "@/components/platform/ui";
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
      <PxHeader title="Activity History" description="Every action taken in this Admin Centre by Evantix staff. For changes made by clients' own administrators and sign-ins, use the Security Audit." />
      <PxPanel>
        <AuditTable entries={entries} />
        <Pagination page={page} pageSize={ACTIVITY_PAGE} total={total} base="/platform-admin/activity" />
      </PxPanel>
    </>
  );
}
