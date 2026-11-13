"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { saveVisitStaffingAction } from "@/app/visit-panel-actions";
import { placeNumber } from "@/lib/carer-places";

/**
 * The client side of the Daily Rota's Visit Details panel: the staffing draft (who fills each carer place before Save
 * Changes), closing the panel by clicking outside it or pressing Escape, Previous/Next with the arrow keys, and the
 * Unsaved Changes prompt that stands between a draft and anything that would lose it. Nothing here decides what is
 * allowed: the save goes to the server, which checks everything again, and the panel only says "saved" after the commit.
 */

export interface StaffingDraft {
  /** Places the coordinator changed: the carer who should fill each one, or null to leave it empty. */
  places: Record<string, string | null>;
  required: number;
  acceptWarnings: boolean;
  /** The visit version the coordinator started from. Saving against it means a colleague's newer save is never overwritten. */
  base: number;
}

type RawDraft = { places: Record<string, string | null>; required: number | null; acceptWarnings: boolean; base: number | null };

interface PanelState {
  visitId: string;
  editing: boolean;
  /** Opens the carer editor, optionally with one change already made (the X on a carer, Add Carer). */
  startEditing: (change?: { place: string; staffId: string | null } | { addPlace: true }) => void;
  stopEditing: () => void;
  draft: StaffingDraft;
  setPlace: (place: string, staffId: string | null) => void;
  setRequired: (n: number) => void;
  setAcceptWarnings: (v: boolean) => void;
  /** The carer saved in each place now (from the database). */
  current: Record<string, string>;
  carersRequired: number;
  changeCount: number;
  /** A chosen carer needs a check, so the coordinator must confirm they have read the warnings. */
  needsAck: boolean;
  dirty: boolean;
  saving: boolean;
  error: { message: string; place?: string; stale?: boolean } | null;
  /** The confirmation after a committed save. */
  saved: string | null;
  save: () => Promise<boolean>;
  discard: () => void;
  reloadLatest: () => void;
  /** Goes to a link, asking first when there are unsaved changes. */
  go: (href: string) => void;
}

const Ctx = createContext<PanelState | null>(null);

export function usePanel() {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePanel is used outside the Visit Details panel");
  return c;
}

/** The changes a draft makes compared with what is saved. */
export function draftChanges(draft: StaffingDraft, current: Record<string, string>, required: number) {
  const places = Object.entries(draft.places)
    .filter(([place]) => (placeNumber(place) ?? 0) <= draft.required || current[place] !== undefined)
    .filter(([place, staffId]) => (current[place] ?? null) !== staffId)
    .map(([place, staffId]) => ({ place, staffId }));
  return { places, countChanged: draft.required !== required };
}

const INTERACTIVE = "a,button,input,select,textarea,label,summary,details,dialog,[role=button],[role=dialog],[role=menu],[role=listbox],[contenteditable=true]";
const TYPING = "input,select,textarea,[contenteditable=true],[role=listbox],[role=menu],[role=slider],[role=combobox]";

export function VisitPanelShell({
  visitId,
  lockVersion,
  carersRequired,
  current,
  closeHref,
  prevHref,
  nextHref,
  reviewStaffIds,
  children,
}: {
  visitId: string;
  lockVersion: number;
  carersRequired: number;
  current: Record<string, string>;
  closeHref: string;
  prevHref: string | null;
  nextHref: string | null;
  /** Carers the eligibility service says need a check for this visit. */
  reviewStaffIds: string[];
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const asideRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const savingRef = useRef(false);
  /** Set while the panel itself carries on with a link or form the prompt held back, so it is not held back again. */
  const bypass = useRef(false);
  // The draft as edited. The number of places and the starting version are filled in from the saved visit until the
  // coordinator makes a change, so a draft never carries stale numbers from before a save.
  const empty = useCallback((): RawDraft => ({ places: {}, required: null, acceptWarnings: false, base: null }), []);
  const [editing, setEditing] = useState(false);
  const [raw, setRaw] = useState<RawDraft>(empty);
  const draft: StaffingDraft = useMemo(() => ({ places: raw.places, acceptWarnings: raw.acceptWarnings, required: raw.required ?? carersRequired, base: raw.base ?? lockVersion }), [raw, carersRequired, lockVersion]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<PanelState["error"]>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, setPending] = useState<{ kind: "href"; href: string } | { kind: "submit"; form: HTMLFormElement; submitter: HTMLElement | null } | null>(null);

  const { places: changes, countChanged } = draftChanges(draft, current, carersRequired);
  const changeCount = changes.length + (countChanged ? 1 : 0);
  const dirty = editing && changeCount > 0;
  const needsAck = changes.some((c) => c.staffId && reviewStaffIds.includes(c.staffId));

  // A newly saved visit (a new version from the server) or a different visit starts from a clean draft.
  const version = `${visitId}:${lockVersion}`;
  const lastVersion = useRef(version);
  useEffect(() => {
    if (lastVersion.current === version) return;
    const sameVisit = lastVersion.current.split(":")[0] === visitId;
    lastVersion.current = version;
    if (sameVisit) {
      // The same visit, saved again (by us or a colleague): an editor with nothing in it follows the new version; a
      // draft keeps the version it started from, so saving it reports the colleague's change instead of overwriting it.
      if (!dirty) setRaw(empty());
      return;
    }
    setRaw(empty());
    setEditing(false);
    setError(null);
    setSaved(null);
    // A different visit opens at the top of the panel.
    asideRef.current?.querySelector<HTMLElement>("[data-panel-scroll]")?.scrollTo({ top: 0 });
  }, [version, visitId, empty, dirty]);

  // Moving to another tab of the same visit leaves the editor when nothing is waiting to be saved.
  const lastSearch = useRef(search);
  useEffect(() => {
    if (lastSearch.current === search) return;
    lastSearch.current = search;
    if (!dirty) setEditing(false);
  }, [search, dirty]);

  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(null), 8000);
    return () => clearTimeout(t);
  }, [saved]);

  const save = useCallback(async () => {
    if (savingRef.current) return false;
    if (!changeCount) return false;
    if (needsAck && !draft.acceptWarnings) {
      setError({ message: "Tick that you have read the warnings for the carers you chose, then save again." });
      return false;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const r = await saveVisitStaffingAction({ visitId, lockVersion: draft.base, carersRequired: draft.required, places: changes, acceptWarnings: draft.acceptWarnings });
      if (!r.ok) {
        setError({ message: r.error, place: r.place, stale: r.stale });
        return false;
      }
      setSaved(r.message);
      setEditing(false);
      setRaw(empty());
      router.refresh();
      return true;
    } catch {
      setError({ message: "The changes could not be sent. Check your connection and try again. Nothing was saved." });
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [changeCount, needsAck, visitId, draft, changes, empty, router]);

  const discard = useCallback(() => {
    setRaw(empty());
    setEditing(false);
    setError(null);
  }, [empty]);

  const go = useCallback(
    (href: string) => {
      if (dirty) {
        setPending({ kind: "href", href });
        dialogRef.current?.showModal();
        return;
      }
      router.push(href, { scroll: false });
    },
    [dirty, router],
  );

  // Links and forms anywhere on the page: with unsaved changes, ask before leaving.
  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (bypass.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (!target || dialogRef.current?.contains(target)) return;
      const a = target.closest<HTMLAnchorElement>("a[href]");
      if (!a || a.target === "_blank" || a.hasAttribute("download") || a.dataset.panelKeep !== undefined) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ kind: "href", href: url.pathname + url.search + url.hash });
      dialogRef.current?.showModal();
    };
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement;
      if (bypass.current || dialogRef.current?.contains(form)) return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ kind: "submit", form, submitter: e.submitter });
      dialogRef.current?.showModal();
    };
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [dirty]);

  // Clicking the rota outside the panel: another visit's row opens it; empty space closes the panel.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (!target || !target.isConnected || asideRef.current?.contains(target) || dialogRef.current?.open) return;
      if (document.querySelector("[aria-modal='true']")) return; // another panel (Find Cover) is in front
      if (window.getSelection()?.toString()) return; // selecting text is not a click outside
      if (target.closest(INTERACTIVE)) return;
      const row = target.closest<HTMLElement>("tr[data-href]");
      if (row?.dataset.href) {
        go(row.dataset.href);
        return;
      }
      if (target.closest("tr, thead, [data-panel-ignore]")) return;
      go(closeHref);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [go, closeHref]);

  // Escape closes (an open pop-over first); Left and Right go to the previous and next visit.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || dialogRef.current?.open) return;
      if (document.querySelector("[aria-modal='true']")) return; // Find Cover handles its own keys
      const target = e.target as HTMLElement | null;
      // A pop-over the person is using: one of the panel's own, or the one that holds the focus (menus stay open by design).
      const openPop = asideRef.current?.querySelector<HTMLDetailsElement>("details[open]") ?? target?.closest<HTMLDetailsElement>("details[open]") ?? null;
      if (e.key === "Escape") {
        if (openPop) {
          openPop.open = false;
          openPop.querySelector("summary")?.focus();
          return;
        }
        if (target?.closest("select")) return;
        // Handled here, so the browser does not also treat this key as closing the prompt that may open now.
        e.preventDefault();
        go(closeHref);
        return;
      }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (openPop || target?.closest(TYPING)) return;
      const href = e.key === "ArrowLeft" ? prevHref : nextHref;
      if (!href) return;
      e.preventDefault();
      go(href);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, closeHref, prevHref, nextHref]);

  const carryOn = () => {
    const p = pending;
    setPending(null);
    dialogRef.current?.close();
    if (!p) return;
    if (p.kind === "href") router.push(p.href, { scroll: false });
    else resubmit(p.form, p.submitter);
  };
  const resubmit = (form: HTMLFormElement, submitter: HTMLElement | null) => {
    bypass.current = true;
    try {
      form.requestSubmit(submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement ? submitter : undefined);
    } finally {
      bypass.current = false;
    }
  };

  const state: PanelState = {
    visitId,
    editing,
    startEditing: (change) => {
      setEditing(true);
      setError(null);
      setSaved(null);
      if (!change) return;
      if ("addPlace" in change) setRaw((d) => ({ ...d, base: d.base ?? lockVersion, required: (d.required ?? carersRequired) + 1 }));
      else setRaw((d) => ({ ...d, base: d.base ?? lockVersion, places: { ...d.places, [change.place]: change.staffId } }));
    },
    stopEditing: () => (dirty ? undefined : setEditing(false)),
    draft,
    setPlace: (place, staffId) => {
      setError(null);
      setRaw((d) => ({ ...d, base: d.base ?? lockVersion, places: { ...d.places, [place]: staffId } }));
    },
    setRequired: (n) => {
      setError(null);
      setRaw((d) => {
        // Places dropped from the draft lose any choice made for them; a saved carer is never dropped silently.
        const places = Object.fromEntries(Object.entries(d.places).filter(([p]) => (placeNumber(p) ?? 0) <= n || current[p] !== undefined));
        return { ...d, base: d.base ?? lockVersion, required: n, places };
      });
    },
    setAcceptWarnings: (v) => setRaw((d) => ({ ...d, acceptWarnings: v })),
    current,
    carersRequired,
    changeCount,
    needsAck,
    dirty,
    saving,
    error,
    saved,
    save,
    discard,
    reloadLatest: () => {
      discard();
      router.refresh();
    },
    go,
  };

  return (
    <Ctx.Provider value={state}>
      <div ref={asideRef} data-visit-panel={visitId} data-pathname={pathname} className="min-w-0">
        {children}
        <dialog ref={dialogRef} aria-labelledby="unsaved-title" aria-describedby="unsaved-text" onCancel={() => setPending(null)} className="w-[500px] max-w-[92vw] rounded-[12px] border border-[#e4e7ec] p-0 shadow-[0_16px_40px_rgba(16,24,40,0.25)] backdrop:bg-[rgba(16,24,40,0.35)]">
          <div className="p-5">
            <h2 id="unsaved-title" className="text-[17px] font-bold text-[#101828]">Unsaved Changes</h2>
            <p id="unsaved-text" className="mt-1.5 text-[14px] text-[#344054]">You have changes that haven&apos;t been saved. What would you like to do?</p>
            {pending?.kind === "submit" ? <p className="mt-1.5 text-[13px] text-[#475467]">If you save the carer changes, send the other form again afterwards.</p> : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" autoFocus onClick={() => { setPending(null); dialogRef.current?.close(); }} className="h-10 rounded-[8px] border border-[#d0d5dd] bg-white px-3.5 text-[14px] font-semibold text-[#101828] hover:bg-slate-50">Continue Editing</button>
              <button type="button" onClick={() => { discard(); if (pending?.kind === "submit") { setPending(null); dialogRef.current?.close(); resubmit(pending.form, pending.submitter); } else carryOn(); }} className="h-10 rounded-[8px] border border-[#f3c9c9] bg-white px-3.5 text-[14px] font-semibold text-[#b42318] hover:bg-[#fdeeee]">Discard Changes</button>
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  const ok = await save();
                  if (!ok) {
                    setPending(null);
                    dialogRef.current?.close();
                    return;
                  }
                  if (pending?.kind === "submit") {
                    setPending(null);
                    dialogRef.current?.close();
                  } else carryOn();
                }}
                className="h-10 rounded-[8px] bg-module px-3.5 text-[14px] font-semibold text-white hover:bg-[#4c2398] disabled:opacity-60"
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </dialog>
      </div>
    </Ctx.Provider>
  );
}

/** Previous | Visit 2 of 25 | Next, at the top of the panel. Real links, so they also work before scripts load. */
export function PanelNav({ prevHref, nextHref, position, total, prevLabel, nextLabel }: { prevHref: string | null; nextHref: string | null; position: number | null; total: number; prevLabel?: string; nextLabel?: string }) {
  const { go } = usePanel();
  const cls = "inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[13.5px] font-semibold no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-module";
  const link = (href: string | null, label: string, aria: string, title?: string) =>
    href ? (
      <a href={href} title={title} aria-label={aria} data-panel-keep onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); go(href); }} className={`${cls} text-module hover:bg-[#f6f2fd]`}>{label}</a>
    ) : (
      <span aria-disabled="true" aria-label={`${aria} (none)`} className={`${cls} cursor-not-allowed text-[#98a2b3]`}>{label}</span>
    );
  return (
    <nav aria-label="Move between visits" className="flex items-center justify-between border-b border-[#eef0f3] px-3 py-1">
      {link(prevHref, "← Previous", "Previous visit", prevLabel)}
      <span className="text-[13px] tabular-nums text-[#475467]" aria-live="polite">{position ? `Visit ${position} of ${total}` : "Not in the current list"}</span>
      {link(nextHref, "Next →", "Next visit", nextLabel)}
    </nav>
  );
}

/** A link inside the panel (close, tabs) that asks first when there are unsaved changes. */
export function PanelLink({ href, children, className, ...rest }: { href: string; children: ReactNode; className?: string; "aria-label"?: string; "aria-current"?: "page" | undefined; title?: string }) {
  const { go } = usePanel();
  return (
    <a href={href} data-panel-keep onClick={(e) => { if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); go(href); }} className={className} {...rest}>
      {children}
    </a>
  );
}

/** The panel body: shows the carer editor in place of the tab content while editing. */
export function PanelBody({ editor, children }: { editor: ReactNode; children: ReactNode }) {
  const { editing } = usePanel();
  return <>{editing ? editor : children}</>;
}

/** The panel footer: the usual actions, or Discard and Save Changes while editing. */
export function PanelFooter({ children }: { children: ReactNode }) {
  const p = usePanel();
  if (!p.editing) return <>{children}</>;
  return (
    <div className="space-y-1.5">
      <p className="text-[13px] font-semibold text-[#344054]" aria-live="polite">{p.changeCount ? `${p.changeCount} change${p.changeCount === 1 ? "" : "s"} waiting to be saved` : "No changes yet"}</p>
      <div className="grid grid-cols-[auto_1fr] gap-2">
      <button type="button" onClick={p.discard} disabled={p.saving} className="h-10 rounded-[8px] border border-[#d0d5dd] bg-white px-3.5 text-[14px] font-semibold text-[#101828] hover:bg-slate-50 disabled:opacity-60">{p.changeCount ? "Discard" : "Close editor"}</button>
      <button
        type="button"
        onClick={() => void p.save()}
        disabled={!p.changeCount || p.saving || (p.needsAck && !p.draft.acceptWarnings)}
        aria-busy={p.saving || undefined}
        title={!p.changeCount ? "Nothing has changed yet" : p.needsAck && !p.draft.acceptWarnings ? "Tick that you have read the warnings first" : undefined}
        className="h-10 rounded-[8px] bg-module px-4 text-[14px] font-semibold text-white hover:bg-[#4c2398] disabled:cursor-not-allowed disabled:bg-[#b9a6e3]"
      >
        {p.saving ? "Saving…" : "Save Changes"}
      </button>
      </div>
    </div>
  );
}

/** The confirmation shown once the server has committed a save. */
export function PanelSaved() {
  const { saved } = usePanel();
  return (
    <div role="status" aria-live="polite" className={saved ? "mx-4 mb-1.5 rounded-[8px] border border-[#cfe9d8] bg-[#eaf6ee] px-3 py-1.5 text-[13.5px] font-semibold text-[#1c7a43]" : "sr-only"}>
      {saved ? `Saved: ${saved}. The rota now shows the new carers.` : ""}
    </div>
  );
}
