"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, Plus, UserMinus, UsersThree, Warning, X } from "@phosphor-icons/react";
import { placeLabel, placeNumber, placeOf } from "@/lib/carer-places";
import { usePanel } from "@/components/visit-panel-shell";

export interface EditorCandidate {
  id: string;
  name: string;
  state: "ELIGIBLE" | "REQUIRES_REVIEW" | "NOT_ELIGIBLE";
  score: number | null;
  /** Readiness when it is not "Ready", in words. */
  readiness: string | null;
  reasons: string[];
}

const STATE_WORD = { ELIGIBLE: "eligible", REQUIRES_REVIEW: "check first", NOT_ELIGIBLE: "not eligible" } as const;

/**
 * The carer chips in the Details tab. Removing a carer or adding one opens the editor with that change waiting, so
 * every staffing change is saved deliberately with Save Changes.
 */
export function CarerChips({ carers, canChange, canAddPlace, maxCarers }: { carers: { place: string; staffId: string; name: string; href: string }[]; canChange: boolean; canAddPlace: boolean; maxCarers: number }) {
  const p = usePanel();
  const hasOpen = p.carersRequired > carers.length;
  return (
    <>
      <span className="mt-1.5 flex flex-wrap gap-1.5">
        {carers.map((c) => (
          <span key={c.place} className="inline-flex items-center gap-1 rounded-full bg-[#eef0f4] py-0.5 pl-2.5 pr-1 text-meta text-[#101828]">
            <a href={c.href} className="text-inherit no-underline hover:underline">{c.name}</a>
            {canChange ? (
              <button type="button" onClick={() => p.startEditing({ place: c.place, staffId: null })} aria-label={`Remove ${c.name} from this visit`} title="Remove from this visit (you save the change next)" className="flex h-5 w-5 items-center justify-center rounded-full text-[#344054] hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-module">
                <X size={12} weight="bold" aria-hidden />
              </button>
            ) : <span className="w-1" />}
          </span>
        ))}
        {!carers.length ? <span className="text-meta font-medium text-[#b42318]">No carer assigned</span> : null}
      </span>
      {canChange && (hasOpen || (canAddPlace && p.carersRequired < maxCarers)) ? (
        <button type="button" onClick={() => p.startEditing(hasOpen ? undefined : { addPlace: true })} className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-full border border-module px-4 text-body font-semibold text-module hover:bg-[#f6f2fd] focus-visible:outline focus-visible:outline-2 focus-visible:outline-module" title={hasOpen ? "Choose a carer for the empty place" : `Add a place for carer ${p.carersRequired + 1}, then choose the carer`}>
          <Plus size={16} weight="bold" aria-hidden />Add Carer
        </button>
      ) : null}
    </>
  );
}

/** The footer's Reassign Carers button: opens the editor for every place. */
export function ReassignButton() {
  const p = usePanel();
  return (
    <button type="button" onClick={() => p.startEditing()} className="flex h-11 w-full items-center justify-center gap-2 rounded-[8px] border border-module bg-module text-lead font-semibold text-white hover:bg-[#4c2398] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-module">
      <UsersThree size={20} weight="fill" aria-hidden />
      Reassign Carers
    </button>
  );
}

/**
 * The carer editor: one row per numbered place showing who is booked, an empty place, or the change waiting to be
 * saved, with the ranked carers for each place. Nothing is saved until Save Changes; the server checks every carer again.
 */
export function StaffingEditor({ names, candidates, canChangePlaces, maxCarers, summary }: { names: Record<string, string>; candidates: EditorCandidate[]; canChangePlaces: boolean; maxCarers: number; summary: string }) {
  const p = usePanel();
  const errorRef = useRef<HTMLDivElement>(null);
  const places = Array.from({ length: p.draft.required }, (_, i) => placeOf(i + 1));
  // Saved carers in places the draft drops (they must be removed first) stay listed so nobody disappears silently.
  const extra = Object.keys(p.current).filter((k) => !places.includes(k as (typeof places)[number]) && k !== "SHADOW");
  const chosen = (place: string) => (place in p.draft.places ? p.draft.places[place]! : p.current[place] ?? null);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const onVisit = Object.entries(p.current).filter(([k]) => k !== "SHADOW");
  const last = places[places.length - 1];
  const lastEmpty = last ? chosen(last) === null : false;

  useEffect(() => {
    if (p.error) errorRef.current?.focus();
  }, [p.error]);

  const row = (place: string, beyond = false) => {
    const now = p.current[place] ?? null;
    const next = beyond ? now : chosen(place);
    const kind = now === next ? (now ? "booked" : "empty") : now && next ? "replace" : next ? "add" : "remove";
    const failed = p.error?.place === place;
    const pick = next && next !== now ? byId.get(next) : undefined;
    const tone = failed
      ? "border-[#d92d20] bg-[#fef3f2]"
      : kind === "booked"
        ? "border-[#e4e7ec] bg-white"
        : kind === "empty"
          ? "border-dashed border-[#f3a8a8] bg-white"
          : kind === "remove"
            ? "border-[#f3c9c9] bg-[#fdf5f5]"
            : "border-module bg-[#f6f2fd]";
    const badge = { booked: null, empty: <span className="rounded-full bg-[#fdecec] px-2 py-0.5 text-caption font-semibold text-[#b42318]">Empty place</span>, replace: <span className="rounded-full bg-module px-2 py-0.5 text-caption font-semibold text-white">Will change</span>, add: <span className="rounded-full bg-module px-2 py-0.5 text-caption font-semibold text-white">Will add</span>, remove: <span className="rounded-full bg-[#b42318] px-2 py-0.5 text-caption font-semibold text-white">Will remove</span> }[kind];
    const newPlace = (placeNumber(place) ?? 0) > p.carersRequired && !beyond;
    const selectId = `place-${place}`;
    return (
      <li key={place} data-place={place} data-kind={kind} className={`rounded-[8px] border px-3 py-2 ${tone}`}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label htmlFor={selectId} className="text-body font-bold text-[#101828]">{placeLabel(place)}</label>
          {newPlace ? <span className="rounded-full bg-[#eef0f4] px-2 py-0.5 text-caption font-semibold text-[#344054]">New place</span> : null}
          {badge}
          {kind !== "booked" && kind !== "empty" && !beyond ? (
            <button type="button" onClick={() => p.setPlace(place, now)} className="ml-auto text-meta font-semibold text-module hover:underline">Undo</button>
          ) : null}
        </div>
        <p className="mt-0.5 text-body text-[#344054]">
          {kind === "booked" ? <>Booked: <strong className="text-[#101828]">{names[now!] ?? "Carer"}</strong></> : null}
          {kind === "empty" ? <span className="text-[#b42318]">Nobody booked</span> : null}
          {kind === "add" ? <>New: <strong className="text-[#3b1f99]">{names[next!] ?? pick?.name ?? "Carer"}</strong></> : null}
          {kind === "replace" ? <span className="inline-flex flex-wrap items-center gap-1"><span className="line-through decoration-[#98a2b3]">{names[now!] ?? "Carer"}</span><ArrowRight size={13} weight="bold" aria-label="replaced by" /><strong className="text-[#3b1f99]">{names[next!] ?? pick?.name ?? "Carer"}</strong></span> : null}
          {kind === "remove" ? <><span className="line-through">{names[now!] ?? "Carer"}</span> will be taken off this visit</> : null}
        </p>
        {beyond ? (
          <p className="mt-1 text-meta text-[#8a5a00]">This place is beyond the number of carers you set. Remove the carer first, or keep the place.</p>
        ) : (
          <div className="mt-1.5 flex items-center gap-2">
            <select
              id={selectId}
              value={next ?? ""}
              onChange={(e) => p.setPlace(place, e.target.value || null)}
              aria-describedby={failed ? "staffing-error" : undefined}
              aria-invalid={failed || undefined}
              className="input min-w-0 flex-1 py-1.5 text-body"
            >
              <option value="">{now ? "Nobody (remove the carer)" : "Nobody yet (leave empty)"}</option>
              {now ? <option value={now}>Keep {names[now] ?? "the booked carer"}</option> : null}
              {onVisit.filter(([k, id]) => k !== place && id !== now).length ? (
                <optgroup label="Move from another place on this visit">
                  {onVisit.filter(([k, id]) => k !== place && id !== now).map(([k, id]) => {
                    const taken = places.some((pl) => pl !== place && chosen(pl) === id);
                    return <option key={id} value={id} disabled={taken}>{names[id] ?? "Carer"} (now {placeLabel(k)}){taken ? " — still in that place" : ""}</option>;
                  })}
                </optgroup>
              ) : null}
              <optgroup label="Carers ranked for this visit">
                {candidates.map((c) => {
                  const elsewhere = places.find((pl) => pl !== place && chosen(pl) === c.id);
                  return (
                    <option key={c.id} value={c.id} disabled={c.state === "NOT_ELIGIBLE" || !!elsewhere}>
                      {c.score !== null ? `${c.score} · ` : ""}{c.name} — {elsewhere ? `chosen for ${placeLabel(elsewhere)}` : STATE_WORD[c.state]}{c.readiness ? ` (${c.readiness.toLowerCase()})` : ""}{c.reasons.length && !elsewhere ? `: ${c.reasons.slice(0, 2).join("; ")}` : ""}
                    </option>
                  );
                })}
              </optgroup>
            </select>
            {now && next ? (
              <button type="button" onClick={() => p.setPlace(place, null)} aria-label={`Remove the carer from ${placeLabel(place)}`} title="Remove the carer from this place" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] border border-[#d0d5dd] bg-white text-[#b42318] hover:bg-[#fdeeee]"><UserMinus size={17} aria-hidden /></button>
            ) : null}
          </div>
        )}
        {pick && pick.reasons.length ? (
          <ul className={`mt-1.5 space-y-0.5 rounded-[6px] px-2.5 py-1.5 text-meta ${pick.state === "REQUIRES_REVIEW" ? "bg-[#fdf4e3] text-[#7a4b00]" : "bg-[#f2f4f7] text-[#344054]"}`}>
            {pick.reasons.map((r) => <li key={r} className="flex gap-1.5"><Warning size={13} weight="fill" aria-hidden className="mt-[2px] shrink-0" />{r}</li>)}
          </ul>
        ) : null}
        {pick?.readiness ? <p className="mt-1 text-meta text-[#7a4b00]">Readiness: {pick.readiness}</p> : null}
      </li>
    );
  };

  return (
    <section aria-labelledby="staffing-title" className="py-2">
      <h3 id="staffing-title" className="text-lead font-bold text-[#101828]">Reassign carers</h3>
      <p className="text-meta text-[#475467]">{summary} · {p.draft.required} carer{p.draft.required === 1 ? "" : "s"} needed</p>
      {p.error ? (
        <div ref={errorRef} id="staffing-error" role="alert" tabIndex={-1} className="mt-2 rounded-[8px] border border-[#f3c9c9] bg-[#fdecec] px-3 py-2 text-body text-[#8a1f1a] outline-none">
          <p className="font-semibold">Nothing was saved.</p>
          <p>{p.error.message}</p>
          {p.error.stale ? <button type="button" onClick={p.reloadLatest} className="mt-1.5 h-8 rounded-[6px] border border-[#d0d5dd] bg-white px-2.5 text-meta font-semibold text-[#101828] hover:bg-slate-50">Reload the latest version</button> : <p className="text-meta">Your choices are still here. Change the highlighted place and save again.</p>}
        </div>
      ) : null}
      <ul className="mt-2 space-y-2">
        {places.map((pl) => row(pl))}
        {extra.map((pl) => row(pl, true))}
      </ul>
      {canChangePlaces ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {p.draft.required < maxCarers ? (
            <button type="button" onClick={() => p.setRequired(p.draft.required + 1)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-module px-3 text-meta font-semibold text-module hover:bg-[#f6f2fd]"><Plus size={14} weight="bold" aria-hidden />Add carer place</button>
          ) : null}
          {p.draft.required > 1 && lastEmpty ? (
            <button type="button" onClick={() => p.setRequired(p.draft.required - 1)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#d0d5dd] px-3 text-meta font-semibold text-[#344054] hover:bg-slate-50">Remove empty {placeLabel(last!)} place</button>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-meta text-[#475467]">The number of carers can only be changed on a scheduled visit.</p>
      )}
      {p.needsAck ? (
        <label className="mt-3 flex items-start gap-2 rounded-[8px] bg-[#fdf4e3] px-3 py-2 text-meta text-[#7a4b00]">
          <input type="checkbox" checked={p.draft.acceptWarnings} onChange={(e) => p.setAcceptWarnings(e.target.checked)} className="mt-0.5 h-4 w-4" />
          I have read the warnings for the carers I chose.
        </label>
      ) : null}
      <p className="mt-2 text-caption text-slate-500">Carers who are not eligible cannot be chosen. Every carer is checked again when you save, and if any change is refused nothing is saved.</p>
    </section>
  );
}
