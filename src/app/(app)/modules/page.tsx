import Link from "@/components/link";
import { requireCtx } from "@/server/auth/current";
import { TitleBar } from "@/components/title-bar";
import { MODULES } from "@/content/modules";
import { ModuleIcon } from "./icons";
import { CheckCircle, LockSimple } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

export default async function ModulesPage() {
  await requireCtx();
  return (
    <div>
      <TitleBar title="CSB Modules" back="/" />
      <div className="bg-[#f1f2f5] pb-6 pt-3">
        <p className="mb-3 rounded-[3px] bg-white px-5 py-3 text-[14px] text-slate-700">Your plan includes the Policy Centre, Resource Centre and the modules marked included. Locked modules can be added at any time.</p>
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {MODULES.map((m) => (
            <li key={m.slug}>
              <Link href={`/modules/${m.slug}`} className="flex h-full flex-col rounded-[3px] bg-white p-5 no-underline shadow-[0_0_0_1px_#eef1f3] hover:shadow-[0_0_0_1px_#c4cfdd]" data-testid={`module-${m.slug}`}>
                <span className="flex items-start justify-between gap-3">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-navy-900 text-white"><ModuleIcon slug={m.slug} size={26} /></span>
                  {m.opens ? (
                    <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[12px] text-emerald-800 ring-1 ring-inset ring-emerald-200"><CheckCircle size={13} weight="fill" aria-hidden="true" />Included</span>
                  ) : (
                    <span className="flex items-center gap-1 rounded-full bg-[#fdf0d8] px-2.5 py-0.5 text-[12px] text-[#8a5a00] ring-1 ring-inset ring-amber-200"><LockSimple size={13} weight="fill" aria-hidden="true" />Locked</span>
                  )}
                </span>
                <span className="mt-3 text-[17px] text-slate-900">{m.name}</span>
                <span className="mt-1 text-[13.5px] leading-5 text-slate-600">{m.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
