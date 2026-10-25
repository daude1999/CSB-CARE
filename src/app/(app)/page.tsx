import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission } from "@/server/auth/rbac";
import { dashboardMetrics } from "@/server/reports/metrics";
import { setupChecklist } from "@/server/setup/checklist";
import { SetupPanel } from "@/components/setup-panel";
import { fmtDate } from "@/components/ui";
import { CaretDown, Check, DotsThree, Info } from "@phosphor-icons/react/dist/ssr";

export const dynamic = "force-dynamic";

type RowStatus = "signed" | "unread" | "read" | "updated";

export default async function Dashboard() {
  const ctx = await requireCtx();
  const now = new Date();
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const orgScope = ctx.organisationId ? { organisationId: ctx.organisationId } : { organisationId: null };
  const m = await dashboardMetrics(ctx);
  const [org, updatedRecently, ownPolicies, publications, myAcks, changes, changesThisMonth] = await Promise.all([
    ctx.organisationId ? db.organisation.findUnique({ where: { id: ctx.organisationId }, select: { name: true, isDemo: true } }) : null,
    db.policyPublication.count({ where: { ...orgScope, status: "PUBLISHED", publishedAt: { gte: monthAgo } } }),
    db.policy.count({ where: { ...orgScope, status: "ACTIVE" } }),
    db.policyPublication.findMany({ where: { ...orgScope, status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, take: 20, include: { policy: { include: { category: true } } } }),
    ctx.organisationId ? db.acknowledgement.findMany({ where: { userId: ctx.userId, organisationId: ctx.organisationId }, select: { publicationId: true, acknowledgedAt: true, dueAt: true } }) : [],
    db.regulatoryChange.findMany({ orderBy: { detectedAt: "desc" }, take: 3, select: { id: true, title: true, detectedAt: true } }),
    db.regulatoryChange.count({ where: { detectedAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } } }),
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
  const month = now.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "Europe/London" });

  return (
    <div>
      <h1 className="rounded-t-[6px] bg-navy-900 px-4 py-3.5 text-center text-[17px] font-medium tracking-normal text-white">Compliance Dashboard</h1>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {org?.isDemo ? (
          <p className="flex items-center gap-1.5 text-[12px] text-slate-500"><Info size={14} aria-hidden="true" />Sample workspace. Records are illustrative and need human verification.</p>
        ) : <span />}
        <details className="relative">
          <summary className="flex h-8 cursor-pointer list-none items-center gap-1.5 rounded-[6px] border border-slate-400 bg-white px-3 text-[12.5px] text-navy-900 [&::-webkit-details-marker]:hidden">Quick actions <CaretDown size={12} weight="bold" aria-hidden="true" /></summary>
          <div className="absolute right-0 z-10 mt-1 flex w-56 flex-col rounded-[6px] border border-slate-200 bg-white py-1 shadow-lg">
            {[["/queue", "Open the change queue"], ["/changes", "See regulatory updates"], ["/policies/new", "Create a policy"], ["/acknowledgements", "My policies to read"], ["/reports", "Reports"]].map(([href, label]) => (
              <Link key={href} href={href!} className="px-3 py-2 text-[13px] text-navy-900 no-underline hover:bg-slate-100">{label}</Link>
            ))}
          </div>
        </details>
      </div>

      <section aria-label="Key figures" className="mt-3 flex flex-wrap gap-3">
        <Stat value={updatedRecently} label="Policies Updated" note="In last 30 days" ring="border-amber-500 text-amber-700" href="/policies" />
        <Stat value={m.newChanges + m.awaitingAssessment} label="Changes to Review" note="Regulatory updates waiting" ring="border-rose-600 text-rose-700" href="/changes" />
        <Stat value={m.outstandingAcks} label="Awaiting Signature" note={m.overdueAcks ? `${m.overdueAcks} past due` : "Staff yet to read and sign"} ring="border-sky-600 text-sky-700" href="/staff" />
        <Stat value={ownPolicies} label={ctx.organisationId ? "Own Policies" : "Templates"} note="In your library" ring="border-violet-600 text-violet-700" href="/policies" />
      </section>

      <section aria-labelledby="recent-heading" className="mt-3 rounded-[6px] border border-slate-200 bg-white px-3 pb-3 pt-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="recent-heading" className="text-[14px] font-medium">Recently updated policies</h2>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-700" aria-label="Status key">
            <li className="flex items-center gap-1.5"><StatusMark status="signed" />Signed</li>
            <li className="flex items-center gap-1.5"><StatusMark status="unread" />Unread</li>
            <li className="flex items-center gap-1.5"><StatusMark status="read" />Read</li>
            <li className="flex items-center gap-1.5"><StatusMark status="updated" />Updated</li>
          </ul>
        </div>
        {latest.length ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-slate-700">
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Impact</th>
                  <th className="px-2 py-2 font-medium">Ref No.</th>
                  <th className="w-[44%] px-2 py-2 font-medium">Title</th>
                  <th className="px-2 py-2 font-medium">Category</th>
                  <th className="px-2 py-2 font-medium">Last Updated</th>
                  <th className="px-2 py-2"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {latest.map((p) => {
                  const status = statusOf(p.id, p.publishedAt);
                  return (
                    <tr key={p.id} className="h-9 odd:bg-slate-50">
                      <td className="px-2 pl-4"><StatusMark status={status} /><span className="sr-only">{status}</span></td>
                      <td className="px-2"><ImpactBars urgency={urgencyOf.get(p.policyId)} /></td>
                      <td className="whitespace-nowrap px-2 text-[12.5px] text-slate-700">{p.policy.ref}</td>
                      <td className="px-2"><Link href={`/policies/${p.policyId}`} className="text-sky-800 no-underline hover:underline">{p.policy.title}</Link></td>
                      <td className="whitespace-nowrap px-2 text-slate-700">{p.policy.category.name}</td>
                      <td className="whitespace-nowrap px-2 text-slate-700">{fmtDate(p.publishedAt)}</td>
                      <td className="px-2 text-right"><Link href={`/policies/${p.policyId}`} aria-label={`Open ${p.policy.title}`} className="inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-navy-900 hover:bg-slate-200"><DotsThree size={22} weight="bold" aria-hidden="true" /></Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-slate-500">No policies have been published yet.</p>
        )}
        <div className="mt-3 flex justify-center"><Link href="/policies" className="rounded-[6px] border border-slate-400 px-5 py-1.5 text-[12.5px] text-navy-900 no-underline hover:border-navy-900">View all ({updatedRecently})</Link></div>
      </section>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <section aria-labelledby="reading-heading" className="flex min-h-[250px] flex-col rounded-[6px] border border-slate-200 bg-white px-4 py-3">
          <h2 id="reading-heading" className="text-[15px] font-normal">My Read and Sign List</h2>
          <div className="mt-8 flex justify-between text-center">
            <p><span className="block text-[18px] font-medium text-rose-700">{overdue}</span><span className="block text-[11px] text-slate-600">Overdue</span></p>
            <p><span className="block text-[18px] font-medium text-navy-900">{due}</span><span className="block text-[11px] text-slate-600">To read</span></p>
            <p><span className="block text-[18px] font-medium text-navy-900">{signed}</span><span className="block text-[11px] text-slate-600">Signed</span></p>
          </div>
          <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200" role="img" aria-label={`${signedShare}% signed`}>
            <div className="h-full rounded-full bg-sky-600" style={{ width: `${signedShare}%` }} />
          </div>
          <div className="mt-auto flex justify-center pt-6"><Link href="/acknowledgements" className="rounded-[6px] border border-slate-400 px-6 py-1.5 text-[12.5px] text-navy-900 no-underline hover:border-navy-900">View all</Link></div>
        </section>

        <section aria-labelledby="month-heading" className="flex min-h-[250px] flex-col rounded-[6px] border border-teal-500 bg-teal-100 px-4 py-3">
          <h2 id="month-heading" className="text-[15px] font-normal text-navy-900">This Month at CSB</h2>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-4">
            <div className="relative flex h-[118px] w-[210px] flex-col justify-center overflow-hidden rounded-[4px] bg-navy-900 px-4 text-white" aria-hidden="true">
              <div className="absolute inset-y-0 right-0 w-1/2 bg-teal-500 [clip-path:polygon(60%_0,100%_0,100%_100%,0_100%)]" />
              <span className="relative text-[10px] font-medium tracking-[0.08em] text-teal-200">CSB</span>
              <span className="relative text-[17px] font-bold leading-tight">Monthly<br />Briefing</span>
              <span className="absolute bottom-2.5 right-3 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-navy-900">{month}</span>
            </div>
            <div className="min-w-0 flex-1 basis-[160px]">
              <p className="text-[12.5px] font-medium text-navy-900">{changesThisMonth === 1 ? "1 regulatory update" : `${changesThisMonth} regulatory updates`} this month</p>
              <ul className="mt-1.5 space-y-1.5">
                {changes.map((c) => (
                  <li key={c.id} className="text-[12.5px] leading-snug"><Link href={`/changes/${c.id}`} className="text-navy-900 underline-offset-2 hover:underline">{c.title.replace(/^SIMULATED:\s*/, "")}</Link></li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-auto flex justify-center pt-4"><Link href="/changes" className="rounded-[6px] border border-slate-400 bg-white px-6 py-1.5 text-[12.5px] text-navy-900 no-underline hover:border-navy-900">View updates</Link></div>
        </section>
      </div>

      {canManage ? <SetupPanel firstName={firstName} orgName={orgName} steps={steps} /> : null}
    </div>
  );
}

function Stat({ value, label, note, ring, href }: { value: number; label: string; note: string; ring: string; href: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-[6px] border border-slate-200 bg-white py-2.5 pl-2.5 pr-5 no-underline shadow-[0_1px_3px_rgb(0_0_0/0.06)] hover:border-slate-400">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 text-[14px] font-medium ${ring}`}>{value}</span>
      <span>
        <span className="block text-[16px] font-medium leading-tight text-navy-900">{label}</span>
        <span className="block text-[12px] text-slate-600">{note}</span>
      </span>
    </Link>
  );
}

function StatusMark({ status }: { status: RowStatus }) {
  if (status === "signed") return <Check size={14} weight="bold" className="text-emerald-600" aria-hidden="true" />;
  if (status === "unread") return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rotate-45 bg-rose-600" />;
  if (status === "read") return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 bg-sky-600" />;
  return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full bg-amber-500" />;
}

function ImpactBars({ urgency }: { urgency?: string }) {
  const level = urgency === "URGENT" || urgency === "HIGH" ? 3 : urgency === "MEDIUM" ? 2 : 1;
  const name = level === 3 ? "High" : level === 2 ? "Medium" : "Low";
  return (
    <svg role="img" aria-label={`${name} impact`} width="18" height="15" viewBox="0 0 18 15">
      {[0, 1, 2].map((i) => (
        <rect key={i} x={i * 6} y={10 - i * 5} width="4" height={5 + i * 5} className={i < level ? "fill-sky-600" : "fill-slate-300"} />
      ))}
    </svg>
  );
}
