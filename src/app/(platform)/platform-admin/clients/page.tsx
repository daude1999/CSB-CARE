import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { CLIENT_PAGE_SIZE, CUSTOMER_STATUSES, listClients } from "@/server/platform/customers";
import { Flash, fmtDate, Pagination } from "@/components/ui";
import { EmptyRow, fmtBytes, fmtNumber, Pill, PxHeader, PxPanel, pxPrimary, pxSecondary, Table } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "All Clients" };

const SORTS: [string, string][] = [["name", "Company"], ["reference", "Reference"], ["users", "Most users"], ["renewal", "Next renewal"], ["created", "Newest"]];

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const page = Number(sp.page ?? "1") || 1;
  const [{ total, rows, sort }, plans] = await Promise.all([
    listClients(ctx, { q: sp.q, status: sp.status, plan: sp.plan, sort: sp.sort, page }),
    db.subscriptionPlan.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PxHeader title="All Clients" description="Every customer organisation. Service user counts are shown for operational metering only; their records are not available here." actions={<Link href="/platform-admin/clients/new" className={pxPrimary}>Add new client</Link>} />
      <Flash searchParams={sp} />
      <form method="get" className="mb-4 grid grid-cols-1 gap-2 rounded-[8px] border border-[#e4e7ef] bg-white p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_auto]" role="search" aria-label="Find clients">
        <label><span className="label">Search</span><input name="q" defaultValue={sp.q ?? ""} placeholder="Name, reference or company number" className="input" /></label>
        <label><span className="label">Status</span>
          <select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">All statuses</option>{CUSTOMER_STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select>
        </label>
        <label><span className="label">Plan</span>
          <select name="plan" defaultValue={sp.plan ?? ""} className="input"><option value="">All plans</option><option value="none">No subscription</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </label>
        <label><span className="label">Sort by</span>
          <select name="sort" defaultValue={sort} className="input">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <div className="flex items-end gap-2"><button className={pxPrimary}>Apply</button><Link href="/platform-admin/clients" className={pxSecondary}>Clear</Link></div>
      </form>
      <PxPanel>
        <Table label="Clients" head={["Company", "Reference", "Plan", "Status", "Branches", "Users", "Service users", "Storage", "Renewal", ""]} empty={rows.length ? null : <EmptyRow>No clients match these filters.</EmptyRow>}>
          {rows.map((c) => (
            <tr key={c.id}>
              <td><Link href={`/platform-admin/clients/${c.id}`} className="font-medium text-[#0f1b3d]">{c.name}</Link>{c.isDemo ? <span className="ml-2 text-[12px] text-[#5b6478]">(demo)</span> : null}</td>
              <td className="font-mono text-[12.5px]">{c.reference}</td>
              <td>{c.plan ?? <span className="text-[#5b6478]">None</span>}</td>
              <td><Pill value={c.status} /></td>
              <td className="tabular-nums">{fmtNumber(c.branches)}</td>
              <td className="tabular-nums">{fmtNumber(c.users)}</td>
              <td className="tabular-nums">{fmtNumber(c.serviceUsers)}</td>
              <td className="tabular-nums">{fmtBytes(c.storageBytes)}</td>
              <td className="whitespace-nowrap">{c.renewal ? <>{fmtDate(c.renewal)}<span className="block text-[12px] text-[#5b6478]">{c.renewalKind}</span></> : <span className="text-[#5b6478]">—</span>}</td>
              <td><Link href={`/platform-admin/clients/${c.id}`} className={`${pxSecondary} !py-1 text-[13px]`} aria-label={`Manage ${c.name}`}>Manage</Link></td>
            </tr>
          ))}
        </Table>
        <Pagination page={page} pageSize={CLIENT_PAGE_SIZE} total={total} base="/platform-admin/clients" params={{ q: sp.q, status: sp.status, plan: sp.plan, sort: sp.sort }} />
      </PxPanel>
    </>
  );
}
