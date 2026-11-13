import Link from "@/components/link";
import { fromDbDate, hhmm, WEEKDAYS } from "@/lib/london";
import { Badge, fmtDate } from "@/components/ui";
import { createPackageAction, endPackageAction, updatePackageAction } from "@/app/rota-actions";
import { resolveFollowUpAction } from "@/app/coordinator-actions";
import { coverageState, hoursPerWeek, hoursText, isLongText, type CoverageFigures, type CoverageState } from "@/server/care/package-view";
import { REQUIREMENTS_MAX, type packageHistory, type packageReviewItems, type packageSources } from "@/server/care/packages";
import { FOLLOW_UP_LABEL } from "@/lib/care-coordinator-rules";

/**
 * The full Care Package tab: the structured package, commissioned against planned care, the original requirements
 * text exactly as stored, package review items, source documents and history. Editing, ending and replacing still
 * use the existing package actions, which check permissions and scope on the server again.
 */

type Pkg = { id: string; reference: string | null; status: "ACTIVE" | "ENDED"; commissionedMinutesPerWeek: number | null; startDate: Date; endDate: Date | null; requirements: string | null; funderId: string | null; funder: { name: string } | null; createdAt: Date };
type Template = { id: string; startMinute: number; durationMin: number; carersRequired: number; weekdays: number[]; cycleWeeks: number[]; effectiveTo: Date | null; callType: { name: string } };
type Reviews = Awaited<ReturnType<typeof packageReviewItems>>;
type Sources = Awaited<ReturnType<typeof packageSources>>;
type HistoryRow = Awaited<ReturnType<typeof packageHistory>>[number];
type SourceEntry = NonNullable<ReturnType<Sources["byPackage"]["get"]>>;

interface Props {
  person: { id: string; name: string; reference: string };
  packages: Pkg[];
  templates: Template[];
  coverage: CoverageFigures;
  reviews: Reviews;
  sources: Sources;
  history: HistoryRow[];
  names: Map<string, string>;
  funders: { id: string; name: string }[];
  can: { edit: boolean; fund: boolean; rota: boolean; resolve: boolean; intake: boolean };
  base: string;
  back: string;
  today: string;
}

const STATE: Record<CoverageState, { label: string; tone: "green" | "amber" | "slate" }> = {
  MATCHES: { label: "Reconciles", tone: "green" },
  OVER: { label: "Over", tone: "amber" },
  UNDER: { label: "Under", tone: "amber" },
  NOT_RECORDED: { label: "Cannot compare", tone: "slate" },
};

export function CarePackageTab(p: Props) {
  const active = p.packages.find((x) => x.status === "ACTIVE") ?? null;
  const past = p.packages.filter((x) => x !== active);
  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px]" data-testid="care-package-tab">
      <div className="min-w-0 space-y-3">
        {active ? (
          <>
            <PackageDetails pkg={active} {...p} />
            <CommissionedCare pkg={active} />
          </>
        ) : (
          <section className="card"><h2 className="text-subtitle">Package details</h2><p className="mt-2 text-body text-slate-600">{p.packages.length ? "No package is active. Earlier packages are listed under Package history." : "No care package recorded yet."}</p></section>
        )}
        <ScheduledCare {...p} />
        {active ? <OriginalRequirements pkg={active} source={p.sources.byPackage.get(active.id) ?? null} intakeLinks={p.can.intake} /> : null}
        <PackageHistory past={past} {...p} />
      </div>
      <div className="min-w-0 space-y-3">
        <ReviewItems {...p} />
        <SourceDocuments active={active} {...p} />
        {p.can.edit ? (
          <section className="card" aria-labelledby="pkg-new-h">
            <h2 id="pkg-new-h" className="text-subtitle">{active ? "Replace with a new package" : "Record a package"}</h2>
            {active ? <p className="mt-1 text-body text-slate-600">The active package ends the day before the new one starts. Past invoices keep using the package that was in force on each visit date.</p> : null}
            <PackageForm action={createPackageAction} hidden={{ serviceUserId: p.person.id }} back={p.back} funders={p.funders} canFund={p.can.fund} submit="Record package" today={p.today} />
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Item({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <dt className="text-meta text-slate-600">{label}</dt>
      <dd className="mt-0.5 break-words text-body text-[#1d2939]">{children}</dd>
    </div>
  );
}

// ── A. Package details ─────────────────────────────────────────────────────

function PackageDetails({ pkg, person, funders, can, back, today, sources }: Props & { pkg: Pkg }) {
  const source = sources.byPackage.get(pkg.id);
  return (
    <section className="card" aria-labelledby="pkg-a-h" data-testid="package-details">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pkg-a-h" className="text-subtitle">Package details</h2>
        <Badge tone="green">Active</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 lg:grid-cols-3">
        <Item label="Package reference">{pkg.reference?.trim() || <span className="text-slate-500">Reference not recorded</span>}</Item>
        <Item label="Status">Active</Item>
        <Item label="Commissioned">{hoursPerWeek(pkg.commissionedMinutesPerWeek) ?? <span className="text-slate-500">Hours not recorded</span>}</Item>
        <Item label="Start date">{fmtDate(pkg.startDate)}</Item>
        <Item label="End date">{pkg.endDate ? fmtDate(pkg.endDate) : <span className="text-slate-500">Open-ended</span>}</Item>
        <Item label="Funder">{pkg.funder ? <>{pkg.funder.name} <span className="text-meta text-slate-500">(linked by finance)</span></> : <><span>Funder not linked</span><span className="block text-meta text-slate-500">Finance links the funder</span></>}</Item>
        <Item label="Service user">{person.name} <span className="text-slate-500">({person.reference})</span></Item>
        <Item label="Recorded on">{fmtDate(pkg.createdAt)}</Item>
        <Item label="Set up from">{source ? `Care Coordinator intake ${source.intakeReference}` : <span className="text-slate-500">Not recorded</span>}</Item>
      </dl>
      {can.edit ? (
        <div className="mt-3 flex flex-wrap items-start gap-3 border-t border-slate-100 pt-3">
          <details className="[&[open]]:w-full">
            <summary className="btn-secondary inline-block cursor-pointer py-1">Edit package</summary>
            <PackageForm action={updatePackageAction} hidden={{ packageId: pkg.id }} back={back} p={pkg} funders={funders} canFund={can.fund} submit="Save changes" />
          </details>
          <details className="[&[open]]:w-full">
            <summary className="btn-secondary inline-block cursor-pointer py-1">End package</summary>
            <form action={endPackageAction} className="mt-2 space-y-2">
              <input type="hidden" name="back" value={back} /><input type="hidden" name="packageId" value={pkg.id} />
              <label className="block"><span className="label">Last day</span><input type="date" name="endDate" required defaultValue={today} className="input" /></label>
              <label className="block"><span className="label">Why it ends</span><input name="reason" required minLength={3} className="input" /></label>
              <button className="btn-danger">End package</button>
            </form>
          </details>
        </div>
      ) : null}
    </section>
  );
}

// ── B. Commissioned care ───────────────────────────────────────────────────

function CommissionedCare({ pkg }: { pkg: Pkg }) {
  const m = pkg.commissionedMinutesPerWeek;
  return (
    <section className="card" aria-labelledby="pkg-b-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pkg-b-h" className="text-subtitle">Commissioned care</h2>
        <span className="text-meta text-slate-500">From the package&apos;s structured fields</span>
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Item label="Authorised weekly hours">{m === null ? <span className="text-slate-500">Hours not recorded</span> : <span className="font-medium tabular-nums">{hoursText(m)} hours a week <span className="font-normal text-slate-500">({m.toLocaleString("en-GB")} minutes)</span></span>}</Item>
        <Item label="On average per day">{m === null ? "—" : <span className="tabular-nums">{hoursText(Math.round(m / 7))} hours</span>}</Item>
        <Item label="Package period">{fmtDate(pkg.startDate)} to {pkg.endDate ? fmtDate(pkg.endDate) : "open-ended"} {pkg.endDate ? <Badge tone="amber">Time-limited</Badge> : null}</Item>
      </dl>
      <p className="mt-3 text-meta text-slate-600">These figures are what the office recorded as authorised. The written requirements below are kept exactly as recorded and are not turned into authorised figures.</p>
    </section>
  );
}

// ── C. Scheduled care and rota comparison ──────────────────────────────────

function ScheduledCare({ coverage, templates, today, can, base }: Props) {
  const c = coverageState(coverage);
  const current = templates.filter((t) => !t.effectiveTo || fromDbDate(t.effectiveTo) >= today);
  const rows: { label: string; value: string; note?: string; state?: CoverageState; diff?: number | null }[] = [
    { label: "Commissioned", value: hoursPerWeek(coverage.commissioned) ?? "Not recorded" },
    { label: "Planned visit time", value: `${hoursText(coverage.planned)} hours/week`, note: `${coverage.templates} repeating ${coverage.templates === 1 ? "visit" : "visits"}, averaged over the rota cycle` },
    { label: "Planned carer time", value: `${hoursText(coverage.plannedCarerMinutes)} hours/week`, note: c.hasDoubleUps ? "Double-up visits count once for each carer" : "No double-up visits" },
    { label: "Difference (visit time)", value: diffText(c.visit.difference), state: c.visit.state },
  ];
  if (c.hasDoubleUps) rows.push({ label: "Difference (carer time)", value: diffText(c.carer.difference), state: c.carer.state, note: "Use this line if the council commissions carer hours" });
  return (
    <section className="card" aria-labelledby="pkg-c-h" data-testid="package-coverage">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="pkg-c-h" className="text-subtitle">Scheduled care and rota comparison</h2>
        {can.rota ? <span className="flex gap-2"><Link href={`${base}?tab=template`} className="btn-secondary py-1">Template</Link><Link href={`${base}?tab=rota`} className="btn-secondary py-1">Rota</Link></span> : null}
      </div>
      <dl className="mt-2 divide-y divide-slate-100 rounded-[6px] border border-slate-200">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-1 gap-x-4 gap-y-0.5 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center">
            <dt className="text-body text-slate-700">{r.label}{r.note ? <span className="block text-meta text-slate-500">{r.note}</span> : null}</dt>
            <dd className="flex flex-wrap items-center gap-2 text-body font-medium tabular-nums text-[#1d2939]">{r.value}{r.state ? <Badge tone={STATE[r.state].tone}>{STATE[r.state].label}</Badge> : null}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-meta text-slate-600">A 30-minute visit with two carers is 30 minutes of visit time and 60 minutes of carer time. Nothing here changes the package or the rota: correct the template or the package by hand if they differ.</p>
      {current.length ? (
        <>
          <h3 className="mt-3 text-body font-semibold">Repeating visits</h3>
          <div className="mt-1 overflow-x-auto">
          <table className="table min-w-[30rem]">
            <thead><tr><th>Call</th><th>Time</th><th>Days</th><th>Carers</th></tr></thead>
            <tbody>
              {[...current].sort((a, b) => a.startMinute - b.startMinute).map((t) => (
                <tr key={t.id}>
                  <td>{can.rota ? <Link href={`/rota/templates/${t.id}`}>{t.callType.name}</Link> : t.callType.name}</td>
                  <td className="tabular-nums">{hhmm(t.startMinute)} · {t.durationMin}m</td>
                  <td>{t.weekdays.length === 7 ? "Every day" : t.weekdays.map((d) => WEEKDAYS[d - 1]!.slice(0, 2)).join(" ")}{t.effectiveTo ? <span className="block text-meta text-slate-500">until {fmtDate(t.effectiveTo)}</span> : null}</td>
                  <td>{t.carersRequired}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      ) : <p className="mt-3 text-body text-slate-600">No recurring visits configured.</p>}
    </section>
  );
}

const diffText = (d: number | null) => (d === null ? "—" : d === 0 ? "0 hours" : `${d > 0 ? "+" : "−"}${hoursText(Math.abs(d))} hours/week`);

// ── D. Original requirements, exactly as stored ────────────────────────────

function OriginalRequirements({ pkg, source, intakeLinks }: { pkg: Pkg; source: SourceEntry | null; intakeLinks: boolean }) {
  const text = pkg.requirements;
  return (
    <section className="card" aria-labelledby="pkg-d-h" data-testid="package-requirements">
      <h2 id="pkg-d-h" className="text-subtitle">Original package requirements &amp; imported information</h2>
      <p className="mt-1 text-meta text-slate-600">
        {source ? <>Saved from Care Coordinator intake {intakeLinks ? <Link href={`/rota/coordinator/${source.intakeId}`}>{source.intakeReference}</Link> : source.intakeReference} after the coordinator confirmed it. </> : "Source not recorded: entered on the package form or by an earlier import. "}
        Shown exactly as recorded. It is not checked against the commissioning documents.
      </p>
      {text ? (
        isLongText(text) ? (
          <details className="mt-2 rounded-[6px] border border-slate-200">
            <summary className="cursor-pointer px-3 py-2 text-body text-[#1d4f91]">Show the full text ({text.length.toLocaleString("en-GB")} characters, {text.split("\n").length} lines)</summary>
            <RequirementsText text={text} />
          </details>
        ) : <div className="mt-2 rounded-[6px] border border-slate-200"><RequirementsText text={text} /></div>
      ) : <p className="mt-2 text-body text-slate-600">No requirements text recorded.</p>}
    </section>
  );
}

function RequirementsText({ text }: { text: string }) {
  return <div className="whitespace-pre-wrap break-words px-3 py-2.5 text-body leading-relaxed text-[#1d2939]" data-testid="requirements-text">{text}</div>;
}

// ── E. Outstanding questions and review items ──────────────────────────────

function ReviewItems({ reviews, can, back }: Props) {
  const open = reviews.items.filter((i) => i.status === "OPEN");
  const closed = reviews.items.filter((i) => i.status !== "OPEN");
  return (
    <section className="card" aria-labelledby="pkg-e-h" data-testid="package-review-items">
      <div className="flex items-center justify-between gap-2">
        <h2 id="pkg-e-h" className="text-subtitle">Outstanding questions</h2>
        {open.length ? <Badge tone="amber">{open.length} open</Badge> : null}
      </div>
      {reviews.hidden ? <p className="mt-1 text-meta text-slate-600">{reviews.hidden} restricted item{reviews.hidden === 1 ? "" : "s"} for a registered manager.</p> : null}
      {open.length ? (
        <ul className="mt-2 space-y-2">
          {open.map((i) => (
            <li key={i.id} className="rounded-[6px] border border-slate-200 p-3 text-body">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{FOLLOW_UP_LABEL[i.category] ?? i.category}</span>{i.restricted ? <Badge tone="violet">Restricted</Badge> : null}</div>
              <p className="mt-1 whitespace-pre-line break-words">{i.description}</p>
              <p className="mt-1 text-meta text-slate-500">Raised {fmtDate(i.createdAt)}{i.sourceRef ? ` · Source: ${i.sourceRef}` : ""}</p>
              {can.resolve ? (
                <details className="mt-1"><summary className="cursor-pointer text-body text-[#1d4f91]">Close this question</summary>
                  <form action={resolveFollowUpAction} className="mt-1 space-y-2"><input type="hidden" name="back" value={back} /><input type="hidden" name="itemId" value={i.id} /><label className="block"><span className="label">What was done</span><input name="resolution" required minLength={5} className="input" /></label><button className="btn-secondary">Close</button></form>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-body text-slate-600">No open package questions are recorded. Anything still written only in the original requirements text stays there until someone reviews it.</p>}
      {closed.length ? (
        <details className="mt-2"><summary className="cursor-pointer text-body text-[#1d4f91]">{closed.length} closed</summary>
          <ul className="mt-1 space-y-1.5 text-body">{closed.map((i) => <li key={i.id}><span className="font-medium">{FOLLOW_UP_LABEL[i.category] ?? i.category}:</span> {i.resolution ?? "Closed"} <span className="text-slate-500">({fmtDate(i.resolvedAt)})</span></li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}

// ── F. Source documents ────────────────────────────────────────────────────

function SourceDocuments({ active, sources, base, can }: Props & { active: Pkg | null }) {
  const src = active ? sources.byPackage.get(active.id) : undefined;
  const docHref = (id: string) => `${base}?tab=documents&section=council&doc=${id}`;
  return (
    <section className="card" aria-labelledby="pkg-f-h" data-testid="package-sources">
      <h2 id="pkg-f-h" className="text-subtitle">Source documents</h2>
      {src ? (
        <div className="mt-2 text-body">
          <p className="text-slate-700">Read from {can.intake ? <Link href={`/rota/coordinator/${src.intakeId}`}>Care Coordinator intake {src.intakeReference}</Link> : `Care Coordinator intake ${src.intakeReference}`}:</p>
          {src.documents.length ? (
            <ul className="mt-1 space-y-1">
              {src.documents.map((d) => <li key={d.name}>{d.filedDocumentId ? <Link href={docHref(d.filedDocumentId)}>{d.name}</Link> : d.name}{d.pages.length ? <span className="text-slate-500"> · page {d.pages.join(", ")}</span> : null}{d.restricted ? <> <Badge tone="violet">Restricted</Badge></> : null}</li>)}
            </ul>
          ) : <p className="text-slate-600">Facts were added by hand on the intake.</p>}
        </div>
      ) : <p className="mt-2 text-body text-slate-600">Source not recorded for this package.</p>}
      <h3 className="mt-3 text-body font-semibold text-slate-700">Commissioning documents on file</h3>
      {sources.onFile.length ? (
        <ul className="mt-1 space-y-1 text-body">
          {sources.onFile.map((d) => <li key={d.id}>{d.restricted ? <span>{d.name}</span> : <Link href={docHref(d.id)}>{d.name}</Link>}<span className="block text-meta text-slate-500">{d.categoryLabel}{d.receivedOn ? ` · received ${fmtDate(d.receivedOn)}` : ""}</span></li>)}
        </ul>
      ) : <p className="mt-1 text-body text-slate-600">None filed. <Link href={`${base}?tab=documents&section=council`}>Council documents</Link></p>}
    </section>
  );
}

// ── G. Package history ─────────────────────────────────────────────────────

const ACTION_LABEL: Record<string, string> = { "care.package.created": "Package recorded", "care.package.updated": "Package details changed", "care.package.ended": "Package ended" };

function PackageHistory({ past, history, names }: Props & { past: Pkg[] }) {
  return (
    <section className="card" aria-labelledby="pkg-g-h" data-testid="package-history">
      <h2 id="pkg-g-h" className="text-subtitle">Package history</h2>
      <h3 className="mt-2 text-body font-semibold text-slate-700">Previous packages</h3>
      {past.length ? (
        <ul className="rows">
          {past.map((x) => (
            <li key={x.id} className="py-2.5 text-body">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{x.reference?.trim() || "Reference not recorded"}</span><Badge>Ended</Badge></div>
              <div className="text-slate-600">{hoursPerWeek(x.commissionedMinutesPerWeek) ?? "Hours not recorded"} · {fmtDate(x.startDate)} to {x.endDate ? fmtDate(x.endDate) : "open-ended"} · {x.funder ? x.funder.name : "no funder linked"}</div>
              {x.requirements ? (
                <details className="mt-1"><summary className="cursor-pointer text-body text-[#1d4f91]">Requirements as recorded</summary><RequirementsText text={x.requirements} /></details>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="text-body text-slate-600">No earlier packages.</p>}
      <h3 className="mt-3 text-body font-semibold text-slate-700">Changes</h3>
      {history.length ? (
        <ol className="mt-1 space-y-2 text-body">
          {history.map((h) => {
            const d = (h.data ?? {}) as { reason?: unknown };
            return (
              <li key={h.id} className="border-l-2 border-slate-200 pl-3">
                <div className="font-medium">{ACTION_LABEL[h.action] ?? h.action}{typeof d.reason === "string" ? <span className="font-normal text-slate-600">: {d.reason}</span> : null}</div>
                <div className="text-meta text-slate-500">{names.get(h.actorId ?? "") ?? "System"} · {fmtDate(h.createdAt, true)}</div>
              </li>
            );
          })}
        </ol>
      ) : <p className="mt-1 text-body text-slate-600">No package changes recorded.</p>}
    </section>
  );
}

// ── The existing package form ──────────────────────────────────────────────

type PackageRow = { reference: string | null; commissionedMinutesPerWeek: number | null; startDate: Date; endDate: Date | null; requirements: string | null; funderId: string | null };

function PackageForm({ action, hidden, back, p, funders, canFund, submit, today }: { action: (fd: FormData) => Promise<void>; hidden: Record<string, string>; back: string; p?: PackageRow; funders: { id: string; name: string }[]; canFund: boolean; submit: string; today?: string }) {
  return (
    <form action={action} className="mt-2 space-y-2">
      <input type="hidden" name="back" value={back} />
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="grid grid-cols-2 gap-2">
        <label><span className="label">Reference</span><input name="reference" defaultValue={p?.reference ?? ""} maxLength={80} className="input" /></label>
        <label><span className="label">Hours a week</span><input name="hoursPerWeek" type="number" min="0" max="336" step="0.25" defaultValue={p?.commissionedMinutesPerWeek != null ? p.commissionedMinutesPerWeek / 60 : ""} className="input" /></label>
        <label><span className="label">Starts</span><input name="startDate" type="date" required defaultValue={p ? fromDbDate(p.startDate) : today} className="input" /></label>
        <label><span className="label">Ends (optional)</span><input name="endDate" type="date" defaultValue={p?.endDate ? fromDbDate(p.endDate) : ""} className="input" /></label>
      </div>
      <label className="block"><span className="label">What was commissioned</span><textarea name="requirements" rows={p?.requirements && isLongText(p.requirements) ? 10 : 3} maxLength={REQUIREMENTS_MAX} defaultValue={p?.requirements ?? ""} placeholder="e.g. four calls a day, two carers for hoist transfers" className="input" /></label>
      {canFund ? (
        <label className="block"><span className="label">Funder</span><select name="funderId" defaultValue={p?.funderId ?? ""} className="input"><option value="">None yet</option>{funders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
      ) : <p className="text-meta text-slate-600">Finance links the funder.</p>}
      <button className="btn-primary">{submit}</button>
    </form>
  );
}
