import Link from "@/components/link";
import { ComplianceTabs } from "@/components/compliance-nav";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { requireCtx } from "@/server/auth/current";
import { hasOrgPermission, hasPlatformPermission } from "@/server/auth/rbac";
import { Badge, Flash, fmtDate, PageHeader, SimulatedBadge, Stat, StatRow, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  // The same people the menu shows the queue to: anyone else would only meet drafts they cannot open.
  const canQueue = hasOrgPermission(ctx, "policy.author") || hasOrgPermission(ctx, "policy.review") || hasOrgPermission(ctx, "policy.approve") || hasPlatformPermission(ctx, "master.review") || hasPlatformPermission(ctx, "master.author");
  if (!canQueue) notFound();
  const scope = { organisationId: ctx.organisationId ?? null };
  const [revisions, needsDraft, myAssignments] = await Promise.all([
    db.policyRevision.findMany({
      where: { ...scope, closedAt: null },
      orderBy: [{ urgency: "desc" }, { createdAt: "asc" }],
      include: { policy: { select: { id: true, ref: true, title: true } }, draftVersion: { select: { status: true, label: true } }, assignments: true, impactAssessment: { select: { change: { select: { id: true, title: true, isSimulated: true } } } } },
    }),
    db.impactAssessment.findMany({
      where: { ...scope, status: "CONFIRMED_REVISION_REQUIRED", revisions: { none: { closedAt: null } } },
      include: { policy: { select: { id: true, ref: true, title: true } }, change: { select: { id: true, title: true, isSimulated: true } } },
    }),
    db.reviewAssignment.findMany({ where: { assigneeId: ctx.userId, status: "PENDING", revision: { closedAt: null, ...scope } }, select: { revisionId: true } }),
  ]);
  const mine = new Set(myAssignments.map((a) => a.revisionId));
  const columns = [
    { title: "Drafts in progress", items: revisions.filter((r) => ["DRAFT", "CHANGES_REQUESTED"].includes(r.draftVersion.status)) },
    { title: "Awaiting review and approval", items: revisions.filter((r) => r.draftVersion.status === "UNDER_REVIEW") },
    { title: "Approved, ready to publish or scheduled", items: revisions.filter((r) => ["APPROVED", "SCHEDULED"].includes(r.draftVersion.status)) },
  ];
  return (
    <>
      <PageHeader tabs={<ComplianceTabs ctx={ctx} ws="library" active="queue" />} eyebrow="Revisions · draft to publication" title="Review & Approval Queue" subtitle="Every change to a policy moves from draft, through review and approval, to publication. Nothing here reaches staff until it is published." />
      <Flash searchParams={sp} />
      <StatRow>
        <Stat label="Needs a Draft" value={needsDraft.length} hint="Revision required, not started" tone="rose" />
        <Stat label="Drafts" value={columns[0]!.items.length} hint="Being written" tone="amber" />
        <Stat label="In Review" value={columns[1]!.items.length} hint="Awaiting review and approval" tone="navy" />
        <Stat label="Ready to Publish" value={columns[2]!.items.length} hint="Approved or scheduled" tone="green" />
      </StatRow>
      {needsDraft.length ? (
        <section className="mb-3 rounded-[3px] border-l-4 border-[#e4544f] bg-white px-[15px] py-3" aria-labelledby="needs-draft">
          <h2 id="needs-draft" className="flex items-center gap-2 text-[17px]">Revision required, no draft started <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-[#f06a4d] px-1.5 text-[12px] font-medium text-white">{needsDraft.length}</span></h2>
          <ul className="rows mt-2 text-[14px]">
            {needsDraft.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="w-[86px] shrink-0 text-slate-700">{a.policy.ref.replace(/^CSB-/, "")}</span>
                <Link href={`/changes/${a.change.id}`} className="row-title">{a.policy.title}</Link>
                <span className="text-[13px] text-slate-600">because of “{a.change.title.replace(/^SIMULATED:\s*/, "")}”</span>
                <SimulatedBadge show={a.change.isSimulated} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ol className="grid gap-3 lg:grid-cols-3">
        {columns.map((col, n) => (
          <li key={col.title} className="panel min-w-0">
            <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 text-[17px] ${["border-[#e3934a] text-[#b35e14]", "border-[#4a7fc9] text-[#2f5fa3]", "border-[#3fae6a] text-[#1c7a43]"][n]}`}>{col.items.length}</span>
              <div>
                <div className="text-[12px] text-slate-500">Step {n + 1} of 3</div>
                <h2 className="text-[17px] leading-snug">{col.title}</h2>
              </div>
            </div>
            {col.items.length ? (
              <ul className="rows mt-3">
                {col.items.map((r) => (
                  <li key={r.id} className={`border-l-4 py-3 ${["HIGH", "URGENT"].includes(r.urgency) ? "border-[#e4544f]" : r.urgency === "MEDIUM" ? "border-[#f0a92e]" : "border-slate-300"}`} data-testid={`queue-${r.policy.ref}`}>
                    <div className="text-[12.5px] text-slate-600">{r.policy.ref} · {r.draftVersion.label}</div>
                    <Link href={`/revisions/${r.id}`} className="row-title mt-0.5 block text-[15.5px] leading-snug">{r.policy.title}</Link>
                    <p className="mt-1 text-[13px] text-slate-700">{r.title}</p>
                    {r.impactAssessment ? <p className="mt-1 text-[12.5px] text-slate-600">Prompted by: {r.impactAssessment.change.title.replace(/^SIMULATED:\s*/, "")}</p> : null}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={r.draftVersion.status} />
                      <Badge>{r.kind.replace(/_/g, " ").toLowerCase()}</Badge>
                      <StatusBadge status={r.urgency} />
                      <SimulatedBadge show={r.isSimulated} />
                      {mine.has(r.id) ? <Badge tone="teal">Assigned to you</Badge> : null}
                    </div>
                    <div className="mt-2 text-[12px] text-slate-500">Opened {fmtDate(r.createdAt)}{r.dueAt ? ` · due ${fmtDate(r.dueAt)}` : ""}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-6 text-center text-[14px] text-slate-500">Nothing at this step.</p>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
