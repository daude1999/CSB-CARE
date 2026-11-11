import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { CLIENT_PAGE_SIZE, CUSTOMER_STATUSES, listClients } from "@/server/platform/customers";
import { fmtDate } from "@/components/ui";
import { EmptyState, Filter, fmtBytes, fmtNumber, listUrl, Pill, PxFlash, PxHeader, PxPagination, PxPanel, pxPrimary, pxSecondary, pxSm, Table, Toolbar } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "All Clients" };

const SORTS: [string, string][] = [["name", "Name (A–Z)"], ["reference", "Reference"], ["users", "Most users"], ["renewal", "Next renewal"], ["created", "Newest first"]];

/** The client directory: find a customer quickly, see its plan and status, and open its workspace. */
export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const page = Number(sp.page ?? "1") || 1;
  const [{ total, rows, sort }, plans] = await Promise.all([
    listClients(ctx, { q: sp.q, status: sp.status, plan: sp.plan, sort: sp.sort, page }),
    db.subscriptionPlan.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const filters = { q: sp.q, status: sp.status, plan: sp.plan, sort: sp.sort };
  const filtered = Boolean(sp.q || sp.status || sp.plan);
  const back = encodeURIComponent(listUrl("/platform-admin/clients", { ...filters, page: page > 1 ? String(page) : undefined }));
  const open = (id: string, tab?: string) => `/platform-admin/clients/${id}?${tab ? `tab=${tab}&` : ""}back=${back}`;
  return (
    <>
      <PxHeader title="Clients" description="Every customer organisation on the platform." actions={<Link href="/platform-admin/clients/new" className={pxPrimary}>Add client</Link>} />
      <PxFlash searchParams={sp} />
      <PxPanel flush>
        <Toolbar label="Find clients" clearHref="/platform-admin/clients" active={filtered || Boolean(sp.sort)}>
          <Filter label="Search" grow><input name="q" type="search" defaultValue={sp.q ?? ""} placeholder="Name, EVX reference or company number" className="input" /></Filter>
          <Filter label="Status">
            <select name="status" defaultValue={sp.status ?? ""} className="input"><option value="">All statuses</option>{CUSTOMER_STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</option>)}</select>
          </Filter>
          <Filter label="Plan">
            <select name="plan" defaultValue={sp.plan ?? ""} className="input"><option value="">All plans</option><option value="none">No subscription</option>{plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </Filter>
          <Filter label="Sort">
            <select name="sort" defaultValue={sort} className="input">{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </Filter>
        </Toolbar>
        {rows.length ? (
          <div className="px-4">
            <Table label="Clients" minWidth={920} head={["Client", "Reference", "Plan", "Status", "Users", "Branches", "Storage", "Next renewal", ""]} align={["left", "left", "left", "left", "right", "right", "right", "left", "right"]}>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="max-w-[280px]">
                    <Link href={open(c.id)} className="font-medium text-px-ink no-underline hover:text-px-accent hover:underline">{c.name}</Link>
                    {c.isDemo ? <span className="ml-2 rounded-[4px] bg-px-row px-1.5 py-[1px] text-micro font-medium text-px-muted">Demo</span> : null}
                  </td>
                  <td className="whitespace-nowrap font-mono text-meta text-px-body">{c.reference}</td>
                  <td>{c.plan ?? <span className="text-px-subtle">No plan</span>}</td>
                  <td><Pill value={c.status} /></td>
                  <td className="text-right tabular-nums">{fmtNumber(c.users)}</td>
                  <td className="text-right tabular-nums">{fmtNumber(c.branches)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{fmtBytes(c.storageBytes)}</td>
                  <td className="whitespace-nowrap tabular-nums">{c.renewal ? <>{fmtDate(c.renewal)}<span className="block text-caption text-px-subtle">{c.renewalKind}</span></> : <span className="text-px-subtle">—</span>}</td>
                  <td className="text-right">
                    <Link href={open(c.id)} className={`${pxSecondary} ${pxSm}`} aria-label={`Manage ${c.name}`}>Manage</Link>
                  </td>
                </tr>
              ))}
            </Table>
          </div>
        ) : filtered ? (
          <EmptyState title="No clients match these filters" action={<Link href="/platform-admin/clients" className={pxSecondary}>Clear filters</Link>}>Try a shorter name, or search by EVX reference or company number.</EmptyState>
        ) : (
          <EmptyState title="No clients yet" action={<Link href="/platform-admin/clients/new" className={pxPrimary}>Add the first client</Link>}>Adding a client creates its organisation, first branch, subscription and administrator invitation in one step.</EmptyState>
        )}
        <PxPagination page={page} pageSize={CLIENT_PAGE_SIZE} total={total} base="/platform-admin/clients" params={filters} noun="client" />
      </PxPanel>
    </>
  );
}
