"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { CaretLeft, CaretRight } from "@phosphor-icons/react";
import { STATE_KEY, afterPush, arrive, canBack, canForward, idxOf, parsePos, type NavPos } from "@/lib/app-history";

/**
 * Back and Forward for the platform header. They follow this tab's own history of platform pages: each entry Next.js
 * creates is tagged with its position, so a direction is offered only when a platform page is known to be there.
 * They never lead to another site, keep each page's filters (they are in the address), and ask before leaving a page
 * with unsaved changes. Works across full page loads (the HR Hub, refresh, plain forms) through session storage.
 */
const POS_KEY = "csb-nav";
const LEFT_KEY = "csb-nav-left";
const SCROLL_KEY = "csb-nav-scroll";

let pos: NavPos | null = null;
let restoreTo: number | null = null;
const listeners = new Set<() => void>();

function store(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Private windows and blocked storage: the buttons still work within this page load.
  }
}
function load(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function set(next: NavPos | null) {
  pos = next;
  store(POS_KEY, next ? JSON.stringify(next) : null);
  listeners.forEach((l) => l());
}

function scrolls(): Record<string, number> {
  try {
    const v: unknown = JSON.parse(load(SCROLL_KEY) ?? "{}");
    return v && typeof v === "object" ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function saveScroll() {
  if (!pos) return;
  const all = scrolls();
  all[String(pos.idx)] = Math.round(window.scrollY);
  // Keep the nearest 50 positions only.
  const keys = Object.keys(all).map(Number).sort((a, b) => a - b);
  for (const k of keys.slice(0, Math.max(0, keys.length - 50))) delete all[String(k)];
  store(SCROLL_KEY, JSON.stringify(all));
}

type HistoryFn = (data: unknown, unused: string, url?: string | URL | null) => void;
const isNext = (data: unknown): data is Record<string, unknown> => !!data && typeof data === "object" && (data as Record<string, unknown>).__NA === true;

/** Installs the history tracking once per page load. Next.js's own history calls pass through the wrappers. */
function install() {
  const w = window as Window & { __csbHistory?: boolean };
  if (w.__csbHistory) return;
  w.__csbHistory = true;

  const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  const how = nav?.type === "reload" ? "reload" : nav?.type === "back_forward" ? "back_forward" : "navigate";
  const left = parseLeft(load(LEFT_KEY));
  store(LEFT_KEY, null);
  let sameOrigin = false;
  try {
    sameOrigin = !!document.referrer && new URL(document.referrer).origin === window.location.origin;
  } catch {
    sameOrigin = false;
  }
  const fromApp = sameOrigin && !!left && Date.now() - left.at < 120_000;
  set(arrive(how, idxOf(window.history.state), parsePos(load(POS_KEY)), left?.idx ?? null, fromApp));
  // Tag the entry the page opened on (Next.js has written its own state by now).
  if (pos && isNext(window.history.state)) window.history.replaceState({ ...window.history.state, [STATE_KEY]: pos.idx }, "", window.location.href);

  const push: HistoryFn = window.history.pushState.bind(window.history);
  const replace: HistoryFn = window.history.replaceState.bind(window.history);
  window.history.pushState = function pushState(data: unknown, unused: string, url?: string | URL | null) {
    saveScroll();
    const next = afterPush(pos);
    set(next);
    // Only Next.js's own entries are tagged: adding state to anyone else's would make Next.js reload on Back.
    return push(isNext(data) ? { ...data, [STATE_KEY]: next.idx } : data, unused, url);
  };
  window.history.replaceState = function replaceState(data: unknown, unused: string, url?: string | URL | null) {
    return replace(isNext(data) && pos ? { ...data, [STATE_KEY]: pos.idx } : data, unused, url);
  };

  let traversing = false;
  window.addEventListener("popstate", (e) => {
    saveScroll();
    traversing = true;
    setTimeout(() => (traversing = false), 0);
    set(arrive("traverse", idxOf(e.state), pos, null, false));
    restoreTo = pos ? scrolls()[String(pos.idx)] ?? null : null;
  });
  // A link to a #fragment adds an untagged entry: Back from it is known, Forward past it is not.
  window.addEventListener("hashchange", () => {
    if (!traversing && window.history.state === null) set(afterPush(pos));
  });
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      saveScroll();
    });
  }, { passive: true });
  window.addEventListener("pagehide", () => {
    saveScroll();
    store(LEFT_KEY, JSON.stringify({ idx: pos?.idx ?? null, at: Date.now() }));
  });
  // Restored from the browser's page cache (Back or Forward to a page across a full page load).
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    const back = parseLeft(load(LEFT_KEY));
    store(LEFT_KEY, null);
    set(arrive("back_forward", idxOf(window.history.state), parsePos(load(POS_KEY)), back?.idx ?? null, false));
  });
}

function parseLeft(raw: string | null): { idx: number | null; at: number } | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return null;
    const { idx, at } = v as Record<string, unknown>;
    if (typeof at !== "number") return null;
    return { idx: typeof idx === "number" ? idx : null, at };
  } catch {
    return null;
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const read = () => pos;
const readServer = () => null;

/** Mounted once in the shell, always (on the Overview too), so every page is tracked. Renders nothing. */
export function AppHistory() {
  const path = usePathname();
  const params = useSearchParams();
  const address = `${path}?${params.toString()}`;
  useEffect(() => install(), []);
  // After Back or Forward inside the app, put the page back where it was scrolled to, once it is tall enough.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const y = restoreTo;
    restoreTo = null;
    if (!y) return;
    let tries = 0;
    const step = () => {
      const room = document.documentElement.scrollHeight - window.innerHeight;
      if (room >= y || ++tries > 20) window.scrollTo({ top: Math.min(y, Math.max(0, room)) });
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [address]);
  return null;
}

const UNSAVED = "You have unsaved changes on this page. Leave without saving them?";

const BTN = "flex h-8 w-8 items-center justify-center rounded-[6px] text-[#0b1530] hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#0369d5] disabled:cursor-default disabled:text-[#0b1530]/30 disabled:hover:bg-transparent";

/** The compact Back and Forward buttons in the header. Disabled until the page knows where it is. */
export function HistoryButtons() {
  const p = useSyncExternalStore(subscribe, read, readServer);
  const go = (dir: -1 | 1) => {
    if (document.querySelector('[data-unsaved="true"]') && !window.confirm(UNSAVED)) return;
    if (dir < 0) window.history.back();
    else window.history.forward();
  };
  const back = canBack(p);
  const fwd = canForward(p);
  return (
    <nav aria-label="Page history" className="flex items-center gap-0.5" data-testid="history-nav">
      <button type="button" onClick={() => go(-1)} disabled={!back} aria-label="Back to the previous page" title={back ? "Back" : "No previous page in the platform"} className={BTN}>
        <CaretLeft size={18} weight="bold" aria-hidden="true" />
      </button>
      <button type="button" onClick={() => go(1)} disabled={!fwd} aria-label="Forward to the next page" title={fwd ? "Forward" : "No next page"} className={BTN}>
        <CaretRight size={18} weight="bold" aria-hidden="true" />
      </button>
    </nav>
  );
}
