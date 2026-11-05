"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { BookmarkSimple, Star } from "@phosphor-icons/react";
import { togglePolicyBookmarkAction } from "@/app/actions";
import { prefersReducedMotion } from "@/lib/motion";

/**
 * The Policy Reader's moving parts (owner's spec of 5 Nov 2026): one continuous document, a sticky strip of section
 * cards that follows the reader as they scroll, and a reading-progress card.
 *
 * How the active section is found: one line just under the sticky strip is the "reading line". The active section is
 * the last one whose top has passed that line; at the very bottom of the page the last section wins. One line and one
 * rule, so the highlight cannot flicker between two sections near a boundary. Scrolling is read on animation frames
 * only. While a click-scroll is running the clicked section stays highlighted, so the strip does not run through
 * every section on the way.
 *
 * Reading progress is only how far down the document the reader is. It is never an acknowledgement: signing stays
 * with Read & Sign.
 */

export type ReaderNavItem = { id: string; label: string; number: number; icon: ReactNode };

type ReaderState = { active: string; progress: number; items: ReaderNavItem[]; go: (id: string, push?: boolean) => void };
const ReaderContext = createContext<ReaderState | null>(null);

function useReader() {
  const c = useContext(ReaderContext);
  if (!c) throw new Error("Policy reader parts must sit inside <PolicyReader>");
  return c;
}

const topbarHeight = () => document.querySelector<HTMLElement>(".shell-topbar, .ov-topbar")?.getBoundingClientRect().height ?? 0;

export function PolicyReader({ items, initial, children }: { items: ReaderNavItem[]; initial?: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(items[0]?.id ?? "");
  const [progress, setProgress] = useState(0);
  const lock = useRef<{ id: string; until: number } | null>(null);

  /** Space taken at the top of the window by the shell's top bar and the sticky section strip. */
  const offset = useCallback(() => {
    const strip = root.current?.querySelector<HTMLElement>("[data-reader-strip]");
    return topbarHeight() + (strip?.getBoundingClientRect().height ?? 0) + 12;
  }, []);

  // Sections and the side panel sit just below the sticky strip, whatever its height at this screen width.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const apply = () => el.style.setProperty("--reader-top", `${Math.round(offset())}px`);
    apply();
    const ro = new ResizeObserver(apply);
    const strip = el.querySelector<HTMLElement>("[data-reader-strip]");
    if (strip) ro.observe(strip);
    window.addEventListener("resize", apply);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [offset]);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = offset() + 8;
      const sections = items.map((i) => document.getElementById(i.id)).filter((x): x is HTMLElement => Boolean(x));
      if (!sections.length) return;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let current = sections[0]!.id;
      for (const s of sections) if (s.getBoundingClientRect().top <= line) current = s.id;
      if (atBottom) current = sections[sections.length - 1]!.id;
      const l = lock.current;
      if (l && Date.now() < l.until) current = l.id;
      else lock.current = null;
      setActive(current);
      // Progress through the document: 0% with its top under the strip, 100% when its end is in view.
      const doc = root.current?.querySelector<HTMLElement>("[data-reader-document]");
      if (doc) {
        const r = doc.getBoundingClientRect();
        const span = r.height - (window.innerHeight - line);
        const done = span <= 0 ? 1 : (line - r.top) / span;
        setProgress(Math.round(Math.min(1, Math.max(0, done)) * 100));
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const release = () => {
      lock.current = null;
      onScroll();
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("scrollend", release);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scrollend", release);
    };
  }, [items, offset]);

  const go = useCallback(
    (id: string, push = true) => {
      const target = document.getElementById(id);
      if (!target) return;
      const reduce = prefersReducedMotion();
      lock.current = { id, until: Date.now() + (reduce ? 50 : 1200) };
      setActive(id);
      const top = target.getBoundingClientRect().top + window.scrollY - offset() + 4;
      window.scrollTo({ top: Math.max(0, top), behavior: reduce ? "auto" : "smooth" });
      if (push) history.pushState(history.state, "", `${location.pathname}${location.search}#${id}`);
      // Move keyboard and screen-reader focus to the section heading without a second jump.
      target.querySelector<HTMLElement>("[data-reader-heading]")?.focus({ preventScroll: true });
    },
    [offset],
  );

  // Open at a section named in the address (#purpose) or by an older link (?view=procedure), and follow Back/Forward.
  useEffect(() => {
    const fromHash = () => decodeURIComponent(location.hash.slice(1));
    const start = fromHash() || initial;
    if (start && items.some((i) => i.id === start)) requestAnimationFrame(() => go(start, false));
    const onPop = () => {
      const id = fromHash();
      if (id && items.some((i) => i.id === id)) go(id, false);
      else if (!id) window.scrollTo({ top: 0 });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [go, initial, items]);

  return (
    <ReaderContext.Provider value={{ active, progress, items, go }}>
      <div ref={root} className="policy-reader">{children}</div>
    </ReaderContext.Provider>
  );
}

/** The sticky strip of section cards. The active card is purple and is kept in view inside the strip. */
export function ReaderNav({ after }: { after?: ReactNode }) {
  const { active, items, go, progress } = useReader();
  const list = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const strip = list.current;
    const item = strip?.querySelector<HTMLElement>(`[data-id="${CSS.escape(active)}"]`);
    if (!strip || !item) return;
    const left = item.offsetLeft - strip.clientWidth / 2 + item.clientWidth / 2;
    strip.scrollTo({ left, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [active]);

  // Arrow keys move between cards, Home and End jump to the first and last (the strip is one tab stop per card).
  const onKey = (e: KeyboardEvent<HTMLOListElement>) => {
    const links = [...(list.current?.querySelectorAll<HTMLAnchorElement>("a[data-id]") ?? [])];
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (at < 0) return;
    const next = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? links.length - 1 : null;
    if (next === null) return;
    e.preventDefault();
    links[Math.max(0, Math.min(links.length - 1, next))]?.focus();
  };

  return (
    <div data-reader-strip className="reader-strip">
      <nav aria-label="Policy sections" className="min-w-0 flex-1">
        <ol ref={list} onKeyDown={onKey} className="reader-strip-list" data-testid="reader-nav">
          {items.map((i) => (
            <li key={i.id}>
              <a
                href={`#${i.id}`}
                data-id={i.id}
                aria-current={active === i.id ? "location" : undefined}
                className="reader-card"
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                  e.preventDefault();
                  go(i.id);
                }}
              >
                <span aria-hidden="true" className="reader-card-icon">{i.icon}</span>
                <span className="reader-card-label">{i.label}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {after}
      {/* Below desktop the Policy Progress card sits after the document, so the strip carries a thin progress line. */}
      <span aria-hidden="true" className="reader-strip-progress" style={{ width: `${progress}%` }} />
    </div>
  );
}

/** "Policy Progress": the section on screen, how many there are, and how far down the document the reader is. */
export function ReaderProgress() {
  const { active, progress, items } = useReader();
  const at = Math.max(0, items.findIndex((i) => i.id === active));
  const current = items[at];
  return (
    <section className="reader-panel" aria-labelledby="reader-progress-title" data-testid="reader-progress">
      <h2 id="reader-progress-title" className="reader-panel-title">Policy Progress</h2>
      <p className="mt-1 text-[13.5px] text-[#475467]">
        Section <strong className="font-semibold text-[#101828]" data-testid="reader-progress-section">{at + 1}</strong> of {items.length}
        {current ? <span className="block truncate text-[12.5px] text-[#667085]">{current.label}</span> : null}
      </p>
      <div className="mt-3 flex items-center justify-between text-[12.5px] text-[#475467]">
        <span>Progress</span>
        <span className="font-semibold text-[#5b2bb5]" data-testid="reader-progress-value">{progress}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#ede7fb]" role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
        <div className="h-full rounded-full bg-[#5b2bb5] transition-[width] duration-150" style={{ width: `${progress}%` }} />
      </div>
      <p className="mt-2.5 text-[12px] leading-[17px] text-[#667085]">Shows how far you have read. It does not sign the policy: use Log Read &amp; Sign for that.</p>
    </section>
  );
}

/** "Mark as Important" and "Add to Reading List": the signed-in person's own markers, saved without reloading the page. */
export function BookmarkToggle({ policyId, kind, initial }: { policyId: string; kind: "IMPORTANT" | "READING_LIST"; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const label = kind === "IMPORTANT" ? (on ? "Marked as important" : "Mark as Important") : on ? "On your reading list" : "Add to Reading List";
  const Icon = kind === "IMPORTANT" ? Star : BookmarkSimple;
  return (
    <>
      <button
        type="button"
        className="reader-action"
        aria-pressed={on}
        disabled={pending}
        data-testid={`bookmark-${kind.toLowerCase()}`}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await togglePolicyBookmarkAction({ policyId, kind });
            if (r.ok) setOn(r.data);
            else setError(r.error);
          })
        }
      >
        <Icon size={18} weight={on ? "fill" : "regular"} aria-hidden="true" className={on ? "text-[#5b2bb5]" : undefined} />
        <span className="flex-1 text-left">{label}</span>
        {on ? <span className="text-[12px] font-medium text-[#5b2bb5]">{kind === "IMPORTANT" ? "Undo" : "Remove"}</span> : null}
      </button>
      {error ? <p role="alert" className="px-3 pb-1 text-[12px] font-medium text-[#a3242c]">{error}</p> : null}
    </>
  );
}
