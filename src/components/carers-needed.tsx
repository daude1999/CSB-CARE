"use client";

import { useId, useState } from "react";
import { MAX_CARERS } from "@/lib/carer-places";

const PRESETS = [1, 2, 3, 4, 5, 6] as const;
const presetLabel = (n: number) => (n === 1 ? "1 carer" : n === 2 ? "2 carers (double-up)" : `${n} carers`);

/**
 * "Carers needed": 1 to 6 from the list, or Custom with the exact number typed in (up to MAX_CARERS). The form posts
 * `name` ("1"…"6" or "custom") and, for Custom, `${name}Custom`. The server reads both, so the field works the same in
 * every form that uses it, and still validates the number itself.
 */
export function CarersNeededField({ name = "carersRequired", defaultValue = 1, label = "Carers needed", compact = false, onCount }: { name?: string; defaultValue?: number; label?: string; compact?: boolean; onCount?: (n: number) => void }) {
  const startsCustom = defaultValue > PRESETS.length;
  const [custom, setCustom] = useState(startsCustom);
  const id = useId();
  const labelClass = compact ? "text-meta text-slate-600" : "label";
  const inputClass = compact ? "input py-1.5 text-body" : "input";
  return (
    <div className="min-w-0">
      <label htmlFor={`${id}-n`} className={labelClass}>{label}</label>
      <div className="flex gap-2">
        <select id={`${id}-n`} name={name} defaultValue={startsCustom ? "custom" : String(defaultValue)} onChange={(e) => {
          const isCustom = e.target.value === "custom";
          setCustom(isCustom);
          onCount?.(isCustom ? (startsCustom ? defaultValue : PRESETS.length + 1) : Number(e.target.value));
        }} className={inputClass}>
          {PRESETS.map((n) => <option key={n} value={n}>{presetLabel(n)}</option>)}
          <option value="custom">Custom…</option>
        </select>
        {custom ? (
          <input
            name={`${name}Custom`}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_CARERS}
            step={1}
            required
            defaultValue={startsCustom ? defaultValue : PRESETS.length + 1}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= MAX_CARERS) onCount?.(n);
            }}
            aria-label={`Exact number of carers needed (1 to ${MAX_CARERS})`}
            className={`${inputClass} w-24 shrink-0`}
          />
        ) : null}
      </div>
      {custom ? <p className="mt-1 text-caption text-slate-500">Enter the exact number of carers, from 1 to {MAX_CARERS}.</p> : null}
    </div>
  );
}
