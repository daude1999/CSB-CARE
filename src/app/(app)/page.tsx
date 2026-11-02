import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { complianceDashboard } from "@/server/compliance/dashboard";
import { setupChecklist } from "@/server/setup/checklist";
import { SetupPanel } from "@/components/setup-panel";
import { ArrowRight, BookOpenText, CalendarBlank, CalendarX, DotsThree, Info, Plus, Signature, Stamp } from "@phosphor-icons/react/dist/ssr";
import { CompliancePageHeader, MODULE_PRIMARY } from "@/components/module-header";
import { canUseQueue } from "@/components/compliance-nav";
import { fmtDate } from "@/components/ui";

export const dynamic = "force-dynamic";

type RowStatus = "signed" | "unread" | "read" | "updated";

export default async function Dashboard() {
  const ctx = await requireCtx();
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const orgScope = ctx.organisationId ? { organisationId: ctx.organisationId } : { organisationId: null };
  const dash = await complianceDashboard(ctx, now);
  const [org, updatedRecently, publications, myAcks] = await Promise.all([
    ctx.organisationId ? db.organisation.findUnique({ where: { id: ctx.organisationId }, select: { name: true, isDemo: true } }) : null,
    db.policyPublication.count({ where: { ...orgScope, status: "PUBLISHED", publishedAt: { gte: monthAgo } } }),
    db.policyPublication.findMany({ where: { ...orgScope, status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: 20, include: { policy: { include: { category: true } } } }),
    ctx.organisationId ? db.acknowledgement.findMany({ where: { userId: ctx.userId, organisationId: ctx.organisationId, supersededAt: null, state: { notIn: ["WITHDRAWN", "EXEMPTED"] } }, select: { publicationId: true, acknowledgedAt: true, dueAt: true } }) : [],
  ]);
  const orgName = org?.name.replace(/\s+\(DEMO\)$/i, "") ?? "CSB";
  const firstName = ctx.userName.split(/\s+/)[0]!;

  // One row per policy, newest publication first.
  const seen = new Set<string>();
  const latest = publications.filter((p) => !seen.has(p.policyId) && seen.add(p.policyId)).slice(0, 5);
  const urgencies = await db.impactAssessment.findMany({ where: { policyId: { in: latest.map((p) => p.policyId) } }, orderBy: { createdAt: "desc" }, select: { policyId: true, urgency: true } });
  const urgencyOf = new Map<string, string>();
  for (const u of urgencies) if (!urgencyOf.has(u.policyId)) urgencyOf.set(u.policyId, u.urgency);
  const ackOf = new Map(myAcks.map((a) => [a.publicationId, a]));
  const statusOf = (publicationId: string, publishedAt: Date | null): RowStatus => {
    const ack = ackOf.get(publicationId);
    if (ack) return ack.acknowledgedAt ? "signed" : "unread";
    return publishedAt && publishedAt >= monthAgo ? "updated" : "read";
  };

  const overdue = myAcks.filter((a) => !a.acknowledgedAt && a.dueAt && a.dueAt < now).length;
  const due = myAcks.filter((a) => !a.acknowledgedAt).length;
  const signed = myAcks.filter((a) => a.acknowledgedAt).length;
  const signedShare = myAcks.length ? Math.round((signed / myAcks.length) * 100) : 100;

  const canManage = Boolean(ctx.organisationId) && hasOrgPermission(ctx, "org.manage");
  const steps = canManage ? await setupChecklist(ctx.organisationId!) : [];
  // Only links the person can open: a quick action or figure that leads to "not found" is a dead end.
  const quickActions = ([
    ["/policies/new", "Create a policy", hasOrgPermission(ctx, "policy.author")],
    ["/queue", "Open the review queue", canUseQueue(ctx)],
    ["/staff/rules", "Assign staff sign-off", hasOrgPermission(ctx, "signoff.manage")],
    ["/audits", "Start an audit", hasOrgPermission(ctx, "audit.conduct")],
    ["/actions", "Create a corrective action", hasOrgPermission(ctx, "action.manage")],
    ["/compliance/risks/new", "Add a risk", hasOrgPermission(ctx, "risk.manage")],
    ["/compliance/reports", "View compliance reports", hasOrgPermission(ctx, "report.view")],
    ["/acknowledgements", "My reading list", Boolean(ctx.organisationId)],
  ] as const).filter(([, , ok]) => ok);
  const k = dash.kpis;

  return (
    <div className="relative min-w-0">
      <CompliancePageHeader
        title="Policy & Compliance"
        back={null}
        subtitle={<>Your policies, staff sign-off, audits and regulatory updates. Figures are counted from your own records today ({fmtDate(now)}).</>}
        actions={hasOrgPermission(ctx, "policy.author") ? <Link href="/policies/new" className={MODULE_PRIMARY}><Plus size={16} weight="bold" aria-hidden="true" />Add policy</Link> : undefined}
      />
      <div className="pb-4">
        {org?.isDemo ? (
          <p className="mb-2 flex items-center gap-1.5 px-1 text-[12px] text-slate-500"><Info size={14} aria-hidden="true" />Sample workspace. Records are illustrative and need human verification.</p>
        ) : null}

        <section aria-label="Key figures" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Figure icon={<BookOpenText size={22} aria-hidden="true" />} value={k.activePolicies} label={ctx.organisationId ? "Active policies" : "Active templates"} note={ctx.organisationId ? "Your organisation's library" : "CSB starter library"} href="/policies" />
          <Figure icon={<CalendarX size={22} aria-hidden="true" />} value={k.overdueReviews} label="Reviews overdue" note="Past the policy's review date" href="/policies?quick=overdue" alert={k.overdueReviews > 0} />
          <Figure icon={<Stamp size={22} aria-hidden="true" />} value={k.awaitingApproval} label="Awaiting approval" note="Revisions submitted for review" href={canUseQueue(ctx) ? "/queue" : "/policies?quick=awaiting"} />
          <Figure icon={<Signature size={22} aria-hidden="true" />} value={k.outstandingAcks} label={dash.manager ? "Sign-offs outstanding" : "To read and sign"} note={dash.manager ? "Staff yet to acknowledge" : "Your reading list"} href={dash.manager ? "/staff" : "/acknowledgements"} />
        </section>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <section aria-labelledby="status-heading" className={CARD}>
            <h2 id="status-heading" className={CARD_H}>Policy review status</h2>
            <ReviewDonut status={dash.reviewStatus} />
            <p className="px-4 pb-3 text-[12px] leading-4 text-slate-500">Active policies only. &ldquo;Due soon&rdquo; means a review date in the next 60 days. This is not a compliance rating.</p>
          </section>

          <section aria-labelledby="attention-heading" className={CARD}>
            <h2 id="attention-heading" className={CARD_H}>Needs attention</h2>
            {dash.attention.some((x) => x.count) ? (
              <ul className="divide-y divide-slate-100" data-testid="needs-attention">
                {dash.attention.filter((x) => x.count).map((x) => (
                  <li key={x.key}>
                    <Link href={x.href} className="flex items-center gap-3 px-4 py-2.5 text-slate-800 no-underline hover:bg-slate-50">
                      <span className="min-w-0 flex-1"><span className="block text-[14.5px] font-medium leading-5">{x.label}</span><span className="block text-[12.5px] text-slate-600">{x.detail}</span></span>
                      <span className={`min-w-8 rounded-full px-2 text-center text-[13px] font-semibold tabular-nums ${x.tone === "rose" ? "bg-[#fde1e3] text-[#a3242c]" : "bg-[#fdf0d8] text-[#8a5a00]"}`}>{x.count}</span>
                      <ArrowRight size={14} aria-hidden="true" className="shrink-0 text-slate-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 py-6 text-center text-[14px] text-slate-600">Nothing overdue or waiting on you.</p>}
          </section>

          <section aria-labelledby="upcoming-heading" className={CARD}>
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 id="upcoming-heading" className="text-[16px] font-semibold tracking-normal text-slate-900">Upcoming reviews</h2>
              {ctx.organisationId ? <Link href="/policies?tab=calendar" className="text-[13.5px] font-semibold text-[#1f5fd1] no-underline hover:underline">Review calendar</Link> : null}
            </div>
            {dash.upcomingReviews.length ? (
              <ul className="divide-y divide-slate-100" data-testid="upcoming-reviews">
                {dash.upcomingReviews.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
                    <CalendarBlank size={18} aria-hidden="true" className="shrink-0 text-[#1f5fd1]" />
                    <Link href={`/policies/${p.id}`} className="min-w-0 flex-1 truncate text-[14px] font-medium text-slate-900 no-underline hover:underline">{p.title}</Link>
                    <span className="whitespace-nowrap text-[13px] tabular-nums text-slate-600">{p.nextReviewDate ? fmtDate(p.nextReviewDate) : "—"}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="px-4 py-6 text-center text-[14px] text-slate-600">No review dates set in the future.</p>}
          </section>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <section aria-labelledby="activity-heading" className={`${CARD} lg:col-span-2`}>
            <h2 id="activity-heading" className={CARD_H}>Recent activity <span className="text-[13px] font-normal text-slate-500">last 14 days</span></h2>
            {dash.activity.length ? (
              <ol className="divide-y divide-slate-100" data-testid="recent-activity">
                {dash.activity.slice(0, 6).map((x, n) => (
                  <li key={n} className="flex flex-wrap items-baseline gap-x-3 px-4 py-2 text-[13.5px] leading-5">
                    <span className="w-[130px] shrink-0 text-[12px] tabular-nums text-slate-500">{fmtDate(x.at, true)}</span>
                    <span className="w-[120px] shrink-0 font-medium text-slate-800">{x.kind}</span>
                    <span className="min-w-0 flex-1 truncate">{x.href ? <Link href={x.href} className="text-[#1d4f91] no-underline hover:underline">{x.text}</Link> : x.text}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="px-4 py-6 text-center text-[14px] text-slate-600">No compliance activity in the last 14 days.</p>}
          </section>

          <section aria-labelledby="quick-heading" className={CARD}>
            <h2 id="quick-heading" className={CARD_H}>Quick actions</h2>
            <ul className="grid gap-1.5 p-3">
              {quickActions.map(([href, label]) => (
                <li key={href}><Link href={href} className="flex h-[36px] items-center justify-between rounded-[6px] border border-slate-200 px-3 text-[14px] text-slate-800 no-underline hover:border-[#1f5fd1] hover:text-[#0646b1]">{label}<ArrowRight size={14} aria-hidden="true" /></Link></li>
              ))}
            </ul>
          </section>
        </div>
        <section aria-labelledby="recent-heading" className="relative mt-[10px] rounded-[3px] bg-white px-1.5 pb-4 pt-3">
          <h2 id="recent-heading" className="absolute left-[15px] top-3 text-[17px] font-normal tracking-normal text-slate-800">Recently published</h2>
          <ul className="flex flex-wrap justify-end gap-x-[18px] gap-y-1 pr-2.5 text-[14px] text-slate-700" aria-label="Status key">
            <li className="flex items-center gap-[7px]"><StatusMark status="signed" />Affirmed</li>
            <li className="flex items-center gap-[7px]"><StatusMark status="unread" />Unread</li>
            <li className="flex items-center gap-[7px]"><StatusMark status="read" />Read</li>
            <li className="flex items-center gap-[7px]"><StatusMark status="updated" />Updated</li>
          </ul>
          {latest.length ? (
            <div className="relative mt-3 min-w-0 max-w-full overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-[14px]">
                <thead>
                  <tr className="h-[38px] text-left text-[13px] text-slate-700">
                    <th className="w-[69px] pl-1 font-normal">Status <Sort /></th>
                    <th className="w-[79px] font-normal">Impact <Sort /></th>
                    <th className="w-[82px] font-normal">Ref No. <Sort /></th>
                    <th className="font-normal">Title <Sort /></th>
                    <th className="w-[290px] font-normal">Category <Sort /></th>
                    <th className="w-[250px] font-normal">Last Updated <Sort /></th>
                    <th className="w-[40px]"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {latest.map((p) => {
                    const status = statusOf(p.id, p.publishedAt);
                    return (
                      <tr key={p.id} className="h-[40px] bg-[#f5f9fc] leading-5 [&>td]:py-0 [&>td]:align-middle">
                        <td className="pl-6"><StatusMark status={status} /><span className="sr-only">{status}</span></td>
                        <td><ImpactBars urgency={urgencyOf.get(p.policyId)} /></td>
                        <td className="whitespace-nowrap text-slate-800">{p.policy.ref.replace(/^CSB-/, "")}</td>
                        <td><Link href={`/policies/${p.policyId}`} className="font-medium text-[#1d4f91] no-underline hover:underline">{p.policy.title}</Link></td>
                        <td className="whitespace-nowrap text-slate-800">{p.policy.category.name}</td>
                        <td className="whitespace-nowrap text-slate-800">{p.publishedAt ? p.publishedAt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "Europe/London" }).replace(/ (\d\d)$/, " '$1") : "—"}</td>
                        <td className="pr-2 text-right"><Link href={`/policies/${p.policyId}`} aria-label={`Open ${p.policy.title}`} className="ml-auto flex h-7 w-8 items-center justify-center rounded text-slate-900 hover:bg-slate-200"><DotsThree size={26} weight="bold" aria-hidden="true" /></Link></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-slate-500">No policies have been published yet.</p>
          )}
          <div className="mt-4 flex justify-center"><Link href="/policies" className="flex h-[35px] w-[141px] items-center justify-center rounded-[6px] border-[1.5px] border-slate-500 text-[14px] text-slate-800 no-underline hover:border-navy-900">View All ({updatedRecently})</Link></div>
        </section>

        <div className="mt-[10px] grid gap-3">
          <section aria-labelledby="reading-heading" className="relative flex min-h-[308px] flex-col rounded-[3px] bg-white px-[15px] pt-3">
            <h2 id="reading-heading" className="text-[17px] font-normal tracking-normal text-slate-800">My Reading List</h2>
            <div className="mt-[62px] flex justify-between px-2.5 text-center">
              <p className="text-[12px] text-slate-700"><span className="block text-[20px] leading-[22px] text-[#a3242c]">{overdue}</span>Overdue</p>
              <p className="text-[12px] text-slate-700"><span className="block text-[20px] leading-[22px] text-navy-700">{due}</span>Total due</p>
              <p className="text-[12px] text-slate-700"><span className="block text-[20px] leading-[22px] text-slate-800">{signed}</span>Total Completed</p>
            </div>
            <div className="mx-2.5 mt-3 h-[18px] overflow-hidden rounded-full bg-slate-200" role="img" aria-label={`${signedShare}% completed`}>
              <div className="h-full rounded-full bg-[#3289f8]" style={{ width: `${signedShare}%` }} />
            </div>
            <div className="mt-auto flex justify-center pb-6"><Link href="/acknowledgements" className="flex h-[35px] w-[110px] items-center justify-center rounded-[6px] border-[1.5px] border-slate-500 text-[14px] text-slate-800 no-underline hover:border-navy-900">View all</Link></div>
          </section>

        </div>
      </div>

      {canManage ? <SetupPanel firstName={firstName} orgName={orgName} steps={steps} /> : null}
    </div>
  );
}

function Sort() {
  return <svg width="9" height="6" viewBox="0 0 9 6" aria-hidden="true" className="ml-1 inline"><path d="M0 0h9L4.5 6z" fill="currentColor" /></svg>;
}

const CARD = "min-w-0 rounded-[8px] border border-slate-200 bg-white";
const CARD_H = "border-b border-slate-100 px-4 py-3 text-[16px] font-semibold tracking-normal text-slate-900";

function Figure({ icon, value, label, note, href, alert = false }: { icon: React.ReactNode; value: number; label: string; note: string; href: string; alert?: boolean }) {
  return (
    <Link href={href} className="flex min-w-0 items-center gap-3.5 rounded-[8px] border border-slate-200 bg-white px-4 py-3 no-underline hover:border-[#9db8ee] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1f5fd1]">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px] ${alert ? "bg-[#fde1e3] text-[#a3242c]" : "bg-[#eaf1fd] text-[#1f5fd1]"}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[14px] font-medium text-slate-700">{label}</span>
        <span className="block text-[26px] font-semibold leading-8 tabular-nums text-slate-900">{value}</span>
        <span className="block truncate text-[12px] text-slate-500">{note}</span>
      </span>
    </Link>
  );
}

/** A ring of the active library by review status, with a linked legend. Counts only; no percentage score. */
function ReviewDonut({ status }: { status: { current: number; dueSoon: number; overdue: number } }) {
  const total = status.current + status.dueSoon + status.overdue;
  const parts = [
    { label: "Current", n: status.current, colour: "#1c7a43", href: "/policies" },
    { label: "Due soon", n: status.dueSoon, colour: "#d08700", href: "/policies?quick=due" },
    { label: "Overdue", n: status.overdue, colour: "#c4323a", href: "/policies?quick=overdue" },
  ];
  const r = 44;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="flex flex-wrap items-center gap-6 px-4 py-4" data-testid="review-status">
      <svg width="120" height="120" viewBox="0 0 120 120" role="img" aria-label={`${total} active policies: ${parts.map((p) => `${p.n} ${p.label.toLowerCase()}`).join(", ")}`}>
        <circle cx="60" cy="60" r={r} fill="none" stroke="#e8ebf0" strokeWidth="14" />
        {total
          ? parts.map((p) => {
              const len = (p.n / total) * c;
              const el = <circle key={p.label} cx="60" cy="60" r={r} fill="none" stroke={p.colour} strokeWidth="14" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)" />;
              offset += len;
              return el;
            })
          : null}
        <text x="60" y="58" textAnchor="middle" fontSize="24" fontWeight="600" fill="#0f172a">{total}</text>
        <text x="60" y="76" textAnchor="middle" fontSize="11" fill="#64748b">policies</text>
      </svg>
      <ul className="grid flex-1 gap-2 text-[14px]">
        {parts.map((p) => (
          <li key={p.label}>
            <Link href={p.href} className="flex items-center gap-2 text-slate-800 no-underline hover:underline">
              <span aria-hidden="true" className="h-3 w-3 rounded-full" style={{ background: p.colour }} />
              <span className="flex-1">{p.label}</span>
              <span className="font-semibold tabular-nums">{p.n}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusMark({ status }: { status: RowStatus }) {
  if (status === "signed") return <svg width="20" height="16" viewBox="0 0 24 20" aria-hidden="true" className="inline"><path d="M2 11l6 6L22 3" stroke="#28b463" strokeWidth="4" fill="none" /></svg>;
  if (status === "unread") return <span aria-hidden="true" className="inline-block h-[11px] w-[11px] rotate-45 bg-[#f64149]" />;
  if (status === "read") return <span aria-hidden="true" className="inline-block h-[15px] w-[15px] bg-[#2f8bf4]" />;
  return <span aria-hidden="true" className="inline-block h-[15px] w-[15px] rounded-full bg-[#f0a92e]" />;
}

function ImpactBars({ urgency }: { urgency?: string }) {
  const level = urgency === "URGENT" || urgency === "HIGH" ? 3 : urgency === "MEDIUM" ? 2 : 1;
  const name = level === 3 ? "High" : level === 2 ? "Medium" : "Low";
  const fill = level === 1 ? "#28b463" : "#2f8bf4";
  return (
    <svg role="img" aria-label={`${name} impact`} width="30" height="22" viewBox="0 0 30 22">
      {[0, 1, 2].map((i) => (
        <rect key={i} x={2 + i * 8} y={15 - i * 6.5} width="4" height={7 + i * 6.5} fill={i < level ? fill : "#dfe5e8"} />
      ))}
    </svg>
  );
}
