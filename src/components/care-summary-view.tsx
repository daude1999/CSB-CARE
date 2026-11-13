import Link from "@/components/link";
import { fmtLondonDate } from "@/lib/london";
import type { Ctx } from "@/server/auth/rbac";
import { hasOrgPermission } from "@/server/auth/rbac";
import { careRecords, careSummariesFor, careSummaryAvailability, parsePeriod, type StoredOutput, type StoredSource } from "@/server/care/care-summary";
import { memberNames } from "@/server/rota/queries";
import { generateCareSummaryAction, reviewCareSummaryAction, startReviewFromSummaryAction } from "@/app/care-summary-actions";
import { Badge, Card, Empty, fmtDate, type Tone } from "@/components/ui";

const SECTIONS: { key: "summary" | "changes" | "concerns" | "nextActions"; title: string; hint: string }[] = [
  { key: "summary", title: "Summary of recent care", hint: "What the records say happened." },
  { key: "changes", title: "Possible changes to review", hint: "Patterns in the records worth a manager's look. Not a diagnosis." },
  { key: "concerns", title: "Outstanding concerns", hint: "Recorded issues that still look open." },
  { key: "nextActions", title: "Suggested next action", hint: "Something to check or consider. Nothing has been changed." },
];

const KIND_TONE: Record<string, Tone> = { "Visit note": "slate", "Task not done": "amber", Incident: "rose", "Risk assessment": "violet", "Care plan": "teal", Medication: "amber" };
const STATUS: Record<string, { label: string; tone: Tone }> = {
  UNREVIEWED: { label: "Unapproved draft", tone: "amber" },
  REVIEWED: { label: "Reviewed by a manager", tone: "green" },
  DISMISSED: { label: "Dismissed", tone: "slate" },
};

const short = (iso: string) => fmtLondonDate(iso).replace(/ \d{4}$/, "");

/** Care Summary tab on a person's care plan: period, counted facts, the optional AI draft, and the records behind it. */
export async function CareSummaryView({ ctx, serviceUserId, sp }: { ctx: Ctx; serviceUserId: string; sp: Record<string, string | undefined> }) {
  const range = parsePeriod(sp);
  const base = `/rota/care-plans/${serviceUserId}?view=summary`;
  const [{ records, facts, medicationIncluded }, summaries, avail] = await Promise.all([careRecords(ctx, serviceUserId, range), careSummariesFor(ctx, serviceUserId), careSummaryAvailability(ctx)]);
  const chosen = sp.summary ? summaries.find((s) => s.id === sp.summary) ?? null : summaries.find((s) => s.status !== "DISMISSED") ?? null;
  const names = await memberNames(ctx, summaries.flatMap((s) => [s.requestedById, s.reviewedById]));
  const who = (id: string | null) => (id ? names.get(id) ?? "Former member" : "—");
  const canReview = hasOrgPermission(ctx, "care.plan.approve");
  const canDraft = hasOrgPermission(ctx, "care.plan.edit");
  const periodQs = range.period === "custom" ? `period=custom&from=${range.from}&to=${range.to}` : `period=${range.period}`;
  const here = `${base}&${periodQs}${chosen ? `&summary=${chosen.id}` : ""}`;
  const kinds = [...new Set(records.map((r) => r.kind))];
  const kind = sp.kind && kinds.includes(sp.kind) ? sp.kind : null;
  const shown = kind ? records.filter((r) => r.kind === kind) : records;

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-3">
        <section aria-label="Period" className="card flex flex-wrap items-end gap-x-4 gap-y-2">
          <nav aria-label="Period" className="flex flex-wrap gap-1.5">
            {(["7", "14", "30"] as const).map((p) => (
              <Link key={p} href={`${base}&period=${p}`} aria-current={range.period === p ? "page" : undefined} className={`rounded-[4px] border px-3 py-1.5 text-[14px] no-underline ${range.period === p ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 text-navy-900 hover:bg-slate-50"}`}>Last {p} days</Link>
            ))}
          </nav>
          <form className="flex flex-wrap items-end gap-2" aria-label="Custom period">
            <input type="hidden" name="view" value="summary" />
            <input type="hidden" name="period" value="custom" />
            <label><span className="label">From</span><input type="date" name="from" defaultValue={range.from} className="input" required /></label>
            <label><span className="label">To</span><input type="date" name="to" defaultValue={range.to} className="input" required /></label>
            <button className={range.period === "custom" ? "btn-primary" : "btn-secondary"}>Show</button>
          </form>
          <p className="basis-full text-[13px] text-slate-600" data-testid="care-facts">
            {fmtLondonDate(range.from)} to {fmtLondonDate(range.to)}: {facts.scheduled} visits scheduled, {facts.completed} completed, {facts.late} started more than 10 minutes late, {facts.missed} recorded as missed, {facts.notDelivered} not delivered, {facts.cancelled} cancelled.
          </p>
        </section>

        <Card
          title={<span className="flex flex-wrap items-center gap-2">Care Summary {chosen ? <Badge tone={STATUS[chosen.status]!.tone}>{STATUS[chosen.status]!.label}</Badge> : null}{chosen?.isSimulated ? <Badge tone="slate">Simulated, rule-based</Badge> : null}</span>}
        >
          <div data-testid="care-summary">
            {chosen ? (
              <>
                <p className="mb-3 rounded-[3px] border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-[13.5px] text-amber-900">
                  {chosen.status === "UNREVIEWED" ? "Draft for a manager to check against the records. It has not changed the care plan, any incident or any safeguarding record." : chosen.status === "REVIEWED" ? `Checked against the records by ${who(chosen.reviewedById)}${chosen.reviewedAt ? ` on ${fmtDate(chosen.reviewedAt)}` : ""}. It is still a summary, not part of the care plan.` : `Dismissed by ${who(chosen.reviewedById)}: ${chosen.reviewNote ?? ""}`}
                </p>
                <p className="mb-3 text-[12.5px] text-slate-600">
                  Created by {who(chosen.requestedById)} on {fmtDate(chosen.createdAt, true)} for {fmtLondonDate(chosen.fromDate.toISOString().slice(0, 10))} to {fmtLondonDate(chosen.toDate.toISOString().slice(0, 10))}, from {chosen.sources.length} records. Provider: {chosen.isSimulated ? "simulated (rule-based, no AI)" : `${chosen.provider}${chosen.model ? ` (${chosen.model})` : ""}`}.
                </p>
                <SummaryBody output={chosen.output} sources={chosen.sources} />
                {chosen.status === "UNREVIEWED" && canReview ? (
                  <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-3">
                    <form action={reviewCareSummaryAction}>
                      <input type="hidden" name="back" value={here} /><input type="hidden" name="summaryId" value={chosen.id} /><input type="hidden" name="outcome" value="REVIEWED" />
                      <button className="btn-primary">Mark as reviewed</button>
                    </form>
                    <form action={reviewCareSummaryAction} className="flex flex-wrap items-end gap-2">
                      <input type="hidden" name="back" value={here} /><input type="hidden" name="summaryId" value={chosen.id} /><input type="hidden" name="outcome" value="DISMISSED" />
                      <label><span className="label">Reason to dismiss</span><input name="note" required minLength={3} className="input" /></label>
                      <button className="btn-secondary">Dismiss</button>
                    </form>
                  </div>
                ) : null}
                {chosen.status !== "DISMISSED" && canDraft ? (
                  <form action={startReviewFromSummaryAction} className="mt-3 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="back" value={here} /><input type="hidden" name="summaryId" value={chosen.id} />
                    <button className="btn-secondary">Start a care plan review</button>
                    <span className="text-[12.5px] text-slate-500">Opens a new draft copied from the current plan. The summary text is not copied in, and a second person still approves.</span>
                  </form>
                ) : null}
              </>
            ) : (
              <p className="text-[14px] text-slate-700">No Care Summary yet. The records for the period are listed below.</p>
            )}
            <Generate avail={avail} serviceUserId={serviceUserId} range={range} back={here} hasRecords={records.length > 0} again={!!chosen} />
          </div>
        </Card>

        <Card title={`Recent records (${records.length})`}>
          <p className="mb-2 text-[13px] text-slate-600">Straight from the records: visit notes, tasks not done or refused, incidents (and any still open), risk assessments, and care plan changes{medicationIncluded ? ", plus refused or not-given medicines" : ""}. No AI is used here.</p>
          {kinds.length > 1 ? (
            <nav aria-label="Record type" className="mb-2 flex flex-wrap gap-1.5">
              <Link href={`${base}&${periodQs}`} aria-current={!kind ? "page" : undefined} className={`rounded-full border px-2.5 py-0.5 text-[13px] no-underline ${!kind ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 text-navy-900"}`}>All</Link>
              {kinds.map((k) => <Link key={k} href={`${base}&${periodQs}&kind=${encodeURIComponent(k)}`} aria-current={kind === k ? "page" : undefined} className={`rounded-full border px-2.5 py-0.5 text-[13px] no-underline ${kind === k ? "border-navy-900 bg-navy-900 text-white" : "border-slate-300 text-navy-900"}`}>{k} ({records.filter((r) => r.kind === k).length})</Link>)}
            </nav>
          ) : null}
          {shown.length ? (
            <ul className="divide-y divide-slate-100" data-testid="care-records">
              {shown.map((r) => (
                <li key={r.sid} id={`rec-${r.sid}`} className="grid grid-cols-[52px_84px_minmax(0,1fr)] items-baseline gap-2 py-2 text-[14px] sm:grid-cols-[52px_90px_130px_minmax(0,1fr)_auto]">
                  <span className="font-mono text-[12.5px] text-slate-500">{r.sid}</span>
                  <span className="text-[13px] text-slate-600">{short(r.date)}</span>
                  <span className="hidden sm:block"><Badge tone={KIND_TONE[r.kind] ?? "slate"}>{r.kind}</Badge></span>
                  <span className="min-w-0 break-words">{r.text}</span>
                  <Link href={r.href} className="col-start-3 text-[13px] sm:col-start-auto">Open</Link>
                </li>
              ))}
            </ul>
          ) : <Empty>Nothing was recorded for this person in the period.</Empty>}
        </Card>
      </div>

      <aside className="space-y-3" aria-label="Earlier summaries">
        <Card title="Earlier summaries">
          {summaries.length ? (
            <ul className="rows text-[14px]">
              {summaries.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 py-1.5">
                  <Link href={`${base}&${periodQs}&summary=${s.id}`} aria-current={chosen?.id === s.id ? "page" : undefined} className={chosen?.id === s.id ? "font-semibold" : ""}>{fmtDate(s.createdAt)}</Link>
                  <Badge tone={STATUS[s.status]!.tone}>{STATUS[s.status]!.label}</Badge>
                </li>
              ))}
            </ul>
          ) : <Empty>None yet.</Empty>}
          <p className="mt-2 text-[12.5px] text-slate-500">Summaries are kept as created, with the records they used. They cannot be edited.</p>
        </Card>
        <Card title="How this works">
          <ul className="list-disc space-y-1 pl-4 text-[13px] text-slate-700">
            <li>Every point links to the record it came from. Points without a record are removed before saving.</li>
            <li>The summary never changes the care plan, a diagnosis, an incident or a safeguarding record.</li>
            <li>Names and addresses are not sent to the AI provider.</li>
          </ul>
        </Card>
      </aside>
    </div>
  );
}

function SummaryBody({ output, sources }: { output: StoredOutput; sources: StoredSource[] }) {
  const bySid = new Map(sources.map((s) => [s.sid, s]));
  return (
    <div className="space-y-4">
      {SECTIONS.map((sec) => {
        const pts = output[sec.key] ?? [];
        return (
          <section key={sec.key} aria-label={sec.title}>
            <h3 className="text-[15px] font-semibold text-navy-900">{sec.title}</h3>
            <p className="mb-1 text-[12.5px] text-slate-500">{sec.hint}</p>
            {pts.length ? (
              <ul className="space-y-1.5">
                {pts.map((p, i) => (
                  <li key={i} className="text-[14px]">
                    {p.text}{" "}
                    <span className="inline-flex flex-wrap gap-1 align-baseline">
                      {p.sources.map((sid) => {
                        const s = bySid.get(sid);
                        return s ? <Link key={sid} href={s.href} title={`${s.kind}, ${s.date}`} className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11.5px] text-slate-700 no-underline hover:bg-slate-200">{sid}</Link> : null;
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-[13.5px] text-slate-500">Nothing in the records for this.</p>}
          </section>
        );
      })}
      {output.gaps?.length ? (
        <section aria-label="What the records do not show">
          <h3 className="text-[15px] font-semibold text-navy-900">What the records do not show</h3>
          <ul className="list-disc pl-5 text-[13.5px] text-slate-600">{output.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}

function Generate({ avail, serviceUserId, range, back, hasRecords, again }: { avail: Awaited<ReturnType<typeof careSummaryAvailability>>; serviceUserId: string; range: { period: string; from: string; to: string }; back: string; hasRecords: boolean; again: boolean }) {
  const why = {
    off: "Care Summary is switched off for your organisation. An admin can switch it on in Rostering Settings after data protection approval.",
    not_configured: "No AI provider is configured, so a summary cannot be created. The records below are complete without it.",
    no_permission: "Care coordinators and managers can create a Care Summary.",
  } as const;
  if (avail.state !== "ready") return <p className="mt-3 border-t border-slate-200 pt-3 text-[13px] text-slate-600" data-testid="care-summary-state">{why[avail.state]}</p>;
  return (
    <form action={generateCareSummaryAction} className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
      <input type="hidden" name="back" value={back} /><input type="hidden" name="serviceUserId" value={serviceUserId} />
      <input type="hidden" name="period" value={range.period} /><input type="hidden" name="from" value={range.from} /><input type="hidden" name="to" value={range.to} />
      <button className={again ? "btn-secondary" : "btn-primary"} disabled={!hasRecords}>{again ? "Create a new summary for this period" : "Create Care Summary"}</button>
      <span className="text-[12.5px] text-slate-500">{avail.isSimulated ? "Simulated provider: rule-based keyword counts, clearly labelled. Nothing leaves the platform." : `Sends the record text to ${avail.providerName}. Names and addresses are not sent.`}</span>
    </form>
  );
}
