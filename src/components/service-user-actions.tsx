"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Link from "@/components/link";
import { Archive, ArrowLeft, CaretDown, FileArrowUp, FirstAidKit, MagnifyingGlass, NotePencil, PencilSimple, Plus } from "@phosphor-icons/react";

/**
 * Add New Service User and Update Existing Service User on the All Service Users page: dropdowns whose every choice is
 * a link into a workflow that already exists, so there is one form, one intake and one profile per person.
 *
 *  - Upload Support Plan          → Care Coordinator intake, new person   (/rota/coordinator?mode=NEW#start)
 *  - Add Manually                 → the Add service user form             (/rota/service-users/new)
 *  - Upload Revised Support Plan  → Care Coordinator intake, this person  (mode=EXISTING&person=<id>)
 *  - Hospital Discharge           → the same intake for this person, labelled as a discharge letter; filing it opens
 *                                   the post-discharge review (discharge-review.ts)
 *  - Update Manually              → this person's profile, Personal details tab
 *  - Archive or Delete            → this person's Archive or delete page (/rota/service-users/<id>/archive)
 *
 * Which choices appear depends on `perms`, worked out on the server from the member's roles; each destination checks
 * the same permissions again on the server, so hiding a choice is never the only protection.
 */

export type ServiceUserActionPerms = {
  /** May create service-user records (serviceUser.edit). */
  create: boolean;
  /** May update service-user records by hand (serviceUser.edit). */
  edit: boolean;
  /** May start Care Coordinator intakes with documents (serviceUser.edit, rota.edit and serviceUser.documents). */
  upload: boolean;
  /** May archive and restore (serviceUser.archive). */
  archive?: boolean;
  /** May delete a record added by mistake (serviceUser.delete). */
  delete?: boolean;
};

export type UpdateMethod = "revised" | "discharge" | "manual";
export type PickedPerson = { id: string; name: string; reference?: string | null };

export const archiveHref = (id: string) => `/rota/service-users/${encodeURIComponent(id)}/archive`;
export const ADD_UPLOAD_HREF = "/rota/coordinator?mode=NEW#start";
export const ADD_MANUAL_HREF = "/rota/service-users/new";
export function updateHref(method: UpdateMethod, id: string): string {
  const person = encodeURIComponent(id);
  if (method === "manual") return `/rota/service-users/${person}?tab=details`;
  return `/rota/coordinator?mode=EXISTING&person=${person}${method === "discharge" ? "&doc=discharge" : ""}#start`;
}

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b2bb5] focus-visible:ring-offset-2";
export const PRIMARY_BTN = `inline-flex h-11 items-center justify-center gap-2 rounded-[9px] border border-[#4b1fa8] bg-[#4b1fa8] px-4 text-[15px] font-semibold text-white hover:border-[#3d1890] hover:bg-[#3d1890] hover:text-white ${FOCUS}`;
export const OUTLINE_BTN = `inline-flex h-11 items-center justify-center gap-2 rounded-[9px] border border-[#b9a6ea] bg-white px-4 text-[15px] font-semibold text-[#101828] hover:border-[#5b2bb5] hover:bg-[#f8f5fe] hover:text-[#101828] ${FOCUS}`;

/**
 * A button with a dropdown panel. The panel is positioned against the viewport so it is never cut off by the table's
 * scroll area; it closes on Escape (focus returns to the button), on a click elsewhere, and when the page scrolls.
 */
function Dropdown({ label, buttonClass, testId, panelTestId, width = 380, children, onClose }: { label: ReactNode; buttonClass: string; testId: string; panelTestId: string; width?: number; children: (close: () => void) => ReactNode; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = useCallback((focusButton = true) => {
    setOpen(false);
    onClose?.();
    if (focusButton) btn.current?.focus();
  }, [onClose]);

  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect();
    if (!b) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const w = Math.min(width, vw - 16);
    const left = Math.min(Math.max(8, b.right - w), vw - w - 8);
    const below = vh - b.bottom - 12;
    const above = b.top - 12;
    const top = below >= 260 || below >= above ? b.bottom + 6 : Math.max(8, b.top - 6 - Math.min(above, 460));
    setPos({ top, left, maxHeight: Math.max(200, below >= 260 || below >= above ? below : Math.min(above, 460)) });
  }, [width]);

  useLayoutEffect(() => { if (open) place(); }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panel.current?.contains(t) || btn.current?.contains(t)) return;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    // Follow the button when the page scrolls or resizes (closing would lose a half-typed search on a phone).
    const onMove = (e: Event) => { if (e.target instanceof Node && panel.current?.contains(e.target)) return; place(); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    // Move focus into the panel so keyboard users land on the first choice (or the search field).
    const id = requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("input, a, button")?.focus());
    return () => {
      cancelAnimationFrame(id);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, close, place]);

  return (
    <>
      <button ref={btn} type="button" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => (open ? close(false) : setOpen(true))} className={buttonClass} data-testid={testId}>
        {label}
      </button>
      {open ? (
        <div
          ref={panel}
          id={panelId}
          data-testid={panelTestId}
          style={pos ? { top: pos.top, left: pos.left, width: Math.min(width, typeof window === "undefined" ? width : window.innerWidth - 16), maxHeight: pos.maxHeight } : { visibility: "hidden" }}
          className="fixed z-50 overflow-y-auto whitespace-normal rounded-[12px] border border-[#e4e7ec] bg-white p-1.5 text-left text-[#101828] shadow-[0_16px_40px_rgba(16,24,40,0.16)]"
        >
          {children(() => close())}
        </div>
      ) : null}
    </>
  );
}

/** One choice in a dropdown: an icon, a title and a one-line description. */
function Choice({ href, icon, title, text, testId }: { href: string; icon: ReactNode; title: string; text: string; testId: string }) {
  return (
    <li>
      <Link href={href} data-testid={testId} className={`group flex items-start gap-3 rounded-[9px] px-3 py-2.5 text-[#101828] no-underline hover:bg-[#f6f2fd] hover:text-[#101828] ${FOCUS}`}>
        <span aria-hidden className="mt-0.5 shrink-0 text-[#5b2bb5]">{icon}</span>
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold text-[#3d1890]">{title}</span>
          <span className="mt-0.5 block text-[13px] leading-[18px] text-[#475467]">{text}</span>
        </span>
      </Link>
    </li>
  );
}

export function AddChoices({ perms }: { perms: ServiceUserActionPerms }) {
  return (
    <ul className="divide-y divide-[#f2f4f7]" aria-label="Ways to add a service user">
      {perms.upload ? <Choice href={ADD_UPLOAD_HREF} icon={<FileArrowUp size={20} />} title="Upload Support Plan" text="Create a new profile using a council support plan or referral. CSB AI reads it and fills in the profile." testId="add-upload" /> : null}
      {perms.create ? <Choice href={ADD_MANUAL_HREF} icon={<PencilSimple size={20} />} title="Add Manually" text="Enter the service user's details by hand." testId="add-manual" /> : null}
    </ul>
  );
}

export function UpdateChoices({ perms, person }: { perms: ServiceUserActionPerms; person: PickedPerson }) {
  return (
    <ul className="divide-y divide-[#f2f4f7]" aria-label={`Ways to update ${person.name}`}>
      {perms.upload ? <Choice href={updateHref("revised", person.id)} icon={<FileArrowUp size={20} />} title="Upload Revised Support Plan" text="A revised council plan or updated assessment, compared with this person's records." testId="update-revised" /> : null}
      {perms.upload ? <Choice href={updateHref("discharge", person.id)} icon={<FirstAidKit size={20} />} title="Hospital Discharge / New Medical Information" text="A discharge summary or medical letter. Changes go to the discharge review; medicines are reconciled, never changed from the letter." testId="update-discharge" /> : null}
      {perms.edit ? <Choice href={updateHref("manual", person.id)} icon={<NotePencil size={20} />} title="Update Manually" text="Open this person's profile to change their details." testId="update-manual" /> : null}
      {perms.archive || perms.delete ? <Choice href={archiveHref(person.id)} icon={<Archive size={20} />} title="Archive or Delete" text="Archive someone whose care has ended (every record kept, can be restored). Admins can delete a record added by mistake." testId="update-archive" /> : null}
    </ul>
  );
}

/** + Add New Service User ▾ */
export function AddServiceUserButton({ perms }: { perms: ServiceUserActionPerms }) {
  if (!perms.create && !perms.upload) return null;
  return (
    <Dropdown label={<><Plus size={18} weight="bold" aria-hidden />Add New Service User<CaretDown size={16} weight="bold" aria-hidden className="ml-1" /></>} buttonClass={PRIMARY_BTN} testId="add-service-user" panelTestId="add-menu">
      {() => <AddChoices perms={perms} />}
    </Dropdown>
  );
}

type Found = { id: string; name: string; reference: string; legacyReference: string | null; postcode: string | null; area: string | null; status: string; archived?: boolean; matchedReference: string | null };

/** Step 1 of Update Existing: search with the directory's own search (on the server) and choose the person. */
function PersonPicker({ onPick }: { onPick: (p: PickedPerson) => void }) {
  const [q, setQ] = useState("");
  const [state, setState] = useState<{ loading: boolean; people: Found[]; problem: string | null; error: string | null; searched: string }>({ loading: false, people: [], problem: null, error: null, searched: "" });
  const inputId = useId();
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setState({ loading: false, people: [], problem: null, error: null, searched: "" }); return; }
    const ctrl = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/service-users/search?${new URLSearchParams({ q: term })}`, { signal: ctrl.signal, cache: "no-store" });
        const body = (await res.json()) as { people?: Found[]; referenceProblem?: string | null; error?: string };
        if (!res.ok) { setState({ loading: false, people: [], problem: null, error: body.error ?? "The search could not be completed.", searched: term }); return; }
        setState({ loading: false, people: body.people ?? [], problem: body.referenceProblem ?? null, error: null, searched: term });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setState({ loading: false, people: [], problem: null, error: "The search could not be completed. Check your connection and try again.", searched: term });
      }
    }, 250);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);
  return (
    <div className="p-2">
      <label htmlFor={inputId} className="block text-[14px] font-semibold">Choose the service user to update</label>
      <div className="relative mt-1.5">
        <MagnifyingGlass size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
        <input id={inputId} type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" placeholder="Name, CSB reference, council or Frameworki number" className={`input h-10 pl-9 text-[14px] ${FOCUS}`} data-testid="update-search" />
      </div>
      <p className="mt-1 text-[12px] leading-4 text-[#667085]">Council and Frameworki numbers must be typed in full. NHS numbers are searched only for staff allowed to see them.</p>
      <div aria-live="polite" className="mt-2">
        {state.problem ? <p className="mb-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900">{state.problem}</p> : null}
        {state.error ? <p role="alert" className="rounded-[8px] border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-[13px] text-[#b42318]">{state.error}</p> : null}
        {state.loading ? <p className="px-1 text-[13px] text-[#475467]">Searching…</p> : null}
        {!state.loading && !state.error && state.searched && !state.people.length ? <p className="px-1 text-[13px] text-[#475467]">No service users you are allowed to see match “{state.searched}”.</p> : null}
        {!state.loading && state.people.length ? (
          <ul className="max-h-64 divide-y divide-[#eaecf0] overflow-y-auto rounded-[9px] border border-[#e4e7ec]" aria-label="Matching service users" data-testid="update-results">
            {state.people.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onPick({ id: p.id, name: p.name, reference: p.reference })} className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[#f8f5fe] ${FOCUS}`}>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold">{p.name}</span>
                    <span className="block text-[12px] text-[#475467] [overflow-wrap:anywhere]">{[p.reference, p.legacyReference ? `legacy ${p.legacyReference}` : null, p.postcode, p.area, p.matchedReference ? `matched ${p.matchedReference}` : null].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-[#f2f4f7] px-2 py-0.5 text-[11.5px] font-medium text-[#344054]">{p.archived ? "Archived" : p.status.charAt(0) + p.status.slice(1).toLowerCase()}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

/**
 * ✎ Update Existing Service User ▾ (no person yet: search first) and each row's ✎ Update ▾ (person already chosen,
 * so the three ways to update appear at once and the person is never searched for again).
 */
export function UpdateServiceUserButton({ perms, person, buttonClass, testId = "update-service-user" }: { perms: ServiceUserActionPerms; person?: PickedPerson; buttonClass?: string; testId?: string }) {
  const [picked, setPicked] = useState<PickedPerson | null>(person ?? null);
  const reset = useCallback(() => setPicked(person ?? null), [person]);
  if (!perms.edit && !perms.upload) return null;
  const label = person
    ? <><PencilSimple size={16} aria-hidden />Update<span className="sr-only"> {person.name}</span><CaretDown size={14} weight="bold" aria-hidden /></>
    : <><PencilSimple size={18} aria-hidden />Update Existing Service User<CaretDown size={16} weight="bold" aria-hidden className="ml-1" /></>;
  return (
    <Dropdown label={label} buttonClass={buttonClass ?? OUTLINE_BTN} testId={testId} panelTestId="update-menu" width={person ? 380 : 420} onClose={reset}>
      {() => picked ? (
        <div>
          <p className="px-3 pb-1 pt-2 text-[13px] text-[#475467]" data-testid="update-person">Update <strong className="text-[#101828]">{picked.name}</strong>{picked.reference ? ` · ${picked.reference}` : ""}</p>
          <UpdateChoices perms={perms} person={picked} />
          {!person ? <button type="button" onClick={() => setPicked(null)} className={`m-1 inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[13px] font-semibold text-[#5b2bb5] hover:bg-[#f6f2fd] ${FOCUS}`}><ArrowLeft size={14} aria-hidden />Choose a different person</button> : null}
        </div>
      ) : <PersonPicker onPick={setPicked} />}
    </Dropdown>
  );
}

/** The ⋮ button on a row: the rest of that person's directory details, in the same dropdown panel. */
export function RowDetails({ name, children }: { name: string; children: ReactNode }) {
  return (
    <Dropdown label={<><span aria-hidden className="text-[18px] leading-none">⋮</span><span className="sr-only">More details for {name}</span></>} buttonClass={`inline-flex h-9 w-9 items-center justify-center rounded-[8px] text-[#475467] hover:bg-[#f2f4f7] ${FOCUS}`} testId="row-more" panelTestId="row-details" width={320}>
      {() => <div className="p-2 text-[13.5px]">{children}</div>}
    </Dropdown>
  );
}
