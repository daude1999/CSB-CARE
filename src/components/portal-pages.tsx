import Link from "@/components/link";
import { TitleBar } from "@/components/title-bar";
import { portalById, type PortalId } from "@/lib/portals";

/** The honest page for a portal that is not built yet: what it will do, when, and what it will not include. No figures. */
export function PlannedPortal({ id, description, features, notIncluded }: { id: PortalId; description: string; features: string[]; notIncluded: string }) {
  const portal = portalById(id);
  return (
    <div>
      <TitleBar title={portal.name} />
      <div className="grid gap-4 bg-[#f1f2f5] p-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-[3px] bg-white px-5 py-5" data-testid="planned-portal">
          <span className="inline-block rounded-full border border-dashed border-slate-400 bg-slate-100 px-2.5 text-[12px] font-medium leading-[22px] text-slate-600">Planned · {portal.planned}</span>
          <h2 className="mt-3 font-sans text-[22px] font-medium text-navy-900">This portal is not built yet</h2>
          <p className="mt-2 max-w-[60ch] text-[15px] leading-6 text-slate-700">{description}</p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[15px] text-slate-700">
            {features.map((f) => <li key={f}>{f}</li>)}
          </ul>
        </section>
        <aside className="self-start rounded-[3px] bg-white px-5 py-5">
          <h3>Planned for</h3>
          <p className="mt-1 text-[14px] text-slate-600">{portal.planned}, after HR records are in the platform.</p>
          <h3 className="mt-4">Not included in the demo</h3>
          <p className="mt-1 text-[14px] text-slate-600">{notIncluded}</p>
          <Link href="/overview" className="btn-secondary mt-4">Back to Overview</Link>
        </aside>
      </div>
    </div>
  );
}
