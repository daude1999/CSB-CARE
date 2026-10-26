"use client";
import { useState } from "react";
import { BUSINESS_FIELDS, REQUIRED_TAGS, SERVICE_TYPES, type BusinessDetails } from "@/lib/business";
import { TagBody } from "@/components/tag-text";

const PREVIEW = [
  "This policy is adopted by {{company_name}} ({{service_type}}), registered at {{address}}.",
  "The registered manager ({{registered_manager}}) is the safeguarding lead for the service and refers concerns to the local authority safeguarding team at {{local_authority}}.",
  "• Safeguarding lead: {{safeguarding_lead}}",
  "• Nominated individual: {{nominated_individual}}",
  "• Telephone {{phone}} · {{email}}",
].join("\n");

/** Business details form with a live preview of how the details read inside a policy. */
export function BusinessForm({ initial, action }: { initial: BusinessDetails; action: (fd: FormData) => Promise<void> }) {
  const [values, setValues] = useState(initial);
  const filled = REQUIRED_TAGS.filter((t) => values[t]?.trim()).length;
  return (
    <form action={action} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <input type="hidden" name="back" value="/settings" />
      <div>
        <div className="grid gap-x-5 gap-y-3.5 sm:grid-cols-2">
          {BUSINESS_FIELDS.map((f) => (
            <div key={f.tag} className={f.tag === "address" ? "sm:col-span-2" : ""}>
              <label className="label flex items-baseline justify-between gap-2" htmlFor={`b-${f.tag}`}>
                <span>{f.label}{REQUIRED_TAGS.includes(f.tag) ? <span className="text-rose-700"> *</span> : null}</span>
                <code className="shrink-0 font-mono text-[11px] font-normal normal-case tracking-normal text-slate-400">{`{{${f.tag}}}`}</code>
              </label>
              {f.tag === "service_type" ? (
                <select id={`b-${f.tag}`} name={f.tag} className="input" value={values[f.tag]} onChange={(e) => setValues({ ...values, [f.tag]: e.target.value })}>
                  <option value="">Choose…</option>
                  {[...new Set([...SERVICE_TYPES, values[f.tag]].filter(Boolean))].map((s) => <option key={s}>{s}</option>)}
                </select>
              ) : (
                <input id={`b-${f.tag}`} name={f.tag} className="input" value={values[f.tag]} placeholder={f.hint} onChange={(e) => setValues({ ...values, [f.tag]: e.target.value })} />
              )}
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button className="btn-primary" type="submit">Save and update all policies</button>
          <span className="text-[13px] text-slate-600">{filled} of {REQUIRED_TAGS.length} required details complete</span>
        </div>
      </div>
      <aside aria-label="Preview" className="self-start rounded-[4px] border-[1.5px] border-teal-400 bg-teal-100 p-4">
        <p className="text-[15px] font-medium text-navy-900">How this reads in your policies</p>
        <p className="mt-1 text-[12.5px] text-slate-600">Updates as you type. Highlighted words are tags that fill in across every policy, form and download.</p>
        <div className="mt-3 rounded-[2px] bg-white p-3.5 text-[14px] leading-7 text-slate-800 shadow-[0_1px_3px_rgb(0_0_0/0.08)]">
          <TagBody body={PREVIEW} details={values} />
        </div>
      </aside>
    </form>
  );
}
