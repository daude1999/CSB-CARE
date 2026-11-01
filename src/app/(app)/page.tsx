import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { complianceDashboard } from "@/server/compliance/dashboard";
import { setupChecklist } from "@/server/setup/checklist";
import { SetupPanel } from "@/components/setup-panel";
import { ArrowRight, DotsThree, Info } from "@phosphor-icons/react/dist/ssr";
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
      <h1 className="flex h-[60px] items-center justify-center rounded-t-[6px] bg-[var(--module,#0f2a4f)] px-4 text-[20px] font-medium tracking-normal text-white">Compliance Centre Dashboard</h1>
      <div className="bg-[#f1f2f5] pb-4">
        {org?.isDemo ? (
          <p className="flex items-center gap-1.5 bg-white pb-2 pl-1 pt-2 text-[12px] text-slate-500"><Info size={14} aria-hidden="true" />Sample workspace. Records are illustrative and need human verification.</p>
        ) : null}

        <section aria-label="Key figures" className="grid grid-cols-1 gap-[10px] bg-white pb-2 pt-2 sm:grid-cols-2 xl:grid-cols-4">
          <Stat value={k.activePolicies} label={ctx.organisationId ? "Active policies" : "Active templates"} note={ctx.organisationId ? "Your organisation's library" : "CSB starter library"} ring="border-[#6d5fc0] text-[#4a3d9c]" href="/policies" />
          <Stat value={k.overdueReviews} label="Reviews overdue" note={k.overdueReviews ? "Past the review date" : "None overdue"} ring="border-[#e4544f] text-[#c3332c]" href="/policies?quick=overdue" />
          <Stat value={k.awaitingApproval} label="Awaiting approval" note="Submitted revisions" ring="border-[#e3934a] text-[#b35e14]" href={canUseQueue(ctx) ? "/queue" : "/policies?quick=awaiting"} />
          <Stat value={k.outstandingAcks} label={dash.manager ? "Sign-offs outstanding" : "To read and sign"} note={dash.manager ? "Staff yet to acknowledge" : "Your reading list"} ring="border-[#4a7fc9] text-[#2f5fa3]" href={dash.manager ? "/staff" : "/acknowledgements"} />
        </section>

        <div className="mt-[10px] grid grid-cols-1 gap-[10px] lg:grid-cols-3">
          <section aria-labelledby="attention-heading" className="min-w-0 rounded-[3px] bg-white px-[15px] pb-3 pt-3">
            <h2 id="attention-heading" className="text-[17px] font-normal tracking-normal text-slate-800">Needs attention</h2>
            {dash.attention.some((x) => x.count) ? (
              <ul className="mt-2 divide-y divide-slate-100" data-testid="needs-attention">
                {dash.attention.filter((x) => x.count).map((x) => (
                  <li key={x.key}>
                    <Link href={x.href} className="flex items-center gap-3 py-2.5 text-slate-800 no-underline hover:bg-slate-50">
                      <span className={`flex h-8 min-w-8 items-center justify-center rounded-full px-1.5 text-[14px] font-semibold tabular-nums ${x.tone === "rose" ? "bg-[#fde1e3] text-[#a3242c]" : "bg-[#fdf0d8] text-[#8a5a00]"}`}>{x.count}</span>
                      <span className="min-w-0 flex-1"><span className="block text-[14.5px] leading-5">{x.label}</span><span className="block text-[12.5px] text-slate-600">{x.detail}</span></span>
                      <ArrowRight size={14} aria-hidden="true" className="shrink-0 text-slate-400" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <p className="py-6 text-center text-[14px] text-slate-600">Nothing overdue or waiting on you.</p>}
          </section>

          <section aria-labelledby="activity-heading" className="min-w-0 rounded-[3px] bg-white px-[15px] pb-3 pt-3">
            <h2 id="activity-heading" className="text-[17px] font-normal tracking-normal text-slate-800">Recent activity <span className="text-[13px] text-slate-500">last 14 days</span></h2>
            {dash.activity.length ? (
              <ol className="mt-2 space-y-2.5" data-testid="recent-activity">
                {dash.activity.map((x, n) => (
                  <li key={n} className="text-[13.5px] leading-5">
                    <span className="text-[12px] tabular-nums text-slate-500">{fmtDate(x.at, true)}</span> · <span className="font-medium text-slate-800">{x.kind}</span>
                    <span className="block truncate">{x.href ? <Link href={x.href} className="text-[#1d4f91] no-underline hover:underline">{x.text}</Link> : x.text}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="py-6 text-center text-[14px] text-slate-600">No compliance activity in the last 14 days.</p>}
          </section>

          <section aria-labelledby="quick-heading" className="min-w-0 rounded-[3px] bg-white px-[15px] pb-3 pt-3">
            <h2 id="quick-heading" className="text-[17px] font-normal tracking-normal text-slate-800">Quick actions</h2>
            <ul className="mt-2 grid gap-1.5">
              {quickActions.map(([href, label]) => (
                <li key={href}><Link href={href} className="flex h-[38px] items-center justify-between rounded-[4px] border border-slate-200 px-3 text-[14px] text-slate-800 no-underline hover:border-[#1f5fd1] hover:text-[#0646b1]">{label}<ArrowRight size={14} aria-hidden="true" /></Link></li>
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

function Stat({ value, label, note, ring, href }: { value: number; label: string; note: string; ring: string; href: string }) {
  return (
    <Link href={href} className="flex h-[66px] items-center gap-[13px] whitespace-nowrap rounded-[3px] bg-white pl-[13px] pr-3 no-underline shadow-[0_0_0_1px_#eef1f3] hover:shadow-[0_0_0_1px_#c4cfdd]">
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-[17px] ${ring}`}>{value}</span>
      <span>
        <span className="block text-[20px] leading-[22px] text-slate-900">{label}</span>
        <span className="block text-[14px] leading-[18px] text-slate-600">{note}</span>
      </span>
    </Link>
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
