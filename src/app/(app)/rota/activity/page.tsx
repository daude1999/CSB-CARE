import Link from "@/components/link";
import { requireRotaPage } from "@/server/auth/portals";
import { rotaActivity } from "@/server/rota/overview";
import { londonDate } from "@/lib/london";
import { Empty, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const PAGE = 50;
const when = (d: Date) => `${d.toLocaleDateString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" })} ${d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })}`;

/** Every recorded rota event the member may see, newest first: the "View all" of the dashboard's Recent Rota Activity. */
export default async function RotaActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireRotaPage();
  const page = Math.max(1, Math.min(200, Number.parseInt(sp.page ?? "1", 10) || 1));
  const q = sp.q?.trim().slice(0, 100) || undefined;
  const a = await rotaActivity(ctx, { branch: sp.branch, q, take: PAGE, skip: (page - 1) * PAGE });
  const qs = (extra: Record<string, string | undefined>) => new URLSearchParams(Object.entries({ branch: a.branch ?? undefined, q, ...extra }).filter((e): e is [string, string] => !!e[1])).toString();
  const today = londonDate();
  return (
    <>
      <PageHeader title="Rota Activity" back="/rota" subtitle="Changes to visits and to the whole rota, newest first, taken from each visit's history and the audit log. Clock times and task ticks are on each visit." />
      <section className="panel" aria-label="Rota activity">
        <form method="get" role="search" className="mb-3 flex flex-wrap items-end gap-2">
          {a.branches.length > 1 ? (
            <label><span className="label">Branch</span>
              <select name="branch" defaultValue={a.branch ?? ""} className="input w-[200px]"><option value="">All my branches</option>{a.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </label>
          ) : null}
          <label><span className="label">Search</span><input name="q" type="search" defaultValue={q ?? ""} placeholder="Service user or visit reference" className="input w-[260px]" /></label>
          <button className="btn-primary">Show</button>
          {q || a.branch ? <Link href="/rota/activity" className="btn-secondary">Clear</Link> : null}
        </form>
        {q || a.branch ? <p className="mb-2 text-[13px] text-slate-600">Whole-rota events (built, published, rolled forward) are shown only when no branch or search is chosen, because they cover every branch.</p> : null}
        {a.rows.length ? (
          <div className="overflow-x-auto rounded border border-slate-200">
            <table className="table text-[14px]">
              <thead><tr><th scope="col">Time</th><th scope="col">Activity</th><th scope="col">Details</th><th scope="col">By</th></tr></thead>
              <tbody>
                {a.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap tabular-nums">{londonDate(r.at) === today ? `Today ${when(r.at).slice(-5)}` : when(r.at)}</td>
                    <td>{r.activity}</td>
                    <td><Link href={r.href}>{r.details}</Link></td>
                    <td>{r.by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>{q ? `No rota activity matches “${q}”.` : "No rota activity has been recorded yet."}</Empty>}
        <nav aria-label="Pages" className="mt-3 flex items-center gap-2 text-[14px]">
          {page > 1 ? <Link href={`/rota/activity?${qs({ page: String(page - 1) })}`} className="btn-secondary">Newer</Link> : null}
          <span className="text-slate-600">Page {page}</span>
          {a.more ? <Link href={`/rota/activity?${qs({ page: String(page + 1) })}`} className="btn-secondary">Older</Link> : null}
        </nav>
      </section>
    </>
  );
}
