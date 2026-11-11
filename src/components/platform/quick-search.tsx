"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowElbowDownLeft, Buildings, MagnifyingGlass, Package, SignIn, User } from "@phosphor-icons/react";
import { WORKSPACES } from "./nav-config";

type Hit = { kind: "Client" | "Person" | "Plan" | "Page"; id: string; title: string; detail: string; href: string };

const PAGES: Hit[] = WORKSPACES.flatMap((w) => w.pages.map((p) => ({ kind: "Page" as const, id: p.href, title: p.label, detail: w.label, href: p.href })));
const ICON = { Client: Buildings, Person: User, Plan: Package, Page: SignIn };

/**
 * The header's quick search. Typing searches clients, people and plans on the server (with the caller's platform
 * permission) and matches Admin Centre pages by name. Arrow keys move, Enter opens, and "/" or Ctrl+K focuses it.
 * Without JavaScript the form still submits to the full search page.
 */
export function QuickSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);

  useEffect(() => {
    const term = q.trim();
    const pages = term ? PAGES.filter((p) => p.title.toLowerCase().includes(term.toLowerCase()) || p.detail.toLowerCase().includes(term.toLowerCase())).slice(0, 4) : [];
    if (term.length < 2) {
      setHits(pages);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const res = await fetch(`/api/platform/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal, headers: { accept: "application/json" } });
        const body = (await res.json()) as { hits?: Hit[]; error?: string };
        if (!res.ok) throw new Error(body.error ?? "Search failed");
        setHits([...(body.hits ?? []).slice(0, 8), ...pages]);
        setError(null);
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("Search is unavailable. Press Enter to try the full search.");
      } finally {
        setBusy(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => setCursor(-1), [hits]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  return (
    <div ref={box} className="relative w-full">
      <form
        role="search"
        action="/platform-admin/search"
        onSubmit={(e) => {
          if (cursor >= 0 && hits[cursor]) {
            e.preventDefault();
            go(hits[cursor].href);
          }
        }}
      >
        <label className="relative block">
          <span className="sr-only">Search clients, people, plans and pages</span>
          <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-px-subtle" aria-hidden="true" />
          <input
            ref={input}
            name="q"
            type="search"
            value={q}
            autoComplete="off"
            role="combobox"
            aria-expanded={open && q.trim().length > 0}
            aria-controls={listId}
            aria-activedescendant={cursor >= 0 ? `${listId}-${cursor}` : undefined}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(hits.length - 1, c + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(-1, c - 1));
              } else if (e.key === "Escape") {
                setOpen(false);
                input.current?.blur();
              }
            }}
            placeholder="Search clients, people, plans"
            className="h-9 w-full rounded-[8px] border border-px-line bg-px-field pl-9 pr-12 text-body text-px-ink placeholder:text-px-faint focus:border-px-focus focus:bg-white focus:outline-none focus:ring-2 focus:ring-px-accent-soft"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded-[4px] border border-px-line bg-white px-1.5 font-sans text-micro text-px-subtle lg:block">Ctrl K</kbd>
        </label>
      </form>
      {open && q.trim() ? (
        <div className="absolute left-0 right-0 z-50 mt-1.5 overflow-hidden rounded-[10px] border border-px-line bg-white shadow-[0_12px_32px_-8px_rgba(15,27,61,0.25)]">
          <ul id={listId} role="listbox" aria-label="Search results" className="max-h-[60vh] overflow-y-auto py-1">
            {hits.map((h, i) => {
              const Ico = ICON[h.kind];
              return (
                <li key={`${h.kind}-${h.id}`} id={`${listId}-${i}`} role="option" aria-selected={i === cursor}>
                  <button type="button" onMouseEnter={() => setCursor(i)} onClick={() => go(h.href)} className={`flex w-full items-center gap-3 px-3 py-2 text-left ${i === cursor ? "bg-px-accent-tint" : ""}`}>
                    <Ico size={16} className="shrink-0 text-px-muted" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium text-px-ink">{h.title}</span>
                      <span className="block truncate text-caption text-px-muted">{h.kind === "Page" ? `Go to page · ${h.detail}` : h.detail}</span>
                    </span>
                    <span className="shrink-0 text-micro uppercase tracking-[0.04em] text-px-faint">{h.kind}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t border-px-divider bg-px-field px-3 py-1.5 text-caption text-px-muted" aria-live="polite">
            <span>{error ?? (busy ? "Searching…" : hits.length ? `${hits.length} result${hits.length === 1 ? "" : "s"}` : q.trim().length < 2 ? "Keep typing" : "No matches")}</span>
            <span className="flex items-center gap-1"><ArrowElbowDownLeft size={12} aria-hidden="true" /> all results</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
