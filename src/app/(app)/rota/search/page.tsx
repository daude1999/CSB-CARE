import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { rotaSearch } from "@/server/rota/search";
import { Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

/** Results of the top bar search on rostering pages. */
export default async function RotaSearchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage();
  const r = await rotaSearch(ctx, sp.q ?? "");
  const groups = [
    { title: "Service users", rows: r.serviceUsers.map((s) => ({ key: s.id, href: `/rota/service-users/${s.id}`, name: s.name, detail: s.detail })) },
    { title: "Team members", rows: r.staff.map((s) => ({ key: s.id, href: `/rota/staff/${s.id}`, name: s.name, detail: s.detail })) },
    { title: "Visits", rows: r.visits.map((v) => ({ key: v.id, href: `/rota/visits/${v.id}`, name: v.reference, detail: v.detail })) },
  ];
  const found = groups.some((g) => g.rows.length);
  return (
    <>
      <PageHeader title="Search rostering" back="/rota" subtitle="Service users, team members and visit references you are allowed to see. Up to 15 of each are shown." />
      <section className="panel">
        <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-2">
          <label><span className="label">Search</span><input name="q" type="search" defaultValue={r.q} minLength={2} required placeholder="Name, postcode or reference" className="input w-[320px]" /></label>
          <button className="btn-primary">Search</button>
        </form>
        {r.q.length < 2 ? <Empty>Type at least two letters.</Empty> : !found ? <Empty>Nothing matches “{r.q}”.</Empty> : (
          <div className="grid gap-4 lg:grid-cols-3">
            {groups.map((g) => (
              <section key={g.title} aria-label={g.title}>
                <h2 className="mb-2 text-[16px] font-semibold">{g.title} <span className="font-normal text-slate-500">({g.rows.length})</span></h2>
                {g.rows.length ? (
                  <ul className="rows">
                    {g.rows.map((x) => <li key={x.key} className="py-2"><Link href={x.href} className="font-medium">{x.name}</Link><span className="block text-[13px] text-slate-600">{x.detail}</span></li>)}
                  </ul>
                ) : <p className="text-[13.5px] text-slate-500">None.</p>}
              </section>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
