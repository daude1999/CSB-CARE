"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CalendarBlank, CaretDown, Clock, SignOut } from "@phosphor-icons/react";
import { londonClock } from "@/lib/london";
import { useDismissableDetails } from "@/components/help-menu";
import { ColourModeOptions, useColourMode } from "@/components/colour-mode-menu";
import type { ColourMode } from "@/lib/colour-mode";

/**
 * Shows its `overview` content only on `/overview` (today's date and time in the ClearCare top bar), and `children`
 * everywhere else.
 */
export function TopbarSwitch({ overview, children }: { overview: React.ReactNode; children: React.ReactNode }) {
  return usePathname() === "/overview" ? overview : children;
}

/**
 * Today's date and time in Europe/London, refreshed every few seconds. It starts from the server's instant so the first
 * paint matches on both sides, then follows the browser's clock; London's offset (GMT or BST) comes from the time zone
 * rules, never from the browser's own zone.
 */
export function LondonClock({ initial }: { initial: number }) {
  const [now, setNow] = useState(initial);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  const at = new Date(now);
  const { date, time } = londonClock(at);
  const iso = at.toISOString();
  return (
    <div className="flex items-center text-meta font-semibold text-ink" data-testid="overview-clock">
      <span className="hidden items-center gap-2 pr-3 xl:flex">
        <CalendarBlank size={18} aria-hidden="true" className="text-cc-muted" />
        <time dateTime={iso.slice(0, 10)} data-testid="overview-date">{date}</time>
      </span>
      <span aria-hidden="true" className="hidden h-6 w-px bg-cc-line lg:block" />
      <span className="flex items-center gap-2 lg:pl-3">
        <Clock size={18} aria-hidden="true" className="hidden text-cc-muted sm:block" />
        <time dateTime={iso} data-testid="overview-time"><span className="sr-only">UK time </span>{time}</time>
      </span>
    </div>
  );
}

/** The signed-in person, with their branch, the light / dark appearance and sign out in a small menu. */
export function AccountMenu({ name, initials, role, branch, sample, mode: initialMode, signOutAction }: {
  name: string;
  initials: string;
  role: string;
  branch: string | null;
  sample: boolean;
  mode: ColourMode;
  signOutAction: () => Promise<void>;
}) {
  const ref = useDismissableDetails();
  const [mode, changeMode] = useColourMode(initialMode);
  return (
    <details ref={ref} className="relative" data-testid="account-menu">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-[10px] py-1 pl-1 pr-1.5 hover:bg-page [&::-webkit-details-marker]:hidden" aria-label={`Account: ${name}, ${role}`}>
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cc-primary text-meta font-semibold text-white">{initials}</span>
        <span className="hidden min-w-0 text-left xl:block">
          <span className="block max-w-[180px] truncate text-body font-semibold leading-[18px] text-ink" data-testid="overview-user">{name}</span>
          <span className="block max-w-[180px] truncate text-caption leading-[15px] text-cc-muted" data-testid="overview-role">{role}</span>
        </span>
        <CaretDown size={14} weight="bold" aria-hidden="true" className="hidden text-cc-muted xl:block" />
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-[250px] overflow-hidden rounded-[12px] border border-cc-line bg-white py-1 text-ink shadow-lg">
        <div className="border-b border-slate-100 px-3 pb-2.5 pt-2">
          <p className="truncate text-body font-semibold">{name}</p>
          <p className="truncate text-meta text-slate-600">{role}</p>
          {branch ? <p className="mt-1 truncate text-meta text-slate-600">Branch: {branch}</p> : null}
          {sample ? <p className="mt-1.5 w-fit rounded-[3px] border border-dashed border-slate-400 px-1.5 py-0.5 text-micro uppercase tracking-[0.08em] text-slate-600">Sample workspace</p> : null}
        </div>
        <div className="border-b border-slate-100 py-1">
          <p className="px-3 pb-1 pt-1.5 text-micro font-semibold uppercase tracking-[0.06em] text-slate-500">Appearance</p>
          <ColourModeOptions mode={mode} onChange={changeMode} />
        </div>
        <form action={signOutAction}>
          <button type="submit" className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-body hover:bg-slate-100">
            <SignOut size={18} aria-hidden="true" className="text-slate-600" />Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
