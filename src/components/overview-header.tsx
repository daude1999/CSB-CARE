"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { CalendarBlank, CaretDown, Clock, SignOut } from "@phosphor-icons/react";
import { londonClock } from "@/lib/london";
import { useDismissableDetails } from "@/components/help-menu";

/**
 * The Overview has its own dark header (logo, organisation, today's date and time, the signed-in person), as in the
 * owner's approved design. Every other page keeps the standard top bar, so this only swaps the two on `/overview`.
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
    <div className="flex items-center text-[14px] font-medium text-white" data-testid="overview-clock">
      <span className="hidden items-center gap-2 pr-4 lg:flex">
        <CalendarBlank size={20} aria-hidden="true" className="text-white/85" />
        <time dateTime={iso.slice(0, 10)} data-testid="overview-date">{date}</time>
      </span>
      <span aria-hidden="true" className="hidden h-7 w-px bg-white/25 lg:block" />
      <span className="flex items-center gap-2 lg:pl-4">
        <Clock size={20} aria-hidden="true" className="hidden text-white/85 sm:block" />
        <time dateTime={iso} data-testid="overview-time"><span className="sr-only">UK time </span>{time}</time>
      </span>
    </div>
  );
}

/** The signed-in person, with their branch and sign out in a small menu. */
export function AccountMenu({ name, initials, role, branch, sample, signOutAction }: {
  name: string;
  initials: string;
  role: string;
  branch: string | null;
  sample: boolean;
  signOutAction: () => Promise<void>;
}) {
  const ref = useDismissableDetails();
  return (
    <details ref={ref} className="relative" data-testid="account-menu">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 rounded-[8px] py-1 pl-1 pr-1.5 hover:bg-white/10 [&::-webkit-details-marker]:hidden" aria-label={`Account: ${name}, ${role}`}>
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#dbe7f8] text-[13px] font-semibold text-[#0b2a4a]">{initials}</span>
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block max-w-[180px] truncate text-[14px] font-semibold leading-[18px] text-white" data-testid="overview-user">{name}</span>
          <span className="block max-w-[180px] truncate text-[12px] leading-[15px] text-white/80" data-testid="overview-role">{role}</span>
        </span>
        <CaretDown size={14} weight="bold" aria-hidden="true" className="hidden text-white/85 sm:block" />
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-[250px] overflow-hidden rounded-[8px] border border-slate-200 bg-white py-1 text-[#0b1530] shadow-lg">
        <div className="border-b border-slate-100 px-3 pb-2.5 pt-2">
          <p className="truncate text-[14px] font-semibold">{name}</p>
          <p className="truncate text-[12.5px] text-slate-600">{role}</p>
          {branch ? <p className="mt-1 truncate text-[12.5px] text-slate-600">Branch: {branch}</p> : null}
          {sample ? <p className="mt-1.5 w-fit rounded-[3px] border border-dashed border-slate-400 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-slate-600">Sample workspace</p> : null}
        </div>
        <form action={signOutAction}>
          <button type="submit" className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[14px] hover:bg-slate-100">
            <SignOut size={18} aria-hidden="true" className="text-slate-600" />Sign out
          </button>
        </form>
      </div>
    </details>
  );
}
