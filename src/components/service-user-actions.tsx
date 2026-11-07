"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "@/components/link";
import { ArrowLeft, FileArrowUp, FirstAidKit, MagnifyingGlass, NotePencil, PencilSimple, Plus } from "@phosphor-icons/react";

/**
 * Add New Service User and Update Existing Service User: the one set of choices used by the All Service Users
 * directory (header buttons and each row's Update) and the Service User Management workspace. Every choice is a link
 * into a workflow that already exists, so there is one form, one intake and one profile per person:
 *
 *  - Upload Support Plan          → Care Coordinator intake, new person   (/rota/coordinator?mode=NEW#start)
 *  - Add Manually                 → the Add service user form             (/rota/service-users/new)
 *  - Upload Revised Support Plan  → Care Coordinator intake, this person  (mode=EXISTING&person=<id>)
 *  - Hospital Discharge           → the same intake for this person, labelled as a discharge letter; filing it opens
 *                                   the post-discharge review (discharge-review.ts)
 *  - Update Manually              → this person's profile, Personal details tab
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
};

export type UpdateMethod = "revised" | "discharge" | "manual";
export type PickedPerson = { id: string; name: string; reference?: string | null };

export const ADD_UPLOAD_HREF = "/rota/coordinator?mode=NEW#start";
export const ADD_MANUAL_HREF = "/rota/service-users/new";
export function updateHref(method: UpdateMethod, id: string): string {
  const person = encodeURIComponent(id);
  if (method === "manual") return `/rota/service-users/${person}?tab=details`;
  return `/rota/coordinator?mode=EXISTING&person=${person}${method === "discharge" ? "&doc=discharge" : ""}#start`;
}

const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b2bb5] focus-visible:ring-offset-2";
export const PRIMARY_BTN = `inline-flex h-10 items-center justify-center gap-2 rounded-[9px] border border-[#5b2bb5] bg-[#5b2bb5] px-4 text-[14px] font-semibold text-white hover:border-[#4a2196] hover:bg-[#4a2196] hover:text-white ${FOCUS}`;
export const OUTLINE_BTN = `inline-flex h-10 items-center justify-center gap-2 rounded-[9px] border border-[#cfc3ef] bg-white px-4 text-[14px] font-semibold text-[#1d2939] hover:border-[#5b2bb5] hover:bg-[#f8f5fe] hover:text-[#1d2939] ${FOCUS}`;

function Modal({ open, onClose, title, subtitle, testId, children }: { open: boolean; onClose: () => void; title: string; subtitle: string; testId: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} aria-labelledby={titleId} data-testid={testId} className="m-auto w-[min(640px,calc(100vw-24px))] whitespace-normal rounded-[12px] border border-[#e4e7ec] bg-white p-0 text-left text-[#101828] shadow-[0_24px_48px_rgba(16,24,40,0.18)] backdrop:bg-[#101828]/40">
      {open ? (
        <div className="flex max-h-[calc(100vh-32px)] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-[#eaecf0] px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-[19px] font-bold [overflow-wrap:anywhere]">{title}</h2>
              <p className="mt-0.5 text-[14px] text-[#475467]">{subtitle}</p>
            </div>
            <button type="button" onClick={onClose} className={`shrink-0 rounded-[8px] px-2 py-1 text-[14px] font-semibold text-[#475467] hover:bg-[#f2f4f7] ${FOCUS}`}>Close</button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}

/** One choice in a dialog or workspace card: a full-width link with a title and a plain description. */
function Choice({ href, icon, title, text, testId }: { href: string; icon: ReactNode; title: string; text: string; testId: string }) {
  return (
    <li>
      <Link href={href} data-testid={testId} className={`group flex items-start gap-3 rounded-[10px] border border-[#e4e7ec] bg-white p-4 text-[#101828] no-underline hover:border-[#5b2bb5] hover:bg-[#f8f5fe] hover:text-[#101828] ${FOCUS}`}>
        <span aria-hidden className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f1ecfc] text-[#5b2bb5]">{icon}</span>
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold group-hover:text-[#4a2196]">{title}</span>
          <span className="mt-0.5 block text-[13.5px] leading-5 text-[#475467]">{text}</span>
        </span>
      </Link>
    </li>
  );
}

export function AddChoices({ perms }: { perms: ServiceUserActionPerms }) {
  return (
    <ul className="space-y-2.5" aria-label="Ways to add a service user">
      {perms.upload ? <Choice href={ADD_UPLOAD_HREF} icon={<FileArrowUp size={18} />} title="Upload Support Plan" text="Upload a council support plan or referral document. CSB AI will extract the information and populate the service-user profile." testId="add-upload" /> : null}
      {perms.create ? <Choice href={ADD_MANUAL_HREF} icon={<PencilSimple size={18} />} title="Add Manually" text="Create a service-user profile by entering their details manually." testId="add-manual" /> : null}
    </ul>
  );
}

export function UpdateChoices({ perms, person }: { perms: ServiceUserActionPerms; person: PickedPerson }) {
  return (
    <ul className="space-y-2.5" aria-label={`Ways to update ${person.name}`}>
      {perms.upload ? <Choice href={updateHref("revised", person.id)} icon={<FileArrowUp size={18} />} title="Upload Revised Support Plan" text="Upload a revised council support plan or updated care assessment. It is compared with this person's existing records and the changes are prepared for you to check." testId="update-revised" /> : null}
      {perms.upload ? <Choice href={updateHref("discharge", person.id)} icon={<FirstAidKit size={18} />} title="Hospital Discharge / New Medical Information" text="Upload a hospital discharge summary or new medical document and identify changes to the person's care needs. Medicines are reconciled, never changed from the letter." testId="update-discharge" /> : null}
      {perms.edit ? <Choice href={updateHref("manual", person.id)} icon={<NotePencil size={18} />} title="Update Manually" text="Open the existing Service User profile to make changes manually." testId="update-manual" /> : null}
    </ul>
  );
}

/** Add New Service User: a button that opens the two ways to create a profile. */
export function AddServiceUserButton({ perms, className = PRIMARY_BTN, label = "Add New Service User" }: { perms: ServiceUserActionPerms; className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!perms.create && !perms.upload) return null;
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className={className} data-testid="add-service-user"><Plus size={16} weight="bold" aria-hidden />{label}</button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add New Service User" subtitle="How would you like to create this service-user profile?" testId="add-dialog">
        <AddChoices perms={perms} />
      </Modal>
    </>
  );
}

type Found = { id: string; name: string; reference: string; legacyReference: string | null; postcode: string | null; area: string | null; status: string; matchedReference: string | null };

/** Step 1 of Update Existing: search with the directory's own search and choose the person. */
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
    <div>
      <label htmlFor={inputId} className="block text-[13.5px] font-semibold">Search for the service user</label>
      <div className="relative mt-1">
        <MagnifyingGlass size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
        <input id={inputId} type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" placeholder="Name, CSB or SU reference, council or Frameworki number, postcode" className={`input pl-9 ${FOCUS}`} data-testid="update-search" />
      </div>
      <p className="mt-1 text-[12.5px] text-[#667085]">Council, Frameworki and NHS numbers must be typed in full. NHS numbers are searched only for staff allowed to see them.</p>
      <div aria-live="polite" className="mt-3">
        {state.problem ? <p className="mb-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">{state.problem}</p> : null}
        {state.error ? <p role="alert" className="rounded-[8px] border border-[#fecdca] bg-[#fef3f2] px-3 py-2 text-[14px] text-[#b42318]">{state.error}</p> : null}
        {state.loading ? <p className="text-[14px] text-[#475467]">Searching…</p> : null}
        {!state.loading && !state.error && state.searched && !state.people.length ? <p className="text-[14px] text-[#475467]">No service users you are allowed to see match “{state.searched}”.</p> : null}
        {!state.loading && state.people.length ? (
          <ul className="divide-y divide-[#eaecf0] rounded-[10px] border border-[#e4e7ec]" aria-label="Matching service users" data-testid="update-results">
            {state.people.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onPick({ id: p.id, name: p.name, reference: p.reference })} className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-[#f8f5fe] ${FOCUS}`}>
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-semibold">{p.name}</span>
                    <span className="block text-[12.5px] text-[#475467] [overflow-wrap:anywhere]">{[p.reference, p.legacyReference ? `legacy ${p.legacyReference}` : null, p.postcode, p.area, p.matchedReference ? `matched ${p.matchedReference}` : null].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-[#f2f4f7] px-2 py-0.5 text-[12px] font-medium text-[#344054]">{p.status.charAt(0) + p.status.slice(1).toLowerCase()}</span>
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
 * Update Existing Service User. Without `person` it starts with the search; with `person` (a directory row) the
 * person is already chosen and the three ways to update appear at once. With `method` (a workspace card) choosing
 * the person goes straight to that way of updating.
 */
export function UpdateServiceUserButton({ perms, person, method, label, className = OUTLINE_BTN, icon = true, testId = "update-service-user" }: { perms: ServiceUserActionPerms; person?: PickedPerson; method?: UpdateMethod; label?: string; className?: string; icon?: ReactNode | boolean; testId?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedPerson | null>(person ?? null);
  if (!perms.edit && !perms.upload) return null;
  if (method && (method === "manual" ? !perms.edit : !perms.upload)) return null;
  const close = () => { setOpen(false); setPicked(person ?? null); };
  const pick = (p: PickedPerson) => {
    if (method) { setOpen(false); router.push(updateHref(method, p.id)); return; }
    setPicked(p);
  };
  const title = picked ? `Update ${picked.name}` : "Update Existing Service User";
  const subtitle = picked ? `${picked.reference ? `${picked.reference}. ` : ""}How would you like to update this person's records? Their existing profile and history are kept.` : "Select the service user whose information you want to update.";
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)} className={className} data-testid={testId}>{icon === true ? <PencilSimple size={16} aria-hidden /> : icon || null}{label ?? (person ? "Update" : "Update Existing Service User")}{person ? <span className="sr-only"> {person.name}</span> : null}</button>
      <Modal open={open} onClose={close} title={title} subtitle={subtitle} testId="update-dialog">
        {picked ? (
          <>
            <UpdateChoices perms={perms} person={picked} />
            {!person ? <button type="button" onClick={() => setPicked(null)} className={`mt-3 inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-[14px] font-semibold text-[#5b2bb5] hover:bg-[#f6f2fd] ${FOCUS}`}><ArrowLeft size={14} aria-hidden />Choose a different person</button> : null}
          </>
        ) : <PersonPicker onPick={pick} />}
      </Modal>
    </>
  );
}

