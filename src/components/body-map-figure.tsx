"use client";

import { ArrowCounterClockwise, Crosshair, Cursor, MagnifyingGlassMinus, MagnifyingGlassPlus, NotePencil, Plus, PlusSquare, X } from "@phosphor-icons/react";
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
  Bruising: "#7c3aed", "Cuts and scratches": "#ef4444", "Pressure sore": "#ec4899", "Skin tear": "#c026d3", Wound: "#f97316",
  Burn: "#eab308", Swelling: "#22c55e", Redness: "#e11d48", Rash: "#a855f7", "Other skin condition": "#64748b",
};
/** Short names for the type list (the stored category keeps its full name). */
const TYPE_SHORT: Record<string, string> = { "Cuts and scratches": "Cut / scratch", "Other skin condition": "Other" };
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


/** CSB's own outline, drawn on the 200 × 400 grid (front and back share it). Arms are drawn over the body. */
const BODY_PATH = "M93 43 C90.5 44.7 93.5 50.5 92 53 C90.5 55.5 87.3 56.7 84 58 C80.7 59.3 75.5 59.7 72 61 C68.5 62.3 65 63.5 63 66 C61 68.5 60.3 71.7 60 76 C59.7 80.3 60.3 86 61 92 C61.7 98 63.2 105 64 112 C64.8 119 65.8 127.3 66 134 C66.2 140.7 65.5 146 65 152 C64.5 158 63.3 163.7 63 170 C62.7 176.3 62.7 182.7 63 190 C63.3 197.3 64.2 205.7 65 214 C65.8 222.3 67 232 68 240 C69 248 70.5 255.3 71 262 C71.5 268.7 70.8 273.7 71 280 C71.2 286.3 71.3 292.3 72 300 C72.7 307.7 74 317.7 75 326 C76 334.3 77.3 344 78 350 C78.7 356 79.3 358 79 362 C78.7 366 77.2 370.3 76 374 C74.8 377.7 71.7 381.3 72 384 C72.3 386.7 74.7 389 78 390 C81.3 391 89.2 391.7 92 390 C94.8 388.3 94.7 384.3 95 380 C95.3 375.7 94 370.7 94 364 C94 357.3 94.7 349 95 340 C95.3 331 96 319.7 96 310 C96 300.3 95 290 95 282 C95 274 95.5 270.7 96 262 C96.5 253.3 97.5 239.3 98 230 C98.5 220.7 98.7 211.3 99 206 C99.3 200.7 99.7 198 100 198 C100.3 198 100.7 200.7 101 206 C101.3 211.3 101.5 220.7 102 230 C102.5 239.3 103.5 253.3 104 262 C104.5 270.7 105 274 105 282 C105 290 104 300.3 104 310 C104 319.7 104.7 331 105 340 C105.3 349 106 357.3 106 364 C106 370.7 104.7 375.7 105 380 C105.3 384.3 105.2 388.3 108 390 C110.8 391.7 118.7 391 122 390 C125.3 389 127.7 386.7 128 384 C128.3 381.3 125.2 377.7 124 374 C122.8 370.3 121.3 366 121 362 C120.7 358 121.3 356 122 350 C122.7 344 124 334.3 125 326 C126 317.7 127.3 307.7 128 300 C128.7 292.3 128.8 286.3 129 280 C129.2 273.7 128.5 268.7 129 262 C129.5 255.3 131 248 132 240 C133 232 134.2 222.3 135 214 C135.8 205.7 136.7 197.3 137 190 C137.3 182.7 137.3 176.3 137 170 C136.7 163.7 135.5 158 135 152 C134.5 146 133.8 140.7 134 134 C134.2 127.3 135.2 119 136 112 C136.8 105 138.3 98 139 92 C139.7 86 140.3 80.3 140 76 C139.7 71.7 139 68.5 137 66 C135 63.5 131.5 62.3 128 61 C124.5 59.7 119.3 59.3 116 58 C112.7 56.7 109.5 55.5 108 53 C106.5 50.5 109.5 44.7 107 43 C104.5 41.3 95.5 41.3 93 43 Z";
const ARM_PATHS = ["M63 66 C61.7 63 56.2 68 54 72 C51.8 76 51 84 50 90 C49 96 49 101 48 108 C47 115 45.3 124.3 44 132 C42.7 139.7 41.3 146.7 40 154 C38.7 161.3 37 170.3 36 176 C35 181.7 35 184.3 34 188 C33 191.7 31 194.7 30 198 C29 201.3 27.7 205.3 28 208 C28.3 210.7 30.5 213.7 32 214 C33.5 214.3 36 212 37 210 C38 208 37.3 204.7 38 202 C38.7 199.3 40 196.7 41 194 C42 191.3 43 190.7 44 186 C45 181.3 45.8 172.7 47 166 C48.2 159.3 49.7 152.7 51 146 C52.3 139.3 53.7 132.7 55 126 C56.3 119.3 57.8 112 59 106 C60.2 100 61.3 96.7 62 90 C62.7 83.3 64.3 69 63 66 Z", "M137 66 C138.3 63 143.8 68 146 72 C148.2 76 149 84 150 90 C151 96 151 101 152 108 C153 115 154.7 124.3 156 132 C157.3 139.7 158.7 146.7 160 154 C161.3 161.3 163 170.3 164 176 C165 181.7 165 184.3 166 188 C167 191.7 169 194.7 170 198 C171 201.3 172.3 205.3 172 208 C171.7 210.7 169.5 213.7 168 214 C166.5 214.3 164 212 163 210 C162 208 162.7 204.7 162 202 C161.3 199.3 160 196.7 159 194 C158 191.3 157 190.7 156 186 C155 181.3 154.2 172.7 153 166 C151.8 159.3 150.3 152.7 149 146 C147.7 139.3 146.3 132.7 145 126 C143.7 119.3 142.2 112 141 106 C139.8 100 138.7 96.7 138 90 C137.3 83.3 135.7 69 137 66 Z"];
const ARM_EDGES = ["M63 66 C61.7 63 56.2 68 54 72 C51.8 76 51 84 50 90 C49 96 49 101 48 108 C47 115 45.3 124.3 44 132 C42.7 139.7 41.3 146.7 40 154 C38.7 161.3 37 170.3 36 176 C35 181.7 35 184.3 34 188 C33 191.7 31 194.7 30 198 C29 201.3 27.7 205.3 28 208 C28.3 210.7 30.5 213.7 32 214 C33.5 214.3 36 212 37 210 C38 208 37.3 204.7 38 202 C38.7 199.3 40 196.7 41 194 C42 191.3 43 190.7 44 186 C45 181.3 45.8 172.7 47 166 C48.2 159.3 49.7 152.7 51 146 C52.3 139.3 53.7 132.7 55 126 C56.3 119.3 57.8 112 59 106 C60.2 100 61.3 96.7 62 90", "M137 66 C138.3 63 143.8 68 146 72 C148.2 76 149 84 150 90 C151 96 151 101 152 108 C153 115 154.7 124.3 156 132 C157.3 139.7 158.7 146.7 160 154 C161.3 161.3 163 170.3 164 176 C165 181.7 165 184.3 166 188 C167 191.7 169 194.7 170 198 C171 201.3 172.3 205.3 172 208 C171.7 210.7 169.5 213.7 168 214 C166.5 214.3 164 212 163 210 C162 208 162.7 204.7 162 202 C161.3 199.3 160 196.7 159 194 C158 191.3 157 190.7 156 186 C155 181.3 154.2 172.7 153 166 C151.8 159.3 150.3 152.7 149 146 C147.7 139.3 146.3 132.7 145 126 C143.7 119.3 142.2 112 141 106 C139.8 100 138.7 96.7 138 90"];
const INK = "#475467";
const DETAIL = "#98a2b3";

function Outline({ view }: { view: View }) {
  if (view === "FRONT" || view === "BACK") {
    return (
      <g strokeLinejoin="round" strokeLinecap="round">
        <path d={BODY_PATH} fill="#fff" stroke={INK} strokeWidth="1.3" />
        {ARM_PATHS.map((d) => <path key={d} d={d} fill="#fff" />)}
        {ARM_EDGES.map((d) => <path key={d} d={d} fill="none" stroke={INK} strokeWidth="1.3" />)}
        <ellipse cx="85.6" cy="27" rx="2.6" ry="5" fill="#fff" stroke={INK} strokeWidth="1.1" />
        <ellipse cx="114.4" cy="27" rx="2.6" ry="5" fill="#fff" stroke={INK} strokeWidth="1.1" />
        <ellipse cx="100" cy="25" rx="14.5" ry="18.5" fill="#fff" stroke={INK} strokeWidth="1.3" />
        <g fill="none" stroke={DETAIL} strokeWidth="0.9">
          {view === "FRONT" ? (
            <>
              <path d="M94 24 q2 -1.6 4 0 M102 24 q2 -1.6 4 0" />
              <path d="M97 35 q3 1.8 6 0" />
              <path d="M76 66 Q88 63 98 67 M124 66 Q112 63 102 67" />
              <path d="M74 94 Q86 104 98 96 M126 94 Q114 104 102 96" />
              <circle cx="100" cy="140" r="1.4" />
              <path d="M80 270 q5 4 10 0 M110 270 q5 4 10 0" />
            </>
          ) : (
            <>
              <path d="M100 58 V178" strokeDasharray="3 4" />
              <path d="M76 82 Q82 100 92 104 M124 82 Q118 100 108 104" />
              <path d="M100 182 Q100 196 100 198 M78 196 Q90 202 99 194 M122 196 Q110 202 101 194" />
              <path d="M80 268 q5 -3 10 0 M110 268 q5 -3 10 0" />
            </>
          )}
        </g>
      </g>
    );
  }
  // Side views: the person faces the way of their nose; LEFT shows their left side (facing your left).
  const flip = view === "RIGHT";
  return (
    <g fill="#fff" stroke={INK} strokeWidth="1.3" strokeLinejoin="round" transform={flip ? "translate(200 0) scale(-1 1)" : undefined}>
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
  // Select: clicking the outline picks an area. Add Area (browse only): clicking opens Record Observation at that spot.
  const [tool, setTool] = useState<"select" | "add">("select");
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
            {markers.some((m) => m.view === v && m.open) ? <span className="sr-only"> (has open observations)</span> : null}
          </button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-[48px_minmax(0,1fr)_140px] gap-1.5 max-sm:grid-cols-[50px_minmax(0,1fr)]">
        <div role="toolbar" aria-label="Body map tools" className="bm-tools">
          <button type="button" className="bm-tool" aria-pressed={tool === "select"} onClick={() => setTool("select")}><Cursor size={18} aria-hidden /> <span>Select</span></button>
          <button type="button" className="bm-tool" aria-pressed={tool === "add"} disabled={editing || !props.canRecord || !props.recordHref} title={editing ? "Click the outline to mark the area" : "Click the outline to record a new observation there"} onClick={() => setTool("add")}><PlusSquare size={18} aria-hidden /> <span>Add Area</span></button>
          <button type="button" className="bm-tool" onClick={() => setZoom((z) => Math.min(2.5, z + 0.25))} disabled={zoom >= 2.5}><MagnifyingGlassPlus size={18} aria-hidden /> <span>Zoom In</span></button>
          <button type="button" className="bm-tool" onClick={() => setZoom((z) => Math.max(1, z - 0.25))} disabled={zoom <= 1}><MagnifyingGlassMinus size={18} aria-hidden /> <span>Zoom Out</span></button>
          <button type="button" className="bm-tool" onClick={() => { setZoom(1); setTool("select"); setPin(editing ? pin : null); if (!editing) setRegion(""); setOnly(null); }}><ArrowCounterClockwise size={18} aria-hidden /> <span>Reset</span></button>
        </div>
        <div className="min-w-0 overflow-auto rounded-[8px]" style={{ maxHeight: 500 }} data-testid="body-map-canvas">
          <svg
            viewBox="22 0 156 404"
            role="img"
            aria-label={`${VIEW_LABEL[view]} of body. Click to choose where on the body.`}
            className={`mx-auto block h-auto ${tool === "add" ? "cursor-copy" : "cursor-crosshair"}`}
            style={{ width: `${zoom * 100}%`, maxWidth: zoom === 1 ? 240 : undefined }}
            data-testid="body-map-svg"
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const x = Math.round(((22 + ((e.clientX - box.left) / box.width) * 156) / 200) * 1000) / 10;
              const y = Math.round(((((e.clientY - box.top) / box.height) * 404) / 400) * 1000) / 10;
              if (tool === "add" && !editing && props.recordHref) {
                window.location.assign(`${props.recordHref}&view=${view}&x=${x}&y=${y}&region=${encodeURIComponent(nearest(regions, view, x, y))}${only ? `&category=${encodeURIComponent(only)}` : ""}`);
                return;
              }
              placeAt(x, y);
            }}
          >
            <Outline view={view} />
            {view === "FRONT" || view === "BACK" ? (
              <g fontSize="7" fontWeight="600" fill="#98a2b3" textAnchor="middle" aria-hidden="true">
                <text x="30" y="226">{view === "FRONT" ? "R" : "L"}</text>
                <text x="170" y="226">{view === "FRONT" ? "L" : "R"}</text>
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
                        <span className="min-w-0 flex-1 truncate text-left" title={c.name}>{TYPE_SHORT[c.name] ?? c.name}</span>
                        {mode === "browse" && c.count ? <span className="sr-only">, {c.count} recorded</span> : null}
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
              <p className="bm-chip" data-testid="body-map-selected-area">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: mode === "site" ? "#0e7490" : category ? colourOf(category) : "#5b2bb5" }} />
                <span className="min-w-0 flex-1">{region}</span>
                <button type="button" aria-label="Clear the selected area" className="text-slate-500 hover:text-slate-900" onClick={() => pickRegion("")}><X size={14} aria-hidden /></button>
              </p>
            ) : <p className="px-1 text-meta text-slate-500">None yet. Click the outline.</p>}
          </div>
          {mode === "browse" && props.canRecord && props.recordHref ? (
            <a href={`${props.recordHref}&view=${view}${pin ? `&x=${pin.x}&y=${pin.y}` : ""}${region ? `&region=${encodeURIComponent(region)}` : ""}${only ? `&category=${encodeURIComponent(only)}` : ""}`} className="bm-primary mt-3 w-full justify-center gap-1.5 px-1.5 text-meta"><Plus size={14} weight="bold" aria-hidden /> Record Observation</a>
          ) : null}
        </div>
      </div>
      {sites.length || markers.some((m) => !m.open) ? (
        <p className="mt-2 flex flex-wrap justify-center gap-x-3 text-caption text-slate-500">
          {markers.some((m) => !m.open) ? <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#98a2b3]" />resolved</span> : null}
          {sites.length ? <span><span className="mr-1 inline-block h-2 w-2 rounded-[2px] bg-[#0e7490]" />medication site</span> : null}
        </p>
      ) : null}
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
      <span id="bm-loc-hint" className="mt-0.5 block text-caption text-slate-500">{VIEW_LABEL[view]} view ({VIEW_LONG[view]})</span>
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
        <div><h3 id="bm-site-h" className="bm-h3">Record medication application site</h3><p className="text-meta text-slate-600">Where a cream, ointment or patch is applied, as documented by a manager. This is not a skin observation and not a record that a dose was given.</p></div>
        <a href={props.site.cancelHref} aria-label="Close" className="text-slate-500 hover:text-slate-900"><X size={20} aria-hidden /></a>
      </div>
      <div className="mt-4 space-y-3">
        {location}
        <label className="block"><span className="bm-label">Medicine <Req /></span><select name="medicationId" required className="input" defaultValue=""><option value="">Choose…</option>{props.site.medicines.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        <label className="block"><span className="bm-label">Note (optional)</span><input name="note" maxLength={500} className="input" placeholder="e.g. Rotate patch site weekly, as on the label" /></label>
        <p className="text-meta text-slate-500">A new patch site ends the previous one. Creams may have several sites. The MAR and its approvals are unchanged.</p>
        <div className="flex justify-between gap-2 border-t border-[#eaecf0] pt-3"><a href={props.site.cancelHref} className="bm-secondary">Cancel</a><button className="bm-primary">Save application site</button></div>
      </div>
    </section>
  ) : props.children;

  const grid = <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(370px,1fr)_minmax(0,1fr)]">{figure}<div className="min-w-0">{body}</div></div>;
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
        <div className="min-w-0 flex-1"><h3 id="bm-new-h" className="bm-h3">Record Observation</h3><p className="text-meta text-slate-600">Add a new body map observation for {f.personName}.</p></div>
        <a href={f.cancelHref} onClick={clearDraft} aria-label="Close without saving" className="text-slate-500 hover:text-slate-900"><X size={20} aria-hidden /></a>
      </div>
      {restored ? <p className="mt-3 rounded-[8px] bg-[#f4f3ff] px-3 py-2 text-meta text-[#4a2196]" role="status">Your unsaved entries were kept. Photographs must be added again.</p> : null}
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
          <span className="mt-0.5 block text-right text-caption text-slate-500">{desc} / 4000</span>
        </label>
        <label className="md:col-span-3"><span className="bm-label">Pain / Discomfort <Req /></span><select name="pain" required className="input" defaultValue=""><option value="">Choose…</option>{f.pain.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
        <label className="md:col-span-3"><span className="bm-label">Action Taken</span><textarea name="actionTaken" maxLength={2000} rows={2} className="input" placeholder="e.g. Monitored, informed care coordinator, photograph taken" /></label>
        <label className="md:col-span-6"><span className="bm-label">Person Notified</span><input name="personNotified" maxLength={300} className="input" placeholder="e.g. Care coordinator; daughter (next of kin) by phone" /></label>
        <label className="md:col-span-6"><span className="bm-label">Exact location (optional)</span><input name="locationDetail" maxLength={200} className="input" placeholder="e.g. 3 cm above the wrist, outer side" /></label>
        <div className="md:col-span-2">
          <span className="bm-label" id="bm-fu-l">Follow-up Required</span>
          <input type="hidden" name="followUpRequired" value={followUp ? "yes" : "no"} />
          <button type="button" role="switch" aria-checked={followUp} aria-labelledby="bm-fu-l" className="bm-switch" onClick={() => setFollowUp((v) => !v)}><span /></button>
          <span className="ml-2 text-meta text-slate-600">{followUp ? "Yes" : "No"}</span>
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
              <p className={`max-w-[230px] text-caption ${photoError ? "font-medium text-[#a3242c]" : "text-slate-500"}`} role={photoError ? "alert" : undefined}>{photoError ?? `JPG, PNG, GIF or WebP · up to ${Math.round(f.maxBytes / 1048576)} MB each · up to ${f.maxPhotos} photos. Only with the person's consent; kept privately.`}</p>
            </div>
            {photos.length ? <label className="mt-2 block"><span className="bm-label">Photo caption (optional)</span><input name="caption" maxLength={200} className="input" /></label> : null}
          </div>
        ) : null}
      </div>
      <p className="mt-3 text-caption text-slate-500">Saved exactly as entered and cannot be edited afterwards; later findings are added as notes and follow-ups. Managers are told in the app.</p>
      <div className="mt-3 flex justify-between gap-2 border-t border-[#eaecf0] pt-3">
        <a href={f.cancelHref} onClick={clearDraft} className="bm-secondary">Cancel</a>
        <button className="bm-primary" data-testid="body-map-save"><NotePencil size={16} aria-hidden /> Save Observation</button>
      </div>
    </section>
  );
}
