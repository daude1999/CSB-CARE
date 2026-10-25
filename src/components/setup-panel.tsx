"use client";
import { useEffect, useState } from "react";
import Link from "@/components/link";
import { CaretRight, Check, X } from "@phosphor-icons/react";
import type { SetupStep } from "@/server/setup/checklist";

const HIDDEN_KEY = "csb.setup-panel.hidden";

/** The slide-in setup checklist on the dashboard. "Hide for now" is remembered in this browser only. */
export function SetupPanel({ firstName, orgName, steps }: { firstName: string; orgName: string; steps: SetupStep[] }) {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(HIDDEN_KEY) === "1") setHidden(true);
    } catch {}
  }, []);
  if (hidden) return null;
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(HIDDEN_KEY, "1");
    } catch {}
  };
  const done = steps.filter((s) => s.done).length;
  return (
    <aside aria-label="Setup checklist" className="relative mt-10 w-full rounded-[8px] bg-navy-900 pb-2 text-white shadow-[-4px_8px_24px_rgb(0_0_0/0.2)] lg:fixed lg:bottom-6 lg:right-0 lg:z-30 lg:mt-0 lg:w-[250px] lg:rounded-r-none">
      <button type="button" onClick={hide} aria-label="Close setup checklist" className="absolute -top-3 right-2 flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:text-navy-900">
        <X size={13} weight="bold" aria-hidden="true" />
      </button>
      <div className="-mt-9 flex justify-center">
        <div className="flex h-[70px] w-[70px] items-center justify-center rounded-full border-[3px] border-teal-500 bg-white">
          <div className="flex h-[52px] w-[52px] items-center justify-center rounded-[12px] bg-teal-400 text-[15px] font-bold text-navy-950">CSB</div>
        </div>
      </div>
      <div className="px-4 pb-3 pt-2 text-center">
        <p className="text-[16px] font-bold">Hi, {firstName}!</p>
        <p className="mt-0.5 text-[12px] leading-snug text-teal-100">{done === steps.length ? `${orgName} is fully set up. Nice work!` : `Finish these steps so ${orgName} is fully set up.`}</p>
      </div>
      <p className="mb-1 ml-3 rounded-l-[4px] bg-teal-400 py-1.5 text-center text-[12px] font-bold text-navy-950">Setup checklist · {done} of {steps.length}</p>
      <ul>
        {steps.map((s) => (
          <li key={s.key}>
            <Link href={s.href} className="flex min-h-[44px] items-center gap-2.5 border-t border-white/15 px-3.5 text-[13px] font-medium text-white no-underline hover:bg-white/[0.06] hover:text-white">
              {s.done ? (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-teal-500"><Check size={10} weight="bold" aria-hidden="true" /><span className="sr-only">Done:</span></span>
              ) : (
                <span className="h-4 w-4 rounded-full border-[1.5px] border-teal-200"><span className="sr-only">To do:</span></span>
              )}
              <span className={s.done ? "text-teal-100" : undefined}>{s.label}</span>
              <CaretRight size={12} weight="bold" aria-hidden="true" className="ml-auto" />
            </Link>
          </li>
        ))}
      </ul>
      <button type="button" onClick={hide} className="mx-auto mt-1 block px-2 py-1 text-[11px] text-teal-100 underline hover:text-white">Hide for now</button>
    </aside>
  );
}
