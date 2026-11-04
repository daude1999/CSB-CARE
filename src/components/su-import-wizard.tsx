"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { confirmImportAction, readSupportPlanAction } from "@/app/su-import-actions";
import type { DuplicateMatch, ImportDraft } from "@/server/care/su-import";
import { SimulatedBadge } from "@/components/ui";
import { guessCallType } from "@/lib/su-import-rules";

/**
 * "Set up from support plan" in three steps: upload, check and correct, confirm. One form holds the files for all three
 * steps (the file input stays mounted), so nothing is stored until Confirm. Reading the plan is a proposal from the AI
 * provider; every field is shown for a person to check, with the page it came from.
 */

type Visit = ImportDraft["visits"][number];
type Contact = ImportDraft["contacts"][number];
type Doc = ImportDraft["documents"][number];
interface Option { id: string; name: string }
interface Category { key: string; label: string; sensitive: boolean }
type Reading = { available: true; simulated: boolean } | { available: false; reason: string };

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const KINDS: [Contact["kind"], string][] = [["NEXT_OF_KIN", "Next of kin"], ["FAMILY", "Family or informal carer"], ["GP", "GP"], ["PHARMACY", "Pharmacy"], ["SOCIAL_WORKER", "Social worker or council"], ["DISTRICT_NURSE", "District nurse"], ["LPA_HEALTH", "LPA (health)"], ["LPA_FINANCE", "LPA (finance)"], ["OTHER", "Other"]];
const FUNDED: [Visit["fundedBy"] & string, string][] = [["COUNCIL", "Council"], ["CARERS_SERVICE", "Carers service"], ["OTHER", "Other"]];
const today = () => new Date().toISOString().slice(0, 10);

const emptyVisit = (callTypeId: string, from: string): Visit => ({ weekdays: [1, 2, 3, 4, 5, 6, 7], startTime: "", durationMin: 30, carers: 1, callTypeId, tasks: "", fundedBy: "COUNCIL", medicationPrompt: false, effectiveFrom: from || today(), effectiveTo: undefined, sourcePages: [] });
const emptyContact = (): Contact => ({ kind: "FAMILY", name: "", relationship: "", phone: "", altPhone: "", address: "", isEmergency: false, canReceiveUpdates: false, isKeyHolder: false, isPrimary: false });

function minutes(v: Pick<Visit, "weekdays" | "durationMin">) {
  return new Set(v.weekdays.map(Number)).size * (Number(v.durationMin) || 0);
}
const hours = (m: number) => `${(m / 60).toFixed(2).replace(/\.?0+$/, "")} h`;

export function SuImportWizard({ areas, callTypes, councilCategories, otherCategories, sensitive, reading }: { areas: Option[]; callTypes: Option[]; councilCategories: Category[]; otherCategories: Category[]; sensitive: boolean; reading: Reading }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const id = useId();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState<"read" | "confirm" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [draft, setDraft] = useState<ImportDraft | null>(null);
  const [source, setSource] = useState<"ai" | "manual" | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);

  const set = <K extends keyof ImportDraft>(key: K, value: ImportDraft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d));
  const person = (k: keyof ImportDraft["person"], value: string) => setDraft((d) => (d ? { ...d, person: { ...d.person, [k]: value } } : d));
  const pkg = (k: keyof ImportDraft["package"], value: string) => setDraft((d) => (d ? { ...d, package: { ...d.package, [k]: value } } : d));
  const visit = (i: number, patch: Partial<Visit>) => setDraft((d) => (d ? { ...d, visits: d.visits.map((v, n) => (n === i ? { ...v, ...patch } : v)) } : d));
  const contact = (i: number, patch: Partial<Contact>) => setDraft((d) => (d ? { ...d, contacts: d.contacts.map((c, n) => (n === i ? { ...c, ...patch } : c)) } : d));
  const doc = (i: number, patch: Partial<Doc>) => setDraft((d) => (d ? { ...d, documents: d.documents.map((c, n) => (n === i ? { ...c, ...patch } : c)) } : d));

  async function read() {
    const files = Array.from(fileInput.current?.files ?? []);
    if (!files.length) return setError("Choose the council support plan (PDF) first.");
    if (files.length > 4) return setError("Upload at most 4 files: the support plan first, then any letters.");
    if (files.some((f) => f.size > 4 * 1024 * 1024)) return setError("Each file must be 4 MB or smaller.");
    setError(null);
    setBusy("read");
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    const r = await readSupportPlanAction(fd);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setFileNames(files.map((f) => f.name));
    setDraft(r.data.draft);
    setSource(r.data.source);
    setSimulated(r.data.simulated);
    setDuplicates(r.data.duplicates);
    setStep(2);
  }

  function checkDraft(d: ImportDraft): string | null {
    if (!d.person.firstName.trim() || !d.person.lastName.trim()) return "Enter the person's first and last name.";
    if (!d.visits.length) return "Add at least one visit from the timetable.";
    for (const [i, v] of d.visits.entries()) {
      if (!v.weekdays.length) return `Visit ${i + 1}: choose at least one day.`;
      if (!/^\d{2}:\d{2}$/.test(v.startTime)) return `Visit ${i + 1}: give a start time.`;
      if (!(Number(v.durationMin) >= 5)) return `Visit ${i + 1}: the duration must be at least 5 minutes.`;
      if (!v.callTypeId) return `Visit ${i + 1}: choose a call type.`;
      if (!v.effectiveFrom) return `Visit ${i + 1}: give a start date.`;
    }
    for (const [i, c] of d.contacts.entries()) if (c.name.trim().length < 2) return `Contact ${i + 1}: enter a name.`;
    if (!d.package.startDate) return "Give the care package a start date.";
    return null;
  }

  async function confirm() {
    if (!draft || !form.current) return;
    setError(null);
    setBusy("confirm");
    const fd = new FormData(form.current);
    fd.set("draft", JSON.stringify(draft));
    const r = await confirmImportAction(fd);
    if (!r.ok) {
      setBusy(null);
      setError(r.error);
      return;
    }
    router.push(r.data.to);
  }

  const totals = draft ? draft.visits.reduce((t, v) => { const m = minutes(v); t.total += m; if (v.fundedBy === "COUNCIL" || !v.fundedBy) t.council += m; else if (v.fundedBy === "CARERS_SERVICE") t.carers += m; else t.other += m; return t; }, { total: 0, council: 0, carers: 0, other: 0 }) : null;
  const commissioned = draft?.package.commissionedMinutesPerWeek != null && String(draft.package.commissionedMinutesPerWeek) !== "" ? Number(draft.package.commissionedMinutesPerWeek) : null;

  return (
    <form ref={form} onSubmit={(e) => e.preventDefault()} aria-label="Set up from support plan" className="space-y-4">
      <ol className="flex flex-wrap gap-2 text-[13.5px]" aria-label="Steps">
        {(["Upload", "Check and correct", "Confirm"] as const).map((label, i) => (
          <li key={label} aria-current={step === i + 1 ? "step" : undefined} className={`rounded-full px-3 py-1 ${step === i + 1 ? "bg-navy-900 font-medium text-white" : step > i + 1 ? "bg-[#e6f5ee] text-[#0f6b47]" : "bg-[#eef1f5] text-slate-600"}`}>{i + 1}. {label}</li>
        ))}
      </ol>

      {error ? <div role="alert" data-testid="import-error" className="rounded-[3px] border border-[#e4b4b8] bg-[#fdf2f3] px-3 py-2 text-[14px] text-[#8a1c24]">{error}</div> : null}

      <section className={`panel space-y-3 ${step === 1 ? "" : "hidden"}`} aria-label="Upload" aria-hidden={step !== 1}>
        <h2 className="text-[16px] font-medium text-navy-900">1. Upload the council support plan</h2>
        <p className="text-[14px] text-slate-600">The support plan goes first. Add hospital or GP letters after it if you have them; they are filed as documents and are not read. PDF only, up to 4 MB each, at most 4 files. Nothing is saved until you confirm at step 3.</p>
        <label htmlFor={`${id}-files`} className="block">
          <span className="label">Files</span>
          <input ref={fileInput} id={`${id}-files`} name="files" type="file" accept=".pdf,application/pdf" multiple className="input" onChange={() => setError(null)} />
        </label>
        {reading.available ? (
          <p className="text-[13.5px] text-slate-600">The plan is read page by page and every value is shown with its page number for you to check. {reading.simulated ? <SimulatedBadge /> : null}</p>
        ) : (
          <p className="text-[13.5px] text-slate-600">{reading.reason} You can still set the person up here in one go.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={read} disabled={busy === "read"} className="btn-primary" aria-busy={busy === "read"}>{busy === "read" ? "Reading the plan…" : reading.available ? "Read the plan" : "Continue"}</button>
        </div>
        {busy === "read" ? <p role="status" className="text-[13.5px] text-slate-600">Reading every page, including the timetable. This can take up to a minute.</p> : null}
      </section>

      {draft && step === 2 ? (
        <div className="space-y-4">
          <section className="panel space-y-2" aria-label="How this was read">
            <h2 className="text-[16px] font-medium text-navy-900">2. Check and correct</h2>
            <p className="text-[14px] text-slate-600">
              {source === "ai" ? <>Read from <strong>{fileNames[0]}</strong>. Page numbers show where each value came from. Check every field against the plan and correct anything wrong. {simulated ? <SimulatedBadge /> : null}</> : <>Type the details in from <strong>{fileNames[0] ?? "the plan"}</strong>. Nothing is saved until you confirm.</>}
            </p>
            {draft.flags?.length ? (
              <div className="rounded-[3px] border border-[#f1d9a6] bg-[#fff8e8] px-3 py-2 text-[13.5px] text-[#6b4a00]">
                <strong>Things to decide before the visits run</strong>
                <ul className="mt-1 list-disc pl-5">{draft.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>
              </div>
            ) : null}
            {duplicates.length ? (
              <div role="alert" className="rounded-[3px] border border-[#e4b4b8] bg-[#fdf2f3] px-3 py-2 text-[13.5px] text-[#8a1c24]">
                <strong>Possible duplicate.</strong> {duplicates.map((d) => `${d.name} (${d.reference}, ${d.status.toLowerCase()}): ${d.reason.toLowerCase()}`).join("; ")}.
                <label className="mt-1 flex items-center gap-2"><input type="checkbox" checked={!!draft.notADuplicate} onChange={(e) => set("notADuplicate", e.target.checked)} /> This is a different person, go ahead</label>
              </div>
            ) : null}
          </section>

          <section className="panel space-y-3" aria-labelledby={`${id}-person`}>
            <h3 id={`${id}-person`} className="text-[15px] font-medium text-navy-900">Person</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <label><span className="label">First name</span><input className="input" required value={draft.person.firstName} onChange={(e) => person("firstName", e.target.value)} /></label>
              <label><span className="label">Last name</span><input className="input" required value={draft.person.lastName} onChange={(e) => person("lastName", e.target.value)} /></label>
              <label><span className="label">Known as</span><input className="input" value={draft.person.preferredName ?? ""} onChange={(e) => person("preferredName", e.target.value)} /></label>
              {sensitive ? <label><span className="label">Date of birth</span><input type="date" className="input" value={draft.person.dateOfBirth ?? ""} onChange={(e) => person("dateOfBirth", e.target.value)} /></label> : null}
              {sensitive ? <label><span className="label">NHS number</span><input className="input" inputMode="numeric" value={draft.person.nhsNumber ?? ""} onChange={(e) => person("nhsNumber", e.target.value)} /></label> : null}
              <label><span className="label">Gender</span><input className="input" value={draft.person.gender ?? ""} onChange={(e) => person("gender", e.target.value)} /></label>
              <label><span className="label">First language</span><input className="input" value={draft.person.firstLanguage ?? ""} onChange={(e) => person("firstLanguage", e.target.value)} /></label>
              <label><span className="label">Council reference</span><input className="input" value={draft.person.councilReference ?? ""} onChange={(e) => person("councilReference", e.target.value)} /></label>
              <label><span className="label">Area</span><select className="input" value={draft.person.areaId ?? ""} onChange={(e) => person("areaId", e.target.value)}><option value="">No area</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
              <label><span className="label">Carer preference</span><select className="input" value={draft.person.carerGenderPreference} onChange={(e) => person("carerGenderPreference", e.target.value)}><option value="ANY">No preference</option><option value="FEMALE">Female carers</option><option value="MALE">Male carers</option></select></label>
              <label><span className="label">Address</span><input className="input" value={draft.person.addressLine1 ?? ""} onChange={(e) => person("addressLine1", e.target.value)} /></label>
              <label><span className="label">Address line 2</span><input className="input" value={draft.person.addressLine2 ?? ""} onChange={(e) => person("addressLine2", e.target.value)} /></label>
              <label><span className="label">Town</span><input className="input" value={draft.person.town ?? ""} onChange={(e) => person("town", e.target.value)} /></label>
              <label><span className="label">Postcode</span><input className="input" value={draft.person.postcode ?? ""} onChange={(e) => person("postcode", e.target.value)} /></label>
              <label><span className="label">Phone</span><input type="tel" className="input" value={draft.person.phone ?? ""} onChange={(e) => person("phone", e.target.value)} /></label>
              <label><span className="label">Alternative phone</span><input type="tel" className="input" value={draft.person.altPhone ?? ""} onChange={(e) => person("altPhone", e.target.value)} /></label>
              <label className="md:col-span-3"><span className="label">Access notes for carers</span><textarea rows={2} className="input" value={draft.person.accessNotes ?? ""} onChange={(e) => person("accessNotes", e.target.value)} /></label>
              <label className="md:col-span-3"><span className="label">Communication needs</span><textarea rows={2} className="input" value={draft.person.communicationNeeds ?? ""} onChange={(e) => person("communicationNeeds", e.target.value)} /></label>
            </div>
          </section>

          <section className="panel space-y-3" aria-labelledby={`${id}-contacts`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`${id}-contacts`} className="text-[15px] font-medium text-navy-900">Contacts and carers</h3>
              <button type="button" className="btn-secondary py-1" onClick={() => set("contacts", [...draft.contacts, emptyContact()])}>Add contact</button>
            </div>
            {draft.contacts.length ? draft.contacts.map((c, i) => (
              <fieldset key={i} className="grid gap-2 rounded-[3px] border border-slate-200 p-3 md:grid-cols-4">
                <legend className="px-1 text-[13px] text-slate-600">Contact {i + 1}{c.sourcePage ? ` · page ${c.sourcePage}` : ""}</legend>
                <label><span className="label">Type</span><select className="input" value={c.kind} onChange={(e) => contact(i, { kind: e.target.value as Contact["kind"] })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                <label><span className="label">Name</span><input className="input" required value={c.name} onChange={(e) => contact(i, { name: e.target.value })} /></label>
                <label><span className="label">Relationship</span><input className="input" value={c.relationship ?? ""} onChange={(e) => contact(i, { relationship: e.target.value })} /></label>
                <label><span className="label">Phone</span><input type="tel" className="input" value={c.phone ?? ""} onChange={(e) => contact(i, { phone: e.target.value })} /></label>
                <label><span className="label">Mobile or other phone</span><input type="tel" className="input" value={c.altPhone ?? ""} onChange={(e) => contact(i, { altPhone: e.target.value })} /></label>
                <label className="md:col-span-2"><span className="label">Address</span><input className="input" value={c.address ?? ""} onChange={(e) => contact(i, { address: e.target.value })} /></label>
                <div className="flex flex-wrap items-end gap-3 text-[13.5px]">
                  <label className="flex items-center gap-1"><input type="checkbox" checked={c.isEmergency} onChange={(e) => contact(i, { isEmergency: e.target.checked })} /> Emergency contact</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={!!c.isKeyHolder} onChange={(e) => contact(i, { isKeyHolder: e.target.checked })} /> Key holder</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={!!c.isPrimary} onChange={(e) => contact(i, { isPrimary: e.target.checked })} /> Main contact</label>
                  <button type="button" className="btn-secondary py-1" onClick={() => set("contacts", draft.contacts.filter((_, n) => n !== i))}>Remove</button>
                </div>
              </fieldset>
            )) : <p className="text-[14px] text-slate-600">No contacts yet. Add next of kin, the emergency contact, the GP and the main informal carer from the plan.</p>}
          </section>

          <section className="panel space-y-3" aria-labelledby={`${id}-package`}>
            <h3 id={`${id}-package`} className="text-[15px] font-medium text-navy-900">Care package</h3>
            <div className="grid gap-3 md:grid-cols-3">
              <label><span className="label">Funder</span><input className="input" value={draft.package.funderName ?? ""} onChange={(e) => pkg("funderName", e.target.value)} placeholder="e.g. the council" /></label>
              <label><span className="label">Package reference</span><input className="input" value={draft.package.reference ?? ""} onChange={(e) => pkg("reference", e.target.value)} /></label>
              <label><span className="label">Commissioned minutes a week</span><input type="number" min={0} className="input" value={draft.package.commissionedMinutesPerWeek ?? ""} onChange={(e) => pkg("commissionedMinutesPerWeek", e.target.value)} /></label>
              <label><span className="label">Package start</span><input type="date" required className="input" value={draft.package.startDate} onChange={(e) => pkg("startDate", e.target.value)} /></label>
              <label><span className="label">Package end (if given)</span><input type="date" className="input" value={draft.package.endDate ?? ""} onChange={(e) => pkg("endDate", e.target.value)} /></label>
              <label><span className="label">Care active from</span><input type="date" className="input" value={draft.careActiveFrom ?? ""} onChange={(e) => set("careActiveFrom", e.target.value)} /><span className="block text-[12.5px] text-slate-500">Leave empty to keep the person at Assessment (Build Rota then skips them).</span></label>
              <label className="md:col-span-3"><span className="label">Requirements and conditions</span><textarea rows={2} className="input" value={draft.package.requirements ?? ""} onChange={(e) => pkg("requirements", e.target.value)} /></label>
            </div>
          </section>

          <section className="panel space-y-3" aria-labelledby={`${id}-visits`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={`${id}-visits`} className="text-[15px] font-medium text-navy-900">Timetable: repeating visits</h3>
              <button type="button" className="btn-secondary py-1" onClick={() => set("visits", [...draft.visits, emptyVisit(guessCallType("09:00", "", callTypes), draft.package.startDate)])}>Add visit</button>
            </div>
            <p className="text-[13.5px] text-slate-600">One row per timetable line. Each becomes a repeating visit template; the task text goes on the template for carers to see.</p>
            {draft.visits.length ? draft.visits.map((v, i) => (
              <fieldset key={i} data-testid="import-visit" className="space-y-2 rounded-[3px] border border-slate-200 p-3">
                <legend className="px-1 text-[13px] text-slate-600">Visit {i + 1}{v.sourcePages?.length ? ` · page ${v.sourcePages.join(", ")}` : ""} · {hours(minutes(v))} a week</legend>
                <div className="flex flex-wrap gap-2" role="group" aria-label={`Visit ${i + 1} days`}>
                  {DAYS.map((d, n) => { const day = n + 1; const on = v.weekdays.map(Number).includes(day); return <label key={d} className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-[13px] ${on ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white text-slate-700"}`}><input type="checkbox" className="sr-only" checked={on} onChange={(e) => visit(i, { weekdays: e.target.checked ? [...v.weekdays.map(Number), day].sort() : v.weekdays.map(Number).filter((x) => x !== day) })} />{d}</label>; })}
                </div>
                <div className="grid gap-2 md:grid-cols-6">
                  <label><span className="label">Start</span><input type="time" required className="input" value={v.startTime} onChange={(e) => visit(i, { startTime: e.target.value, ...(source === "manual" ? { callTypeId: guessCallType(e.target.value, v.tasks ?? "", callTypes) } : {}) })} /></label>
                  <label><span className="label">Minutes</span><input type="number" min={5} step={5} required className="input" value={v.durationMin} onChange={(e) => visit(i, { durationMin: Number(e.target.value) })} /></label>
                  <label><span className="label">Carers</span><input type="number" min={1} max={20} required className="input" value={v.carers} onChange={(e) => visit(i, { carers: Number(e.target.value) })} /></label>
                  <label><span className="label">Call type</span><select required className="input" value={v.callTypeId} onChange={(e) => visit(i, { callTypeId: e.target.value })}><option value="">Choose…</option>{callTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                  <label><span className="label">Funded by</span><select className="input" value={v.fundedBy ?? "COUNCIL"} onChange={(e) => visit(i, { fundedBy: e.target.value as Visit["fundedBy"] })}>{FUNDED.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
                  <div className="flex items-end pb-2"><label className="flex items-center gap-1 text-[13.5px]"><input type="checkbox" checked={!!v.medicationPrompt} onChange={(e) => visit(i, { medicationPrompt: e.target.checked })} /> Medication prompt</label></div>
                  <label><span className="label">From</span><input type="date" required className="input" value={v.effectiveFrom} onChange={(e) => visit(i, { effectiveFrom: e.target.value })} /></label>
                  <label><span className="label">Until (if temporary)</span><input type="date" className="input" value={v.effectiveTo ?? ""} onChange={(e) => visit(i, { effectiveTo: e.target.value || undefined })} /></label>
                  <label className="md:col-span-3"><span className="label">Tasks</span><textarea rows={2} className="input" value={v.tasks ?? ""} onChange={(e) => visit(i, { tasks: e.target.value })} /></label>
                  <div className="flex items-end"><button type="button" className="btn-secondary py-1" onClick={() => set("visits", draft.visits.filter((_, n) => n !== i))}>Remove</button></div>
                </div>
              </fieldset>
            )) : <p className="text-[14px] text-slate-600">No visits yet. Add one row for each line of the timetable.</p>}
            {totals ? <p className="text-[13.5px] text-slate-700">Weekly total <strong>{hours(totals.total)}</strong>: council {hours(totals.council)}{totals.carers ? `, carers service ${hours(totals.carers)}` : ""}{totals.other ? `, other ${hours(totals.other)}` : ""}.{commissioned !== null ? ` Commissioned ${hours(commissioned)}${totals.council !== commissioned ? ` (difference ${hours(Math.abs(totals.council - commissioned))})` : " (matches)"}.` : ""}</p> : null}
          </section>

          <section className="panel space-y-3" aria-labelledby={`${id}-docs`}>
            <h3 id={`${id}-docs`} className="text-[15px] font-medium text-navy-900">Documents</h3>
            {draft.documents.map((d, i) => {
              const cats = d.section === "COUNCIL" ? councilCategories : otherCategories;
              const catSensitive = cats.find((c) => c.key === d.category)?.sensitive ?? false;
              return (
                <fieldset key={i} className="grid gap-2 rounded-[3px] border border-slate-200 p-3 md:grid-cols-4">
                  <legend className="px-1 text-[13px] text-slate-600">{fileNames[d.fileIndex] ?? `File ${d.fileIndex + 1}`}</legend>
                  <label><span className="label">Section</span><select className="input" value={d.section} onChange={(e) => { const section = e.target.value as Doc["section"]; const first = (section === "COUNCIL" ? councilCategories : otherCategories)[0]!.key; doc(i, { section, category: first }); }}><option value="COUNCIL">Council Documents</option><option value="OTHER">Other Documents</option></select></label>
                  <label><span className="label">Category</span><select className="input" value={d.category} onChange={(e) => doc(i, { category: e.target.value })}>{cats.map((c) => <option key={c.key} value={c.key}>{c.label}{c.sensitive ? " (restricted)" : ""}</option>)}</select></label>
                  <label><span className="label">Name</span><input className="input" required value={d.name} onChange={(e) => doc(i, { name: e.target.value })} /></label>
                  <div className="flex items-end pb-2 text-[13.5px]">{catSensitive ? <span className="text-slate-600">Restricted to managers</span> : sensitive ? <label className="flex items-center gap-1"><input type="checkbox" checked={!!d.markSensitive} onChange={(e) => doc(i, { markSensitive: e.target.checked })} /> Restrict to managers</label> : null}</div>
                </fieldset>
              );
            })}
          </section>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => { setStep(1); setError(null); }}>Back</button>
            <button type="button" className="btn-primary" onClick={() => { const e = checkDraft(draft); if (e) { setError(e); window.scrollTo({ top: 0 }); } else { setError(null); setStep(3); } }}>Continue to confirm</button>
          </div>
        </div>
      ) : null}

      {draft && step === 3 && totals ? (
        <div className="space-y-4">
          <section className="panel space-y-3" aria-label="Confirm">
            <h2 className="text-[16px] font-medium text-navy-900">3. Confirm</h2>
            <p className="text-[14px] text-slate-700">Confirm creates, in one go: the record for <strong>{draft.person.firstName} {draft.person.lastName}</strong>{draft.careActiveFrom ? ` (care active from ${draft.careActiveFrom})` : " (status Assessment)"}, {draft.contacts.length} contact{draft.contacts.length === 1 ? "" : "s"}, the care package, {draft.visits.length} repeating visit{draft.visits.length === 1 ? "" : "s"} and {draft.documents.length} document{draft.documents.length === 1 ? "" : "s"}. Every record shows in the person&apos;s history as set up from the support plan.</p>
            <div className="overflow-x-auto"><table className="table" data-testid="import-summary">
              <thead><tr><th>Days</th><th>Start</th><th>Minutes</th><th>Carers</th><th>Call type</th><th>Funded by</th><th>Medication</th><th>Dates</th><th>Weekly</th></tr></thead>
              <tbody>
                {draft.visits.map((v, i) => (
                  <tr key={i}>
                    <td>{v.weekdays.map(Number).length === 7 ? "Every day" : v.weekdays.map((d) => DAYS[Number(d) - 1]).join(", ")}</td>
                    <td className="tabular-nums">{v.startTime}</td>
                    <td className="tabular-nums">{v.durationMin}</td>
                    <td className="tabular-nums">{v.carers}</td>
                    <td>{callTypes.find((c) => c.id === v.callTypeId)?.name ?? "—"}</td>
                    <td>{FUNDED.find(([k]) => k === v.fundedBy)?.[1] ?? "Council"}</td>
                    <td>{v.medicationPrompt ? "Prompt" : "—"}</td>
                    <td className="tabular-nums">{v.effectiveFrom}{v.effectiveTo ? ` → ${v.effectiveTo}` : ""}</td>
                    <td className="tabular-nums">{hours(minutes(v))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={8} className="font-medium">Total a week{commissioned !== null ? ` (commissioned ${hours(commissioned)})` : ""}</td><td className="font-medium tabular-nums">{hours(totals.total)}</td></tr></tfoot>
            </table></div>
            {commissioned !== null && totals.council !== commissioned ? <p className="text-[13.5px] text-[#8a1c24]">The council-funded visits ({hours(totals.council)}) do not match the commissioned minutes ({hours(commissioned)}). Check the timetable or the package before confirming, or confirm and resolve it with the funder.</p> : null}
            <div className="rounded-[3px] bg-[#f5f9fc] px-3 py-2 text-[13.5px] text-slate-700">
              <strong>Not created here, on purpose:</strong> the care plan, risk assessments, medication records and any resuscitation decision. They need a manager&apos;s or clinical lead&apos;s judgement. After confirming, open the person&apos;s Care tab to add them.
            </div>
            {duplicates.length && !draft.notADuplicate ? <p role="alert" className="text-[13.5px] text-[#8a1c24]">A possible duplicate was found. Go back and tick &quot;This is a different person&quot; to confirm.</p> : null}
          </section>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => { setStep(2); setError(null); }} disabled={busy === "confirm"}>Back</button>
            <button type="button" className="btn-primary" onClick={confirm} disabled={busy === "confirm" || (duplicates.length > 0 && !draft.notADuplicate)} aria-busy={busy === "confirm"}>{busy === "confirm" ? "Setting up…" : "Confirm and set up"}</button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
