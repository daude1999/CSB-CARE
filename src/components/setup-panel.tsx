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
    <aside aria-label="Setup checklist" className="relative mt-24 w-full bg-navy-900 pb-3 pt-[60px] text-white shadow-[-4px_8px_24px_rgb(0_0_0/0.2)] lg:fixed lg:bottom-0 lg:right-4 lg:z-30 lg:mt-0 lg:h-[567px] lg:w-[247px]">
      <div className="absolute -top-[56px] left-1/2 h-[112px] w-[112px] -translate-x-1/2 overflow-hidden rounded-full border-[3px] border-white bg-teal-200" aria-hidden="true">
        <svg viewBox="0 0 112 112" className="h-full w-full">
          <circle cx="56" cy="56" r="56" className="fill-teal-50" />
          <path d="M20 112c2-22 17-34 36-34s34 12 36 34z" className="fill-navy-900" />
          <path d="M48 70h16v12l-8 6-8-6z" fill="#f3d4bd" />
          <ellipse cx="56" cy="50" rx="18" ry="21" fill="#f3d4bd" />
          <path d="M37 48c0-16 9-24 19-24s20 8 20 24c-4-8-10-12-20-12s-15 4-19 12z" className="fill-navy-900" />
          <path d="M44 92l12 8 12-8" className="fill-teal-400" />
        </svg>
      </div>
      <button type="button" onClick={hide} aria-label="Close setup checklist" className="absolute -right-2 -top-[15px] flex h-[30px] w-[30px] items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:text-navy-900">
        <X size={14} weight="bold" aria-hidden="true" />
      </button>
      <div className="px-4 text-center">
        <p className="text-[20px] font-bold">Hi, {firstName}!</p>
        <p className="mt-1 text-[13px] leading-snug text-teal-100">{done === steps.length ? `${orgName} is fully set up. Nice work!` : "To finish setting up CSB, please complete the checklist below."}</p>
      </div>
      <div className="mt-4 flex items-center pl-3">
        <svg viewBox="0 0 28 34" className="relative z-10 h-[34px] w-[28px] shrink-0" aria-hidden="true">
          <rect x="1" y="4" width="26" height="29" rx="3" className="fill-white" />
          <rect x="8" y="1" width="12" height="7" rx="2" className="fill-teal-400" />
          <path d="M6 15h16M6 21h16M6 27h10" className="stroke-navy-900" strokeWidth="2" />
        </svg>
        <p className="-ml-2 flex-1 bg-teal-400 py-[7px] pl-4 text-[14px] font-bold text-navy-950 [clip-path:polygon(0_0,100%_0,94%_50%,100%_100%,0_100%)]">Setup Checklist · {done} of {steps.length}</p>
      </div>
      <ul className="mt-2">
        {steps.map((s) => (
          <li key={s.key}>
            <Link href={s.href} className="flex h-[46px] items-center gap-3 border-b border-white/15 px-4 text-[14.5px] text-white no-underline hover:bg-white/[0.06] hover:text-white">
              {s.done ? (
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-400 text-navy-950"><Check size={11} weight="bold" aria-hidden="true" /><span className="sr-only">Done:</span></span>
              ) : (
                <span className="h-5 w-5 shrink-0 rounded-full border-2 border-white/70"><span className="sr-only">To do:</span></span>
              )}
              <span className={s.done ? "text-teal-100 line-through decoration-white/40" : undefined}>{s.label}</span>
              <CaretRight size={13} weight="bold" aria-hidden="true" className="ml-auto" />
            </Link>
          </li>
        ))}
      </ul>
      <button type="button" onClick={hide} className="mx-auto mt-3 block px-2 py-1 text-[13px] text-teal-100 underline hover:text-white">Don&apos;t show this again</button>
    </aside>
  );
}
