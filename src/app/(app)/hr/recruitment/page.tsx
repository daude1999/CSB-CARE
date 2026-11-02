import { notFound } from "next/navigation";
import { HrPageHeader } from "@/components/module-header";
import { CalendarCheck, Envelope, GearSix, MagnifyingGlass, MapPin, Phone, Plus, Rows, SquaresFour, UserCircle, X } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { AppError } from "@/lib/errors";
import { fmtLondonDate, fromDbDate, londonDate, londonTime } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { getCandidate, recruitmentBoard } from "@/server/recruitment/candidates";
import { staffChoices } from "@/server/recruitment/access";
import { dueReminders } from "@/server/recruitment/onboarding";
import { manualMoves, REMINDER_LABEL, STAGE_LABEL, PIPELINE } from "@/server/recruitment/model";
import { moveStageAction } from "@/app/recruitment-actions";
import { Empty, Flash } from "@/components/ui";
import { AutoSubmitForm } from "@/components/auto-submit";
import { R_PANEL, R_PRIMARY, R_SECONDARY, R_TD, R_TH, RtwBadge, StageBadge } from "@/components/recruitment-ui";

export const dynamic = "force-dynamic";

const STAGE_TABS = [["open", "All open"], ...PIPELINE.map((s) => [s, STAGE_LABEL[s]]), ["closed", "Closed"]] as const;

/**
 * HR & Workforce → Recruitment: one list of candidates from application to Ready for Work, the figures that say what
 * needs doing (each one counted from the candidate records and opening the matching list), upcoming interviews and the
 * recruiter's reminders. A simple pipeline view groups the same candidates by stage.
 */
export default async function RecruitmentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("hr");
  let b: Awaited<ReturnType<typeof recruitmentBoard>>;
  try {
    b = await recruitmentBoard(ctx, sp);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const a = b.access;
  const [people, reminders] = await Promise.all([staffChoices(a.organisationId), dueReminders(a.organisationId, a.branchIds)]);
  const name = new Map(people.map((p) => [p.id, p.name]));
  const branchName = new Map(a.branches.map((x) => [x.id, x.name]));
  // The board is the default (owner's approved Recruitment design); the list is one click away.
  const view = sp.view === "list" ? "list" : "pipeline";
  const f = b.filters;
  const url = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ q: f.q, stage: f.stage === "open" ? undefined : f.stage, branch: f.branch, recruiter: f.recruiter, focus: f.focus, view: view === "pipeline" ? undefined : view, candidate: undefined, ...over }).filter((e): e is [string, string] => !!e[1]));
    return `/hr/recruitment${p.size ? `?${p}` : ""}`;
  };
  const today = londonDate();
  const chosen = view === "pipeline" && sp.candidate ? await getCandidate(ctx, sp.candidate) : null;
  const boardUrl = (id?: string) => {
    const base = url({});
    return id ? `${base}${base.includes("?") ? "&" : "?"}candidate=${encodeURIComponent(id)}` : base;
  };
  const figure = (n: number, label: string, href: string, testId: string, tone = "text-[#101828]") => (
    <Link href={href} data-testid={testId} className="group flex min-w-0 items-baseline gap-1.5 rounded-[6px] px-1 text-[14px] text-[#344054] no-underline hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#c2410c]">
      <strong className={`text-[18px] font-bold tabular-nums ${tone}`}>{n}</strong>{label}
    </Link>
  );

  return (
    <div className="-mt-1">
      <HrPageHeader
        title="Recruitment"
        back="/hr/dashboard"
        subtitle="Candidates from application to their first day. A candidate is not an employee until HR starts onboarding, and is never booked on visits from here."
        actions={
          <>
            {a.canEdit ? <Link href="/hr/recruitment/new" className={R_PRIMARY}><Plus size={17} weight="bold" aria-hidden />Add Candidate</Link> : null}
            <Link href="/hr/recruitment/settings" className={R_SECONDARY}><GearSix size={17} aria-hidden />Reminders &amp; retention</Link>
          </>
        }
      />
      <Flash searchParams={sp} />

      <section aria-label="What needs doing" className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[10px] border border-[#e4e7ec] bg-white px-4 py-2.5">
        {figure(b.counts.newApplications, "new applications (7 days)", url({ focus: "new", stage: undefined, page: undefined }), "rc-new")}
        <span aria-hidden className="h-5 w-px bg-[#e4e7ec]" />
        {figure(b.counts.needsReview, "need review", url({ focus: "review", stage: undefined, page: undefined }), "rc-review", "text-[#b54708]")}
        <span aria-hidden className="h-5 w-px bg-[#e4e7ec]" />
        {figure(b.counts.upcomingInterviews, "interviews in the next 14 days", "#interviews", "rc-interviews")}
        <span aria-hidden className="h-5 w-px bg-[#e4e7ec]" />
        {figure(b.counts.offersAwaiting, "offers awaiting an answer", url({ focus: "offers", stage: undefined, page: undefined }), "rc-offers")}
        <span aria-hidden className="h-5 w-px bg-[#e4e7ec]" />
        {figure(b.counts.onboarding, "onboarding", url({ stage: "ONBOARDING", focus: undefined, page: undefined }), "rc-onboarding", "text-[#067647]")}
        <span aria-hidden className="h-5 w-px bg-[#e4e7ec]" />
        {figure(b.counts.readyForAction, "ready for your next step", url({ focus: "ready", stage: undefined, page: undefined }), "rc-ready", "text-[#c2410c]")}
      </section>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Candidates" className={R_PANEL}>
          <nav aria-label="Stage" className="flex gap-1 overflow-x-auto border-b border-[#eaecf0] px-2">
            {STAGE_TABS.map(([k, label]) => {
              const active = f.stage === k && !f.focus;
              const n = k === "open" ? b.pipeline.reduce((s, x) => s + x.count, 0) : b.pipeline.find((x) => x.stage === k)?.count;
              return (
                <Link key={k} href={url({ stage: k === "open" ? undefined : k, focus: undefined, page: undefined })} aria-current={active ? "page" : undefined} className={`-mb-px inline-flex shrink-0 items-center gap-1.5 border-b-[3px] px-3 py-2.5 text-[14.5px] no-underline ${active ? "border-[#c2410c] font-semibold text-[#9a3412]" : "border-transparent font-medium text-[#475467] hover:text-[#101828]"}`}>
                  {label}{n !== undefined ? <span className="rounded-full bg-[#f2f4f7] px-1.5 text-[12px] font-semibold tabular-nums text-[#344054]">{n}</span> : null}
                </Link>
              );
            })}
          </nav>
          <div className="flex flex-wrap items-center gap-2.5 px-3.5 py-3">
            <AutoSubmitForm label="Filters" className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
              {f.stage !== "open" ? <input type="hidden" name="stage" value={f.stage} /> : null}
              {f.focus ? <input type="hidden" name="focus" value={f.focus} /> : null}
              {view !== "pipeline" ? <input type="hidden" name="view" value={view} /> : null}
              <label className="relative min-w-[200px] flex-1">
                <span className="sr-only">Search candidates</span>
                <MagnifyingGlass size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#667085]" />
                <input type="search" name="q" defaultValue={f.q ?? ""} placeholder="Search name, reference or role…" className="h-10 w-full rounded-[8px] border border-[#d0d5dd] bg-white pl-9 pr-2 text-[14px]" />
              </label>
              {a.branches.length > 1 ? (
                <label><span className="sr-only">Branch</span><select name="branch" defaultValue={f.branch ?? ""} className="h-10 rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14px]"><option value="">All my branches</option>{a.branches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              ) : null}
              <label><span className="sr-only">Recruiter</span><select name="recruiter" defaultValue={f.recruiter ?? ""} className="h-10 rounded-[8px] border border-[#d0d5dd] bg-white px-3 text-[14px]"><option value="">Any recruiter</option>{people.filter((p) => p.hr).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            </AutoSubmitForm>
            <div role="group" aria-label="View" className="flex rounded-[8px] border border-[#d0d5dd] bg-white p-0.5">
              <Link href={url({ view: undefined, page: undefined })} aria-current={view === "pipeline" ? "page" : undefined} className={`inline-flex h-9 items-center gap-1.5 rounded-[6px] px-3 text-[14px] font-semibold no-underline ${view === "pipeline" ? "bg-[#fff1e6] text-[#9a3412]" : "text-[#475467]"}`}><SquaresFour size={16} aria-hidden />Board</Link>
              <Link href={url({ view: "list" })} aria-current={view === "list" ? "page" : undefined} className={`inline-flex h-9 items-center gap-1.5 rounded-[6px] px-3 text-[14px] font-semibold no-underline ${view === "list" ? "bg-[#fff1e6] text-[#9a3412]" : "text-[#475467]"}`}><Rows size={16} aria-hidden />List</Link>
            </div>
          </div>
          {f.focus ? (
            <p className="mx-3.5 mb-3 flex flex-wrap items-center gap-2 rounded-[8px] bg-[#fff1e6] px-3 py-2 text-[14px] text-[#7c2d12]">
              Showing {f.focus === "new" ? "applications received in the last 7 days" : f.focus === "review" ? "candidates waiting for someone to review them" : f.focus === "offers" ? "offers waiting for the candidate's answer" : "candidates whose next step is yours, not the candidate's"}.
              <Link href={url({ focus: undefined, page: undefined })} className="font-semibold text-[#9a3412]">Show all</Link>
            </p>
          ) : null}

          {view === "pipeline" ? (
            <div className="overflow-x-auto border-t border-[#eaecf0]">
              <div className="grid min-w-[1080px] grid-cols-6 gap-2.5 p-3" data-testid="pipeline">
                {b.byStage.map((col) => (
                  <section key={col.stage} aria-label={col.label} className={`min-w-0 rounded-[8px] border p-2 ${col.stage === "READY" ? "border-[#bfe5cc] bg-[#f3fbf6]" : "border-[#eaecf0] bg-[#f9fafb]"}`}>
                    <h3 className="mb-2 flex items-center justify-between px-1 text-[15px] font-bold text-[#101828]">{col.label}<span className="rounded-full bg-white px-2 text-[12.5px] tabular-nums text-[#344054] ring-1 ring-[#eaecf0]">{col.items.length}</span></h3>
                    {col.items.length ? (
                      <ul className="space-y-2">
                        {col.items.map((c) => {
                          const on = chosen?.candidate.id === c.id;
                          return (
                            <li key={c.id}>
                              <Link href={boardUrl(c.id)} aria-current={on ? "true" : undefined} className={`block rounded-[8px] border bg-white px-2.5 py-2 no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#c2410c] ${on ? "border-[#c2410c] ring-2 ring-[#fed7aa]" : "border-[#e4e7ec] hover:border-[#f9b98a]"}`}>
                                <span className="block truncate text-[14px] font-semibold text-[#101828]">{c.firstName} {c.lastName}</span>
                                <span className="block truncate text-[12.5px] text-[#475467]">{c.roleApplied}</span>
                                <span className="mt-1 flex items-center gap-1 truncate text-[12.5px] text-[#475467]"><MapPin size={13} aria-hidden />{branchName.get(c.branchId) ?? "—"}</span>
                                {c.source ? <span className="block truncate text-[12px] text-[#667085]">Source: {c.source}</span> : null}
                                <span className="mt-1.5 block rounded-[6px] bg-[#f2f4f7] px-1.5 py-1 text-[12px] leading-4 text-[#344054]"><strong>Next:</strong> {c.next}</span>
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    ) : <p className="px-1 py-2 text-[13px] text-[#667085]">Nobody at this stage.</p>}
                  </section>
                ))}
              </div>
            </div>
          ) : b.rows.length ? (
            <div className="relative min-w-0 overflow-x-auto border-t border-[#eaecf0]">
              <table className="w-full border-collapse text-[14px]">
                <caption className="sr-only">Candidates</caption>
                <thead className="bg-[#f9fafb]">
                  <tr className="border-b border-[#eaecf0]">
                    <th scope="col" className={R_TH}>Candidate</th>
                    <th scope="col" className={R_TH}>Role and branch</th>
                    <th scope="col" className={R_TH}>Stage</th>
                    <th scope="col" className={R_TH}>Right to work</th>
                    <th scope="col" className={R_TH}>Recruiter</th>
                    <th scope="col" className={R_TH}>Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((c) => (
                    <tr key={c.id} className="border-b border-[#f2f4f7] last:border-0 hover:bg-[#fffaf5]">
                      <td className={R_TD}>
                        <Link href={`/hr/recruitment/${c.id}`} className="inline-flex items-center gap-1.5 font-semibold text-[#9a3412] underline decoration-[#f9b98a] underline-offset-2 hover:decoration-[#9a3412]"><UserCircle size={18} aria-hidden />{c.firstName} {c.lastName}</Link>
                        <span className="block text-[12.5px] text-[#667085]">{c.reference}{!c.applicationComplete ? " · application incomplete" : ""}</span>
                      </td>
                      <td className={R_TD}><span className="block max-w-[220px] truncate" title={c.roleApplied}>{c.roleApplied}</span><span className="block text-[12.5px] text-[#667085]">{branchName.get(c.branchId) ?? "—"}</span></td>
                      <td className={R_TD}><StageBadge stage={c.stage} /><span className="mt-0.5 block text-[12px] text-[#667085]">since {fmtLondonDate(londonDate(c.stageChangedAt), { day: "numeric", month: "short" })}</span></td>
                      <td className={R_TD}><RtwBadge status={c.rightToWork} /></td>
                      <td className={`${R_TD} whitespace-nowrap`}>{c.recruiterId ? name.get(c.recruiterId) ?? "Former member" : <span className="text-[#98a2b3]">Not assigned</span>}</td>
                      <td className={R_TD}>
                        <span className={`block max-w-[260px] ${c.waiting ? "text-[#475467]" : "font-semibold text-[#101828]"}`}>{c.next}</span>
                        {c.nextActionDue ? <span className={`block text-[12.5px] tabular-nums ${fromDbDate(c.nextActionDue) < today ? "font-semibold text-[#b42318]" : "text-[#667085]"}`}>by {fmtLondonDate(fromDbDate(c.nextActionDue), { day: "numeric", month: "short" })}</span> : c.waiting ? <span className="block text-[12.5px] text-[#667085]">Waiting on the candidate</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="border-t border-[#eaecf0] p-4"><Empty>{f.q || f.focus || f.branch || f.recruiter ? "No candidates match these filters." : f.stage === "open" ? "No open applications. Add a candidate to start." : `No candidates at ${f.stage === "closed" ? "a closed stage" : STAGE_LABEL[f.stage as keyof typeof STAGE_LABEL]}.`}</Empty></div>
          )}
          {view === "list" && b.total ? (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#eaecf0] px-3.5 py-2.5 text-[13.5px] text-[#475467]">
              <span data-testid="rc-count">Showing {(b.page - 1) * 25 + 1} to {Math.min(b.page * 25, b.total)} of {b.total} candidate{b.total === 1 ? "" : "s"}</span>
              {b.pages > 1 ? (
                <span className="flex gap-2">
                  {b.page > 1 ? <Link href={url({ page: String(b.page - 1) })} className={R_SECONDARY}>Previous</Link> : null}
                  {b.page < b.pages ? <Link href={url({ page: String(b.page + 1) })} className={R_SECONDARY}>Next</Link> : null}
                </span>
              ) : null}
            </div>
          ) : null}
        </section>

        {chosen ? (
          <aside aria-labelledby="cand-h" className={`${R_PANEL} xl:sticky xl:top-3`} data-testid="candidate-drawer">
            <div className="flex items-center gap-2 border-b border-[#eaecf0] px-4 py-3">
              <UserCircle size={20} aria-hidden className="text-[#c2410c]" />
              <h2 id="cand-h" className="mr-auto text-[16px] font-bold">Candidate details</h2>
              <Link href={boardUrl()} aria-label="Close candidate details" className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-[#475467] hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#c2410c]"><X size={18} aria-hidden /></Link>
            </div>
            <div className="flex items-center gap-3 px-4 py-3">
              <span aria-hidden className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#fff1e6] text-[16px] font-bold text-[#9a3412]">{chosen.candidate.firstName[0]}{chosen.candidate.lastName[0]}</span>
              <div className="min-w-0">
                <p className="truncate text-[17px] font-bold text-[#101828]">{chosen.candidate.firstName} {chosen.candidate.lastName}</p>
                <p className="truncate text-[13.5px] text-[#475467]">{chosen.candidate.roleApplied} · {branchName.get(chosen.candidate.branchId) ?? "—"}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2"><StageBadge stage={chosen.candidate.stage} /><span className="text-[12.5px] text-[#667085]">{chosen.candidate.reference}</span></p>
              </div>
            </div>
            <dl className="grid gap-1.5 border-t border-[#f2f4f7] px-4 py-3 text-[13.5px]">
              <div className="flex items-center gap-2"><dt className="sr-only">Phone</dt><Phone size={15} aria-hidden className="text-[#667085]" /><dd>{chosen.candidate.phone ?? "Phone not recorded"}</dd></div>
              <div className="flex items-center gap-2"><dt className="sr-only">Email</dt><Envelope size={15} aria-hidden className="text-[#667085]" /><dd className="truncate">{chosen.candidate.email ?? "Email not recorded"}</dd></div>
              <div className="flex items-center gap-2"><dt className="text-[#667085]">Source:</dt><dd>{chosen.candidate.source ?? "Not recorded"}</dd></div>
              <div className="flex items-center gap-2"><dt className="text-[#667085]">Right to work:</dt><dd><RtwBadge status={chosen.candidate.rightToWork} /></dd></div>
              <div className="flex items-center gap-2"><dt className="text-[#667085]">Recruiter:</dt><dd>{chosen.candidate.recruiterId ? name.get(chosen.candidate.recruiterId) ?? "Former member" : "Not assigned"}</dd></div>
            </dl>
            {(() => {
              const upcoming = chosen.candidate.interviews.filter((i) => i.startsAt > new Date() && i.status !== "CANCELLED").sort((x, y) => +x.startsAt - +y.startsAt)[0];
              return upcoming ? (
                <p className="mx-4 mb-3 flex items-center gap-2 rounded-[8px] border border-[#eaecf0] px-3 py-2 text-[13.5px]"><CalendarCheck size={18} aria-hidden className="text-[#c2410c]" /><span><strong className="block">Interview</strong>{fmtLondonDate(londonDate(upcoming.startsAt), { weekday: "short", day: "numeric", month: "short" })} at {londonTime(upcoming.startsAt)}</span></p>
              ) : null;
            })()}
            <div className="border-t border-[#f2f4f7] px-4 py-3">
              <p className="text-[12.5px] font-semibold uppercase tracking-[0.02em] text-[#667085]">Next step</p>
              <p className="text-[15px] font-semibold text-[#101828]">{chosen.next}</p>
              {chosen.candidate.outstandingDocuments.length ? (
                <>
                  <p className="mt-2.5 text-[12.5px] font-semibold uppercase tracking-[0.02em] text-[#667085]">Documents still needed</p>
                  <ul className="mt-1 list-disc pl-5 text-[13.5px] text-[#344054]">{chosen.candidate.outstandingDocuments.map((d) => <li key={d}>{d}</li>)}</ul>
                </>
              ) : null}
            </div>
            <div className="grid gap-2 border-t border-[#eaecf0] p-3">
              <Link href={`/hr/recruitment/${chosen.candidate.id}`} className={R_PRIMARY}>Open full record</Link>
              {a.canEdit && manualMoves(chosen.candidate.stage).length ? (
                <form action={moveStageAction} className="flex flex-wrap items-center gap-1.5 text-[13px]" aria-label="Move stage">
                  <input type="hidden" name="back" value={boardUrl(chosen.candidate.id)} />
                  <input type="hidden" name="candidateId" value={chosen.candidate.id} />
                  <input type="hidden" name="lockVersion" value={chosen.candidate.lockVersion} />
                  <span className="w-full text-[#475467]">Move to another stage:</span>
                  {manualMoves(chosen.candidate.stage).map((st) => <button key={st} name="to" value={st} className="rounded-[6px] border border-[#d0d5dd] px-2.5 py-1 font-semibold text-[#344054] hover:bg-slate-50">{STAGE_LABEL[st]}</button>)}
                </form>
              ) : null}
              <p className="text-[12px] text-[#667085]">Screening, interviews, offers and onboarding are recorded on the full record, where each step&apos;s checks apply.</p>
            </div>
          </aside>
        ) : (
        <aside className="space-y-3" aria-label="Interviews and reminders">
          <section id="interviews" aria-labelledby="int-h" className={R_PANEL}>
            <h2 id="int-h" className="flex items-center gap-2 border-b border-[#eaecf0] px-4 py-3 text-[16px] font-bold"><CalendarCheck size={20} aria-hidden className="text-[#c2410c]" />Upcoming interviews</h2>
            {b.interviews.length ? (
              <ul className="divide-y divide-[#f2f4f7]">
                {b.interviews.slice(0, 8).map((i) => (
                  <li key={i.id} className="px-4 py-2.5 text-[14px]">
                    <Link href={`/hr/recruitment/${i.candidate.id}`} className="font-semibold text-[#101828] no-underline hover:underline">{i.candidate.firstName} {i.candidate.lastName}</Link>
                    <span className="block text-[13px] text-[#475467]">{fmtLondonDate(londonDate(i.startsAt), { weekday: "short", day: "numeric", month: "short" })} at <span className="tabular-nums">{londonTime(i.startsAt)}</span> · {name.get(i.interviewerId) ?? "Former member"}</span>
                    <span className={`text-[12.5px] font-semibold ${i.status === "CONFIRMED" ? "text-[#067647]" : "text-[#b54708]"}`}>{i.status === "CONFIRMED" ? "Confirmed by the candidate" : "Not confirmed yet"}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 py-3 text-[14px] text-[#667085]">No interviews booked in the next 14 days.</p>}
          </section>

          <section aria-labelledby="rem-h" className={R_PANEL}>
            <h2 id="rem-h" className="border-b border-[#eaecf0] px-4 py-3 text-[16px] font-bold">Reminders <span className="text-[13px] font-medium text-[#667085]">(in the app only)</span></h2>
            {reminders.length ? (
              <ul className="divide-y divide-[#f2f4f7]" data-testid="rc-reminders">
                {reminders.slice(0, 10).map((r) => (
                  <li key={r.key} className="px-4 py-2.5 text-[14px]">
                    <span className="block text-[12.5px] font-semibold uppercase tracking-[0.02em] text-[#b54708]">{REMINDER_LABEL[r.kind]}</span>
                    <Link href={`/hr/recruitment/${r.candidateId}`} className="font-semibold text-[#101828] no-underline hover:underline">{r.name}</Link> <span className="text-[13px] text-[#667085]">{r.reference}</span>
                    <span className="block text-[13px] text-[#475467]">{r.text}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 py-3 text-[14px] text-[#667085]">Nothing due today.</p>}
            <p className="border-t border-[#eaecf0] px-4 py-2.5 text-[12.5px] text-[#667085]">Reminders go to the candidate&apos;s recruiter in the platform. No emails or texts are sent to candidates: email, text and job-board connections are not set up.</p>
          </section>

          {b.erasable && a.canErase ? (
            <p className="rounded-[10px] border border-[#fedf89] bg-[#fffaeb] px-4 py-3 text-[13.5px] text-[#7a2e0e]"><strong>{b.erasable}</strong> closed application{b.erasable === 1 ? " is" : "s are"} past {b.erasable === 1 ? "its" : "their"} retention date. <Link href={url({ stage: "closed", focus: undefined })} className="font-semibold">Review closed applications</Link> to remove personal details.</p>
          ) : null}
        </aside>
        )}
      </div>
    </div>
  );
}
