import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { Badge, Flash, fmtDate, PageHeader, SimulatedBadge, StatusBadge } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function QueuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
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
      <PageHeader eyebrow="Revisions · draft to publication" title="Policy Change Queue" subtitle="Every change to a policy moves from draft, through review and approval, to publication. Nothing here reaches staff until it is published." />
      <Flash searchParams={sp} />
      {needsDraft.length ? (
        <section className="mb-8 border-l-2 border-rose-600 bg-white px-5 py-4" aria-labelledby="needs-draft">
          <h2 id="needs-draft" className="text-base">Revision required, no draft started <span className="ml-1 font-mono text-xs font-normal text-slate-500">{needsDraft.length}</span></h2>
          <ul className="mt-2 divide-y divide-slate-200 text-sm">
            {needsDraft.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <Link href={`/changes/${a.change.id}`}><span className="mr-2 font-mono text-xs">{a.policy.ref}</span>{a.policy.title}</Link>
                <span className="text-xs text-slate-500">because of “{a.change.title.replace(/^SIMULATED:\s*/, "")}”</span>
                <SimulatedBadge show={a.change.isSimulated} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <ol className="grid gap-6 lg:grid-cols-3 [&>*]:min-w-0">
        {columns.map((col, n) => (
          <li key={col.title} className="min-w-0">
            <div className="flex items-end justify-between border-b-2 border-navy-900 pb-2">
              <div>
                <div className="font-mono text-[11px] text-slate-400">Step {n + 1} of 3</div>
                <h2 className="text-[17px]">{col.title}</h2>
              </div>
              <span className="figure text-3xl leading-none text-navy-900">{col.items.length}</span>
            </div>
            {col.items.length ? (
              <ul className="mt-3 space-y-3">
                {col.items.map((r) => (
                  <li key={r.id} className={`border-l-2 bg-white px-4 py-3 ${["HIGH", "URGENT"].includes(r.urgency) ? "border-rose-600" : r.urgency === "MEDIUM" ? "border-amber-500" : "border-slate-300"}`} data-testid={`queue-${r.policy.ref}`}>
                    <div className="font-mono text-[11px] text-slate-500">{r.policy.ref} · {r.draftVersion.label}</div>
                    <Link href={`/revisions/${r.id}`} className="mt-0.5 block font-serif text-[16px] font-semibold leading-snug text-navy-900 no-underline hover:underline hover:decoration-teal-400 hover:decoration-2">{r.policy.title}</Link>
                    <p className="mt-1 text-xs text-slate-600">{r.title}</p>
                    {r.impactAssessment ? <p className="mt-1 text-xs text-slate-500">Prompted by: {r.impactAssessment.change.title.replace(/^SIMULATED:\s*/, "")}</p> : null}
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={r.draftVersion.status} />
                      <Badge>{r.kind.replace(/_/g, " ").toLowerCase()}</Badge>
                      <StatusBadge status={r.urgency} />
                      <SimulatedBadge show={r.isSimulated} />
                      {mine.has(r.id) ? <Badge tone="teal">assigned to you</Badge> : null}
                    </div>
                    <div className="mt-2 text-[11px] text-slate-400">Opened {fmtDate(r.createdAt)}{r.dueAt ? ` · due ${fmtDate(r.dueAt)}` : ""}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm italic text-slate-400">Nothing at this step.</p>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
