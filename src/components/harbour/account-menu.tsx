"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { SignOut } from "@phosphor-icons/react";
import { useDismissableDetails } from "@/components/help-menu";
import { ColourModeMenu, ColourModeOptions, useColourMode } from "@/components/colour-mode-menu";
import { londonClock } from "@/lib/london";
import type { ColourMode } from "@/lib/colour-mode";

/**
 * The signed-in person on the right of the Harbour top bar: avatar, name and "Organisation · Branch". It opens the
 * same menu as before: who they are, the light / dark appearance and sign out.
 */
export function HarbourAccountMenu({ name, initials, role, place, sample, mode: initialMode, signOutAction }: {
  name: string;
  initials: string;
  role: string;
  /** "Organisation · Branch", or the organisation alone. */
  place: string;
  sample: boolean;
  mode: ColourMode;
  signOutAction: () => Promise<void>;
}) {
  const ref = useDismissableDetails();
  const [mode, changeMode] = useColourMode(initialMode);
  // As before: the Overview offers the appearance choice here; every other page has it on the top bar's own button.
  const overview = usePathname() === "/overview";
  return (
    <details ref={ref} className="relative" data-testid="account-menu">
      <summary className="hb-hd-me cursor-pointer list-none [&::-webkit-details-marker]:hidden" aria-label={`Account: ${name}, ${role}`}>
        <span className="hb-av" aria-hidden="true">{initials}</span>
        <span className="hidden min-w-0 sm:block">
          <b data-testid="current-user">{name}</b>
          <small>{place}</small>
        </span>
      </summary>
      <div className="absolute right-0 z-40 mt-2 w-[260px] overflow-hidden rounded-[8px] border border-[var(--hb-line)] bg-white py-1 text-[var(--hb-ink)]" style={{ boxShadow: "var(--hb-sh-menu)" }}>
        <div className="border-b border-[var(--hb-line-2)] px-3 pb-2.5 pt-2">
          <p className="truncate text-[13.5px] font-semibold" data-testid="overview-user">{name}</p>
          <p className="truncate text-[12.5px] text-[var(--hb-ink-3)]" data-testid="overview-role">{role}</p>
          <p className="mt-1 truncate text-[12.5px] text-[var(--hb-ink-3)]">{place}</p>
          {sample ? <p className="mt-1.5 w-fit rounded-[3px] border border-dashed border-slate-400 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-slate-600">Sample workspace</p> : null}
        </div>
        {overview ? (
          <div className="border-b border-[var(--hb-line-2)] py-1">
            <p className="px-3 pb-1 pt-1.5 text-[11.5px] font-semibold text-[var(--hb-ink-3)]">Appearance</p>
            <ColourModeOptions mode={mode} onChange={changeMode} />
          </div>
        ) : null}
        <form action={signOutAction}>
          <button type="submit" className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[14px] hover:bg-[var(--hb-sunken)]">
            <SignOut size={18} aria-hidden="true" className="text-[var(--hb-ink-3)]" />Sign out
          </button>
        </form>
      </div>
    </details>
  );
}

/** Today's date and time in London, shown in the top bar on the Overview (as the Overview's own header did). */
export function TopBarClock({ initial }: { initial: number }) {
  const path = usePathname();
  const [now, setNow] = useState(initial);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  if (path !== "/overview") return null;
  const at = new Date(now);
  const { date, time } = londonClock(at);
  const iso = at.toISOString();
  return (
    <span className="hb-clock hidden md:inline" data-testid="overview-clock">
      <time dateTime={iso.slice(0, 10)} data-testid="overview-date">{date}</time>
      <span aria-hidden="true"> · </span>
      <time dateTime={iso} data-testid="overview-time"><span className="sr-only">UK time </span>{time}</time>
    </span>
  );
}

/** The top bar's light / dark button, on every page except the Overview (where the account menu offers it). */
export function TopBarColourMode({ initial }: { initial: ColourMode }) {
  const path = usePathname();
  if (path === "/overview") return null;
  return <ColourModeMenu initial={initial} />;
}
