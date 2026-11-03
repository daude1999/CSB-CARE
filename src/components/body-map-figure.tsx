"use client";

import { useState, type ReactNode } from "react";

/**
 * The Digital Body Map outline and marker picker. The outline is CSB's own simple drawing (front, back, left and right
 * side) on a 200 × 400 grid; positions are stored as percentages so they survive any change of drawing size.
 * Clicking the outline places the mark and picks the nearest named area; keyboard users choose the area from the list,
 * which puts the mark at that area's centre.
 */

export type View = "FRONT" | "BACK" | "LEFT" | "RIGHT";
export interface Marker { id: string; n: number; view: View; x: number; y: number; open: boolean; label: string; href: string; selected?: boolean }
export type Regions = Record<View, readonly { label: string; x: number; y: number }[]>;

const VIEW_LABEL: Record<View, string> = { FRONT: "Front", BACK: "Back", LEFT: "Left side", RIGHT: "Right side" };

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

export function BodyMapFigure({ markers, regions, recordable = false, initialView = "FRONT", children }: { markers: Marker[]; regions: Regions; recordable?: boolean; initialView?: View; children?: ReactNode }) {
  const [view, setView] = useState<View>(initialView);
  const [pin, setPin] = useState<{ x: number; y: number } | null>(null);
  const [region, setRegion] = useState("");
  const shown = markers.filter((m) => m.view === view);
  const choose = (v: View) => {
    setView(v);
    setPin(null);
    setRegion("");
  };
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(220px,260px)_minmax(0,1fr)]">
      <div>
        <div role="group" aria-label="Body map view" className="mb-2 grid grid-cols-4 gap-1">
          {(Object.keys(VIEW_LABEL) as View[]).map((v) => (
            <button key={v} type="button" onClick={() => choose(v)} aria-pressed={view === v} className={`rounded-[4px] border px-1.5 py-1.5 text-[13px] ${view === v ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white text-slate-800 hover:border-navy-700"}`}>
              {VIEW_LABEL[v]}
              {markers.some((m) => m.view === v && m.open) ? <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-[#e4544f] align-middle" aria-label="has open observations" /> : null}
            </button>
          ))}
        </div>
        <svg
          viewBox="0 0 200 400"
          role="img"
          aria-label={`${VIEW_LABEL[view]} of body${recordable ? ". Click to mark where the observation is." : ""}`}
          className={`mx-auto block h-auto w-full max-w-[240px] rounded-[4px] border border-slate-200 bg-white ${recordable ? "cursor-crosshair" : ""}`}
          data-testid="body-map-svg"
          onClick={(e) => {
            if (!recordable) return;
            const box = e.currentTarget.getBoundingClientRect();
            const x = Math.round(((e.clientX - box.left) / box.width) * 1000) / 10;
            const y = Math.round(((e.clientY - box.top) / box.height) * 1000) / 10;
            setPin({ x, y });
            setRegion(nearest(regions, view, x, y));
          }}
        >
          <Outline view={view} />
          {view === "FRONT" || view === "BACK" ? (
            <g fontSize="9" fill="#64748b" textAnchor="middle">
              <text x="22" y="12">{view === "FRONT" ? "Their right" : "Their left"}</text>
              <text x="178" y="12">{view === "FRONT" ? "Their left" : "Their right"}</text>
            </g>
          ) : null}
          {shown.map((m) => {
            const dot = (
              <>
                <circle cx={m.x * 2} cy={m.y * 4} r={m.selected ? 8.5 : 7} fill={m.open ? "#e4544f" : "#94a3b8"} stroke={m.selected ? "#0b2545" : "#fff"} strokeWidth={m.selected ? 2.5 : 1.5} opacity={recordable ? 0.55 : 1} />
                <text x={m.x * 2} y={m.y * 4 + 3.2} fontSize="9" fontWeight="600" fill="#fff" textAnchor="middle" pointerEvents="none">{m.n}</text>
              </>
            );
            // While recording, earlier marks are shown faintly for reference and do not catch clicks.
            return recordable ? <g key={m.id} pointerEvents="none" aria-hidden="true">{dot}</g> : <a key={m.id} href={m.href} aria-label={`Observation ${m.n}: ${m.label}`}>{dot}</a>;
          })}
          {pin ? <circle cx={pin.x * 2} cy={pin.y * 4} r="7" fill="#0b2545" stroke="#fff" strokeWidth="2" data-testid="body-map-pin" /> : null}
        </svg>
        <p className="mt-2 text-center text-[12px] text-slate-500"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-[#e4544f]" /> open <span className="mx-1 ml-3 inline-block h-2 w-2 rounded-full bg-[#94a3b8]" /> resolved</p>
      </div>
      {recordable ? (
        <div className="space-y-2">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="x" value={pin?.x ?? ""} />
          <input type="hidden" name="y" value={pin?.y ?? ""} />
          <label className="block">
            <span className="label">Where on the body ({VIEW_LABEL[view].toLowerCase()})</span>
            <select
              name="region"
              required
              value={region}
              className="input"
              onChange={(e) => {
                const label = e.currentTarget.value;
                setRegion(label);
                const r = regions[view].find((x) => x.label === label);
                // Choosing from the list (or changing the area) moves the mark to that area unless it is already inside it.
                if (r && (!pin || nearest(regions, view, pin.x, pin.y) !== label)) setPin({ x: r.x, y: r.y });
              }}
            >
              <option value="">Click the outline or choose…</option>
              {regions[view].map((r) => <option key={r.label} value={r.label}>{r.label}</option>)}
            </select>
          </label>
          {children}
        </div>
      ) : children ? <div>{children}</div> : null}
    </div>
  );
}
