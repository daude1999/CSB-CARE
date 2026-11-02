"use client";

import { useState } from "react";
import { CarersNeededField } from "@/components/carers-needed";

type Opt = { id: string; label: string };

/**
 * Carers needed on a template and the preferred carer for each place. Choosing a number shows one "Carer N" choice per
 * place: places 1 and 2 post as preferredStaff1Id / preferredStaff2Id, places 3 and above as extraPreferredStaffIds (in
 * order). The server validates the whole set again (distinct people, no shadow among them, within the number needed).
 */
export function TemplateCarersFields({ options, carersRequired, preferred, shadowStaffId }: { options: Opt[]; carersRequired: number; preferred: (string | null)[]; shadowStaffId: string | null }) {
  const [count, setCount] = useState(carersRequired);
  const opts = options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <CarersNeededField defaultValue={carersRequired} onCount={setCount} />
      </div>
      <fieldset className="grid gap-3 md:grid-cols-3">
        <legend className="sr-only">Preferred carer for each place</legend>
        {Array.from({ length: count }, (_, i) => (
          <label key={i}>
            <span className="label">Carer {i + 1}</span>
            <select name={i === 0 ? "preferredStaff1Id" : i === 1 ? "preferredStaff2Id" : "extraPreferredStaffIds"} defaultValue={preferred[i] ?? ""} className="input">
              <option value="">Leave unassigned</option>
              {opts}
            </select>
          </label>
        ))}
        <label><span className="label">Shadow carer</span><select name="shadowStaffId" defaultValue={shadowStaffId ?? ""} className="input"><option value="">None</option>{opts}</select></label>
      </fieldset>
    </>
  );
}
