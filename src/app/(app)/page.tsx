import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasPlatformPermission } from "@/server/auth/rbac";
import { dashboardMetrics } from "@/server/reports/metrics";
import { Badge, Empty, fmtDate, SimulatedBadge, StatusBadge } from "@/components/ui";
import { ArrowRight, CheckCircle, Info } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

export default async function Overview() {
  const ctx = await requireCtx();
  const m = await dashboardMetrics(ctx);
  const [changes, myAssignments, myAcks] = await Promise.all([
    db.regulatoryChange.findMany({ orderBy: { detectedAt: "desc" }, take: 6, include: { source: true } }),
    db.reviewAssignment.findMany({ where: { assigneeId: ctx.userId, status: "PENDING", revision: { closedAt: null } }, include: { revision: { include: { policy: true, draftVersion: true } } }, take: 10 }),
    db.acknowledgement.findMany({ where: { userId: ctx.userId, acknowledgedAt: null }, include: { publication: { include: { policy: true, version: true } } }, take: 10 }),
  ]);
  const admin = hasPlatformPermission(ctx, "sources.manage");
  const org = ctx.organisationId ? await db.organisation.findUnique({ where: { id: ctx.organisationId }, select: { name: true, isDemo: true } }) : null;
  const orgName = org?.name.replace(/\s+\(DEMO\)$/i, "") ?? "CSB platform";
  const now = new Date();
  const hour = Number(now.toLocaleString("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/London" }));
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const firstName = ctx.userName.split(/\s+/)[0];
  const today = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });

  // The agenda: every figure that can need someone's attention, in the order a manager would deal with it.
  const agenda: { label: string; say: (n: number) => string; detail: string; count: number; href: string; urgent?: boolean }[] = [
    { label: "Regulatory changes to triage", say: (n) => (n === 1 ? "A regulatory change is waiting to be triaged." : `${numberWord(n)} regulatory changes are waiting to be triaged.`), detail: "Detected on monitored sources. Decide whether each one applies.", count: m.newChanges, href: "/changes" },
    { label: "Impact assessments awaiting a decision", say: (n) => (n === 1 ? "An impact assessment needs a decision." : `${numberWord(n)} impact assessments need a decision.`), detail: "Proposed links between a change and your policies.", count: m.awaitingAssessment, href: "/queue" },
    { label: "Policies needing revision", say: (n) => (n === 1 ? "A policy needs revising." : `${numberWord(n)} policies need revising.`), detail: "A confirmed change, with no revision started yet.", count: m.policiesAwaitingRevision, href: "/queue" },
    { label: "Drafts awaiting approval", say: (n) => (n === 1 ? "A draft is waiting for approval." : `${numberWord(n)} drafts are waiting for approval.`), detail: "Revised text waiting for a reviewer or approver.", count: m.draftsAwaitingApproval, href: "/queue" },
    { label: "Policy reviews overdue", say: (n) => (n === 1 ? "A policy is past its review date." : `${numberWord(n)} policies are past their review date.`), detail: "Past their scheduled review date.", count: m.overdueReviews, href: "/policies?overdue=1", urgent: true },
    { label: "Compliance actions overdue", say: (n) => (n === 1 ? "A compliance action is overdue." : `${numberWord(n)} compliance actions are overdue.`), detail: "Open actions past their due date.", count: m.overdueActions, href: "/actions", urgent: true },
    { label: "Staff acknowledgements overdue", say: (n) => (n === 1 ? "A staff acknowledgement is overdue." : `${numberWord(n)} staff acknowledgements are overdue.`), detail: `${m.outstandingAcks} outstanding in total.`, count: m.overdueAcks, href: "/staff", urgent: true },
  ];
  const open = agenda.filter((a) => a.count > 0);
  const clear = agenda.filter((a) => a.count === 0);
  const items = open.reduce((n, a) => n + a.count, 0);
  const lead = open.length
    ? `${items === 1 ? "One item needs" : `${numberWord(items)} items need`} attention across ${open.length === 1 ? "one area" : `${numberWord(open.length).toLowerCase()} areas`}. ${open[0]!.say(open[0]!.count)}${open[1] ? ` ${open[1].say(open[1].count)}` : ""}`
    : "Nothing is waiting. Every change has been triaged, every review is in date and staff are up to date with their reading.";
  const monitored = m.sources.total - m.sources.manual;

  return (
    <>
      <header className="mb-8 grid gap-6 border-b border-navy-900 pb-7 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="max-w-3xl">
          <p className="eyebrow">{today} · {orgName}</p>
          <h1 className="mt-3 text-[2.5rem] leading-[1.1] tracking-[-0.02em]">{greeting}, {firstName}.</h1>
          <p className="mt-3 max-w-2xl font-serif text-[1.15rem] leading-relaxed text-slate-700">{lead}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/queue" className="btn-primary">Open change queue <ArrowRight size={15} aria-hidden="true" /></Link>
          <Link href="/policies/new" className="btn-secondary">Create a policy</Link>
        </div>
      </header>

      {org?.isDemo ? (
        <p className="-mt-4 mb-8 flex items-start gap-2 text-xs leading-5 text-slate-500">
          <Info size={15} className="mt-px shrink-0" aria-hidden="true" />
          <span><span className="font-medium text-slate-700">Sample workspace.</span> Records are illustrative. Regulatory proposals and status indicators need human verification and are not proof of compliance.</span>
        </p>
      ) : null}

      <section aria-labelledby="key-figures" className="mb-10">
        <h2 id="key-figures" className="sr-only">Key figures</h2>
        <dl className="grid grid-cols-2 border-y border-slate-300 lg:grid-cols-4">
          <KeyFigure label="Sources checked in window" value={`${m.sources.fresh}/${monitored}`} note={m.sources.failing + m.sources.stale ? `${m.sources.failing + m.sources.stale} failing or stale` : "All current"} warn={m.sources.failing + m.sources.stale > 0} href={admin ? "/admin/sources" : undefined} />
          <KeyFigure label="Published this month" value={m.publishedThisMonth} note="New or revised versions issued" />
          <KeyFigure label="Acknowledgements outstanding" value={m.outstandingAcks} note={m.overdueAcks ? `${m.overdueAcks} past due` : "None past due"} warn={m.overdueAcks > 0} href="/staff" />
          <KeyFigure label="Reviews overdue" value={m.overdueReviews} note={m.overdueReviews ? "Past scheduled review date" : "All in date"} warn={m.overdueReviews > 0} href="/policies?overdue=1" />
        </dl>
      </section>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section aria-labelledby="agenda-heading">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="agenda-heading" className="text-xl">Agenda</h2>
            <span className="eyebrow">{open.length ? `${open.length} open` : "All clear"}</span>
          </div>
          {open.length ? (
            <ol className="border-t-2 border-navy-900">
              {open.map((a, i) => (
                <li key={a.label}>
                  <Link href={a.href} className="group grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-x-4 border-b border-slate-200 py-4 no-underline hover:bg-white">
                    <span className="pl-1 font-mono text-xs text-slate-400">{String(i + 1).padStart(2, "0")}</span>
                    <span>
                      <span className="block font-medium text-navy-900 group-hover:underline group-hover:decoration-teal-400 group-hover:decoration-2 group-hover:underline-offset-4">{a.label}</span>
                      <span className="mt-0.5 block text-[13px] text-slate-500">{a.detail}</span>
                    </span>
                    <span className={`figure pr-1 text-3xl ${a.urgent ? "text-rose-700" : "text-navy-900"}`}>{a.count}</span>
                  </Link>
                </li>
              ))}
            </ol>
          ) : (
            <Empty>Nothing on the agenda today.</Empty>
          )}
          {clear.length ? (
            <p className="mt-4 flex items-start gap-2 text-[13px] leading-5 text-slate-500">
              <CheckCircle size={16} className="mt-px shrink-0 text-emerald-700" aria-hidden="true" />
              <span><span className="text-slate-700">Clear:</span> {clear.map((a) => a.label.charAt(0).toLowerCase() + a.label.slice(1)).join(", ")}.</span>
            </p>
          ) : null}
        </section>

        <div className="space-y-10">
          <section aria-labelledby="desk-heading">
            <h2 id="desk-heading" className="mb-3 text-xl">On your desk</h2>
            <div className="border-t-2 border-navy-900">
              <h3 className="eyebrow mt-4 font-sans">To review or approve</h3>
              {myAssignments.length ? (
                <ul className="mt-2 divide-y divide-slate-200">
                  {myAssignments.map((a) => (
                    <li key={a.id} className="flex items-baseline justify-between gap-3 py-2.5">
                      <Link href={`/revisions/${a.revisionId}`} className="min-w-0 text-sm"><span className="mr-2 font-mono text-xs text-slate-500">{a.revision.policy.ref}</span>{a.revision.policy.title}</Link>
                      <span className="flex shrink-0 items-center gap-2"><Badge>{a.role.toLowerCase()}</Badge><StatusBadge status={a.revision.draftVersion.status} /></span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-500">Nothing assigned to you.</p>
              )}
              <h3 className="eyebrow mt-6 font-sans">To read and sign</h3>
              {myAcks.length ? (
                <ul className="mt-2 divide-y divide-slate-200">
                  {myAcks.map((a) => (
                    <li key={a.id} className="flex items-baseline justify-between gap-3 py-2.5">
                      <Link href={`/policies/${a.publication.policyId}`} className="min-w-0 text-sm"><span className="mr-2 font-mono text-xs text-slate-500">{a.publication.policy.ref}</span>{a.publication.policy.title} <span className="text-slate-500">({a.publication.version.label})</span></Link>
                      <span className="shrink-0 text-xs text-slate-500">due {fmtDate(a.dueAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-500">You are up to date.</p>
              )}
            </div>
          </section>

          <section aria-labelledby="bulletin-heading">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 id="bulletin-heading" className="text-xl">Regulatory bulletin</h2>
              <Link href="/changes" className="text-sm">All updates</Link>
            </div>
            {changes.length ? (
              <ul className="border-t-2 border-navy-900">
                {changes.map((c) => (
                  <li key={c.id} className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-x-4 border-b border-slate-200 py-3.5">
                    <time dateTime={c.detectedAt.toISOString()} className="pt-0.5 font-mono text-[11px] uppercase leading-4 text-slate-500">{c.detectedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Europe/London" })}</time>
                    <div className="min-w-0">
                      <Link href={`/changes/${c.id}`} className="font-serif text-[15px] font-semibold leading-snug text-navy-900 no-underline hover:underline hover:decoration-teal-400 hover:decoration-2">{c.title.replace(/^SIMULATED:\s*/, "")}</Link>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <SimulatedBadge show={c.isSimulated} />
                        <StatusBadge status={c.status} />
                        <span className="truncate">{c.source.name}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No changes detected yet. Changes appear here after the monitor finds a genuine content change.</Empty>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

function KeyFigure({ label, value, note, warn = false, href }: { label: string; value: number | string; note: string; warn?: boolean; href?: string }) {
  const body = (
    <>
      <dt className="eyebrow">{label}</dt>
      <dd className="figure mt-2 text-[2.25rem] leading-none text-navy-900">{value}</dd>
      <dd className={`mt-2 text-xs ${warn ? "font-medium text-rose-700" : "text-slate-500"}`}>{note}</dd>
    </>
  );
  const cls = "block border-slate-300 px-4 py-5 no-underline not-first:border-l max-lg:nth-3:border-l-0 max-lg:nth-[n+3]:border-t";
  return href ? <Link href={href} className={`${cls} hover:bg-white`}>{body}</Link> : <div className={cls}>{body}</div>;
}

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
function numberWord(n: number) {
  return WORDS[n] ?? String(n);
}

