"use client";
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowsClockwise } from "@phosphor-icons/react";
import Link from "@/components/link";
import { rollHref, type RollChoices } from "@/lib/roll-forward-href";
import type { RollCarerState, RollRow } from "@/server/rota/roll-forward";

/**
 * The Roll Forward form and its preview, in four steps: choose the weeks, Preview Rota, Save as Draft, then Roll Forward
 * Next Week (the week just saved becomes the one to copy from). Preview asks the server to work the plan out again for
 * the choices on screen and shows the result in place: the dialog stays open, the choices stay as they are, the old
 * figures are dimmed with "Updating the preview…" while the server works, and "Preview updated at …" confirms the new
 * result. Weeks and areas sit under More options. Without JavaScript the same form still submits as a plain GET.
 * Nothing here writes to the rota; only Save does, and only for the preview on screen.
 */
export interface RollSummary {
  sourceWeek: string;
  targetWeeks: string[];
  sourceVisits: number;
  existing: number;
  destinationInPlace: number;
  counts: { create: number; kept: number; review: number; uncovered: number; doubleUpsShort: number; oneOff: number };
  skipped: number;
  careHours: string;
  estimatedPay: string;
  slotsWithoutRate: number;
  blockers: string[];
  nextWeekHref: string | null;
  computedAt: string;
  updatedLabel: string;
  fingerprint: string;
}

const dmy = (iso: string) => iso.split("-").reverse().join("/");
const n = (x: number) => x.toLocaleString("en-GB");
const addDays = (iso: string, d: number) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};
const dayLabel = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortDay = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const sameChoices = (a: RollChoices, b: RollChoices) => a.from === b.from && a.to === b.to && a.weeks === b.weeks && !!a.keepOneOff === !!b.keepOneOff && [...a.areaIds].sort().join() === [...b.areaIds].sort().join();

const CARER_TONE: Record<RollCarerState, string> = {
  KEPT: "bg-[#e3f3e7] text-[#1f6f3a]",
  REVIEW: "bg-[#fdf1d8] text-[#8a5a00]",
  UNCOVERED: "bg-[#fbe4e6] text-[#a3242c]",
  BOOKED: "",
};
const CARER_LABEL: Record<RollCarerState, string> = { KEPT: "Carer retained", REVIEW: "Needs review", UNCOVERED: "Uncovered", BOOKED: "" };
const KIND_TONE = { EXISTING: "border-slate-300 bg-slate-100 text-slate-700", NEW: "border-[#b7cdf0] bg-[#e8f0fc] text-[#1d4f91]", SKIPPED: "border-slate-300 bg-white text-slate-500 line-through decoration-slate-400" } as const;
const KIND_LABEL = { EXISTING: "Already exists", NEW: "New visit", SKIPPED: "Skipped" } as const;

type Show = "all" | "existing" | "new" | "differs" | "kept" | "review" | "uncovered" | "skipped";
const SHOW: { id: Show; label: string; dot: string; test: (r: RollRow) => boolean }[] = [
  { id: "all", label: "Whole rota", dot: "", test: () => true },
  { id: "existing", label: "Already exists", dot: "bg-slate-400", test: (r) => r.kind === "EXISTING" },
  { id: "new", label: "New visit", dot: "bg-[#1d4f91]", test: (r) => r.kind === "NEW" },
  { id: "differs", label: "Different from source", dot: "bg-[#6b4bb8]", test: (r) => !!r.differs },
  { id: "kept", label: "Carer retained", dot: "bg-[#1f6f3a]", test: (r) => r.kind === "NEW" && r.carers.some((c) => c.state === "KEPT") },
  { id: "review", label: "Needs review", dot: "bg-[#c88a12]", test: (r) => r.carers.some((c) => c.state === "REVIEW") },
  { id: "uncovered", label: "Uncovered", dot: "bg-[#a3242c]", test: (r) => r.carers.some((c) => c.state === "UNCOVERED") },
  { id: "skipped", label: "Skipped", dot: "bg-slate-300", test: (r) => r.kind === "SKIPPED" },
];
const STEPS = ["Choose the weeks", "Preview Rota", "Save as Draft", "Roll Forward Next Week"] as const;

export function RollForwardPreview({
  weekOptions,
  areas,
  reviewed,
  error,
  summary,
  rows,
  saveAction,
  notice,
  savedWeek,
}: {
  weekOptions: { value: string; label: string }[];
  areas: { id: string; name: string }[];
  reviewed: RollChoices;
  error: string | null;
  summary: RollSummary | null;
  rows: RollRow[];
  saveAction: (fd: FormData) => Promise<void>;
  notice: { ok: string | null; error: string | null };
  /** The first week just saved, when the dialog has come back after Save as Draft. */
  savedWeek: string | null;
}) {
  const router = useRouter();
  const [pending, startPreview] = useTransition();
  const [choices, setChoices] = useState<RollChoices>(reviewed);
  // A link that changes the address (such as "Try the next week") brings new choices from the server.
  const reviewedKey = `${reviewed.from}|${reviewed.to}|${reviewed.weeks}|${[...reviewed.areaIds].sort().join()}|${reviewed.keepOneOff ? 1 : 0}`;
  useEffect(() => setChoices(reviewed), [reviewedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = !sameChoices(choices, reviewed);
  const [more, setMore] = useState(reviewed.weeks !== 1 || reviewed.areaIds.length > 0 || !!reviewed.keepOneOff);
  const pressed = useRef(false);
  const [announce, setAnnounce] = useState(false);
  useEffect(() => {
    if (!pending && pressed.current) {
      pressed.current = false;
      setAnnounce(true);
    }
  }, [pending, summary?.computedAt, error]);

  const runPreview = () => {
    if (pending) return;
    // The address never carries "saved" or a message on, so a fresh plan is always worked out.
    const href = rollHref(choices);
    pressed.current = true;
    setAnnounce(false);
    startPreview(() => {
      // The same choices again still asks the server for a fresh plan; new choices change the address too.
      if (`${window.location.pathname}${window.location.search}` === href) router.refresh();
      else router.replace(href, { scroll: false });
    });
  };
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    runPreview();
  };

  const weeksInPlan = summary?.targetWeeks ?? [];
  // The week and day on show always belong to the plan on screen, even in the render where a new plan first arrives.
  const [pickedWeek, setWeek] = useState<string>(weeksInPlan[0] ?? "");
  const week = weeksInPlan.includes(pickedWeek) ? pickedWeek : (weeksInPlan[0] ?? "");
  const [view, setView] = useState<"week" | "day">("week");
  const [pickedDay, setDay] = useState<string>(week);
  const day = pickedDay >= week && pickedDay <= addDays(week, 6) ? pickedDay : week;
  const [show, setShow] = useState<Show>("all");
  const [q, setQ] = useState("");
  const inWeek = useMemo(() => rows.filter((r) => r.weekStart === week), [rows, week]);
  const inView = useMemo(() => (view === "day" ? inWeek.filter((r) => r.date === day) : inWeek), [inWeek, view, day]);
  const counts = useMemo(() => new Map(SHOW.map((s) => [s.id, inView.filter(s.test).length])), [inView]);
  const visible = useMemo(() => {
    const test = SHOW.find((s) => s.id === show)!.test;
    const needle = q.trim().toLowerCase();
    return inView.filter((r) => test(r) && (!needle || r.serviceUserName.toLowerCase().includes(needle) || r.carers.some((c) => c.name.toLowerCase().includes(needle)) || r.previous.toLowerCase().includes(needle)));
  }, [inView, show, q]);
  const byDay = useMemo(() => {
    const m = new Map<string, RollRow[]>();
    for (const r of visible) m.set(r.date, [...(m.get(r.date) ?? []), r]);
    return [...m.entries()];
  }, [visible]);

  const weekOf = (w: string) => ({ total: rows.filter((r) => r.weekStart === w && r.kind !== "SKIPPED").length, created: rows.filter((r) => r.weekStart === w && r.kind === "NEW").length });
  const canSave = !!summary && summary.counts.create > 0 && !dirty && !pending && !error;
  const step = savedWeek && !summary ? 3 : summary && !dirty ? (summary.counts.create ? 2 : 1) : 1;
  const chip = (on: boolean) => `inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] ${on ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white text-navy-900 hover:bg-slate-50"}`;

  return (
    <>
      <ol aria-label="Steps" className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {STEPS.map((label, i) => (
          <li key={label} aria-current={i === step ? "step" : undefined} className={`flex items-center gap-1.5 ${i === step ? "font-semibold text-navy-900" : i < step ? "text-[#1f6f3a]" : "text-slate-500"}`}>
            <span aria-hidden className={`grid h-5 w-5 place-items-center rounded-full text-[11.5px] ${i === step ? "bg-navy-900 text-white" : i < step ? "bg-[#e3f3e7] text-[#1f6f3a]" : "bg-slate-100 text-slate-500"}`}>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <form method="get" action="/rota/build" onSubmit={onSubmit} data-no-progress aria-label="Roll forward choices" className="rounded-[4px] border border-slate-200 bg-slate-50 p-3">
        <input type="hidden" name="roll" value="1" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <label><span className="label">Copy Rota From</span>
            <select name="from" value={choices.from} onChange={(e) => setChoices({ ...choices, from: e.target.value, to: addDays(e.target.value, 7) })} className="input">
              {weekOptions.length ? weekOptions.map((w) => <option key={w.value} value={w.value}>{w.label}</option>) : <option value={choices.from}>No built weeks yet</option>}
            </select>
          </label>
          <label><span className="label">Copy Rota To (week starting)</span><input type="date" name="to" value={choices.to} onChange={(e) => setChoices({ ...choices, to: e.target.value })} className="input" /></label>
          <div className="flex items-end">
            <button className="btn-primary w-full min-w-[150px] whitespace-nowrap" data-pending={pending ? "true" : undefined} aria-disabled={pending || undefined} data-testid="roll-preview">
              {pending ? "Updating…" : "Preview Rota"}
            </button>
          </div>
        </div>
        <details open={more} onToggle={(e) => setMore((e.currentTarget as HTMLDetailsElement).open)} className="mt-2">
          <summary className="cursor-pointer text-[13.5px] font-medium text-[#1d4f91]">
            More options <span className="font-normal text-slate-600">· {choices.weeks} week{choices.weeks === 1 ? "" : "s"} · {choices.areaIds.length ? `${choices.areaIds.length} area${choices.areaIds.length === 1 ? "" : "s"}` : "all your areas"}</span>
          </summary>
          <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 lg:grid-cols-[auto_1fr]">
            <fieldset>
              <legend className="label">How many weeks</legend>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4].map((w) => (
                  <label key={w} className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[4px] border border-slate-300 bg-white px-2 py-2 text-[14px] has-[:checked]:border-[#13703c] has-[:checked]:bg-[#e8f5ec] has-[:checked]:font-medium">
                    <input type="radio" name="weeks" value={w} checked={choices.weeks === w} onChange={() => setChoices({ ...choices, weeks: w })} className="h-4 w-4" />{w} week{w === 1 ? "" : "s"}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="flex flex-wrap content-start gap-x-4 gap-y-1">
              <legend className="label">Areas (none ticked means all yours)</legend>
              {areas.map((a) => (
                <label key={a.id} className="flex items-center gap-1.5 text-[14px]">
                  <input type="checkbox" name="areas" value={a.id} checked={choices.areaIds.includes(a.id)} onChange={(e) => setChoices({ ...choices, areaIds: e.target.checked ? [...choices.areaIds, a.id] : choices.areaIds.filter((x) => x !== a.id) })} className="h-4 w-4" /> {a.name}
                </label>
              ))}
            </fieldset>
            <label className="flex items-start gap-2 text-[14px] lg:col-span-2">
              <input type="checkbox" name="keep" value="1" checked={!!choices.keepOneOff} onChange={(e) => setChoices({ ...choices, keepOneOff: e.target.checked })} className="mt-0.5 h-4 w-4" data-testid="roll-keep-oneoff" />
              <span>Keep one-off times <span className="block text-[13px] text-slate-600">A visit whose time was changed for that day only (it differs from its template) normally goes back to the template time. Tick to copy the one-off time instead.</span></span>
            </label>
          </div>
        </details>
      </form>

      <div role="status" aria-live="polite" data-testid="roll-status" className="min-h-[22px] text-[13.5px]">
        {pending ? (
          <span className="inline-flex items-center gap-2 font-medium text-[#1d4f91]"><ArrowsClockwise size={15} aria-hidden className="animate-spin motion-reduce:animate-none" />Updating the preview for the choices above…</span>
        ) : dirty ? (
          <span className="font-medium text-[#8a5a00]">You have changed the choices. Press Preview Rota to see the rota for them. Saving is paused until you do.</span>
        ) : summary ? (
          <span key={summary.computedAt} className={`${announce ? "flash rounded-[3px] bg-[#e8f5ec] px-1.5 py-0.5 font-medium text-[#13703c]" : "text-slate-600"}`}>
            {announce ? "Preview updated" : "Preview worked out"} at {summary.updatedLabel} · {dmy(summary.sourceWeek)} into {summary.targetWeeks.length} week{summary.targetWeeks.length === 1 ? "" : "s"} from {dmy(summary.targetWeeks[0]!)}
          </span>
        ) : null}
      </div>

      {notice.error ? <p role="alert" className="rounded-[4px] border border-[#f1c2c5] bg-[#fdf0f1] px-3 py-2 text-[#a3242c]">{notice.error}</p> : null}

      {savedWeek && !summary && !pending ? (
        <section aria-labelledby="roll-saved" className="rounded-[4px] border border-[#b9dfc4] bg-[#eef8f1] px-4 py-3">
          <h3 id="roll-saved" className="text-[15px] font-semibold text-[#13703c]">Saved as draft</h3>
          {notice.ok ? <p className="mt-0.5 text-[14px]">{notice.ok}</p> : null}
          <p className="mt-1 text-[14px]">Next: copy the week of {dmy(choices.from)} into the week of {dmy(choices.to)}. Nothing has been published.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={runPreview} className="btn-primary inline-flex items-center gap-1.5 bg-[#13703c] hover:bg-[#0f5c31]"><ArrowsClockwise size={16} aria-hidden />Roll Forward Next Week</button>
            <Link href="/rota/build" className="btn-secondary">Done for now</Link>
          </div>
        </section>
      ) : null}

      <div aria-busy={pending || undefined} data-testid="roll-results" className={`relative space-y-3 transition-opacity ${pending ? "pointer-events-none opacity-45" : ""}`}>
        {error ? <p role="alert" className="rounded-[4px] border border-[#f1c2c5] bg-[#fdf0f1] px-3 py-2 text-[#a3242c]">{error}</p> : null}

        {summary ? (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="Roll forward summary">
              {[
                ["Visits to create", n(summary.counts.create), "text-navy-900"],
                ["Carers kept", n(summary.counts.kept), "text-[#1f6f3a]"],
                ["Need review", n(summary.counts.review), "text-[#8a5a00]"],
                ["Uncovered slots", n(summary.counts.uncovered), "text-[#a3242c]"],
                ["Already in place", n(summary.existing), "text-slate-700"],
                ["Skipped", n(summary.skipped), "text-slate-700"],
              ].map(([k, v, tone]) => (
                <div key={k} className="rounded-[4px] border border-slate-200 px-3 py-2"><dt className="text-[12.5px] text-slate-600">{k}</dt><dd className={`text-[20px] font-semibold tabular-nums ${tone}`}>{v}</dd></div>
              ))}
            </dl>
            <p className="text-[13.5px] text-slate-700" data-testid="roll-sentence">
              Copying {n(summary.sourceVisits)} visits from {dmy(summary.sourceWeek)} into {summary.targetWeeks.map(dmy).join(", ")}. Care hours {summary.careHours}. Estimated basic pay for carers kept {summary.estimatedPay}
              {summary.slotsWithoutRate ? ` (${summary.slotsWithoutRate} carer slots have no pay rate and are not costed)` : ""}. Estimates use pay rate cards only and are not payroll figures.
              {summary.counts.oneOff ? <span data-testid="roll-oneoff"> {summary.counts.oneOff} visit{summary.counts.oneOff === 1 ? " had a one-off time" : "s had one-off times"}: {reviewed.keepOneOff ? "the one-off times are kept, as you ticked." : "they go back to the template time (tick Keep one-off times under More options to keep them)."}</span> : null}
              {summary.counts.doubleUpsShort ? <span className="text-[#a3242c]"> {summary.counts.doubleUpsShort} multi-carer visit{summary.counts.doubleUpsShort === 1 ? "" : "s"} will be short of a carer.</span> : null}
            </p>
            {summary.blockers.length ? (
              <div role="alert" className="rounded-[4px] border border-[#f1c2c5] bg-[#fdf0f1] px-3 py-2">
                <p className="font-semibold text-[#a3242c]">Nothing can be rolled forward</p>
                {summary.blockers.map((b) => <p key={b}>{b}</p>)}
                {summary.nextWeekHref ? <p><Link href={summary.nextWeekHref} className="font-medium text-[#0f6e3b] underline">Try the next week that still needs building</Link></p> : null}
              </div>
            ) : null}

            {rows.length ? (
              <section aria-labelledby="roll-compare" data-testid="roll-destination">
                <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 id="roll-compare" className="text-[15px] font-semibold">Proposed rota</h3>
                  <p className="text-[13px] text-slate-600">Visits already in place are shown as they are and are never changed. Only new visits are saved.</p>
                </div>
                {weeksInPlan.length > 1 ? (
                  <div role="group" aria-label="Destination week" className="mb-2 flex flex-wrap gap-1.5">
                    {weeksInPlan.map((w) => {
                      const s = weekOf(w);
                      return (
                        <button key={w} type="button" aria-pressed={week === w} onClick={() => setWeek(w)} className={`rounded-[4px] border px-2.5 py-1.5 text-[13px] ${week === w ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white text-navy-900 hover:bg-slate-50"}`}>
                          Week of {dmy(w)} · {n(s.total)} visits{s.created ? ` (${n(s.created)} new)` : ""}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13.5px]" data-testid="roll-week-total">
                    <strong className="font-semibold">{dmy(week)} – {dmy(addDays(week, 6))}:</strong> {n(weekOf(week).total)} visits in the rota after saving ({n(inWeek.filter((r) => r.kind === "EXISTING").length)} already exist, {n(inWeek.filter((r) => r.kind === "NEW").length)} new){inWeek.some((r) => r.kind === "SKIPPED") ? `, ${n(inWeek.filter((r) => r.kind === "SKIPPED").length)} skipped` : ""}.
                  </p>
                  <div role="group" aria-label="View" className="inline-flex overflow-hidden rounded-[4px] border border-slate-300 text-[13px]">
                    {(["week", "day"] as const).map((v) => (
                      <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`px-3 py-1.5 ${view === v ? "bg-navy-900 text-white" : "bg-white text-navy-900 hover:bg-slate-50"}`}>{v === "week" ? "Weekly view" : "Daily view"}</button>
                    ))}
                  </div>
                </div>
                {view === "day" ? (
                  <div role="group" aria-label="Day" className="mb-2 flex flex-wrap gap-1.5">
                    {Array.from({ length: 7 }, (_, i) => addDays(week, i)).map((d) => (
                      <button key={d} type="button" aria-pressed={day === d} onClick={() => setDay(d)} className={`rounded-[4px] border px-2.5 py-1.5 text-[13px] ${day === d ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 bg-white text-navy-900 hover:bg-slate-50"}`}>
                        {shortDay(d)} <span className="tabular-nums opacity-80">· {n(inWeek.filter((r) => r.date === d && r.kind !== "SKIPPED").length)}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="mb-2 flex flex-wrap items-center gap-1.5">
                  <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
                    {SHOW.map((s) => (
                      <button key={s.id} type="button" aria-pressed={show === s.id} onClick={() => setShow(s.id)} className={chip(show === s.id)}>
                        {s.dot ? <span aria-hidden className={`h-2 w-2 rounded-full ${s.dot}`} /> : null}{s.label} <span className="tabular-nums opacity-80">{n(counts.get(s.id) ?? 0)}</span>
                      </button>
                    ))}
                  </div>
                  <label className="ml-auto"><span className="sr-only">Find a service user or carer</span><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a service user or carer" className="input h-8 w-[220px] py-1 text-[13px]" /></label>
                </div>
                <div className="max-h-[460px] overflow-auto rounded-[4px] border border-slate-200">
                  <table className="table min-w-[860px] text-[13px]">
                    <thead className="sticky top-0 z-[1] bg-white"><tr><th>Time</th><th>Service user</th><th>Status</th><th>Previous carers ({dmy(summary.sourceWeek)})</th><th>Proposed carers</th></tr></thead>
                    {byDay.map(([date, list]) => (
                      <tbody key={date}>
                        <tr><th colSpan={5} scope="colgroup" className="bg-slate-50 text-left text-[12.5px] font-semibold text-navy-900">{dayLabel(date)} · {n(list.length)} shown</th></tr>
                        {list.map((r) => (
                          <tr key={r.key} data-kind={r.kind} className={r.kind === "NEW" ? "[&>td]:bg-[#f5f8fe]" : r.kind === "SKIPPED" ? "[&>td]:text-slate-500" : ""}>
                            <td className="whitespace-nowrap tabular-nums"><span className="sr-only">{shortDay(r.date)} </span>{r.time}</td>
                            <td>{r.serviceUserName}<span className="block text-[12px] text-slate-500">{r.detail}</span></td>
                            <td>
                              <span className={`inline-block whitespace-nowrap rounded-[3px] border px-1.5 text-[11.5px] font-semibold ${KIND_TONE[r.kind]}`}>{KIND_LABEL[r.kind]}</span>
                              {r.differs ? <span className="ml-1 inline-block whitespace-nowrap rounded-[3px] border border-[#d6ccef] bg-[#f3effc] px-1.5 text-[11.5px] font-semibold text-[#57399e]">Different from source</span> : null}
                              {r.note ? <span className="block text-[12px] text-slate-500">{r.note}</span> : null}
                            </td>
                            <td>{r.previous || <span className="text-slate-400">Not in the source week</span>}</td>
                            <td>
                              {r.kind === "SKIPPED" ? <span className="text-slate-500">Not created</span> : (
                                <ul className="space-y-0.5">
                                  {r.carers.map((c) => (
                                    <li key={c.key}>
                                      {CARER_LABEL[c.state] ? <span className={`mr-1.5 inline-block rounded-[3px] px-1.5 text-[11.5px] font-semibold ${CARER_TONE[c.state]}`}>{CARER_LABEL[c.state]}</span> : null}
                                      {c.name}{c.shadow ? " (shadow)" : ""}
                                      {c.reason ? <span className="block text-[12px] text-slate-600">{c.reason}</span> : null}
                                    </li>
                                  ))}
                                  {!r.carers.length ? <li className="text-slate-500">No carer needed</li> : null}
                                </ul>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    ))}
                  </table>
                  {!visible.length ? <p className="px-3 py-2 text-[13px] text-slate-600">No visits {view === "day" ? "on this day" : "in this week"} match what you chose to show.</p> : null}
                </div>
              </section>
            ) : null}

            {summary.counts.create ? (
              <form action={saveAction} className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
                <input type="hidden" name="back" value={rollHref(reviewed)} />
                <input type="hidden" name="sourceWeek" value={reviewed.from} />
                <input type="hidden" name="targetWeek" value={reviewed.to} />
                <input type="hidden" name="weeks" value={reviewed.weeks} />
                <input type="hidden" name="fingerprint" value={summary.fingerprint} />
                {reviewed.areaIds.map((a) => <input key={a} type="hidden" name="areaIds" value={a} />)}
                {reviewed.keepOneOff ? <input type="hidden" name="keepOneOff" value="1" /> : null}
                <button disabled={!canSave} className="btn-primary inline-flex items-center gap-1.5 bg-[#13703c] hover:bg-[#0f5c31] disabled:cursor-not-allowed disabled:opacity-50"><ArrowsClockwise size={16} aria-hidden />Save as Draft</button>
                <p className="text-[13px] text-slate-600" data-testid="roll-save-note">Saves the {n(summary.counts.create)} new visit{summary.counts.create === 1 ? "" : "s"} in this preview, checked again first, as unpublished drafts. Visits already in place are not touched. Then you can roll forward the next week.</p>
              </form>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
