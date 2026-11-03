"use client";

import { ArrowCounterClockwise, Crosshair, Cursor, MagnifyingGlassMinus, MagnifyingGlassPlus, NotePencil, Plus, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * The Digital Body Map workspace: the outline with its tools (left) and either the register of observations or the
 * Record Observation form (centre). The outline is CSB's own simple drawing (front, back, left and right side) on a
 * 200 × 400 grid; positions are stored as percentages so they survive any change of drawing size. Clicking the outline
 * places a mark and picks the nearest named area; keyboard users choose the area from the list instead.
 *
 * Unsaved form entries are kept in this browser tab (sessionStorage) until the observation is saved or cancelled, so a
 * validation message or an accidental reload does not lose them. Photographs cannot be kept that way and must be added
 * again.
 */

export type View = "FRONT" | "BACK" | "LEFT" | "RIGHT";
export interface Marker { id: string; n: number; view: View; x: number; y: number; open: boolean; label: string; href: string; category: string; selected?: boolean }
export interface SiteMarker { id: string; view: View; x: number; y: number; label: string }
export type Regions = Record<View, readonly { label: string; x: number; y: number }[]>;

const VIEW_LABEL: Record<View, string> = { FRONT: "Front", BACK: "Back", LEFT: "Left", RIGHT: "Right" };
const VIEW_LONG: Record<View, string> = { FRONT: "front", BACK: "back", LEFT: "left side", RIGHT: "right side" };

/** One colour per observation type, used on the outline and the type list. */
export const CATEGORY_COLOUR: Record<string, string> = {
  Bruising: "#7c3aed", "Cuts and scratches": "#ec4899", "Pressure sore": "#ea580c", "Skin tear": "#f472b6", Wound: "#f97316",
  Burn: "#eab308", Swelling: "#22c55e", Redness: "#0ea5e9", Rash: "#a855f7", "Other skin condition": "#64748b",
};
const colourOf = (c: string) => CATEGORY_COLOUR[c] ?? "#64748b";

function nearest(regions: Regions, view: View, x: number, y: number) {
  let best = regions[view][0]!;
  let bestD = Infinity;
  for (const r of regions[view]) {
    const d = (r.x - x) ** 2 + (2 * (r.y - y)) ** 2;
    if (d < bestD) {
      best = r;
      bestD = d;
    }
  }
  return best.label;
}


function Outline({ view }: { view: View }) {
  const fill = "#eef3f8";
  const stroke = "#7b8ba1";
  if (view === "FRONT" || view === "BACK") {
    return (
      <g fill={fill} stroke={stroke} strokeWidth="1.6" strokeLinejoin="round">
        <ellipse cx="100" cy="24" rx="16" ry="20" />
        <path d="M92 42 h16 v14 h-16 Z" />
        <path d="M68 56 Q100 50 132 56 L142 64 Q147 110 137 150 L139 188 Q100 198 61 188 L63 150 Q53 110 58 64 Z" />
        <path d="M58 64 Q46 70 45 106 L38 156 Q35 176 30 188 L40 191 Q46 176 50 158 L60 112 Z" />
        <path d="M142 64 Q154 70 155 106 L162 156 Q165 176 170 188 L160 191 Q154 176 150 158 L140 112 Z" />
        <ellipse cx="33" cy="198" rx="8" ry="11" />
        <ellipse cx="167" cy="198" rx="8" ry="11" />
        <path d="M62 188 L98 194 L95 282 L93 366 L76 366 L72 282 Z" />
        <path d="M138 188 L102 194 L105 282 L107 366 L124 366 L128 282 Z" />
        <ellipse cx="83" cy="378" rx="11" ry="9" />
        <ellipse cx="117" cy="378" rx="11" ry="9" />
        {view === "FRONT" ? (
          <g fill="none" strokeWidth="1.1">
            <path d="M93 22 q2 -2 4 0 M103 22 q2 -2 4 0" />
            <path d="M96 33 q4 3 8 0" />
          </g>
        ) : (
          <path d="M100 58 V182" fill="none" strokeWidth="1" strokeDasharray="3 4" />
        )}
      </g>
    );
  }
  // Side views: the person faces the way of their nose; LEFT shows their left side (facing your left).
  const flip = view === "RIGHT";
  return (
    <g fill={fill} stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" transform={flip ? "translate(200 0) scale(-1 1)" : undefined}>
      <path d="M100 4 Q120 4 120 26 Q120 42 108 46 L106 44 Q96 46 90 40 L82 34 L86 30 L82 24 Q82 4 100 4 Z" />
      <path d="M96 44 h14 v14 h-14 Z" />
      <path d="M86 58 Q104 52 122 60 Q128 110 120 150 L122 188 Q102 194 84 188 L86 150 Q78 110 86 58 Z" />
      <path d="M94 64 Q108 62 110 72 L110 140 L108 186 L98 186 L96 140 Z" />
      <ellipse cx="103" cy="196" rx="7" ry="11" />
      <path d="M86 188 L116 190 L114 282 L112 362 L96 362 L92 282 Z" />
      <path d="M112 362 L112 384 L78 384 Q76 374 90 370 L96 362 Z" />
      <circle cx="108" cy="26" r="3.5" fill="none" strokeWidth="1.1" />
    </g>
  );
}


export interface RecordFormProps {
  action: (fd: FormData) => void | Promise<void>;
  serviceUserId: string;
  personName: string;
  back: string;
  cancelHref: string;
  today: string;
  now: string;
  pain: { value: string; label: string }[];
  reviewers: { id: string; name: string }[];
  canPhotos: boolean;
  photoAccept: string;
  maxBytes: number;
  maxPhotos: number;
  /** True right after a successful save: the kept draft is cleared. */
  clearDraft: boolean;
}

export interface SiteFormProps {
  action: (fd: FormData) => void | Promise<void>;
  serviceUserId: string;
  back: string;
  cancelHref: string;
  medicines: { id: string; label: string }[];
}

export interface WorkspaceProps {
  mode: "browse" | "record" | "site";
  markers: Marker[];
  sites: SiteMarker[];
  regions: Regions;
  categories: { name: string; count: number }[];
  initial: { view: View; x?: number; y?: number; region?: string; category?: string };
  /** Browse mode: where "Record Observation" goes (the chosen area is added to it). */
  recordHref?: string;
  canRecord: boolean;
  record?: RecordFormProps;
  site?: SiteFormProps;
  /** Browse mode: the register shown in the centre. */
  children?: ReactNode;
}

const DRAFT_FIELDS = ["locationDetail", "category", "date", "time", "size", "appearance", "description", "pain", "actionTaken", "personNotified", "followUpRequired", "followUpOn", "reviewerId", "caption"];

export function BodyMapWorkspace(props: WorkspaceProps) {
  const { mode, regions, markers, sites } = props;
  const [view, setView] = useState<View>(props.initial.view);
  const [pin, setPin] = useState<{ x: number; y: number } | null>(props.initial.x != null && props.initial.y != null ? { x: props.initial.x, y: props.initial.y } : null);
  const [region, setRegion] = useState(props.initial.region ?? (props.initial.x != null && props.initial.y != null ? nearest(regions, props.initial.view, props.initial.x, props.initial.y) : ""));
  const [category, setCategory] = useState(props.initial.category ?? "");
  const [zoom, setZoom] = useState(1);
  const [only, setOnly] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const editing = mode !== "browse";

  const choose = (v: View) => {
    setView(v);
    setPin(null);
    setRegion("");
  };
  const placeAt = (x: number, y: number) => {
    setPin({ x, y });
    setRegion(nearest(regions, view, x, y));
  };
  const pickRegion = (label: string) => {
    setRegion(label);
    const r = regions[view].find((x) => x.label === label);
    if (r && (!pin || nearest(regions, view, pin.x, pin.y) !== label)) setPin({ x: r.x, y: r.y });
    if (!label) setPin(null);
  };

  const shown = markers.filter((m) => m.view === view && (!only || m.category === only));
  const shownSites = sites.filter((s) => s.view === view);

  const figure = (
    <section className="bm-card flex flex-col" aria-label="Body map">
      <div role="group" aria-label="Body view" className="bm-seg">
        {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
          <button key={v} type="button" onClick={() => choose(v)} aria-pressed={view === v} className="bm-seg-btn">
            {VIEW_LABEL[v]}
            {markers.some((m) => m.view === v && m.open) ? <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[#e4544f] align-middle" aria-label="has open observations" /> : null}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-[50px_minmax(0,1fr)_146px] gap-2.5 max-sm:grid-cols-[44px_minmax(0,1fr)]">
        <div role="toolbar" aria-label="Body map tools" className="bm-tools">
          <button type="button" className="bm-tool" aria-pressed="true"><Cursor size={18} aria-hidden /> <span>Select</span></button>
          <button type="button" className="bm-tool" onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))} disabled={zoom >= 2.5}><MagnifyingGlassPlus size={18} aria-hidden /> <span>Zoom In</span></button>
          <button type="button" className="bm-tool" onClick={() => setZoom((z) => Math.max(1, z - 0.25))} disabled={zoom <= 1}><MagnifyingGlassMinus size={18} aria-hidden /> <span>Zoom Out</span></button>
          <button type="button" className="bm-tool" onClick={() => { setZoom(1); setPin(editing ? pin : null); if (!editing) setRegion(""); setOnly(null); }}><ArrowCounterClockwise size={18} aria-hidden /> <span>Reset</span></button>
        </div>
        <div className="min-w-0 overflow-auto rounded-[8px]" style={{ maxHeight: 470 }} data-testid="body-map-canvas">
          <svg
            viewBox="25 0 150 400"
            role="img"
            aria-label={`${VIEW_LABEL[view]} of body. Click to choose where on the body.`}
            className="mx-auto block h-auto cursor-crosshair"
            style={{ width: `${zoom * 100}%`, maxWidth: zoom === 1 ? 190 : undefined }}
            data-testid="body-map-svg"
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              placeAt(Math.round(((25 + ((e.clientX - box.left) / box.width) * 150) / 200) * 1000) / 10, Math.round(((e.clientY - box.top) / box.height) * 1000) / 10);
            }}
          >
            <Outline view={view} />
            {view === "FRONT" || view === "BACK" ? (
              <g fontSize="7.5" fill="#667085" textAnchor="middle">
                <text x="48" y="10">{view === "FRONT" ? "Their right" : "Their left"}</text>
                <text x="152" y="10">{view === "FRONT" ? "Their left" : "Their right"}</text>
              </g>
            ) : null}
            {shownSites.map((s) => (
              <g key={s.id} aria-label={`Medication application site: ${s.label}`} role="img">
                <rect x={s.x * 2 - 6.5} y={s.y * 4 - 6.5} width="13" height="13" rx="3" fill="#0e7490" stroke="#fff" strokeWidth="1.5" opacity={editing ? 0.5 : 1} />
                <text x={s.x * 2} y={s.y * 4 + 3} fontSize="8" fontWeight="700" fill="#fff" textAnchor="middle" pointerEvents="none">M</text>
              </g>
            ))}
            {shown.map((m) => {
              const dot = (
                <>
                  <circle cx={m.x * 2} cy={m.y * 4} r={m.selected ? 8.5 : 7} fill={m.open ? colourOf(m.category) : "#98a2b3"} stroke={m.selected ? "#101828" : "#fff"} strokeWidth={m.selected ? 2.5 : 1.5} opacity={editing ? 0.45 : 1} />
                  <text x={m.x * 2} y={m.y * 4 + 3.2} fontSize="9" fontWeight="600" fill="#fff" textAnchor="middle" pointerEvents="none">{m.n}</text>
                </>
              );
              return editing ? <g key={m.id} pointerEvents="none" aria-hidden="true">{dot}</g> : <a key={m.id} href={m.href} aria-label={`Observation ${m.n}: ${m.label}`} onClick={(e) => e.stopPropagation()}>{dot}</a>;
            })}
            {pin ? <circle cx={pin.x * 2} cy={pin.y * 4} r="7.5" fill={mode === "site" ? "#0e7490" : category ? colourOf(category) : "#5b2bb5"} stroke="#fff" strokeWidth="2.5" data-testid="body-map-pin" /> : null}
          </svg>
        </div>
        <div className="max-sm:col-span-2">
          {mode === "site" ? null : (
            <fieldset className="bm-types min-w-0">
              <legend className="bm-types-title">Observation Types</legend>
              <ul className="space-y-0.5">
                {props.categories.map((c) => {
                  const active = mode === "record" ? category === c.name : only === c.name;
                  return (
                    <li key={c.name}>
                      <button type="button" aria-pressed={active} className="bm-type" onClick={() => (mode === "record" ? setCategory(c.name) : setOnly(only === c.name ? null : c.name))}>
                        <span className="inline-block h-3 w-3 shrink-0 rounded-full" style={{ background: colourOf(c.name), boxShadow: active ? `0 0 0 3px ${colourOf(c.name)}33` : undefined }} />
                        <span className="min-w-0 flex-1 truncate text-left">{c.name === "Other skin condition" ? "Other" : c.name}</span>
                        {mode === "browse" && c.count ? <span className="shrink-0 text-[11.5px] text-slate-500">{c.count}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}
          <div className="bm-selected mt-3">
            <p className="bm-types-title">Selected Area</p>
            {region ? (
              <p className="flex items-center gap-2 text-[13px]" data-testid="body-map-selected-area">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: mode === "site" ? "#0e7490" : category ? colourOf(category) : "#5b2bb5" }} />
                <span className="min-w-0 flex-1">{region}</span>
                <button type="button" aria-label="Clear the selected area" className="text-slate-500 hover:text-slate-900" onClick={() => pickRegion("")}><X size={14} aria-hidden /></button>
              </p>
            ) : <p className="text-[12.5px] text-slate-500">Click the outline, or choose from the list.</p>}
          </div>
          {mode === "browse" && props.canRecord && props.recordHref ? (
            <a href={`${props.recordHref}&view=${view}${pin ? `&x=${pin.x}&y=${pin.y}` : ""}${region ? `&region=${encodeURIComponent(region)}` : ""}${only ? `&category=${encodeURIComponent(only)}` : ""}`} className="bm-primary mt-3 w-full justify-center px-2 text-[12.5px]"><Plus size={15} weight="bold" aria-hidden /> Record Observation</a>
          ) : null}
        </div>
      </div>
      <p className="mt-2 flex flex-wrap justify-center gap-x-3 text-[11.5px] text-slate-500">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#7c3aed]" />open (colour by type)</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#98a2b3]" />resolved</span>
        {sites.length ? <span><span className="mr-1 inline-block h-2 w-2 rounded-[2px] bg-[#0e7490]" />medication site</span> : null}
      </p>
      <input type="hidden" name="view" value={view} />
      <input type="hidden" name="x" value={pin?.x ?? ""} />
      <input type="hidden" name="y" value={pin?.y ?? ""} />
    </section>
  );

  const location = (
    <label className="block">
      <span className="bm-label">Body Location <Req /></span>
      <span className="flex items-center gap-2">
        <select name="region" required value={region} className="input" onChange={(e) => pickRegion(e.currentTarget.value)} aria-describedby="bm-loc-hint">
          <option value="">Click the outline or choose…</option>
          {regions[view].map((r) => <option key={r.label} value={r.label}>{r.label}</option>)}
        </select>
        <Crosshair size={20} className="shrink-0 text-slate-500" aria-hidden />
      </span>
      <span id="bm-loc-hint" className="mt-0.5 block text-[11.5px] text-slate-500">{VIEW_LABEL[view]} view ({VIEW_LONG[view]})</span>
    </label>
  );

  const body = mode === "record" && props.record ? (
    <RecordForm f={props.record} location={location} category={category} setCategory={setCategory} formRef={formRef} restore={(d) => {
      if (d.view && d.view in VIEW_LABEL) setView(d.view as View);
      if (d.x && d.y) setPin({ x: Number(d.x), y: Number(d.y) });
      if (d.region) setRegion(d.region);
      if (d.category) setCategory(d.category);
    }} state={{ view, pin, region, category }} />
  ) : mode === "site" && props.site ? (
    <section className="bm-card" aria-labelledby="bm-site-h">
      <div className="flex items-start justify-between gap-3">
        <div><h3 id="bm-site-h" className="bm-h3">Record medication application site</h3><p className="text-[13px] text-slate-600">Where a cream, ointment or patch is applied, as documented by a manager. This is not a skin observation and not a record that a dose was given.</p></div>
        <a href={props.site.cancelHref} aria-label="Close" className="text-slate-500 hover:text-slate-900"><X size={20} aria-hidden /></a>
      </div>
      <div className="mt-4 space-y-3">
        {location}
        <label className="block"><span className="bm-label">Medicine <Req /></span><select name="medicationId" required className="input" defaultValue=""><option value="">Choose…</option>{props.site.medicines.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        <label className="block"><span className="bm-label">Note (optional)</span><input name="note" maxLength={500} className="input" placeholder="e.g. Rotate patch site weekly, as on the label" /></label>
        <p className="text-[12.5px] text-slate-500">A new patch site ends the previous one. Creams may have several sites. The MAR and its approvals are unchanged.</p>
        <div className="flex justify-between gap-2 border-t border-[#eaecf0] pt-3"><a href={props.site.cancelHref} className="bm-secondary">Cancel</a><button className="bm-primary">Save application site</button></div>
      </div>
    </section>
  ) : props.children;

  const grid = <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(330px,0.82fr)_minmax(0,1fr)]">{figure}<div className="min-w-0">{body}</div></div>;
  if (mode === "record" && props.record) {
    return <form ref={formRef} action={props.record.action} encType="multipart/form-data" data-testid="body-map-record-form"><input type="hidden" name="back" value={props.record.back} /><input type="hidden" name="serviceUserId" value={props.record.serviceUserId} />{grid}</form>;
  }
  if (mode === "site" && props.site) {
    return <form action={props.site.action}><input type="hidden" name="back" value={props.site.back} /><input type="hidden" name="serviceUserId" value={props.site.serviceUserId} />{grid}</form>;
  }
  return grid;
}

function field(form: HTMLFormElement, name: string) {
  const el = form.elements.namedItem(name);
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement ? (el.type === "file" ? null : el) : null;
}

const Req = () => <span className="text-[#d92d20]" aria-hidden>*</span>;

function RecordForm({ f, location, category, setCategory, formRef, restore, state }: {
  f: RecordFormProps; location: ReactNode; category: string; setCategory: (c: string) => void; formRef: React.RefObject<HTMLFormElement | null>;
  restore: (d: Record<string, string>) => void; state: { view: View; pin: { x: number; y: number } | null; region: string; category: string };
}) {
  const key = `bm-draft:${f.serviceUserId}`;
  const [desc, setDesc] = useState(0);
  const [followUp, setFollowUp] = useState(true);
  const [photos, setPhotos] = useState<{ name: string; url: string }[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Restore a kept draft once, or clear it after a successful save.
  useEffect(() => {
    try {
      if (f.clearDraft) {
        sessionStorage.removeItem(key);
        return;
      }
      const raw = sessionStorage.getItem(key);
      if (!raw) return;
      const d = JSON.parse(raw) as Record<string, string>;
      const form = formRef.current;
      if (form) {
        for (const name of DRAFT_FIELDS) {
          const el = field(form, name);
          if (el && d[name] !== undefined && name !== "category") el.value = d[name]!;
        }
      }
      if (d.description) setDesc(d.description.length);
      if (d.followUpRequired === "no") setFollowUp(false);
      restore(d);
      setRestored(true);
    } catch {
      // Storage unavailable (private window): the form still works, it just cannot keep a draft.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the draft as the person types or picks a location.
  const save = () => {
    const form = formRef.current;
    if (!form) return;
    const d: Record<string, string> = { view: state.view, x: String(state.pin?.x ?? ""), y: String(state.pin?.y ?? ""), region: state.region, category: state.category };
    for (const name of DRAFT_FIELDS) {
      const el = field(form, name);
      if (el && name !== "category") d[name] = el.value;
    }
    d.followUpRequired = followUp ? "yes" : "no";
    try {
      sessionStorage.setItem(key, JSON.stringify(d));
    } catch {
      /* ignore */
    }
  };
  useEffect(save);

  const clearDraft = () => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  };

  return (
    <section className="bm-card bm-raised" aria-labelledby="bm-new-h" onInput={save}>
      <div className="flex items-start gap-3 border-b border-[#eaecf0] pb-3">
        <span className="bm-icon"><NotePencil size={20} aria-hidden /></span>
        <div className="min-w-0 flex-1"><h3 id="bm-new-h" className="bm-h3">Record Observation</h3><p className="text-[13px] text-slate-600">Add a new body map observation for {f.personName}.</p></div>
        <a href={f.cancelHref} onClick={clearDraft} aria-label="Close without saving" className="text-slate-500 hover:text-slate-900"><X size={20} aria-hidden /></a>
      </div>
      {restored ? <p className="mt-3 rounded-[8px] bg-[#f4f3ff] px-3 py-2 text-[12.5px] text-[#4a2196]" role="status">Your unsaved entries were kept. Photographs must be added again.</p> : null}
      <div className="mt-3 grid gap-x-3 gap-y-3 md:grid-cols-6">
        <div className="md:col-span-3">{location}</div>
        <label className="md:col-span-3"><span className="bm-label">Observation Type <Req /></span>
          <span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: category ? colourOf(category) : "#d0d5dd" }} />
            <select name="category" required className="input" value={category} onChange={(e) => setCategory(e.currentTarget.value)}><option value="">Choose…</option>{Object.keys(CATEGORY_COLOUR).map((c) => <option key={c}>{c}</option>)}</select></span>
        </label>
        <label className="md:col-span-2"><span className="bm-label">Date Observed <Req /></span><input type="date" name="date" required defaultValue={f.today} max={f.today} className="input" /></label>
        <label className="md:col-span-2"><span className="bm-label">Time Observed <Req /></span><input type="time" name="time" required defaultValue={f.now} className="input" /></label>
        <label className="md:col-span-2"><span className="bm-label">Size (approx.)</span><input name="size" maxLength={120} className="input" placeholder="e.g. 6 cm × 4 cm" /></label>
        <label className="md:col-span-6"><span className="bm-label">Colour / Appearance</span><input name="appearance" maxLength={300} className="input" placeholder="e.g. purple / blue, starting to fade at edges" /></label>
        <label className="md:col-span-6"><span className="bm-label">Description (manual entry) <Req /></span>
          <textarea name="description" required minLength={10} maxLength={4000} rows={3} className="input" placeholder="What you saw, in plain words. Describe it; do not diagnose." onChange={(e) => setDesc(e.currentTarget.value.length)} />
          <span className="mt-0.5 block text-right text-[11.5px] text-slate-500">{desc} / 4000</span>
        </label>
        <label className="md:col-span-3"><span className="bm-label">Pain / Discomfort <Req /></span><select name="pain" required className="input" defaultValue=""><option value="">Choose…</option>{f.pain.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
        <label className="md:col-span-3"><span className="bm-label">Action Taken</span><textarea name="actionTaken" maxLength={2000} rows={2} className="input" placeholder="e.g. Monitored, informed care coordinator, photograph taken" /></label>
        <label className="md:col-span-6"><span className="bm-label">Person Notified</span><input name="personNotified" maxLength={300} className="input" placeholder="e.g. Care coordinator; daughter (next of kin) by phone" /></label>
        <label className="md:col-span-6"><span className="bm-label">Exact location (optional)</span><input name="locationDetail" maxLength={200} className="input" placeholder="e.g. 3 cm above the wrist, outer side" /></label>
        <div className="md:col-span-2">
          <span className="bm-label" id="bm-fu-l">Follow-up Required</span>
          <input type="hidden" name="followUpRequired" value={followUp ? "yes" : "no"} />
          <button type="button" role="switch" aria-checked={followUp} aria-labelledby="bm-fu-l" className="bm-switch" onClick={() => setFollowUp((v) => !v)}><span /></button>
          <span className="ml-2 text-[13px] text-slate-600">{followUp ? "Yes" : "No"}</span>
        </div>
        <label className="md:col-span-2"><span className="bm-label">Follow-up Date{followUp ? <> <Req /></> : null}</span><input type="date" name="followUpOn" min={f.today} required={followUp} disabled={!followUp} className="input" /></label>
        <label className="md:col-span-2"><span className="bm-label">Assign To</span><select name="reviewerId" className="input" defaultValue=""><option value="">No reviewer yet</option>{f.reviewers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        {f.canPhotos ? (
          <div className="md:col-span-6">
            <span className="bm-label">Photographs</span>
            <div className="flex flex-wrap items-start gap-3">
              {photos.map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.url} src={p.url} alt={`Selected photo ${p.name}`} className="h-[72px] w-[92px] rounded-[8px] border border-[#eaecf0] object-cover" />
              ))}
              <label className="bm-add-photo">
                <Plus size={18} aria-hidden /> <span>{photos.length ? "Change photos" : "Add Photos"}</span>
                <input ref={fileRef} type="file" name="photo" multiple accept={f.photoAccept} className="sr-only" onChange={(e) => {
                  const files = [...(e.currentTarget.files ?? [])];
                  const tooBig = files.find((x) => x.size > f.maxBytes);
                  const msg = files.length > f.maxPhotos ? `Add up to ${f.maxPhotos} photographs at a time.` : tooBig ? `${tooBig.name} is ${(tooBig.size / 1048576).toFixed(1)} MB. Each photo must be ${Math.round(f.maxBytes / 1048576)} MB or smaller.` : "";
                  e.currentTarget.setCustomValidity(msg);
                  setPhotoError(msg || null);
                  setPhotos(files.map((x) => ({ name: x.name, url: URL.createObjectURL(x) })));
                }} />
              </label>
              <p className={`max-w-[230px] text-[11.5px] ${photoError ? "font-medium text-[#a3242c]" : "text-slate-500"}`} role={photoError ? "alert" : undefined}>{photoError ?? `JPG, PNG, GIF or WebP · up to ${Math.round(f.maxBytes / 1048576)} MB each · up to ${f.maxPhotos} photos. Only with the person's consent; kept privately.`}</p>
            </div>
            {photos.length ? <label className="mt-2 block"><span className="bm-label">Photo caption (optional)</span><input name="caption" maxLength={200} className="input" /></label> : null}
          </div>
        ) : null}
      </div>
      <p className="mt-3 text-[12px] text-slate-500">Saved exactly as entered and cannot be edited afterwards; later findings are added as notes and follow-ups. Managers are told in the app.</p>
      <div className="mt-3 flex justify-between gap-2 border-t border-[#eaecf0] pt-3">
        <a href={f.cancelHref} onClick={clearDraft} className="bm-secondary">Cancel</a>
        <button className="bm-primary" data-testid="body-map-save"><NotePencil size={16} aria-hidden /> Save Observation</button>
      </div>
    </section>
  );
}
