"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * The communication form inside Find Replacement Cover. It only records what staff did outside the platform: nothing
 * is phoned, texted or e-mailed from here. A draft is kept in this browser tab (session storage) so the notes survive a
 * failed save, and leaving with unsaved entries asks first. Each render carries a one-off token, so a double click or
 * a resubmission saves one entry.
 */

export interface RecipientOption {
  value: string;
  label: string;
  detail: string;
  vias: { value: "phone" | "altPhone" | "email"; label: string }[];
}

interface Defaults {
  recipient?: string;
  via?: string;
  otherName?: string;
  otherRelationship?: string;
  otherAddress?: string;
  method?: string;
  outcome?: string;
  notApplicableReason?: string;
  notes?: string;
}

interface Props {
  action: (fd: FormData) => Promise<void>;
  back: string;
  visitId: string;
  caseId: string | null;
  recipients: RecipientOption[];
  owners: { id: string; name: string }[];
  me: string;
  token: string;
  savedToken?: string;
  storageKey: string;
  today: string;
  /** A correction of an existing entry: its id and values, plus a required reason. */
  correction?: { attemptId: string; defaults: Defaults };
}

const METHODS = [
  ["PHONE", "Telephone"],
  ["SMS", "Text message (SMS)"],
  ["EMAIL", "Email"],
  ["OTHER", "Other"],
] as const;
const OUTCOMES = [
  ["INFORMED", "Successfully informed"],
  ["NO_ANSWER", "No answer"],
  ["MESSAGE_LEFT", "Message left"],
  ["UNSUCCESSFUL", "Contact unsuccessful"],
  ["NOT_APPLICABLE", "Not applicable"],
] as const;

type Draft = Required<Defaults> & { token: string; earlier: boolean; contactedDate: string; contactedTime: string; followUp: boolean; followUpOwnerId: string; followUpDate: string; followUpTime: string; reason: string };

const FIELD = "h-9 w-full rounded-[6px] border border-[#d0d5dd] bg-white px-2 text-[14px] text-[#101828] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#5b2bb5]";
const LABEL = "mb-0.5 block text-[12.5px] font-medium text-[#344054]";

export function CoverContactForm(props: Props) {
  const { recipients, correction } = props;
  const d = correction?.defaults ?? {};
  const initial: Draft = {
    token: props.token,
    recipient: d.recipient ?? recipients[0]?.value ?? "other",
    via: d.via ?? "",
    otherName: d.otherName ?? "",
    otherRelationship: d.otherRelationship ?? "",
    otherAddress: d.otherAddress ?? "",
    method: d.method ?? "PHONE",
    outcome: d.outcome ?? "",
    notApplicableReason: d.notApplicableReason ?? "",
    notes: d.notes ?? "",
    earlier: false,
    contactedDate: props.today,
    contactedTime: "",
    followUp: false,
    followUpOwnerId: props.me,
    followUpDate: props.today,
    followUpTime: "",
    reason: "",
  };
  const [f, setF] = useState<Draft>(initial);
  const [dirty, setDirty] = useState(false);
  const [restored, setRestored] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const submitting = useRef(false);

  // Restore an unsaved draft (for example after a failed save); forget it once the server confirms it was saved.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(props.storageKey);
      if (!raw) return;
      const draft = JSON.parse(raw) as Draft;
      if (props.savedToken && draft.token === props.savedToken) {
        window.sessionStorage.removeItem(props.storageKey);
        return;
      }
      setF({ ...initial, ...draft });
      setDirty(true);
      setRestored(true);
    } catch {
      /* storage unavailable: the form still works without a draft */
    }
    // Only on first render for this form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.storageKey, props.savedToken]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setF((prev) => {
      const next = { ...prev, [k]: v };
      try {
        window.sessionStorage.setItem(props.storageKey, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setDirty(true);
  };

  // Warn before leaving with unsaved entries: closing the tab, or following a link out of the panel.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      if (submitting.current) return;
      e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      if (submitting.current) return;
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]");
      if (!a || a.getAttribute("href")?.startsWith("tel:") || a.getAttribute("href")?.startsWith("mailto:")) return;
      if (!window.confirm("You have an unsaved communication entry. Leave without saving it?")) {
        e.preventDefault();
        e.stopPropagation();
      } else discard();
    };
    window.addEventListener("beforeunload", onUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      document.removeEventListener("click", onClick, true);
    };
  });

  const discard = () => {
    try {
      window.sessionStorage.removeItem(props.storageKey);
    } catch {
      /* ignore */
    }
    setF(initial);
    setDirty(false);
    setRestored(false);
  };

  const r = recipients.find((x) => x.value === f.recipient);
  const vias = useMemo(() => {
    const all = r?.vias ?? [];
    const fit = f.method === "EMAIL" ? all.filter((v) => v.value === "email") : f.method === "OTHER" ? all : all.filter((v) => v.value !== "email");
    return [...fit, { value: "other" as const, label: f.recipient === "other" ? "The number or address I used" : "Another number or address" }];
  }, [r, f.method, f.recipient]);
  const via = vias.some((v) => v.value === f.via) ? f.via : vias[0]!.value;
  const noneRecorded = f.recipient !== "other" && vias.length === 1;
  const id = (k: string) => `${props.storageKey}-${k}`;

  return (
    <form
      ref={formRef}
      action={props.action}
      aria-label={correction ? "Correct this entry" : "Record a communication attempt"}
      data-unsaved={dirty ? "true" : undefined}
      data-testid={correction ? "contact-correction-form" : "contact-attempt-form"}
      onSubmit={() => {
        submitting.current = true;
      }}
      className="space-y-2.5"
    >
      <input type="hidden" name="back" value={props.back} />
      <input type="hidden" name="visitId" value={props.visitId} />
      {props.caseId ? <input type="hidden" name="caseId" value={props.caseId} /> : null}
      <input type="hidden" name="clientToken" value={f.token} />
      {correction ? <input type="hidden" name="attemptId" value={correction.attemptId} /> : null}
      {restored ? <p role="status" className="rounded-[6px] bg-[#fdf3dc] px-2.5 py-1.5 text-[13px] text-[#7a5200]">Your unsaved entry was kept. Check it and save again, or <button type="button" onClick={discard} className="font-semibold underline">discard it</button>.</p> : null}

      <fieldset>
        <legend className={LABEL}>Who did you contact?</legend>
        <div className="space-y-1">
          {[...recipients, { value: "other", label: "Someone else", detail: "Not recorded on the profile", vias: [] }].map((o) => (
            <label key={o.value} className="flex cursor-pointer items-start gap-2 rounded-[6px] border border-[#e4e7ec] px-2.5 py-1.5 text-[13.5px] has-[:checked]:border-[#5b2bb5] has-[:checked]:bg-[#f6f3fd]">
              <input type="radio" name="recipient" value={o.value} checked={f.recipient === o.value} onChange={() => set("recipient", o.value)} className="mt-0.5 h-4 w-4 accent-[#5b2bb5]" />
              <span><b className="font-semibold text-[#101828]">{o.label}</b><span className="block text-[12.5px] text-[#475467]">{o.detail}</span></span>
            </label>
          ))}
        </div>
      </fieldset>

      {f.recipient === "other" ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label htmlFor={id("on")}><span className={LABEL}>Their name</span><input id={id("on")} name="otherName" required minLength={2} maxLength={200} value={f.otherName} onChange={(e) => set("otherName", e.target.value)} className={FIELD} /></label>
          <label htmlFor={id("or")}><span className={LABEL}>Relationship (optional)</span><input id={id("or")} name="otherRelationship" maxLength={100} value={f.otherRelationship} onChange={(e) => set("otherRelationship", e.target.value)} className={FIELD} /></label>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label htmlFor={id("m")}><span className={LABEL}>How</span>
          <select id={id("m")} name="method" value={f.method} onChange={(e) => set("method", e.target.value)} className={FIELD}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label htmlFor={id("v")}><span className={LABEL}>Number or address used</span>
          <select id={id("v")} name="via" value={via} onChange={(e) => set("via", e.target.value)} className={FIELD}>{vias.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}</select>
        </label>
      </div>
      {noneRecorded ? <p className="text-[12.5px] text-[#8a5a00]">Nothing suitable is recorded for {r?.label ?? "them"} for this method. Enter what you used below.</p> : null}
      {via === "other" ? <label htmlFor={id("oa")} className="block"><span className={LABEL}>Number or address you used</span><input id={id("oa")} name="otherAddress" required maxLength={200} value={f.otherAddress} onChange={(e) => set("otherAddress", e.target.value)} className={FIELD} /></label> : null}

      <fieldset>
        <legend className={LABEL}>Outcome</legend>
        <div className="flex flex-wrap gap-1.5">
          {OUTCOMES.map(([v, l]) => (
            <label key={v} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#d0d5dd] px-2.5 py-1 text-[13px] has-[:checked]:border-[#5b2bb5] has-[:checked]:bg-[#5b2bb5] has-[:checked]:text-white has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[#5b2bb5]">
              <input type="radio" name="outcome" value={v} required checked={f.outcome === v} onChange={() => set("outcome", v)} className="sr-only" />{l}
            </label>
          ))}
        </div>
        {f.outcome === "MESSAGE_LEFT" ? <p className="mt-1 text-[12.5px] text-[#475467]">A message left is not confirmation: this stays &ldquo;awaiting confirmation&rdquo; until someone is successfully informed.</p> : null}
      </fieldset>
      {f.outcome === "NOT_APPLICABLE" ? <label htmlFor={id("na")} className="block"><span className={LABEL}>Why contact is not applicable</span><input id={id("na")} name="notApplicableReason" required minLength={5} maxLength={500} value={f.notApplicableReason} onChange={(e) => set("notApplicableReason", e.target.value)} placeholder="For example: in hospital, family managing visits this week" className={FIELD} /></label> : null}

      <label htmlFor={id("n")} className="block"><span className={LABEL}>What was communicated (optional)</span><textarea id={id("n")} name="notes" rows={2} maxLength={2000} value={f.notes} onChange={(e) => set("notes", e.target.value)} className={`${FIELD} h-auto py-1.5`} /></label>

      <div className="rounded-[6px] bg-[#f9fafb] px-2.5 py-2">
        <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="earlier" checked={f.earlier} onChange={(e) => set("earlier", e.target.checked)} className="h-4 w-4 accent-[#5b2bb5]" />The contact happened earlier</label>
        {f.earlier ? (
          <div className="mt-1.5 flex flex-wrap gap-2">
            <label htmlFor={id("cd")}><span className={LABEL}>Date</span><input id={id("cd")} type="date" name="contactedDate" required value={f.contactedDate} max={props.today} onChange={(e) => set("contactedDate", e.target.value)} className={`${FIELD} w-[150px]`} /></label>
            <label htmlFor={id("ct")}><span className={LABEL}>Time</span><input id={id("ct")} type="time" name="contactedTime" required value={f.contactedTime} onChange={(e) => set("contactedTime", e.target.value)} className={`${FIELD} w-[110px]`} /></label>
          </div>
        ) : <p className="mt-0.5 text-[12px] text-[#667085]">Otherwise the time you save is used. The time you saved it is always recorded too.</p>}
      </div>

      <div className="rounded-[6px] bg-[#f9fafb] px-2.5 py-2">
        <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="followUp" checked={f.followUp} onChange={(e) => set("followUp", e.target.checked)} className="h-4 w-4 accent-[#5b2bb5]" />A follow-up is needed</label>
        {f.followUp ? (
          <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
            <label htmlFor={id("fo")}><span className={LABEL}>Responsible coordinator</span><select id={id("fo")} name="followUpOwnerId" value={f.followUpOwnerId} onChange={(e) => set("followUpOwnerId", e.target.value)} className={FIELD}>{props.owners.map((o) => <option key={o.id} value={o.id}>{o.name}{o.id === props.me ? " (you)" : ""}</option>)}</select></label>
            <label htmlFor={id("fd")}><span className={LABEL}>Due date</span><input id={id("fd")} type="date" name="followUpDate" required min={props.today} value={f.followUpDate} onChange={(e) => set("followUpDate", e.target.value)} className={`${FIELD} w-[150px]`} /></label>
            <label htmlFor={id("ft")}><span className={LABEL}>Due time</span><input id={id("ft")} type="time" name="followUpTime" required value={f.followUpTime} onChange={(e) => set("followUpTime", e.target.value)} className={`${FIELD} w-[110px]`} /></label>
          </div>
        ) : null}
      </div>

      {correction ? <label htmlFor={id("cr")} className="block"><span className={LABEL}>Reason for the correction</span><input id={id("cr")} name="reason" required minLength={5} maxLength={1000} value={f.reason} onChange={(e) => set("reason", e.target.value)} className={FIELD} /></label> : null}

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button className="inline-flex h-9 items-center rounded-[6px] border border-[#5b2bb5] bg-white px-3.5 text-[14px] font-semibold text-[#4b2f9a] hover:bg-[#f6f3fd] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5b2bb5]">{correction ? "Save correction" : "Save communication"}</button>
        {dirty ? <button type="button" onClick={discard} className="text-[13px] font-medium text-[#475467] underline">Discard</button> : null}
      </div>
      <p className="text-[12px] text-[#667085]">{correction ? "The original entry is kept and shown as corrected." : "This only records what you did. It does not book cover, and the platform does not phone, text or email anyone."}</p>
    </form>
  );
}
