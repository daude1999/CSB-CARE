import { Buildings, Package, User } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { platformSearch, type SearchHit } from "@/server/platform/command-centre";
import { PxHeader, PxPanel, pxPrimary } from "@/components/platform/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search" };

const ICON: Record<SearchHit["kind"], React.ReactNode> = {
  Client: <Buildings size={18} className="text-px-accent" aria-hidden="true" />,
  Person: <User size={18} className="text-px-info" aria-hidden="true" />,
  Plan: <Package size={18} className="text-px-warn" aria-hidden="true" />,
};
const GROUPS: { kind: SearchHit["kind"]; title: string }[] = [{ kind: "Client", title: "Clients" }, { kind: "Person", title: "People" }, { kind: "Plan", title: "Plans" }];

/** Admin Centre search: clients by name, reference or company number; people by name or email; plans by name or code. */
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireCtx();
  const q = ((await searchParams).q ?? "").slice(0, 100);
  const hits = await platformSearch(ctx, q);
  return (
    <>
      <PxHeader title="Search" description="Clients by name, EVX reference, company number or contact email. People by name or email. Plans by name or code. Care records are never searched." />
      <form role="search" className="mb-5 flex max-w-[640px] gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">Search</span>
          <input name="q" type="search" defaultValue={q} autoFocus minLength={2} className="input" placeholder="For example EVX-0001, Bureau or jo@example.com" />
        </label>
        <button className={pxPrimary}>Search</button>
      </form>
      {q.trim().length < 2 ? (
        <p className="text-[13.5px] text-px-muted">Type at least two letters.</p>
      ) : !hits.length ? (
        <PxPanel><p className="py-4 text-center text-[13.5px] text-px-muted">Nothing matches “{q}”. Check the spelling, or search by EVX reference or email address.</p></PxPanel>
      ) : (
        <div className="space-y-4">
          <p className="text-[13px] text-px-muted">{hits.length} result{hits.length === 1 ? "" : "s"} for “{q}”</p>
          {GROUPS.map((g) => {
            const list = hits.filter((h) => h.kind === g.kind);
            if (!list.length) return null;
            return (
              <PxPanel key={g.kind} title={`${g.title} (${list.length})`}>
                <ul className="-mx-4 -my-3 divide-y divide-px-row">
                  {list.map((h) => (
                    <li key={h.id}>
                      <Link href={h.href} className="flex items-center gap-3 px-4 py-2.5 no-underline hover:bg-px-hover">
                        {ICON[h.kind]}
                        <span className="min-w-0">
                          <span className="block text-[14px] font-medium text-px-ink">{h.title}</span>
                          <span className="block truncate text-[12.5px] text-px-muted">{h.detail}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </PxPanel>
            );
          })}
        </div>
      )}
    </>
  );
}
