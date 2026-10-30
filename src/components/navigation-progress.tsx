"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { pageTarget } from "@/lib/navigation";
import { crossesHubEdge, portalById, portalForPath } from "@/lib/portals";

/**
 * Navigation feedback for the whole shell. A click on any link to another page, or the submission of a form that
 * goes to the server, starts a "pending" state at once: the sidebar moves to the page being opened and a thin bar
 * runs under the top bar. It ends when the new address (or the server's fresh render after a form) arrives, so the
 * feedback never claims something finished before the server answered. A slow page says so; a page that stops
 * responding offers to load it again.
 */
type Pending = { href: string | null; kind: "link" | "form" };
type State = { pending: Pending | null; phase: "idle" | "loading" | "slow" | "stalled" | "done" };

const SLOW_MS = 6_000;
const STALLED_MS = 20_000;

let state: State = { pending: null, phase: "idle" };
const listeners = new Set<() => void>();
const timers: ReturnType<typeof setTimeout>[] = [];
let marked: Element[] = [];

function emit(next: State) {
  state = next;
  listeners.forEach((l) => l());
}
function clearTimers() {
  while (timers.length) clearTimeout(timers.pop());
}

export function startNavigation(href: string | null, kind: Pending["kind"]) {
  clearTimers();
  emit({ pending: { href, kind }, phase: "loading" });
  timers.push(setTimeout(() => state.pending && emit({ ...state, phase: "slow" }), SLOW_MS));
  timers.push(setTimeout(() => state.pending && emit({ ...state, phase: "stalled" }), STALLED_MS));
}

export function endNavigation() {
  for (const el of marked) {
    el.removeAttribute("data-pending");
    el.removeAttribute("aria-busy");
  }
  marked = [];
  if (!state.pending) return;
  clearTimers();
  emit({ pending: null, phase: "done" });
  timers.push(setTimeout(() => emit({ pending: null, phase: "idle" }), 320));
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const read = () => state;
const IDLE: State = { pending: null, phase: "idle" };
const readServer = () => IDLE;

export function useNavigationState(): State {
  return useSyncExternalStore(subscribe, read, readServer);
}

/** The page the person just asked for, as "path?query", while it loads; null otherwise. */
export function usePendingHref(): string | null {
  const s = useNavigationState();
  return s.pending?.kind === "link" ? s.pending.href : null;
}

/** A form whose submission goes to the server and comes back as a new render (Server Action or a plain form). */
function submitsToServer(form: HTMLFormElement, defaultPrevented: boolean): boolean {
  if (form.hasAttribute("data-no-progress") || form.target === "_blank") return false;
  if (!defaultPrevented) return !/\/api\//.test(form.action);
  // React handles Server Action forms itself (and prevents the browser's submit); they carry an action id field.
  return Boolean(form.querySelector('input[type="hidden"][name^="$ACTION_ID_"]')) || /^javascript:/i.test(form.getAttribute("action") ?? "");
}

/**
 * Mounted once in the shell. `renderKey` changes on every server render of the layout, which is how a form that
 * redirects back to the very same address still ends its pending state.
 */
export function NavigationProgress({ renderKey }: { renderKey: string }) {
  const path = usePathname();
  const params = useSearchParams();
  const address = `${path}?${params.toString()}`;
  const s = useNavigationState();

  useEffect(() => {
    const clicked = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return null;
      return pageTarget(
        { href: a.href, target: a.getAttribute("target"), optOut: a.hasAttribute("download") || a.hasAttribute("data-no-progress"), button: e.button, modified: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey, defaultPrevented: e.defaultPrevented },
        new URL(window.location.href),
      );
    };
    const onClick = (e: MouseEvent) => {
      const href = clicked(e);
      if (href) startNavigation(href, "link");
    };
    // A link into or out of the HR Hub is kept from Next.js (which would open it in place) so the browser loads a
    // fresh page, and the HR Hub's style sheet never stays behind on another page. Capture phase, before React.
    const onEdge = (e: MouseEvent) => {
      const href = clicked(e);
      if (!href || !crossesHubEdge(window.location.pathname, href.split("?")[0])) return;
      e.stopPropagation();
      startNavigation(href, "link");
    };
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      if (!(form instanceof HTMLFormElement) || !submitsToServer(form, e.defaultPrevented)) return;
      startNavigation(null, "form");
      // Mark the button that was pressed; it is not disabled, because a disabled button drops its value from a native form.
      const submitter = e.submitter ?? form.querySelector('[type="submit"]');
      for (const el of [form, submitter]) if (el) el.setAttribute(el === form ? "aria-busy" : "data-pending", "true");
      marked = [form, ...(submitter ? [submitter] : [])];
    };
    // Coming back through the browser's history cache must not show a page as still loading.
    const onShow = () => endNavigation();
    // Bubble phase on window, so this runs after React and Next.js have handled the event.
    window.addEventListener("click", onEdge, true);
    window.addEventListener("click", onClick);
    window.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onShow);
    return () => {
      window.removeEventListener("click", onEdge, true);
      window.removeEventListener("click", onClick);
      window.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);

  // A new address, or a fresh server render of the shell, means the page asked for has arrived.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    endNavigation();
  }, [address, renderKey]);

  const target = s.pending?.href ?? path;
  const colour = portalById(portalForPath(target.split("?")[0])).colour;
  return (
    <>
      <div aria-hidden="true" data-testid="nav-progress" data-phase={s.phase} className="nav-progress" style={{ "--progress": colour } as React.CSSProperties}>
        <span />
      </div>
      <SlowNotice phase={s.phase} href={s.pending?.href ?? null} />
    </>
  );
}

function SlowNotice({ phase, href }: { phase: State["phase"]; href: string | null }) {
  const show = phase === "slow" || phase === "stalled";
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[64px] z-30 flex justify-center px-4">
      {show ? (
        <div data-testid="nav-slow" className="nav-notice pointer-events-auto flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[8px] border border-[#e3e0d9] bg-white px-4 py-2 text-[13.5px] text-[#1f2d42] shadow-[0_6px_24px_rgb(11_21_48/0.12)]">
          {phase === "slow" ? (
            <span>Still loading. This page is taking longer than usual.</span>
          ) : (
            <>
              <span>This page is not responding.</span>
              {href ? <button type="button" className="font-medium text-[#0646b1] hover:underline" onClick={() => window.location.assign(href)}>Load it again</button> : null}
              <button type="button" className="text-[#5f6b7a] hover:underline" onClick={endNavigation}>Dismiss</button>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
