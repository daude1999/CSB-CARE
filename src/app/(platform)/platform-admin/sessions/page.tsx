import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { listSessions, PAGE_SIZE } from "@/server/platform/accounts";
import { fmtDate } from "@/components/ui";
import { Back, EmptyState, Filter, listUrl, PxFlash, PxHeader, PxPagination, PxPanel, pxSecondary, pxSm, Table, Tone } from "@/components/platform/ui";
import { revokeSessionAction } from "@/app/platform-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sessions" };

/** Everyone signed in now. A session ends after 12 hours without activity and always 7 days after sign-in. */
export default async function SessionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const page = Number(sp.page ?? "1") || 1;
  const { sessions, total } = await listSessions(ctx, { q: sp.q, page });
  const back = listUrl("/platform-admin/sessions", { q: sp.q, page: page > 1 ? String(page) : undefined });
  return (
    <>
      <PxHeader title="Sessions" description="Everyone signed in now. Sessions end after 12 hours without activity and always 7 days after sign-in. Network addresses are shortened." />
      <PxFlash searchParams={sp} />
      <PxPanel flush>
        <form method="get" role="search" aria-label="Find sessions" className="flex flex-wrap items-end gap-2 border-b border-px-divider px-4 py-3">
          <Filter label="Search" grow><input name="q" type="search" defaultValue={sp.q ?? ""} placeholder="Name or email" className="input" /></Filter>
          <button className={`${pxSecondary} ${pxSm}`}>Apply</button>
          {sp.q ? <Link href="/platform-admin/sessions" className={`${pxSecondary} ${pxSm} !border-transparent !shadow-none`}>Clear</Link> : null}
        </form>
        {sessions.length ? (
          <div className="px-4">
            <Table label="Sessions" minWidth={900} head={["Person", "Organisation", "Signed in", "Last active", "Ends", "Device", ""]} align={["left", "left", "left", "left", "left", "left", "right"]}>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td><Link href={`/platform-admin/users/${s.user.id}`} className="font-medium text-px-ink no-underline hover:text-px-accent hover:underline">{s.user.name}</Link>{s.user.platformRoles.includes("PLATFORM_ADMIN") ? <> <Tone tone="violet">Evantix</Tone></> : null}<span className="block text-[12px] text-px-muted">{s.user.email}</span></td>
                  <td className="text-[13px]">{s.organisation ?? "—"}</td>
                  <td className="whitespace-nowrap text-[13px] tabular-nums">{fmtDate(s.createdAt, true)}</td>
                  <td className="whitespace-nowrap text-[13px] tabular-nums">{fmtDate(s.lastSeenAt, true)}</td>
                  <td className="whitespace-nowrap text-[13px] tabular-nums">{fmtDate(s.expiresAt, true)}</td>
                  <td className="text-[12px] text-px-muted">{s.ip ?? "—"}<span className="block max-w-[200px] truncate">{s.userAgent ?? ""}</span></td>
                  <td className="text-right">{s.id ? <form action={revokeSessionAction}><Back value={back} /><input type="hidden" name="sessionId" value={s.id} /><button className={`${pxSecondary} ${pxSm}`}>End session</button></form> : null}</td>
                </tr>
              ))}
            </Table>
          </div>
        ) : <EmptyState title={sp.q ? "No sessions match" : "No one is signed in"} />}
        <PxPagination page={page} pageSize={PAGE_SIZE} total={total} base="/platform-admin/sessions" params={{ q: sp.q }} noun="session" />
      </PxPanel>
    </>
  );
}
