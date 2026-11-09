import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { listSessions, PAGE_SIZE } from "@/server/platform/accounts";
import { Flash, fmtDate, Pagination } from "@/components/ui";
import { Back, EmptyRow, PxHeader, PxPanel, pxPrimary, Table, Tone } from "@/components/platform/ui";
import { revokeSessionAction } from "@/app/platform-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Login Sessions" };

export default async function SessionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const page = Number(sp.page ?? "1") || 1;
  const { sessions, total } = await listSessions(ctx, { q: sp.q, page });
  const back = `/platform-admin/sessions${sp.q ? `?q=${encodeURIComponent(sp.q)}` : ""}`;
  return (
    <>
      <PxHeader title="Login Sessions" description="Everyone signed in now. Sessions end after 12 hours without activity and always 7 days after sign-in. Network addresses are shortened." />
      <Flash searchParams={sp} />
      <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-2 rounded-[8px] border border-[#e4e7ef] bg-white p-3"><label className="min-w-0 flex-1"><span className="label">Name or email</span><input name="q" defaultValue={sp.q ?? ""} className="input" /></label><button className={pxPrimary}>Search</button></form>
      <PxPanel>
        <Table head={["Person", "Organisation", "Signed in", "Last active", "Ends", "Device", ""]} empty={sessions.length ? null : <EmptyRow>No one is signed in.</EmptyRow>}>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td><Link href={`/platform-admin/users/${s.user.id}`}>{s.user.name}</Link>{s.user.platformRoles.includes("PLATFORM_ADMIN") ? <> <Tone tone="violet">Evantix</Tone></> : null}<span className="block text-[12px] text-[#5b6478]">{s.user.email}</span></td>
              <td>{s.organisation ?? "—"}</td>
              <td className="whitespace-nowrap">{fmtDate(s.createdAt, true)}</td>
              <td className="whitespace-nowrap">{fmtDate(s.lastSeenAt, true)}</td>
              <td className="whitespace-nowrap">{fmtDate(s.expiresAt, true)}</td>
              <td className="text-[12px] text-[#5b6478]">{s.ip ?? "—"}<span className="block max-w-[200px] truncate">{s.userAgent ?? ""}</span></td>
              <td>{s.id ? <form action={revokeSessionAction}><Back value={back} /><input type="hidden" name="sessionId" value={s.id} /><button className="text-[13px] text-[#a11d2b] underline">End</button></form> : null}</td>
            </tr>
          ))}
        </Table>
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} base="/platform-admin/sessions" params={{ q: sp.q }} />
      </PxPanel>
    </>
  );
}
