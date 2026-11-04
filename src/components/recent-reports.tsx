"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "@/components/link";

/**
 * Recently viewed reports on Analytics. When a manager opens the report behind a measure, the measure's key and link
 * are remembered in this browser only (no server tracking). They are shown again only for measures the signed-in
 * member may still see: the page passes that list in, so a measure that is no longer allowed is never named.
 */

const MAX = 5;
type Seen = { key: string; href: string };
export type RecentReportOption = { key: string; name: string; area: string };

/** Only links inside the platform are kept, so a stored value can never become an outside or script link. */
const safeHref = (h: unknown): h is string => typeof h === "string" && /^\/(?![/\\])/.test(h) && h.length < 400;

function read(storageKey: string): Seen[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is Seen => typeof x === "object" && x !== null && typeof (x as Seen).key === "string" && safeHref((x as Seen).href)).slice(0, MAX);
  } catch {
    return [];
  }
}

function write(storageKey: string, list: Seen[]) {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(list.slice(0, MAX)));
  } catch {
    /* storage blocked: the section simply stays empty */
  }
}

export function RecentReports({ userId, options }: { userId: string; options: RecentReportOption[] }) {
  const storageKey = `csb.analytics.recent:${userId}`;
  const [seen, setSeen] = useState<Seen[]>([]);

  useEffect(() => {
    setSeen(read(storageKey));
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("tr[data-kpi] a[href]");
      const key = a?.closest("tr")?.getAttribute("data-kpi");
      const href = a?.getAttribute("href");
      if (!key || !safeHref(href)) return;
      write(storageKey, [{ key, href }, ...read(storageKey).filter((s) => s.key !== key)]);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [storageKey]);

  const clear = useCallback(() => {
    write(storageKey, []);
    setSeen([]);
  }, [storageKey]);

  const byKey = new Map(options.map((o) => [o.key, o]));
  const shown = seen.flatMap((s) => {
    const o = byKey.get(s.key);
    return o ? [{ ...o, href: s.href }] : [];
  });
  if (!shown.length) return null;

  return (
    <section aria-labelledby="recent-reports-title" data-testid="recent-reports" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 px-1 text-[13.5px]">
      <h2 id="recent-reports-title" className="text-[13.5px] font-semibold text-slate-700">Recently viewed reports</h2>
      <ul className="flex flex-wrap gap-2">
        {shown.map((r) => (
          <li key={r.key}>
            <Link href={r.href} className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 bg-white px-3 py-1 text-navy-900 no-underline hover:border-slate-400">
              {r.name}<span className="text-[12px] text-slate-500">{r.area}</span>
            </Link>
          </li>
        ))}
      </ul>
      <button type="button" onClick={clear} className="text-[12.5px] text-slate-600 underline">Clear</button>
    </section>
  );
}
