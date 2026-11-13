"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ArrowUpRight, Plus } from "@phosphor-icons/react";
import { initials } from "@/lib/day-board";
import { crossesHubEdge, portalById, portalForPath } from "@/lib/portals";
import type { CommandLink, CommandResults } from "@/server/search/command";
import { OPEN_COMMAND_EVENT } from "@/lib/shell-slots";

/**
 * The command bar (approved redesign, 10 Nov 2026): Ctrl+K, or Cmd+K on a Mac, opens a centred search dialog from any
 * page. Results are grouped as Service users, Staff, Visits today, Pages and Actions. Records come from
 * /api/search/command, which scopes them to the signed-in member on the server; pages and actions are the ones the
 * app layout already worked out the member may open. Arrow keys move, Enter opens, Esc closes and puts focus back.
 */

export interface CommandPage extends CommandLink {
  /** Only the module home pages are listed before anything is typed. */
  home?: boolean;
}

type Row = { key: string; group: string; title: string; detail: string; href: string; chip: { text: string; solid?: boolean } | { icon: "plus" | "open" } };

const GROUPS = ["Service users", "Staff", "Visits today", "Pages", "Actions"] as const;
const MAX_LINKS = 6;

/** Every word typed must appear in the label or its hint. */
export function matchesLink(link: { label: string; hint: string }, q: string) {
  const text = `${link.label} ${link.hint}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => text.includes(w));
}

export function buildRows(q: string, results: CommandResults | null, pages: CommandPage[], actions: CommandLink[]): Row[] {
  const typed = q.trim();
  const rows: Row[] = [];
  if (results && typed.length >= 2) {
    for (const s of results.serviceUsers) rows.push({ key: `su-${s.id}`, group: "Service users", title: s.title, detail: s.detail, href: s.href, chip: { text: initials(s.title), solid: true } });
    for (const s of results.staff) rows.push({ key: `st-${s.id}`, group: "Staff", title: s.title, detail: s.detail, href: s.href, chip: { text: initials(s.title) } });
    for (const v of results.visitsToday) rows.push({ key: `v-${v.id}`, group: "Visits today", title: v.title, detail: v.detail, href: v.href, chip: { text: v.hour } });
  }
  const shownPages = typed ? pages.filter((p) => matchesLink(p, typed)).slice(0, MAX_LINKS) : pages.filter((p) => p.home);
  for (const p of shownPages) rows.push({ key: `p-${p.href}`, group: "Pages", title: p.label, detail: p.hint, href: p.href, chip: { icon: "open" } });
  // Actions for the first service user found come first, then the general actions that match what was typed.
  const first = results && typed.length >= 2 ? results.serviceUsers[0] : undefined;
  if (first) {
    if (first.addVisitHref) rows.push({ key: `a-add-${first.id}`, group: "Actions", title: `Add a visit for ${first.title}`, detail: "Rota", href: first.addVisitHref, chip: { icon: "plus" } });
    rows.push({ key: `a-plan-${first.id}`, group: "Actions", title: `Open care plans for ${first.title}`, detail: "Service user record", href: first.carePlanHref, chip: { icon: "open" } });
  }
  for (const a of (typed ? actions.filter((x) => matchesLink(x, typed)) : actions).slice(0, MAX_LINKS)) rows.push({ key: `a-${a.href}`, group: "Actions", title: a.label, detail: a.hint, href: a.href, chip: { icon: "plus" } });
  return rows;
}

export function CommandBar({ pages, actions }: { pages: CommandPage[]; actions: CommandLink[] }) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  // Closing without opening anything puts focus back where it was; opening a result moves to another page instead.
  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    const el = opener.current;
    opener.current = null;
    if (restoreFocus) requestAnimationFrame(() => el?.isConnected && el.focus());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "k") return;
      // Before any page's own handler, so the shortcut means the same thing on every page.
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen((was) => {
        if (!was) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        return true;
      });
    };
    // The Harbour menu's "Search or jump to" opens the same bar.
    const onOpen = () => setOpen((was) => {
      if (!was) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      return true;
    });
    window.addEventListener("keydown", onKey, true);
    window.addEventListener(OPEN_COMMAND_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener(OPEN_COMMAND_EVENT, onOpen);
    };
  }, []);

  return open ? <CommandDialog pages={pages} actions={actions} onClose={close} /> : null;
}

function CommandDialog({ pages, actions, onClose }: { pages: CommandPage[]; actions: CommandLink[]; onClose: (restoreFocus: boolean) => void }) {
  const router = useRouter();
  const path = usePathname();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CommandResults | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">("idle");
  const [active, setActive] = useState(0);
  const [mac, setMac] = useState(false);

  useEffect(() => {
    input.current?.focus();
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
  }, []);

  // Records are looked up a moment after typing stops; an answer for an older entry is dropped.
  useEffect(() => {
    const typed = q.trim();
    if (typed.length < 2) {
      setResults(null);
      setState("idle");
      return;
    }
    let live = true;
    setState("loading");
    const timer = setTimeout(() => {
      fetch(`/api/search/command?q=${encodeURIComponent(typed)}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<CommandResults>) : Promise.reject(new Error(String(r.status)))))
        .then((d) => {
          if (!live) return;
          setResults(d);
          setState("idle");
        })
        .catch(() => live && setState("failed"));
    }, 160);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q]);

  const rows = useMemo(() => buildRows(q, results, pages, actions), [q, results, pages, actions]);
  useEffect(() => setActive(0), [q, results]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (href: string) => {
    onClose(false);
    if (crossesHubEdge(path, href.split("?")[0]!)) window.location.assign(href);
    else router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose(true);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (rows.length) setActive((i) => (i + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length) setActive((i) => (i - 1 + rows.length) % rows.length);
    } else if (e.key === "Home" && rows.length && e.ctrlKey) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const row = rows[active];
      if (row) go(row.href);
    } else if (e.key === "Tab") {
      // The search box is the dialog's one stop; the list is driven from it with the arrow keys.
      e.preventDefault();
    }
  };

  const typed = q.trim();
  const style = { "--module": portalById(portalForPath(path)).colour } as CSSProperties;
  const activeId = rows[active] ? `command-row-${active}` : undefined;
  let index = -1;

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center px-4 pt-[12vh]" style={style} onKeyDown={onKeyDown}>
      <div aria-hidden className="absolute inset-0 bg-[#101828]/40" onClick={() => onClose(true)} />
      <div role="dialog" aria-modal="true" aria-label="Search and commands" data-testid="command-bar" className="relative flex max-h-[min(560px,76vh)] w-full max-w-[640px] flex-col overflow-hidden rounded-[14px] bg-white shadow-[0_24px_48px_rgba(16,24,40,0.24)]">
        <div className="flex items-center gap-3 border-b border-rule px-5 py-3.5">
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="command-list"
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Search service users, staff, visits, pages and actions"
            placeholder="Search service users, staff, visits, pages…"
            maxLength={100}
            autoComplete="off"
            spellCheck={false}
            className="h-9 min-w-0 flex-1 bg-transparent text-[18px] text-ink caret-module placeholder:text-[#667085] focus:outline-none"
          />
          <button type="button" tabIndex={-1} onClick={() => onClose(true)} aria-label="Close search" className="rounded-[6px] border border-rule px-2 py-0.5 text-[12px] text-status-ink hover:bg-[#f2f4f7]">Esc</button>
        </div>
        <div ref={list} id="command-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {GROUPS.map((g) => {
            const mine = rows.filter((r) => r.group === g);
            if (!mine.length) return null;
            return (
              <div key={g} role="group" aria-labelledby={`command-group-${g.replace(/\s+/g, "-")}`}>
                <div id={`command-group-${g.replace(/\s+/g, "-")}`} className="px-3 pb-1.5 pt-4 text-[12px] font-semibold uppercase tracking-[0.06em] text-status-ink">{g}</div>
                {mine.map((r) => {
                  index += 1;
                  const i = index;
                  const on = i === active;
                  return (
                    <div key={r.key} id={`command-row-${i}`} data-index={i} role="option" aria-selected={on} data-testid="command-row" data-active={on ? "" : undefined} onMouseMove={() => setActive(i)} onClick={() => go(r.href)} className={`flex cursor-pointer items-center gap-3 rounded-[8px] px-3 py-2.5 ${on ? "bg-module/10" : ""}`}>
                      <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-[11.5px] font-semibold tabular-nums ${"text" in r.chip && r.chip.solid ? "bg-module text-white" : "bg-[#f2f4f7] text-ink"}`}>
                        {"text" in r.chip ? r.chip.text : r.chip.icon === "plus" ? <Plus size={13} weight="bold" /> : <ArrowUpRight size={13} weight="bold" />}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{r.title}</span>
                      <span className="max-w-[45%] shrink-0 truncate text-[13px] text-status-ink">{r.detail}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
          <p role="status" className={rows.length && state !== "failed" && !results?.referenceProblem ? "sr-only" : "px-3 py-4 text-[14px] text-status-ink"}>
            {state === "failed" ? "People and visits could not be searched just now. Pages and actions still work." : results?.referenceProblem ? results.referenceProblem : rows.length ? `${rows.length} result${rows.length === 1 ? "" : "s"}` : state === "loading" ? "Searching…" : typed.length < 2 ? "Type at least two letters to search people and visits." : `Nothing you are allowed to see matches “${typed}”.`}
          </p>
        </div>
        <div className="flex items-center gap-4 border-t border-rule bg-[#fafbfc] px-5 py-2.5 text-[12.5px] text-status-ink">
          <span><span aria-hidden>↑↓</span> to move</span>
          <span>Enter to open</span>
          <span className="ml-auto">{mac ? "⌘K" : "Ctrl K"} from any page</span>
        </div>
      </div>
    </div>
  );
}
