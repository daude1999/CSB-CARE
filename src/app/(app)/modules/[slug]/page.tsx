import { notFound } from "next/navigation";
import Link from "@/components/link";
import { requirePortal } from "@/server/auth/portals";
import { requestModuleAction } from "../../../actions";
import { Flash } from "@/components/ui";
import { TitleBar } from "@/components/title-bar";
import { MODULES } from "@/content/modules";
import { ModuleIcon } from "../icons";
import { ArrowRight, Check, LockSimple } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

export default async function ModulePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  await requirePortal("admin");
  const m = MODULES.find((x) => x.slug === slug);
  if (!m) notFound();
  return (
    <div>
      <TitleBar title={m.name} back="/modules" />
      <div className="bg-[#f1f2f5] pb-6 pt-3">
        <Flash searchParams={sp} />
        <section className="relative overflow-hidden rounded-[3px] bg-white px-6 py-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div>
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-navy-900 text-white"><ModuleIcon slug={m.slug} size={30} /></span>
              <p className="mt-4 max-w-2xl text-[16px] leading-7 text-slate-800">{m.summary}</p>
              <ul className="mt-4 grid gap-2 sm:grid-cols-2">
                {m.features.map((f) => <li key={f} className="flex gap-2 text-[14.5px] text-slate-700"><Check size={18} weight="bold" className="mt-0.5 shrink-0 text-teal-600" aria-hidden="true" />{f}</li>)}
              </ul>
            </div>
            {m.opens ? (
              <div className="self-start rounded-[4px] border-[1.5px] border-teal-400 bg-teal-100 p-5">
                <p className="text-[16px] font-medium text-navy-900">Included in your plan</p>
                <p className="mt-1 text-[13.5px] text-slate-700">Open it from here:</p>
                <ul className="mt-3 space-y-2">
                  {m.opens.map((o) => <li key={o.href}><Link href={o.href} className="flex items-center justify-between rounded-[4px] bg-white px-3 py-2 text-[14.5px] text-navy-900 no-underline shadow-[0_1px_2px_rgb(0_0_0/0.06)] hover:bg-teal-50">{o.label}<ArrowRight size={16} aria-hidden="true" /></Link></li>)}
                </ul>
              </div>
            ) : (
              <div className="self-start rounded-[4px] border border-slate-300 bg-[#f5f9fc] p-5 text-center" data-testid="module-locked">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-[#fdf0d8] text-[#8a5a00]"><LockSimple size={28} weight="fill" aria-hidden="true" /></span>
                <p className="mt-3 text-[16px] font-medium text-slate-900">This module is locked</p>
                <p className="mt-1 text-[13.5px] text-slate-600">It is not part of your current plan. Ask us and we will show you a demo and the cost.</p>
                <form action={requestModuleAction} className="mt-4">
                  <input type="hidden" name="module" value={m.slug} />
                  <input type="hidden" name="back" value={`/modules/${m.slug}`} />
                  <button className="btn-primary w-full" type="submit">Request access</button>
                </form>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
