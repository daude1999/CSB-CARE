"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChatCircleText, ClockCountdown, MagnifyingGlass, PhoneX, UserMinus, UserPlus } from "@phosphor-icons/react";
import Link from "@/components/link";
import { TYPE_STYLE, type QueueType } from "@/components/attention-style";

export type { QueueType };

/**
 * The work queue on Visits Needing Attention. The server works out every row, its links and its group; this component
 * only filters the rows by the search box (service user or carer name) as the user types, so the list stays in the
 * page's own order. Selecting a row is a link (?item=), so the detail panel is rendered on the server.
 */

export interface QueueRow {
  key: string;
  type: QueueType;
  time: string;
  day: string;
  serviceUser: string;
  callType: string | null;
  reason: string;
  /** Lower-case text the search box matches: service user, carer and reference. */
  search: string;
  selectHref: string;
  selected: boolean;
  /** The row's accessible name, e.g. "Harold Pryce, tea call 17:00, unassigned". */
  name: string;
  action: { label: string; href: string; aria: string } | null;
}
export interface QueueGroup {
  group: "now" | "today" | "week";
  label: string;
  rows: QueueRow[];
}

const GROUP_TONE = { now: "text-[#b42318]", today: "text-[#8a5a00]", week: "text-[#475467]" } as const;
const GROUP_DOT = { now: "bg-[#d92d20]", today: "bg-[#b07a00]", week: "bg-[#667085]" } as const;

export function TypeIcon({ type, size = 20 }: { type: QueueType; size?: number }) {
  if (type === "unassigned") return <UserPlus size={size} weight="bold" aria-hidden />;
  if (type === "missed") return <PhoneX size={size} weight="bold" aria-hidden />;
  if (type === "absent") return <UserMinus size={size} weight="bold" aria-hidden />;
  if (type === "problem") return <ClockCountdown size={size} weight="bold" aria-hidden />;
  return <ChatCircleText size={size} weight="bold" aria-hidden />;
}

const TESTID: Record<QueueType, string> = { unassigned: "attention-unassigned-row", absent: "attention-absent-row", missed: "attention-missed-row", problem: "attention-problem-row", comms: "attention-comms-row" };

export function AttentionQueueList({ groups, toolbar, filters, footer, empty }: { groups: QueueGroup[]; toolbar: ReactNode; filters?: ReactNode; footer?: ReactNode; empty: string }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => groups.map((g) => ({ ...g, rows: needle ? g.rows.filter((r) => r.search.includes(needle)) : g.rows })).filter((g) => g.rows.length), [groups, needle]);
  // Keep the selected row in view when the page is opened on it.
  useEffect(() => {
    document.querySelector<HTMLElement>("[data-attn-selected='true']")?.scrollIntoView({ block: "nearest" });
  }, []);
  return (
    <section aria-labelledby="attn-queue-title" className="min-w-0 overflow-hidden rounded-[14px] border border-[#eaecf0] bg-white" data-testid="attention-queue">
      <h2 id="attn-queue-title" className="sr-only">Work queue</h2>
      <div className="flex flex-wrap items-center gap-2.5 border-b border-[#eaecf0] px-4 py-3">
        {toolbar}
        <label className="relative ml-auto min-w-[200px] flex-1 sm:max-w-[300px]">
          <span className="sr-only">Search person or carer</span>
          <MagnifyingGlass size={17} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search person or carer" className="h-10 w-full rounded-[8px] border border-[#d0d5dd] bg-white pl-9 pr-3 text-[14.5px] text-[#101828] placeholder:text-[#667085] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5b2bb5]" data-testid="attention-search" />
        </label>
        {filters}
      </div>
      {shown.length ? (
        shown.map((g) => (
          <div key={g.group} role="group" aria-labelledby={`attn-g-${g.group}`}>
            <h3 id={`attn-g-${g.group}`} className={`flex items-center gap-2 border-b border-[#eaecf0] bg-[#f9fafb] px-4 py-2.5 text-[13px] font-bold uppercase tracking-[0.04em] ${GROUP_TONE[g.group]}`} data-testid={`attention-group-${g.group}`}>
              <span aria-hidden className={`h-2 w-2 rounded-full ${GROUP_DOT[g.group]}`} />
              {g.label}
              <span className="font-semibold tabular-nums text-[#475467]">{g.rows.length}</span>
            </h3>
            <ul className="divide-y divide-[#f2f4f7]">
              {g.rows.map((r) => <Row key={r.key} r={r} />)}
            </ul>
          </div>
        ))
      ) : (
        <p className="px-4 py-10 text-center text-[15px] text-[#475467]">{needle ? "No one in this list matches your search." : empty}</p>
      )}
      {footer}
    </section>
  );
}

function Row({ r }: { r: QueueRow }) {
  const s = TYPE_STYLE[r.type];
  return (
    <li
      className={`relative flex flex-wrap items-center gap-x-4 gap-y-2 py-3 pl-4 pr-4 text-[14.5px] ${r.selected ? "bg-[#f4f0fc] shadow-[inset_3px_0_0_#5b2bb5]" : "hover:bg-[#fafafb]"}`}
      data-testid={TESTID[r.type]}
      data-attn-selected={r.selected ? "true" : undefined}
    >
      <span aria-hidden className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] ${s.tile}`}><TypeIcon type={r.type} /></span>
      <span className="w-[88px] shrink-0 leading-tight tabular-nums">
        <span className="block font-semibold text-[#101828]">{r.time}</span>
        <span className="block text-[13.5px] text-[#475467]">{r.day}</span>
      </span>
      <span className="min-w-0 flex-1 basis-[200px] leading-snug">
        <Link href={r.selectHref} scroll={false} aria-current={r.selected ? "true" : undefined} aria-label={r.name} className="block truncate font-semibold text-[#101828] no-underline after:absolute after:inset-0 after:content-[''] hover:text-[#101828] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-[#5b2bb5]">
          {r.serviceUser}{r.callType ? <span className="font-normal text-[#667085]"> · {r.callType}</span> : null}
        </Link>
        <span className="block truncate text-[13.5px] text-[#475467]" title={r.reason}>{r.reason}</span>
      </span>
      <span className="relative z-[1] ml-auto flex shrink-0 items-center gap-3">
        <span className={`hidden whitespace-nowrap rounded-full px-2.5 py-0.5 text-[13px] font-medium sm:inline-flex ${s.chip}`}>{s.label}</span>
        {r.action ? (
          <Link href={r.action.href} scroll={false} aria-label={r.action.aria} className="inline-flex h-9 items-center whitespace-nowrap rounded-[8px] bg-[#5b2bb5] px-3.5 text-[14px] font-semibold text-white no-underline hover:bg-[#4c2398] hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b2bb5]">{r.action.label}</Link>
        ) : null}
      </span>
    </li>
  );
}

/**
 * Below 1280px the detail panel is a slide-over: this shows it only on a narrow screen, so on a wide one the same
 * details stay in the right-hand column. The drawer itself is the shared DrawerShell (Escape, focus trap, backdrop).
 */
export function NarrowOnly({ children }: { children: ReactNode }) {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1279.98px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return narrow ? <>{children}</> : null;
}
