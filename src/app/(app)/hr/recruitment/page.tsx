import { notFound } from "next/navigation";
import { CalendarBlank, CalendarCheck, DotsThree, Envelope, GearSix, ListChecks, MagnifyingGlass, Phone, Plus, Rows, SquaresFour, Warning, X } from "@phosphor-icons/react/dist/ssr";
import Link from "@/components/link";
import { AppError } from "@/lib/errors";
import { fmtLondonDate, fromDbDate, londonDate, londonTime } from "@/lib/london";
import { requirePortal } from "@/server/auth/portals";
import { getCandidate, recruitmentBoard } from "@/server/recruitment/candidates";
import { staffChoices } from "@/server/recruitment/access";
import { dueReminders } from "@/server/recruitment/onboarding";
import { manualMoves, REMINDER_LABEL, STAGE_LABEL } from "@/server/recruitment/model";
import { moveStageAction } from "@/app/recruitment-actions";
import { Flash } from "@/components/ui";
import { AutoSubmitForm } from "@/components/auto-submit";
import { RtwBadge, StageBadge } from "@/components/recruitment-ui";
import { HrAvatar, HrEmpty, HrHeading, HX_PRIMARY, HX_SECONDARY } from "@/components/hr-ui";

export const dynamic = "force-dynamic";

/** "Show" choices: the open pipeline, the figures that used to sit above it, and closed applications. */
const SHOW = [
  ["", "All open applicants"],
  ["new", "Applied in the last 7 days"],
  ["review", "Waiting for a review"],
  ["offers", "Offers awaiting an answer"],
  ["ready", "Next step is ours"],
  ["closed", "Closed (withdrawn or unsuccessful)"],
] as const;

/**
 * HR & Workforce → Recruitment (owner's approved HR concept, 2 Nov 2026): one pipeline board of every open applicant
 * by stage, with search and role, branch and recruiter filters. A card opens the applicant's record; its menu also
 * opens the quick panel, where a stage can be changed through the same validated move as before. All six real stages
 * are shown (the concept's four plus Onboarding and Ready for Work); closed applications are under "Show".
 */
export default async function RecruitmentPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requirePortal("hr");
  const show = SHOW.some(([k]) => k === sp.show) ? sp.show ?? "" : "";
  const query = { ...sp, ...(show === "closed" ? { stage: "closed", focus: undefined } : show ? { focus: show } : {}) };
  let b: Awaited<ReturnType<typeof recruitmentBoard>>;
  try {
    b = await recruitmentBoard(ctx, query);
  } catch (e) {
    if (e instanceof AppError) notFound();
    throw e;
  }
  const a = b.access;
  const [people, reminders] = await Promise.all([staffChoices(a.organisationId), dueReminders(a.organisationId, a.branchIds)]);
  const name = new Map(people.map((p) => [p.id, p.name]));
  const branchName = new Map(a.branches.map((x) => [x.id, x.name]));
  const f = b.filters;
  // Closed applications and single-stage links (from older bookmarks) are lists; everything else opens on the board.
  const view = sp.view === "list" || f.stage !== "open" ? "list" : "pipeline";
  const showValue = f.stage === "closed" ? "closed" : f.focus ?? "";
  const url = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams(
      Object.entries({ q: f.q, role: f.role, branch: f.branch, recruiter: f.recruiter, show: showValue || undefined, stage: f.stage !== "open" && f.stage !== "closed" ? f.stage : undefined, view: sp.view === "list" ? "list" : undefined, candidate: undefined, ...over }).filter((e): e is [string, string] => !!e[1]),
    );
    return `/hr/recruitment${p.size ? `?${p}` : ""}`;
  };
  const today = londonDate();
  const now = new Date();
  const chosen = view === "pipeline" && sp.candidate ? await getCandidate(ctx, sp.candidate).catch(() => null) : null;
  const boardUrl = (id?: string) => {
    const base = url({});
    return id ? `${base}${base.includes("?") ? "&" : "?"}candidate=${encodeURIComponent(id)}` : base;
  };
  const filtered = Boolean(f.q || f.role || f.branch || f.recruiter || f.focus);
  const shortDate = (d: string) => fmtLondonDate(d, { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="hr-ui hx-page" data-testid="hr-recruitment">
      <HrHeading
        title="Recruitment"
        actions={
          <>
            <Link href="/hr/recruitment/settings" className={HX_SECONDARY}><GearSix size={16} aria-hidden />Reminders &amp; retention</Link>
            {a.canEdit ? <Link href="/hr/recruitment/new" className={HX_PRIMARY}><Plus size={16} weight="bold" aria-hidden />Add applicant</Link> : null}
          </>
        }
      />
      <Flash searchParams={sp} />

      <div className={chosen ? "grid grid-cols-1 items-start gap-[14px] xl:grid-cols-[minmax(0,1fr)_340px]" : ""}>
        <section className="hx-card" aria-label="Applicants">
          <div className="hx-toolbar">
            <AutoSubmitForm label="Filters" className="contents">
              {f.stage !== "open" && f.stage !== "closed" ? <input type="hidden" name="stage" value={f.stage} /> : null}
              {sp.view === "list" ? <input type="hidden" name="view" value="list" /> : null}
              <label className="hx-search">
                <span className="sr-only">Search applicants</span>
                <MagnifyingGlass size={17} aria-hidden />
                <input type="search" name="q" defaultValue={f.q ?? ""} placeholder="Search applicants…" className="hx-input" />
              </label>
              <label className="hx-field is-filter">
                <span>Role</span>
                <select name="role" defaultValue={f.role ?? ""} className="hx-select">
                  <option value="">All roles</option>
                  {b.roles.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              {a.branches.length > 1 ? (
                <label className="hx-field is-filter">
                  <span>Branch</span>
                  <select name="branch" defaultValue={f.branch ?? ""} className="hx-select"><option value="">All my branches</option>{a.branches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
                </label>
              ) : null}
              <label className="hx-field is-filter">
                <span>Recruiter</span>
                <select name="recruiter" defaultValue={f.recruiter ?? ""} className="hx-select"><option value="">Anyone</option>{people.filter((p) => p.hr).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              </label>
              <label className="hx-field is-filter">
                <span>Show</span>
                <select name="show" defaultValue={showValue} className="hx-select">{SHOW.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
            </AutoSubmitForm>
            <div className="hx-toolbar-end">
              <nav className="hx-seg" aria-label="View">
                <Link href={url({ view: undefined, page: undefined, show: showValue === "closed" ? undefined : showValue || undefined, stage: undefined })} aria-current={view === "pipeline" ? "page" : undefined}><SquaresFour size={16} aria-hidden />Board</Link>
                <Link href={url({ view: "list" })} aria-current={view === "list" ? "page" : undefined}><Rows size={16} aria-hidden />List</Link>
              </nav>
            </div>
          </div>
          {f.stage !== "open" && f.stage !== "closed" ? (
            <p className="hx-chip" role="status">Showing applicants at {STAGE_LABEL[f.stage as keyof typeof STAGE_LABEL]} only. <Link href={url({ stage: undefined })} className="hx-link">Show all stages</Link></p>
          ) : null}

          {view === "pipeline" ? (
            <>
              <div className="hx-board-wrap">
                <div className="hx-board" data-testid="pipeline" style={{ ["--cols" as string]: b.byStage.length }}>
                  {b.byStage.map((col) => (
                    <section key={col.stage} aria-labelledby={`col-${col.stage}`} className="hx-col">
                      <h2 className="hx-col-head" id={`col-${col.stage}`}>{col.label}<span className="hx-col-count"><span className="sr-only">, </span>{col.count}<span className="sr-only"> applicants</span></span></h2>
                      {col.items.length ? (
                        <ul className="hx-col-list">
                          {col.items.map((c) => {
                            const full = `${c.firstName} ${c.lastName}`;
                            const interview = c.interviews.filter((i) => i.startsAt > now && (i.status === "AWAITING_CONFIRMATION" || i.status === "CONFIRMED")).sort((x, y) => +x.startsAt - +y.startsAt)[0];
                            const due = c.nextActionDue ? fromDbDate(c.nextActionDue) : null;
                            const overdue = !interview && due !== null && due < today;
                            const when = interview
                              ? { text: `${shortDate(londonDate(interview.startsAt))}, ${londonTime(interview.startsAt)}`, cls: londonDate(interview.startsAt) === today ? "is-today" : "", label: "Interview" }
                              : due
                                ? { text: due === today ? "Today" : overdue ? `Overdue · ${shortDate(due)}` : shortDate(due), cls: overdue ? "is-bad" : due === today ? "is-today" : "", label: "Due" }
                                : null;
                            return (
                              <li key={c.id} className={`hx-applicant ${chosen?.candidate.id === c.id ? "is-on" : ""}`} data-testid="applicant-card">
                                <div className="hx-applicant-top">
                                  <HrAvatar name={full} size="sm" />
                                  <span className="min-w-0">
                                    <Link href={`/hr/recruitment/${c.id}`} className="hx-applicant-name">{full}</Link>
                                    <span className="hx-applicant-role">{c.roleApplied}{a.branches.length > 1 ? ` · ${branchName.get(c.branchId) ?? ""}` : ""}</span>
                                  </span>
                                </div>
                                <details className="hx-menu">
                                  <summary className="hx-icon-btn" aria-label={`Actions for ${full}`}><DotsThree size={20} weight="bold" aria-hidden /></summary>
                                  <ul className="hx-menu-list">
                                    <li><Link href={`/hr/recruitment/${c.id}`}>Open record</Link></li>
                                    <li><Link href={boardUrl(c.id)}>{a.canEdit && manualMoves(c.stage).length ? "Quick view and move stage" : "Quick view"}</Link></li>
                                  </ul>
                                </details>
                                <div className="hx-applicant-next">
                                  {interview ? <CalendarBlank size={16} aria-hidden /> : <ListChecks size={16} aria-hidden />}
                                  <span className="min-w-0">
                                    <span className="sr-only">Next step: </span>{interview ? `Interview${interview.location ? ` (${interview.location})` : ""}` : c.next}
                                    {when ? (
                                      <span className={`hx-applicant-when ${when.cls}`} style={{ display: "flex" }}>
                                        {overdue ? <Warning size={13} weight="fill" aria-hidden /> : <CalendarBlank size={13} aria-hidden />}
                                        <span><span className="sr-only">{when.label}: </span>{when.text}</span>
                                      </span>
                                    ) : null}
                                  </span>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      ) : <p className="hx-col-empty">{filtered ? "No one here matches." : "No one at this stage."}</p>}
                      {col.count > col.items.length ? <p className="hx-col-empty">{col.count - col.items.length} more: use the list or filters.</p> : null}
                    </section>
                  ))}
                </div>
              </div>
              <p className="hx-board-note">Stages change on the applicant&apos;s record (or the quick view), where each step&apos;s checks apply. Onboarding creates or links one HR employee record.</p>
            </>
          ) : b.rows.length ? (
            <div className="hx-table-wrap">
              <table className="hx-table">
                <caption className="sr-only">Applicants</caption>
                <thead>
                  <tr>
                    <th scope="col">Applicant</th>
                    <th scope="col">Role and branch</th>
                    <th scope="col">Stage</th>
                    <th scope="col">Right to work</th>
                    <th scope="col">Recruiter</th>
                    <th scope="col">Next step</th>
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <Link href={`/hr/recruitment/${c.id}`} className="hx-person"><HrAvatar name={`${c.firstName} ${c.lastName}`} size="sm" /><span>{c.firstName} {c.lastName}</span></Link>
                        <span className="block text-[12.5px] text-[#5d6676]">{c.reference}{!c.applicationComplete ? " · application incomplete" : ""}</span>
                      </td>
                      <td><span className="block max-w-[220px] truncate" title={c.roleApplied}>{c.roleApplied}</span><span className="block text-[12.5px] text-[#5d6676]">{branchName.get(c.branchId) ?? "—"}</span></td>
                      <td><StageBadge stage={c.stage} /><span className="mt-0.5 block text-[12px] text-[#5d6676]">since {fmtLondonDate(londonDate(c.stageChangedAt), { day: "numeric", month: "short" })}</span></td>
                      <td><RtwBadge status={c.rightToWork} /></td>
                      <td className="whitespace-nowrap">{c.recruiterId ? name.get(c.recruiterId) ?? "Former member" : <span className="text-[#8a93a3]">Not assigned</span>}</td>
                      <td>
                        <span className={`block max-w-[260px] ${c.waiting ? "" : "font-semibold text-[#161b26]"}`}>{c.next}</span>
                        {c.nextActionDue ? <span className={`block text-[12.5px] tabular-nums ${fromDbDate(c.nextActionDue) < today ? "font-semibold text-[#b42318]" : "text-[#5d6676]"}`}>{fromDbDate(c.nextActionDue) < today ? "Overdue: " : "By "}{fmtLondonDate(fromDbDate(c.nextActionDue), { day: "numeric", month: "short" })}</span> : c.waiting ? <span className="block text-[12.5px] text-[#5d6676]">Waiting on the applicant</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <HrEmpty title={filtered ? "No applicants match these filters" : f.stage === "closed" ? "No closed applications" : "No open applications"}>
              {filtered ? "Try another search or clear a filter." : f.stage === "closed" ? "Withdrawn and unsuccessful applications appear here." : a.canEdit ? "Add an applicant to start." : "Applications appear here when they are added."}
            </HrEmpty>
          )}
          {view === "list" && b.total ? (
            <div className="hx-pager">
              <span data-testid="rc-count">Showing {(b.page - 1) * 25 + 1} to {Math.min(b.page * 25, b.total)} of {b.total} applicant{b.total === 1 ? "" : "s"}</span>
              {b.pages > 1 ? (
                <div>
                  {b.page > 1 ? <Link href={url({ page: String(b.page - 1) })} className={`${HX_SECONDARY} hx-btn--sm`}>Previous</Link> : null}
                  {b.page < b.pages ? <Link href={url({ page: String(b.page + 1) })} className={`${HX_SECONDARY} hx-btn--sm`}>Next</Link> : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        {chosen ? (
          <aside aria-labelledby="cand-h" className="hx-card xl:sticky xl:top-3" data-testid="candidate-drawer">
            <div className="hx-card-head" style={{ borderBottom: "1px solid var(--hx-divider)" }}>
              <h2 id="cand-h" className="hx-card-title">Applicant</h2>
              <Link href={boardUrl()} aria-label="Close applicant details" className="hx-icon-btn"><X size={18} aria-hidden /></Link>
            </div>
            <div className="flex items-center gap-3 px-[18px] py-3">
              <HrAvatar name={`${chosen.candidate.firstName} ${chosen.candidate.lastName}`} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-[16px] font-semibold text-[#161b26]">{chosen.candidate.firstName} {chosen.candidate.lastName}</p>
                <p className="truncate text-[13.5px] text-[#5d6676]">{chosen.candidate.roleApplied} · {branchName.get(chosen.candidate.branchId) ?? "—"}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2"><StageBadge stage={chosen.candidate.stage} /><span className="text-[12.5px] text-[#5d6676]">{chosen.candidate.reference}</span></p>
              </div>
            </div>
            <dl className="grid gap-1.5 border-t border-[#eef0f3] px-[18px] py-3 text-[13.5px]">
              <div className="flex items-center gap-2"><dt className="sr-only">Phone</dt><Phone size={15} aria-hidden className="text-[#5d6676]" /><dd>{chosen.candidate.phone ?? "Phone not recorded"}</dd></div>
              <div className="flex items-center gap-2"><dt className="sr-only">Email</dt><Envelope size={15} aria-hidden className="text-[#5d6676]" /><dd className="truncate">{chosen.candidate.email ?? "Email not recorded"}</dd></div>
              <div className="flex items-center gap-2"><dt className="text-[#5d6676]">Source:</dt><dd>{chosen.candidate.source ?? "Not recorded"}</dd></div>
              <div className="flex items-center gap-2"><dt className="text-[#5d6676]">Right to work:</dt><dd><RtwBadge status={chosen.candidate.rightToWork} /></dd></div>
              <div className="flex items-center gap-2"><dt className="text-[#5d6676]">Recruiter:</dt><dd>{chosen.candidate.recruiterId ? name.get(chosen.candidate.recruiterId) ?? "Former member" : "Not assigned"}</dd></div>
            </dl>
            {(() => {
              const upcoming = chosen.candidate.interviews.filter((i) => i.startsAt > now && i.status !== "CANCELLED").sort((x, y) => +x.startsAt - +y.startsAt)[0];
              return upcoming ? (
                <p className="mx-[18px] mb-3 flex items-center gap-2 rounded-[8px] border border-[#e6e8ec] px-3 py-2 text-[13.5px]"><CalendarCheck size={18} aria-hidden className="text-[#c2410c]" /><span><strong className="block">Interview</strong>{fmtLondonDate(londonDate(upcoming.startsAt), { weekday: "short", day: "numeric", month: "short" })} at {londonTime(upcoming.startsAt)}</span></p>
              ) : null;
            })()}
            <div className="border-t border-[#eef0f3] px-[18px] py-3">
              <p className="text-[12.5px] font-semibold text-[#5d6676]">Next step</p>
              <p className="text-[15px] font-semibold text-[#161b26]">{chosen.next}</p>
              {chosen.candidate.outstandingDocuments.length ? (
                <>
                  <p className="mt-2.5 text-[12.5px] font-semibold text-[#5d6676]">Documents still needed</p>
                  <ul className="mt-1 list-disc pl-5 text-[13.5px] text-[#344054]">{chosen.candidate.outstandingDocuments.map((d) => <li key={d}>{d}</li>)}</ul>
                </>
              ) : null}
            </div>
            <div className="grid gap-2 border-t border-[#eef0f3] p-[14px]">
              <Link href={`/hr/recruitment/${chosen.candidate.id}`} className={HX_PRIMARY}>Open full record</Link>
              {a.canEdit && manualMoves(chosen.candidate.stage).length ? (
                <form action={moveStageAction} className="flex flex-wrap items-center gap-1.5 text-[13px]" aria-label="Move stage">
                  <input type="hidden" name="back" value={boardUrl(chosen.candidate.id)} />
                  <input type="hidden" name="candidateId" value={chosen.candidate.id} />
                  <input type="hidden" name="lockVersion" value={chosen.candidate.lockVersion} />
                  <span className="w-full text-[#5d6676]">Move to another stage:</span>
                  {manualMoves(chosen.candidate.stage).map((st) => <button key={st} name="to" value={st} className={`${HX_SECONDARY} hx-btn--sm`}>{STAGE_LABEL[st]}</button>)}
                </form>
              ) : null}
              <p className="text-[12px] text-[#5d6676]">Screening, interviews, offers and onboarding are recorded on the full record, where each step&apos;s checks apply.</p>
            </div>
          </aside>
        ) : null}
      </div>

      <div className="hx-two">
        <section id="interviews" aria-labelledby="int-h" className="hx-card">
          <div className="hx-card-head"><h2 id="int-h" className="hx-card-title">Upcoming interviews</h2></div>
          {b.interviews.length ? (
            <ul className="hx-list">
              {b.interviews.slice(0, 8).map((i) => (
                <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0">
                    <Link href={`/hr/recruitment/${i.candidate.id}`} className="font-semibold text-[#161b26] no-underline hover:underline">{i.candidate.firstName} {i.candidate.lastName}</Link>
                    <span className="block text-[13px] text-[#5d6676]">{i.candidate.roleApplied} · with {name.get(i.interviewerId) ?? "a former member"}</span>
                  </span>
                  <span className="text-right text-[13.5px]">
                    {shortDate(londonDate(i.startsAt))}, <span className="tabular-nums">{londonTime(i.startsAt)}</span>
                    <span className={`block text-[12.5px] ${i.status === "CONFIRMED" ? "text-[#067647]" : "text-[#b54708]"}`}>{i.status === "CONFIRMED" ? "Confirmed" : "Not confirmed yet"}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : <HrEmpty title="No interviews booked">Nothing in the next 14 days.</HrEmpty>}
        </section>

        <section aria-labelledby="rem-h" className="hx-card">
          <div className="hx-card-head"><h2 id="rem-h" className="hx-card-title">Reminders due</h2></div>
          {reminders.length ? (
            <ul className="hx-list" data-testid="rc-reminders">
              {reminders.slice(0, 10).map((r) => (
                <li key={r.key}>
                  <span className="block text-[12.5px] font-semibold text-[#b54708]">{REMINDER_LABEL[r.kind]}</span>
                  <Link href={`/hr/recruitment/${r.candidateId}`} className="font-semibold text-[#161b26] no-underline hover:underline">{r.name}</Link> <span className="text-[13px] text-[#5d6676]">{r.reference}</span>
                  <span className="block text-[13px] text-[#344054]">{r.text}</span>
                </li>
              ))}
            </ul>
          ) : <HrEmpty title="Nothing due today" />}
          <p className="hx-note">Reminders go to the applicant&apos;s recruiter inside the platform. No emails or texts are sent to applicants: email, text and job-board connections are not set up.</p>
        </section>
      </div>

      {b.erasable && a.canErase ? (
        <p className="mt-[14px] rounded-[10px] border border-[#fedf89] bg-[#fffaeb] px-4 py-3 text-[13.5px] text-[#7a2e0e]"><strong>{b.erasable}</strong> closed application{b.erasable === 1 ? " is" : "s are"} past {b.erasable === 1 ? "its" : "their"} retention date. <Link href={url({ show: "closed" })} className="font-semibold">Review closed applications</Link> to remove personal details.</p>
      ) : null}
    </div>
  );
}
