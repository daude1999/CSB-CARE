import Link from "@/components/link";
import { db } from "@/lib/db";
import { requireCtx } from "@/server/auth/current";
import { acknowledgeAction } from "../../actions";
import { Badge, Card, Empty, Flash, fmtDate, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AcknowledgementsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const acks = ctx.organisationId
    ? await db.acknowledgement.findMany({ where: { userId: ctx.userId, organisationId: ctx.organisationId }, orderBy: [{ acknowledgedAt: { sort: "asc", nulls: "first" } }, { dueAt: "asc" }], include: { publication: { include: { policy: { select: { id: true, ref: true, title: true } }, version: { select: { label: true, changeSummary: true } } } } } })
    : [];
  const now = new Date();
  return (
    <>
      <PageHeader title="My policies to read" subtitle="Policies published or updated that you have been asked to read and acknowledge." />
      <Flash searchParams={sp} />
      <Card>
        {acks.length ? (
          <ul className="space-y-3">
            {acks.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-200 p-3" data-testid={`ack-${a.publication.policy.ref}`}>
                <div>
                  <Link href={`/policies/${a.publication.policy.id}`} className="font-medium">{a.publication.policy.ref} {a.publication.policy.title}</Link> <span className="text-xs text-slate-500">{a.publication.version.label}</span>
                  {a.publication.version.changeSummary ? <div className="text-xs text-slate-500">What changed: {a.publication.version.changeSummary}</div> : null}
                  <div className="text-xs">{a.acknowledgedAt ? <Badge tone="green">acknowledged {fmtDate(a.acknowledgedAt)}</Badge> : a.dueAt && a.dueAt < now ? <Badge tone="rose">overdue since {fmtDate(a.dueAt)}</Badge> : <Badge tone="amber">due {fmtDate(a.dueAt)}</Badge>}</div>
                </div>
                {!a.acknowledgedAt ? (
                  <form action={acknowledgeAction}>
                    <input type="hidden" name="acknowledgementId" value={a.id} />
                    <input type="hidden" name="back" value="/acknowledgements" />
                    <button className="btn-primary" type="submit">I have read and understood this policy</button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>You have nothing to acknowledge.</Empty>
        )}
      </Card>
    </>
  );
}
